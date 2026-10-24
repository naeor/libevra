import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../i18n/index.js";
import { refreshMessage } from "./refreshFeedback.js";

/**
 * The sentence under the refresh button.
 *
 * ⚠️ **The failure cases are the reason this exists.** A refresh has three very different outcomes —
 * delivered, pulled, or neither — and one of them (a month download that could not reach the server)
 * comes back as the number zero, indistinguishable from a month that really is empty. So the one
 * thing these tests pin down is that a zero never reads like a success, and a failure never reads
 * like a success either.
 */
describe("refreshMessage", () => {
  const base = {
    guest: false,
    offline: false,
    delivered: 0,
    pulled: 0,
    failed: false,
    error: null,
    waiting: 0,
  };

  it("reports delivery and the month together", () => {
    expect(refreshMessage({ ...base, delivered: 3, pulled: 12 })).toBe(
      "已向云端投递 3 条，并更新了当前月（12 条来自云端）。",
    );
  });

  it("does not claim the month was updated when nothing came back", () => {
    const message = refreshMessage({ ...base, delivered: 2 });

    expect(message).toContain("已向云端投递 2 条");
    expect(message).toContain("没有从云端取回新的数据");
  });

  it("describes a zero honestly instead of saying the cloud is up to date", () => {
    const message = refreshMessage(base);

    expect(message).toContain("已重新读取本机账目");
    expect(message).not.toContain("已同步");
    expect(message).not.toContain("更新了当前月");
  });

  it("says offline rather than implying the server was reached", () => {
    const message = refreshMessage({ ...base, offline: true });

    expect(message).toContain("当前离线");
    expect(message).toContain("本机账目");
  });

  it("reports a failure with its reason, and never as success", () => {
    const message = refreshMessage({ ...base, failed: true, error: "请求超时" });

    expect(message).toBe("同步没有完成：请求超时。已经重新读取了本机账目。");
  });

  it("still names the re-read when the failure has no message", () => {
    const message = refreshMessage({ ...base, failed: true, error: null });

    expect(message).toContain("同步没有完成");
    expect(message).toContain("已经重新读取了本机账目");
  });

  it("tells a guest there is no cloud to sync with", () => {
    const message = refreshMessage({ ...base, guest: true });

    expect(message).toContain("游客账本没有云端可同步");
  });

  /**
   * ⚠️ **The lie this pair exists to prevent**: a delivery can fail without throwing, so "投递 0 条"
   * used to be reported as "没有待投递的改动" while the rows were still marked on screen.
   */
  it("never says there was nothing to send while changes are still waiting", () => {
    const message = refreshMessage({ ...base, waiting: 2 });

    expect(message).toContain("已重新读取本机账目");
    expect(message).not.toContain("没有待投递的改动");
    expect(message).toContain("还有 2 条改动没有送到云端");
  });

  it("still reports the ones left behind after a partial delivery", () => {
    const message = refreshMessage({ ...base, delivered: 1, waiting: 3 });

    expect(message).toContain("已向云端投递 1 条");
    expect(message).toContain("还有 3 条改动没有送到云端");
  });

  it("keeps the empty sentence when nothing is waiting", () => {
    expect(refreshMessage(base)).toContain("没有待投递的改动");
  });

  /** S16：英文句子之间要有空格，单复数按条数变化，且不残留中文。 */
  describe("in English", () => {
    afterEach(() => {
      applyLocale("zh-CN");
    });

    it("joins the sentences with a space and counts in English", () => {
      applyLocale("en-US");

      expect(refreshMessage({ ...base, delivered: 1, waiting: 2 })).toBe(
        "Sent 1 change to the cloud. Nothing new came back for this month. 2 changes haven’t reached the cloud yet. They’re kept on this device and will be retried next time you’re online.",
      );
      expect(refreshMessage({ ...base, delivered: 3, pulled: 12 })).toBe(
        "Sent 3 changes to the cloud and updated this month (12 from the cloud).",
      );
      expect(refreshMessage({ ...base, failed: true, error: null })).not.toMatch(/[㐀-鿿]/);
      expect(refreshMessage({ ...base, guest: true })).not.toMatch(/[㐀-鿿]/);
      expect(refreshMessage(base)).not.toMatch(/[㐀-鿿]/);
    });
  });
});
