import { describe, expect, it } from "vitest";

import { formatRuntimeReport, type RuntimeSnapshot } from "./runtimeInfo.js";

const snapshot: RuntimeSnapshot = {
  version: "1.13.09",
  buildStamp: "2026-10-18T00:00:00.000Z",
  buildStampLocal: "2026-10-18 08:00:00（本机时间 UTC+8）",
  serviceWorker: "1 个注册，正在控制本页",
  online: false,
  offlineReason: "unreachable",
  queryCount: 12,
  liveQueryCount: 9,
  cacheBytes: 1024,
  logCount: 3,
  page: "http://localhost/update/runtime",
  capturedAt: "2026-10-18T00:01:00.000Z",
};

describe("runtime report", () => {
  it("keeps the fields the old update page put on the clipboard", () => {
    const report = formatRuntimeReport(snapshot);
    expect(report).toContain("Libevra 1.13.09");
    expect(report).toContain("构建时间（本机）：2026-10-18 08:00:00");
    expect(report).toContain("构建时间（UTC）：2026-10-18T00:00:00.000Z");
    expect(report).toContain("Service Worker：1 个注册");
    expect(report).toContain("网络：离线（服务器没有答复）");
    expect(report).toContain("缓存条目：12 条，其中 9 条当前版本会读");
    expect(report).toContain("缓存大小：1024 字节");
    expect(report).toContain("运行记录：3 条");
    expect(report).toContain("页面：http://localhost/update/runtime");
  });
});
