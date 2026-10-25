import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { buildHeaders } from "./api.js";

/**
 * The `accept-language` header is how the server learns which language the interface is in.
 *
 * Its only current use is the default ledger name created at registration, but a header that
 * silently went missing would surface as a Chinese ledger name inside an English interface — far
 * from this file — so the contract is pinned here directly.
 */
describe("buildHeaders: accept-language", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("中文界面发送 zh-CN", () => {
    applyLocale("zh-CN");

    expect(buildHeaders()["accept-language"]).toBe("zh-CN");
  });

  it("英文界面发送 en-US", () => {
    applyLocale("en-US");

    expect(buildHeaders()["accept-language"]).toBe("en-US");
  });

  it("指定账本时仍然携带语言", () => {
    applyLocale("en-US");

    const headers = buildHeaders("book-1");

    expect(headers["accept-language"]).toBe("en-US");
    expect(headers["x-libellum-book"]).toBe("book-1");
  });

  it("文件下载不携带语言（导出内容与界面语言无关）", () => {
    applyLocale("en-US");

    const headers = buildHeaders("book-1", false);

    expect(headers).not.toHaveProperty("accept-language");
    expect(headers["x-libellum-book"]).toBe("book-1");
  });
});

/**
 * The device time zone travels with every request so the server can evaluate an
 * anniversary rule in the account's own local day.
 *
 * The value itself comes from the browser; what this pins is that the header exists whenever
 * the environment can name a zone. A missing header would silently push everybody back to the
 * UTC date, where the wrong people get their Philosophy Day avatar.
 */
describe("buildHeaders: time zone", () => {
  it("携带设备时区", () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;

    expect(expected).not.toBe("");
    expect(buildHeaders()["x-libellum-time-zone"]).toBe(expected);
  });
});
