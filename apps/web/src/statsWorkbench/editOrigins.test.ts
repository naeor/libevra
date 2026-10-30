/**
 * 编辑结果的起点随编辑历史走（`EditOrigins`），保存时据此决定写到哪里（`commitLayoutEdit`）。
 * 用真实的 D 命令（移动、整份替换、撤销、重做）走一遍「套用模板 / 恢复默认 / 撤销」的组合。
 */
import { describe, expect, it } from "vitest";
import {
  columnOverrideList,
  commitLayoutEdit,
  displayGeometry,
  editingLayout,
  type EditOrigin,
  type EditorState,
} from "@libellum/shared/analysis/layout";

import { defaultWorkbench } from "./defaults.js";
import { EditOrigins } from "./editOrigins.js";
import { displayFor, sizeContracts } from "./Grid.js";
import { buildSystemPreset, reidentify } from "./presets.js";
import { command, replaceDocuments, sessionDocuments, startSession } from "./session.js";
import { isSystemDefault, type WorkbenchDocuments } from "./storage.js";

const COLUMNS = 4;

function originAt(documents: WorkbenchDocuments): EditOrigin {
  return { documents, start: displayGeometry(displayFor(documents, COLUMNS), documents.layout, documents.content) };
}

function working(origin: EditOrigin): WorkbenchDocuments {
  return { content: origin.documents.content, layout: editingLayout(origin.documents.layout, origin.start) };
}

function commit(state: EditorState, origins: EditOrigins<EditOrigin>, fallback: EditOrigin) {
  const edited = sessionDocuments(state);
  return commitLayoutEdit({ columns: COLUMNS, origin: origins.originOf(state, fallback), edited, contracts: sizeContracts(edited.content, edited.layout) });
}

/** 把第一张卡片挪到最后一行下面（总是合法的「只调整位置」）。 */
function moveFirst(state: EditorState): EditorState {
  const main = state.layout.main;
  const first = main.objects[0]!;
  const bottom = Math.max(...main.objects.map((item) => Math.ceil(item.anchor / main.baseCols) + item.rowSpan - 1));
  const moved = command(state, { type: "move", objectId: first.objectId, anchor: bottom * main.baseCols + 1, collisionPolicy: "reflow" });
  expect(moved.ok).toBe(true);
  return moved.state;
}

describe("EditOrigins：起点随撤销 / 重做走", () => {
  const t = (key: string) => key;

  it("已保存的卡片 ID 与默认相同（只挪过位置）时「恢复默认」：保存的是默认本身，账号回到跟随系统默认", () => {
    const origins = new EditOrigins<EditOrigin>();
    // 已保存：默认布局在 4 列挪过一张卡片（4 列专属布局）。
    const defaults = defaultWorkbench();
    const firstOrigin = originAt(defaults);
    const firstState = startSession(working(firstOrigin));
    origins.register(firstState.layout, firstOrigin);
    const saved = commit(moveFirst(firstState), origins, firstOrigin).documents;
    expect(columnOverrideList(saved.layout, saved.content)).toEqual([COLUMNS]);

    // 新的编辑会话：从已保存的开始，点「恢复默认」，什么也不改就「完成」。
    const storedOrigin = originAt(saved);
    const session = startSession(working(storedOrigin));
    origins.register(session.layout, storedOrigin);
    const resetOrigin = originAt(defaultWorkbench());
    const resetWorking = working(resetOrigin);
    origins.register(resetWorking.layout, resetOrigin);
    const reset = replaceDocuments(session, resetWorking);
    expect(reset.ok).toBe(true);
    const result = commit(reset.state, origins, storedOrigin);
    expect(result.target).toBe("none");
    expect(isSystemDefault(result.documents)).toBe(true);
  });

  it("套用模板 A → 套用模板 B → 撤销：起点回到 A，保存 A 自己的基础布局（不是把 A 的显示结果当成新基础）", () => {
    const origins = new EditOrigins<EditOrigin>();
    const storedOrigin = originAt(defaultWorkbench());
    const start = startSession(working(storedOrigin));
    origins.register(start.layout, storedOrigin);
    const templateA = reidentify(buildSystemPreset("advanced", t));
    const templateB = reidentify(buildSystemPreset("professional", t));
    const originA = originAt(templateA);
    const workingA = working(originA);
    origins.register(workingA.layout, originA);
    const withA = replaceDocuments(start, workingA).state;
    const originB = originAt(templateB);
    const workingB = working(originB);
    origins.register(workingB.layout, originB);
    const withB = replaceDocuments(withA, workingB).state;
    const undone = command(withB, { type: "undo" }).state;
    expect(undone.layout).toBe(withA.layout);
    const result = commit(undone, origins, storedOrigin);
    expect(result.target).toBe("none");
    expect(result.documents.layout).toEqual(templateA.layout);

    // 撤销后再挪一张卡片：从 A 推出的状态仍以 A 为起点 → A 的基础不变 + 4 列专属布局。
    const movedFromA = moveFirst(undone);
    const moved = commit(movedFromA, origins, storedOrigin);
    expect(moved.target).toBe("override");
    expect(moved.documents.layout.main).toEqual(templateA.layout.main);

    // 再撤销到最初、重做两次：回到 B。
    const backToStart = command(command(movedFromA, { type: "undo" }).state, { type: "undo" }).state;
    expect(origins.originOf(backToStart, storedOrigin)).toBe(storedOrigin);
    const redoneA = command(backToStart, { type: "redo" }).state;
    expect(origins.originOf(redoneA, storedOrigin)).toBe(originA);
  });

  it("套用模板后连续编辑超过撤销上限（50 步）：每个新状态都登记过，起点仍是模板", () => {
    const origins = new EditOrigins<EditOrigin>();
    const storedOrigin = originAt(defaultWorkbench());
    const start = startSession(working(storedOrigin));
    origins.register(start.layout, storedOrigin);
    const template = reidentify(buildSystemPreset("advanced", t));
    const templateOrigin = originAt(template);
    const templateWorking = working(templateOrigin);
    origins.register(templateWorking.layout, templateOrigin);
    let state = replaceDocuments(start, templateWorking).state;
    for (let step = 0; step < 60; step += 1) {
      state = moveFirst(state);
      origins.originOf(state, storedOrigin); // 页面在每个新状态渲染后调用一次
    }
    expect(state.history.past.length).toBeLessThanOrEqual(50);
    expect(origins.originOf(state, storedOrigin)).toBe(templateOrigin);
    const result = commit(state, origins, storedOrigin);
    expect(result.target).not.toBe("rebased");
    expect(result.documents.layout.main).toEqual(template.layout.main);
  });

  it("新增卡片（卡片集合变了）：编辑结果成为新的基础布局，列数 = 编辑列数，没有专属布局", () => {
    const origins = new EditOrigins<EditOrigin>();
    const storedOrigin = originAt(defaultWorkbench());
    const start = startSession(working(storedOrigin));
    origins.register(start.layout, storedOrigin);
    const card = { objectId: "card-new", type: "analysis-card" as const, analysis: { analysisId: "AN-B01", params: {} }, chart: { chartFamily: "number" }, rangePolicy: "inherit" as const };
    const added = command(start, { type: "insert-card", card, size: { colSpan: 1, rowSpan: 1 }, collisionPolicy: "reflow" });
    expect(added.ok).toBe(true);
    const result = commit(added.state, origins, storedOrigin);
    expect(result.target).toBe("rebased");
    expect(result.documents.layout.main.baseCols).toBe(COLUMNS);
    expect(result.documents.layout.profiles).toBeUndefined();
  });
});
