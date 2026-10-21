import { describe, expect, it } from "vitest";

import { OCR_CHANNELS, OCR_CHANNEL_LABELS, ocrChannelSchema } from "./ocr.js";

/**
 * The channel enum is the one place Python, API and web agree on where a
 * screenshot came from. Before 2026-10-21 the order platforms were missing, so
 * the API nulled `MEITUAN` / `JD` / `TAOBAO` and the overview could only show a
 * layout label. These tests pin the list and the labels the UI renders.
 */
describe("OCR channels", () => {
  it("knows the payment apps and the three order platforms", () => {
    expect(OCR_CHANNELS).toEqual(["WECHAT", "ALIPAY", "BANK", "MEITUAN", "JD", "TAOBAO"]);
  });

  it("has a Chinese label for every channel", () => {
    for (const channel of OCR_CHANNELS) {
      expect(OCR_CHANNEL_LABELS[channel]).toMatch(/[\u4e00-\u9fa5]/);
    }
    expect(OCR_CHANNEL_LABELS.MEITUAN).toBe("美团");
    expect(OCR_CHANNEL_LABELS.JD).toBe("京东");
    expect(OCR_CHANNEL_LABELS.TAOBAO).toBe("淘宝");
  });

  it("parses the order platforms and rejects an unknown one", () => {
    for (const channel of ["MEITUAN", "JD", "TAOBAO"] as const) {
      expect(ocrChannelSchema.parse(channel)).toBe(channel);
    }
    expect(() => ocrChannelSchema.parse("PINDUODUO")).toThrow();
  });
});
