import { describe, expect, it } from "vitest";

import { INITIAL_WORKSPACE, parseWorkspaceState, workspaceReducer, type WorkspaceAction, type WorkspaceState } from "./model.js";

function run(...actions: WorkspaceAction[]): WorkspaceState {
  return actions.reduce(workspaceReducer, INITIAL_WORKSPACE);
}

describe("工作区状态：角色与内容实例分开", () => {
  it("初始只有主工作区 w1，没有强制打开辅助区", () => {
    expect(INITIAL_WORKSPACE.primary).toBe("w1");
    expect(INITIAL_WORKSPACE.secondary).toBeNull();
    expect(INITIAL_WORKSPACE.secondaryOpen).toBe(false);
    expect(INITIAL_WORKSPACE.ratio).toBe(0.55);
  });

  it("打开辅助区：创建 w2；用户明确指定任务时切到独立", () => {
    const opened = run({ type: "openSecondary", independent: false });
    expect(opened.secondary).toBe("w2");
    expect(opened.secondaryOpen).toBe(true);
    expect(opened.mode).toBe("follow");
    expect(run({ type: "openSecondary", independent: true }).mode).toBe("independent");
  });

  it("关闭只是隐藏，实例保留；恢复回到同一个实例", () => {
    const closed = run({ type: "openSecondary", independent: true }, { type: "closeSecondary" });
    expect(closed.secondary).toBe("w2");
    expect(closed.secondaryOpen).toBe(false);
    const restored = workspaceReducer(closed, { type: "restoreSecondary" });
    expect(restored.secondary).toBe("w2");
    expect(restored.secondaryOpen).toBe(true);
    expect(restored.mode).toBe("independent");
  });

  it("收起原主区：原辅助区晋升为主区，原主区保留为可恢复的辅助区", () => {
    const promoted = run({ type: "openSecondary", independent: true }, { type: "collapse", side: "primary" });
    expect(promoted.primary).toBe("w2");
    expect(promoted.secondary).toBe("w1");
    expect(promoted.secondaryOpen).toBe(false);

    // 恢复 A：B 继续是主区，A 作为辅助区重新出现。
    const restored = workspaceReducer(promoted, { type: "restoreSecondary" });
    expect(restored.primary).toBe("w2");
    expect(restored.secondary).toBe("w1");
    expect(restored.secondaryOpen).toBe(true);
  });

  it("收起辅助区不改变主区身份", () => {
    const collapsed = run({ type: "openSecondary", independent: false }, { type: "collapse", side: "secondary" });
    expect(collapsed.primary).toBe("w1");
    expect(collapsed.secondary).toBe("w2");
    expect(collapsed.secondaryOpen).toBe(false);
  });

  it("切换跟随 / 独立只改模式，不改两边的内容实例", () => {
    const opened = run({ type: "openSecondary", independent: true });
    const follow = workspaceReducer(opened, { type: "setMode", mode: "follow" });
    expect(follow.mode).toBe("follow");
    expect(follow.primary).toBe(opened.primary);
    expect(follow.secondary).toBe(opened.secondary);
  });

  it("交换角色时比例按位置互换", () => {
    const swapped = run({ type: "openSecondary", independent: true }, { type: "setRatio", ratio: 0.62 }, { type: "swapRoles" });
    expect(swapped.primary).toBe("w2");
    expect(swapped.secondary).toBe("w1");
    expect(swapped.ratio).toBeCloseTo(0.38);
  });

  it("比例限制在 30%–70%", () => {
    expect(run({ type: "setRatio", ratio: 0.1 }).ratio).toBe(0.3);
    expect(run({ type: "setRatio", ratio: 0.95 }).ratio).toBe(0.7);
    expect(run({ type: "setRatio", ratio: Number.NaN }).ratio).toBe(0.55);
  });

  it("换身份时丢掉辅助区实例，主区与侧栏偏好保留", () => {
    const before = run({ type: "openSecondary", independent: true }, { type: "setRail", rail: "collapsed" }, { type: "collapse", side: "primary" });
    const after = workspaceReducer(before, { type: "resetForIdentity" });
    expect(after.primary).toBe(before.primary);
    expect(after.secondary).toBeNull();
    expect(after.secondaryOpen).toBe(false);
    expect(after.rail).toBe("collapsed");
  });

  it("会话恢复只接受形状正确的值", () => {
    expect(parseWorkspaceState(null)).toEqual(INITIAL_WORKSPACE);
    expect(parseWorkspaceState({ primary: "w9", secondary: "w1", secondaryOpen: true })).toMatchObject({ primary: "w1", secondary: null, secondaryOpen: false });
    expect(parseWorkspaceState({ primary: "w2", secondary: "w1", secondaryOpen: true, mode: "independent", ratio: 0.6, rail: "collapsed" })).toEqual({
      primary: "w2",
      secondary: "w1",
      secondaryOpen: true,
      mode: "independent",
      ratio: 0.6,
      rail: "collapsed",
      ledgers: { w1: null, w2: null },
    });
  });
});

describe("工作区账本隔离（第二轮）", () => {
  const opened = run({ type: "openSecondary", independent: true });

  it("一侧换账本，另一侧不变", () => {
    const next = workspaceReducer(opened, { type: "setLedger", instance: "w2", ledger: "travel" });
    expect(next.ledgers).toEqual({ w1: null, w2: "travel" });
    expect(workspaceReducer(next, { type: "setLedger", instance: "w1", ledger: "home" }).ledgers).toEqual({ w1: "home", w2: "travel" });
  });

  it("主区换设备当前账本：跟随当前账本的辅助区钉在原来那本账上", () => {
    const pinned = workspaceReducer(opened, { type: "pinLedgers", keep: "w1", previous: "mine", next: "family" });
    expect(pinned.ledgers).toEqual({ w1: null, w2: "mine" });
  });

  it("辅助区本来就在看新的当前账本：回到跟随当前账本，不重复钉住", () => {
    const viewing = workspaceReducer(opened, { type: "setLedger", instance: "w2", ledger: "family" });
    const pinned = workspaceReducer(viewing, { type: "pinLedgers", keep: "w1", previous: "mine", next: "family" });
    expect(pinned.ledgers).toEqual({ w1: null, w2: null });
  });

  it("晋升与交换只换角色，账本跟着实例走", () => {
    const viewing = workspaceReducer(opened, { type: "setLedger", instance: "w2", ledger: "travel" });
    const promoted = workspaceReducer(viewing, { type: "collapse", side: "primary" });
    expect(promoted.primary).toBe("w2");
    expect(promoted.ledgers).toEqual({ w1: null, w2: "travel" });
    const swapped = workspaceReducer(viewing, { type: "swapRoles" });
    expect(swapped.ledgers).toEqual({ w1: null, w2: "travel" });
  });

  it("关闭再恢复辅助区，保留它的账本；第一次新建的辅助区从当前账本开始", () => {
    const viewing = workspaceReducer(opened, { type: "setLedger", instance: "w2", ledger: "travel" });
    const restored = workspaceReducer(workspaceReducer(viewing, { type: "closeSecondary" }), { type: "restoreSecondary" });
    expect(restored.ledgers.w2).toBe("travel");
    const stale: WorkspaceState = { ...INITIAL_WORKSPACE, ledgers: { w1: null, w2: "old" } };
    expect(workspaceReducer(stale, { type: "openSecondary", independent: false }).ledgers.w2).toBeNull();
  });

  it("换了身份：两个实例的账本都清空", () => {
    const viewing = workspaceReducer(opened, { type: "setLedger", instance: "w2", ledger: "travel" });
    expect(workspaceReducer(viewing, { type: "resetForIdentity" }).ledgers).toEqual({ w1: null, w2: null });
  });

  it("会话恢复：只接受字符串账本 id", () => {
    const parsed = parseWorkspaceState({ primary: "w1", secondary: "w2", secondaryOpen: true, ledgers: { w1: 3, w2: "travel" } });
    expect(parsed.ledgers).toEqual({ w1: null, w2: "travel" });
    expect(parseWorkspaceState({}).ledgers).toEqual({ w1: null, w2: null });
  });
});
