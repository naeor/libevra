import type { OcrItemResult } from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, resetDatabase, signUp } from "./support.js";

/**
 * The screenshot endpoint.
 *
 * The recogniser is stubbed. Loading real models would add about a minute to
 * every run and make the API's tests depend on a Python environment being
 * installed — and none of what is being checked here is the recogniser's
 * accuracy. What is checked is the boundary: who may call it, what it refuses,
 * and that nothing is written to disk.
 */
const calls: Buffer[] = [];

function stubOcr() {
  return {
    recognize: (image: Buffer, index: number): Promise<OcrItemResult> => {
      calls.push(image);

      return Promise.resolve({
        index,
        ok: true,
        draft: {
          amount: "328.00",
          currency: "CNY",
          occurredLocalDate: "2026-09-21",
          occurredTime: "16:55",
          kind: "expense",
          channel: "WECHAT",
          counterparty: "Apple Distribution International",
          note: null,
          serial: "4200003225202609228616685603",
          isRefund: false,
          warnings: [],
        },
        error: null,
        message: null,
        lineCount: 30,
        averageConfidence: 0.9834,
        seconds: 1.2,
        pageType: "single-detail",
        layoutLabel: "微信支付详情",
        requiresUserChoice: false,
        candidates: [
          {
            candidateId: `img${String(index)}-1`,
            imageIndex: index,
            amount: "328.00",
            currency: "CNY",
            direction: "expense",
            occurredLocalDate: "2026-09-21",
            occurredTime: "16:55",
            merchant: "Apple Distribution International",
            sourcePlatform: "WECHAT",
            account: "零钱",
            note: null,
            status: "posted",
            isRefund: false,
            isTransfer: false,
            serial: "4200003225202609228616685603",
            issues: [],
            duplicateSuspected: false,
            duplicateGroupIds: [],
            isComplete: true,
            isQuestionable: false,
            rawText: "微信支付\n20.00",
          },
        ],
        warnings: [],
      });
    },
    stop: (): void => undefined,
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = makeApp({ ocr: stubOcr() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  calls.length = 0;
});

/** A one-pixel PNG — enough to pass content sniffing. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

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

  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("POST /recognize", () => {
  it("returns a draft for a screenshot", async () => {
    const cookie = await signUp(app, "mama");
    const form = multipart([{ field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES }]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as { items: OcrItemResult[]; seconds: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.draft?.amount).toBe("328.00");
    expect(body.items[0]?.draft?.channel).toBe("WECHAT");
    expect(typeof body.seconds).toBe("number");
  });

  it("passes the page type and candidates through to the client", async () => {
    const cookie = await signUp(app, "batch_viewer");
    const form = multipart([{ field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES }]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as { items: OcrItemResult[] };
    expect(body.items[0]?.pageType).toBe("single-detail");
    expect(body.items[0]?.layoutLabel).toBe("微信支付详情");
    expect(body.items[0]?.requiresUserChoice).toBe(false);
    expect(body.items[0]?.candidates).toHaveLength(1);
    expect(body.items[0]?.candidates[0]).toMatchObject({
      candidateId: "img0-1",
      amount: "328.00",
      currency: "CNY",
      direction: "expense",
      sourcePlatform: "WECHAT",
      isComplete: true,
    });
    expect(body.items[0]?.warnings).toEqual([]);
  });

  it("still accepts an old per-image response without the batch fields", async () => {
    const legacy = makeApp({
      ocr: {
        recognize: async (_image: Buffer, index: number) =>
          ({
            index,
            ok: true,
            draft: {
              amount: "12.00",
              currency: "CNY",
              occurredLocalDate: "2026-09-21",
              occurredTime: null,
              kind: "expense",
              channel: null,
              counterparty: null,
              note: null,
              serial: null,
              isRefund: false,
              warnings: [],
            },
            error: null,
            message: null,
            lineCount: 5,
            averageConfidence: 0.9,
            seconds: 0.4,
            // The shape a server from before S15-B returns: no pageType,
            // candidates or warnings at all.
          }) as unknown as OcrItemResult,
        stop: () => undefined,
      },
    });
    await legacy.ready();
    try {
      const cookie = await signUp(legacy, "legacy_ocr");
      const form = multipart([
        { field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES },
      ]);
      const response = await legacy.inject({
        method: "POST",
        url: "/api/v1/recognize",
        headers: { ...form.headers, cookie },
        payload: form.payload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: OcrItemResult[] };
      expect(body.items[0]?.draft?.amount).toBe("12.00");
      expect(body.items[0]?.pageType).toBeNull();
      expect(body.items[0]?.candidates).toEqual([]);
      expect(body.items[0]?.warnings).toEqual([]);
    } finally {
      await legacy.close();
    }
  });

  it("passes the image bytes through untouched", async () => {
    const cookie = await signUp(app, "papa");
    const form = multipart([{ field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES }]);

    await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.equals(PNG_BYTES)).toBe(true);
  });

  it("numbers each item so a result can be matched to its thumbnail", async () => {
    const cookie = await signUp(app, "sister");
    const form = multipart([
      { field: "file", filename: "a.png", type: "image/png", body: PNG_BYTES },
      { field: "file", filename: "b.jpg", type: "image/jpeg", body: JPEG_BYTES },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    const body = response.json() as { items: OcrItemResult[] };
    expect(body.items.map((item) => item.index)).toEqual([0, 1]);
  });

  it("refuses a file that is not an image, whatever it claims to be", async () => {
    const cookie = await signUp(app, "uncle");
    const form = multipart([
      {
        field: "file",
        filename: "shot.png",
        type: "image/png",
        body: Buffer.from("this is definitely not a png", "utf8"),
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("not_an_image");
    // Nothing reached the recogniser.
    expect(calls).toHaveLength(0);
  });

  it("explains HEIC rather than failing vaguely", async () => {
    const cookie = await signUp(app, "aunt");
    // ftyp box, brand heic: an iPhone photo rather than a screenshot.
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypheic", "ascii"),
      Buffer.alloc(12),
    ]);
    const form = multipart([{ field: "file", filename: "photo.heic", type: "image/heic", body: heic }]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { code: string; message: string };
    expect(body.code).toBe("heic_not_supported");
    // The message has to tell the user what to do about it.
    expect(body.message).toContain("截图");
  });

  it("refuses more than the limit", async () => {
    const cookie = await signUp(app, "cousin");
    const form = multipart(
      Array.from({ length: 6 }, (_, index) => ({
        field: "file",
        filename: `shot-${String(index)}.png`,
        type: "image/png",
        body: PNG_BYTES,
      })),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { code: string }).code).toBe("too_many_images");
  });

  it("refuses a request with no images", async () => {
    const cookie = await signUp(app, "grandma");
    const form = multipart([]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: { ...form.headers, cookie },
      payload: form.payload,
    });

    expect(response.statusCode).toBe(400);
  });

  it("requires a session", async () => {
    const form = multipart([{ field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES }]);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recognize",
      headers: form.headers,
      payload: form.payload,
    });

    expect(response.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("returns a short availability error, not the Python traceback, when the OCR child fails", async () => {
    const failing = makeApp({
      ocr: {
        recognize: async () => {
          throw new Error("ImportError: libxcb.so.1: cannot open shared object file");
        },
        stop: () => undefined,
      },
    });
    await failing.ready();
    try {
      const cookie = await signUp(failing, "ocr_failure");
      const form = multipart([{ field: "file", filename: "shot.png", type: "image/png", body: PNG_BYTES }]);
      const response = await failing.inject({
        method: "POST",
        url: "/api/v1/recognize",
        headers: { ...form.headers, cookie },
        payload: form.payload,
      });
      expect(response.statusCode).toBe(503);
      const body = response.json() as { code: string; message: string };
      expect(body.code).toBe("ocr_unavailable");
      expect(body.message).toContain("暂时不可用");
      expect(body.message).not.toContain("libxcb");
      expect(body.message).not.toContain("ImportError");
      expect(body.message).not.toContain("Traceback");
    } finally {
      await failing.close();
    }
  });
});
