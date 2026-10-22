import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, resetDatabase, signUp } from "./support.js";

/**
 * The speech endpoint boundary. Whisper is stubbed: these tests are about the
 * HTTP contract, the speechless path, user-facing errors, and the fact that a
 * recording is never persisted — not about model accuracy.
 */
const calls: Buffer[] = [];
let app: FastifyInstance;

function stubVoice(text: string, override: Record<string, unknown> = {}) {
  return {
    transcribe: (audio: Buffer) => {
      calls.push(audio);
      return Promise.resolve({
        text,
        audioSeconds: 4.7,
        seconds: 1.2,
        timings: { decodeMs: 5, vadMs: 2, inferMs: 1000, totalMs: 1007 },
        ...override,
      });
    },
    stop: (): void => undefined,
  };
}

beforeAll(async () => {
  app = makeApp({ voice: stubVoice("午餐三十五元，用微信支付。") });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  calls.length = 0;
});

const WAV_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.alloc(4),
  Buffer.from("WAVEfmt ", "ascii"),
  Buffer.alloc(32),
]);

function multipart(files: readonly { readonly field: string; readonly filename: string; readonly type: string; readonly body: Buffer }[]): {
  readonly payload: Buffer;
  readonly headers: Record<string, string>;
} {
  const boundary = "----libellumtestboundary";
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
        "utf8",
      ),
      file.body,
      Buffer.from("\r\n", "utf8"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

function voiceForm() {
  return multipart([{ field: "file", filename: "recording.wav", type: "audio/wav", body: WAV_BYTES }]);
}

describe("POST /voice/transcribe", () => {
  it("returns the transcript and parsed fields without writing anything", async () => {
    const cookie = await signUp(app, "voice_ok");
    const form = voiceForm();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/voice/transcribe",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      text: "午餐三十五元，用微信支付。",
      amount: "35",
      kind: "expense",
      audioSeconds: 4.7,
      seconds: 1.2,
      parsed: {
        amount: "35",
        currency: "CNY",
        kind: "expense",
        paymentMethod: "微信",
        note: "午餐，用微信支付",
      },
    });
    expect(response.json().parsed.categoryId).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("treats speechless text as success with empty fields", async () => {
    const speechlessApp = makeApp({ voice: stubVoice("", { speechless: true, timings: { decodeMs: 4, vadMs: 1, inferMs: 0, totalMs: 5 } }) });
    await speechlessApp.ready();
    try {
      const cookie = await signUp(speechlessApp, "voice_silent");
      const form = voiceForm();
      const response = await speechlessApp.inject({
        method: "POST",
        url: "/api/v1/voice/transcribe",
        headers: { ...form.headers, cookie },
        payload: form.payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ text: "", amount: null, kind: "expense" });
    } finally {
      await speechlessApp.close();
    }
  });

  it("returns a short availability error, not the technical failure, when the service fails", async () => {
    const failing = makeApp({
      voice: {
        transcribe: () => Promise.reject(new Error("PyAV backend exploded: secret detail")),
        stop: (): void => undefined,
      },
    });
    await failing.ready();
    try {
      const cookie = await signUp(failing, "voice_fail");
      const form = voiceForm();
      const response = await failing.inject({
        method: "POST",
        url: "/api/v1/voice/transcribe",
        headers: { ...form.headers, cookie },
        payload: form.payload,
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { code: string; message: string };
      expect(body.code).toBe("voice_unavailable");
      expect(body.message).toContain("暂时不可用");
      expect(body.message).not.toContain("PyAV");
      expect(body.message).not.toContain("secret");
    } finally {
      await failing.close();
    }
  });

  it("rejects non-audio bytes before calling the transcriber", async () => {
    const cookie = await signUp(app, "voice_bad");
    const form = multipart([{ field: "file", filename: "photo.jpg", type: "image/jpeg", body: Buffer.from("not audio") }]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/voice/transcribe",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });
    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("requires a session", async () => {
    const form = voiceForm();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/voice/transcribe",
      headers: form.headers,
      payload: form.payload,
    });
    expect(response.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
