import { describe, expect, it } from "vitest";
import { entryMenuPosition, entrySourceLedger, entryTarget, FollowEntryFlow, isEntryFlowPath } from "./entryMenu.js";
import { entryFromPath, PaneHistory } from "./paneHistory.js";

describe("记账菜单定位", () => {
  it("对齐实际内容左边缘，中心连接按钮，不使用固定屏幕位置", () => {
    for (const edge of [68, 74, 106, 238]) {
      const result = entryMenuPosition({ left: edge - 60, top: 280, width: 48, height: 48 }, edge, { width: 1180, height: 820 }, 262);
      expect(result.left).toBe(edge);
      expect(result.width).toBe(224);
      expect(result.top + result.connector).toBe(304);
    }
  });
  it("菜单被上下边界推移后重新计算连接点", () => {
    for (const triggerTop of [12, 320, 446]) {
      const result = entryMenuPosition({ left: 10, top: triggerTop, width: 48, height: 48 }, 74, { width: 844, height: 520 }, 262);
      expect(result.top).toBeGreaterThanOrEqual(12);
      expect(result.top + 262).toBeLessThanOrEqual(508);
      expect(result.top + result.connector).toBe(triggerTop + 24);
    }
  });
  it("窗口缩小后限宽限高，保留视口留边", () => {
    const result = entryMenuPosition({ left: 10, top: 180, width: 48, height: 48 }, 74, { width: 280, height: 240 }, 350);
    expect(result.left + result.width).toBe(268);
    expect(result.maxHeight).toBe(216);
    expect(result.top).toBe(12);
  });
});

describe("记账目标与跟随流程", () => {
  it("主辅不同账本时优先来源页／来源区账本，不使用辅助区或全局账本覆盖", () => {
    const ledgers = { w1: "primary-a", w2: "aux-b" };
    expect(entrySourceLedger("w1", "detail", { "w1:detail": "page-c" }, ledgers, "device-d")).toBe("page-c");
    expect(entrySourceLedger("w1", "list", {}, ledgers, "device-d")).toBe("primary-a");
    expect(entrySourceLedger("w2", "list", {}, ledgers, "device-d")).toBe("aux-b");
    expect(entrySourceLedger("w1", "list", {}, { w1: null, w2: "aux-b" }, "device-d")).toBe("device-d");
    expect(ledgers).toEqual({ w1: "primary-a", w2: "aux-b" });
  });
  it("单区、暂隐双区和独立模式留在主区；跟随按角色定位，包含主辅交换", () => {
    const base = { primary: "w1" as const, secondary: "w2" as const, splitVisible: true, mode: "follow" as const };
    expect(entryTarget(base)).toBe("w2");
    expect(entryTarget({ ...base, primary: "w2", secondary: "w1" })).toBe("w1");
    expect(entryTarget({ ...base, splitVisible: false })).toBe("w1");
    expect(entryTarget({ ...base, secondary: null })).toBe("w1");
    expect(entryTarget({ ...base, mode: "independent" })).toBe("w1");
  });
  it("五个既有入口和识别核对链路可继续跟随，设置／分析不会被误放行", () => {
    for (const path of ["/add", "/paste", "/record", "/scan", "/import", "/paste/review", "/voice/review", "/ocr/overview", "/ocr/overview/c1"]) expect(isEntryFlowPath(path)).toBe(true);
    for (const path of ["/", "/stats", "/settings", "/import-ledger", "/ocr/overview/c1/invalid"]) expect(isEntryFlowPath(path)).toBe(false);
  });
  it("真实 PaneHistory 中跟随记账的继续、完成与普通辅助区导航有明确边界", () => {
    const primary = new PaneHistory("w1", [entryFromPath("/stats", "primary")]);
    const secondary = new PaneHistory("w2", [entryFromPath("/", "aux")]);
    const flow = new FollowEntryFlow();
    secondary.open("/paste");
    flow.start("w2", secondary.location.key);
    const paste = secondary.location.key;
    secondary.push("/paste/review");
    expect(flow.continue("w2", paste, secondary.location)).toBe(true);
    expect(flow.has("w2", secondary.location.key)).toBe(true);
    expect(flow.has("w1", secondary.location.key)).toBe(false);
    const review = secondary.location.key;
    secondary.push("/");
    expect(flow.continue("w2", review, secondary.location)).toBe(true);
    expect(flow.has("w2", secondary.location.key)).toBe(false);
    secondary.open("/add"); // 显式辅助导航，不继承跟随来源。
    expect(flow.has("w2", secondary.location.key)).toBe(false);
    expect(flow.continue("w2", review, entryFromPath("/stats"))).toBe(false);
    expect(primary.location.pathname).toBe("/stats");
    expect(primary.snapshot.length).toBe(1);
  });
});
