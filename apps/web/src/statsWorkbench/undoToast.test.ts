import { describe, expect, it } from "vitest";

import { defaultWorkbench } from "./defaults.js";
import { command, duplicateObject, removeObject, startSession, type EditorState } from "./session.js";
import { undoStillApplies } from "./undoToast.js";

/**
 * 1.19.66（所有者决定第 20 条）：分析工作台的“撤销”提示只撤它说的那一步。用真实的编辑命令走一遍：
 * 删除卡片后再有任何提交、撤销 / 重做或离开编辑，提示里的“撤销”都不再指着那一步；只改选中不算。
 */
function afterRemoval(): { readonly removed: EditorState; readonly other: string } {
  const start = startSession(defaultWorkbench());
  const [first, second] = start.layout.main.objects.map((object) => object.objectId);
  const result = removeObject(start, first!);
  expect(result.ok).toBe(true);
  return { removed: result.state, other: second! };
}

describe("分析工作台撤销提示绑定那一步", () => {
  it("刚删除时指着删除这一步", () => {
    const { removed } = afterRemoval();
    expect(undoStillApplies({ past: removed.history.past }, removed)).toBe(true);
  });

  it("只改选中：仍然指着删除", () => {
    const { removed, other } = afterRemoval();
    const selected = command(removed, { type: "select", objectId: other });
    expect(selected.ok).toBe(true);
    expect(undoStillApplies({ past: removed.history.past }, selected.state)).toBe(true);
  });

  it("之后又有一步提交（复制、移动等）：不再指着删除，提示收起、点了也不撤别的", () => {
    const { removed, other } = afterRemoval();
    const duplicated = duplicateObject(removed, other);
    expect(duplicated.ok).toBe(true);
    expect(undoStillApplies({ past: removed.history.past }, duplicated.state)).toBe(false);
  });

  it("用编辑条撤销 / 重做之后：不再指着删除", () => {
    const { removed } = afterRemoval();
    const undone = command(removed, { type: "undo" });
    expect(undone.ok).toBe(true);
    expect(undoStillApplies({ past: removed.history.past }, undone.state)).toBe(false);
    const redone = command(undone.state, { type: "redo" });
    expect(undoStillApplies({ past: removed.history.past }, redone.state)).toBe(false);
  });

  it("离开编辑（没有会话）或没有绑定：不撤销", () => {
    const { removed } = afterRemoval();
    expect(undoStillApplies({ past: removed.history.past }, null)).toBe(false);
    expect(undoStillApplies(null, removed)).toBe(false);
  });
});

describe("分析工作台接上了绑定", () => {
  it("提示收起与点“撤销”都先问 undoStillApplies（源码层面：页面的副作用在无 DOM 测试里不运行）", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../pages/StatsPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("if (binding === null || undoStillApplies(binding, session)) return;");
    expect(source).toContain("if (current === null || !undoStillApplies({ past }, current)) return;");
    expect(source).toContain("sayUndoable(success, result.state.history.past)");
    expect(source).toContain("sayUndoable(message, past)");
  });
});
