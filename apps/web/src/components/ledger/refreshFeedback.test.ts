import { describe, expect, it } from "vitest";

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
  const base = { guest: false, offline: false, delivered: 0, pulled: 0, failed: false, error: null };

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
});
