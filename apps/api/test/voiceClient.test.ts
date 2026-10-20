import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TranscriptionRejected,
  VoiceBusyError,
  VoiceService,
  VoiceServiceError,
} from "../src/voice/client.js";

/**
 * The child-process lifecycle, without Python or Whisper.
 *
 * These tests pin down the failures that used to wait for the old 300/600-second
 * timers: a child that exits before ready must reject immediately, and the next
 * request must be able to start a fresh child. The last block is the S15-A
 * concurrency bound — the queue that keeps a burst of recordings from turning
 * into a slow-motion outage.
 */
const services: VoiceService[] = [];
const directories: string[] = [];

async function fixture(program: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "libevra-voice-client-"));
  directories.push(directory);
  const script = path.join(directory, "fake-service.py");
  await writeFile(script, program, "utf8");
  return script;
}

interface ServiceOptions {
  readonly startupTimeoutMs?: number;
  readonly transcribeTimeoutMs?: number;
  readonly maxConcurrent?: number;
  readonly maxQueue?: number;
  readonly queueTimeoutMs?: number;
}

function service(script: string, options: ServiceOptions = {}): VoiceService {
  const instance = new VoiceService({
    pythonPath: process.execPath,
    serviceDirectory: path.dirname(script),
    serviceFile: script,
    startupTimeoutMs: options.startupTimeoutMs ?? 2_000,
    transcribeTimeoutMs: options.transcribeTimeoutMs ?? 2_000,
    ...(options.maxConcurrent === undefined ? {} : { maxConcurrent: options.maxConcurrent }),
    ...(options.maxQueue === undefined ? {} : { maxQueue: options.maxQueue }),
    ...(options.queueTimeoutMs === undefined ? {} : { queueTimeoutMs: options.queueTimeoutMs }),
  });
  services.push(instance);
  return instance;
}

const LOADING = "process.stdout.write(JSON.stringify({ready:false,loading:true})+\"\\n\");";
const ANSWER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const request = JSON.parse(line);
      process.stdout.write(JSON.stringify({
        id: request.id,
        ok: true,
        text: "午餐三十五元，用微信支付。",
        seconds: 0.01,
        audioSeconds: 4.7,
        timings: { decodeMs: 5, vadMs: 2, inferMs: 10, totalMs: 17 },
      }) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

afterEach(async () => {
  for (const instance of services.splice(0)) instance.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("VoiceService child lifecycle", () => {
  it("fails fast when the child exits before ready", async () => {
    const script = await fixture("process.exit(7);");
    const client = service(script, { startupTimeoutMs: 5_000 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toBeInstanceOf(VoiceServiceError);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("reports a missing interpreter as a startup failure", async () => {
    const client = new VoiceService({
      pythonPath: path.join(tmpdir(), "libevra-missing-python", "python"),
      serviceDirectory: tmpdir(),
      serviceFile: "service.py",
      startupTimeoutMs: 1_000,
    });
    services.push(client);
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/找不到语音识别/);
  });

  it("starts normally and returns a transcription with timing", async () => {
    const script = await fixture(LOADING + ANSWER);
    const client = service(script);
    const result = await client.transcribe(Buffer.from("synthetic"));
    expect(result.text).toContain("午餐");
    expect(result.audioSeconds).toBe(4.7);
    expect(result.timings).toMatchObject({ decodeMs: 5, vadMs: 2, inferMs: 10 });
  });

  it("honours the startup timeout when the child never becomes ready", async () => {
    const script = await fixture("process.stdin.resume();");
    const client = service(script, { startupTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/启动超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("recovers after the child is fixed", async () => {
    const script = await fixture("process.exit(3);");
    const client = service(script);
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toBeInstanceOf(VoiceServiceError);

    await writeFile(script, LOADING + ANSWER, "utf8");
    const result = await client.transcribe(Buffer.from("synthetic"));
    expect(result.text).toContain("午餐");
  });

  it("honours the per-recording timeout after a successful startup", async () => {
    const script = await fixture(LOADING + "process.stdin.resume();");
    const client = service(script, { transcribeTimeoutMs: 150 });
    const started = Date.now();
    await expect(client.transcribe(Buffer.from("synthetic"))).rejects.toThrow(/识别超时/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});

/** Answers each request after a short delay; used to observe serialisation. */
const SLOW_ANSWER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      setTimeout(() => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({ id: request.id, ok: true, text: "slow", seconds: 0.1, audioSeconds: 1 }) + "\\n");
      }, 100);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** Fails the first request and answers the second: tests the slot is released. */
const ERROR_THEN_OK = `
let buffer = "";
let count = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      count += 1;
      const request = JSON.parse(line);
      const answer = count === 1
        ? { id: request.id, ok: false, error: "audio_too_long", message: "录音超过 60 秒，请说短一点。" }
        : { id: request.id, ok: true, text: "after-failure", seconds: 0.01, audioSeconds: 1 };
      process.stdout.write(JSON.stringify(answer) + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** Never answers: a request that holds its slot for as long as the test needs. */
const HANGING = LOADING + "process.stdin.resume();";

/** Let a promise settle so a deliberately-held request cannot become unhandled. */
function settled(promise: Promise<unknown>): void {
  promise.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * The S15-A concurrency bound.
 *
 * S14-V's finding was that one decode occupies the CPU for seconds; the risk
 * S15-A names is a burst of recordings competing with the normal bookkeeping
 * API. These tests are about the bound, not about whisper: a queued request
 * waits, a full queue refuses immediately, and a failed request gives its slot
 * to the next one.
 */
describe("VoiceService concurrency bound", () => {
  it("serialises requests beyond maxConcurrent and answers all of them", async () => {
    const script = await fixture(LOADING + SLOW_ANSWER);
    const client = service(script, { maxConcurrent: 1, maxQueue: 4 });

    const started = Date.now();
    const results = await Promise.all([
      client.transcribe(Buffer.from("first")),
      client.transcribe(Buffer.from("second")),
      client.transcribe(Buffer.from("third")),
    ]);

    // Three 100 ms answers arriving one at a time cannot finish faster than that;
    // without the bound they would all be written to the child at once.
    expect(results.map((result) => result.text)).toEqual(["slow", "slow", "slow"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("refuses a request when the queue is already full", async () => {
    const script = await fixture(HANGING);
    const client = service(script, { maxConcurrent: 1, maxQueue: 0, transcribeTimeoutMs: 5_000 });

    settled(client.transcribe(Buffer.from("held")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(client.transcribe(Buffer.from("refused"))).rejects.toBeInstanceOf(VoiceBusyError);
  });

  it("fails a queued request after the queue timeout instead of waiting forever", async () => {
    const script = await fixture(HANGING);
    const client = service(script, {
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 100,
      transcribeTimeoutMs: 5_000,
    });

    settled(client.transcribe(Buffer.from("held")));
    const queued = client.transcribe(Buffer.from("waiting"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(queued).rejects.toBeInstanceOf(VoiceBusyError);
    await expect(queued).rejects.toThrow(/排队超时/);
  });

  it("gives the slot to a queued request when the running one fails", async () => {
    const script = await fixture(LOADING + ERROR_THEN_OK);
    const client = service(script, { maxConcurrent: 1, maxQueue: 2 });

    const first = client.transcribe(Buffer.from("first"));
    const second = client.transcribe(Buffer.from("second"));

    await expect(first).rejects.toBeInstanceOf(TranscriptionRejected);
    const answered = await second;
    expect(answered.text).toBe("after-failure");
  });

  it("rejects queued requests when the service stops", async () => {
    const script = await fixture(HANGING);
    const client = service(script, { maxConcurrent: 1, maxQueue: 2, transcribeTimeoutMs: 5_000 });

    settled(client.transcribe(Buffer.from("held")));
    const queued = client.transcribe(Buffer.from("waiting"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    client.stop();
    await expect(queued).rejects.toThrow(/已停止/);
  });
});
