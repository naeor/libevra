/**
 * D-3 容器语义 headless（不写 UI）：
 * 容器展开/收缩（presentation + expandedSize）与投影形态；
 * 容器只表达展开/折叠与占位，不解释内部内容。
 */

import { describe, expect, it } from "vitest";
import { applyCommand, createEditorState } from "./commands.js";
import type { EditorState } from "./commands.js";
import { projectLayout } from "./projection.js";
import {
  analysisCard,
  carousel,
  contentOf,
  geometry,
  gridSplit,
  layoutOf,
  object,
  projectedOf,
  reasonsOf,
} from "./test-support.js";
import type { ObjectGeometry } from "./types.js";

const CONTENT = contentOf(
  [analysisCard("c1"), analysisCard("c2"), analysisCard("c3"), analysisCard("c4")],
  [gridSplit("g", ["c1", "c2"]), carousel("q", ["c3", "c4"])],
);

const LAYOUT = geometry(4, [
  object("g", "grid-split", 1, 2, 2),
  object("q", "carousel", 9, 3, 1),
]);

function createState(): EditorState {
  return createEditorState(CONTENT, layoutOf(LAYOUT));
}

function findObject(state: EditorState, objectId: string): ObjectGeometry | undefined {
  return state.layout.main.objects.find((item) => item.objectId === objectId);
}

describe("GridSplit 展开/收缩", () => {
  it("收缩：写 presentation=collapsed、expandedSize 保留完整尺寸、几何变 1×1", () => {
    const state = createState();
    const result = applyCommand(state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    expect(result.ok).toBe(true);
    const container = findObject(result.state, "g");
    expect(container?.presentation).toBe("collapsed");
    expect(container?.expandedSize).toEqual({ colSpan: 2, rowSpan: 2 });
    expect(container?.colSpan).toBe(1);
    expect(container?.rowSpan).toBe(1);
    expect(result.state.selection).toBe("g");
    // 内容文档不被修改。
    expect(result.state.content).toEqual(CONTENT);
  });

  it("展开：用 expandedSize 恢复完整尺寸并清除 presentation/expandedSize", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const restored = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "full",
    });
    expect(restored.ok).toBe(true);
    const container = findObject(restored.state, "g");
    expect(container?.presentation).toBeUndefined();
    expect(container?.expandedSize).toBeUndefined();
    expect(container?.colSpan).toBe(2);
    expect(container?.rowSpan).toBe(2);
    expect(restored.state.content).toEqual(CONTENT);
  });

  it("重复收缩是空操作（不新增撤销记录）", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const historyLength = collapsed.state.history.past.length;
    const again = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    expect(again.ok).toBe(true);
    expect(again.state).toBe(collapsed.state);
    expect(again.state.history.past.length).toBe(historyLength);
  });

  it("收缩后不允许直接调整尺寸（user-collapsed，OQ-LM-06 暂定口径）", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const resize = applyCommand(collapsed.state, {
      type: "resize",
      objectId: "g",
      colSpan: 2,
    });
    expect(resize.ok).toBe(false);
    expect(resize.issues.map((issue) => issue.code)).toContain("user-collapsed");
    expect(resize.state).toBe(collapsed.state);
  });

  it("非容器对象拒绝收缩（invalid-presentation）", () => {
    const content = contentOf([analysisCard("k")], []);
    const state = createEditorState(
      content,
      layoutOf(geometry(2, [object("k", "analysis-card", 1, 1, 1)])),
    );
    const result = applyCommand(state, {
      type: "set-presentation",
      objectId: "k",
      presentation: "collapsed",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-presentation");
  });

  it("Spacer 也拒绝收缩（invalid-presentation）", () => {
    const content = contentOf([], []);
    const state = createEditorState(
      content,
      layoutOf(geometry(2, [object("s", "spacer", 1, 1, 1)])),
    );
    const result = applyCommand(state, {
      type: "set-presentation",
      objectId: "s",
      presentation: "collapsed",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid-presentation");
  });
});

describe("Carousel 展开/收缩", () => {
  it("收缩保留完整尺寸 3×1，展开后恢复", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "q",
      presentation: "collapsed",
    });
    expect(collapsed.ok).toBe(true);
    expect(findObject(collapsed.state, "q")?.expandedSize).toEqual({ colSpan: 3, rowSpan: 1 });
    expect(findObject(collapsed.state, "q")?.colSpan).toBe(1);

    const restored = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "q",
      presentation: "full",
    });
    expect(findObject(restored.state, "q")?.colSpan).toBe(3);
    expect(findObject(restored.state, "q")?.rowSpan).toBe(1);
    expect(findObject(restored.state, "q")?.expandedSize).toBeUndefined();
  });
});

describe("撤销/重做覆盖收缩命令", () => {
  it("收缩 → 撤销 → 重做 的几何与字段一致", () => {
    const original = createState();
    const collapsed = applyCommand(original, {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const undo = applyCommand(collapsed.state, { type: "undo" });
    expect(undo.ok).toBe(true);
    const back = findObject(undo.state, "g");
    expect(back?.presentation).toBeUndefined();
    expect(back?.expandedSize).toBeUndefined();
    expect(back?.colSpan).toBe(2);

    const redo = applyCommand(undo.state, { type: "redo" });
    expect(redo.ok).toBe(true);
    const again = findObject(redo.state, "g");
    expect(again?.presentation).toBe("collapsed");
    expect(again?.expandedSize).toEqual({ colSpan: 2, rowSpan: 2 });
    expect(again?.colSpan).toBe(1);
  });

  it("收缩 → 展开 → 两次撤销回到原始状态", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const restored = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "full",
    });
    const undoOnce = applyCommand(restored.state, { type: "undo" });
    expect(findObject(undoOnce.state, "g")?.presentation).toBe("collapsed");
    const undoTwice = applyCommand(undoOnce.state, { type: "undo" });
    expect(findObject(undoTwice.state, "g")?.presentation).toBeUndefined();
    expect(findObject(undoTwice.state, "g")?.colSpan).toBe(2);
  });
});

describe("容器投影形态（headless，不写 UI）", () => {
  it("用户收缩优先：投影 collapsed，源布局 expandedSize 不被写回", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const before = JSON.stringify(collapsed.state.layout);
    const projection = projectLayout(collapsed.state.layout.main, CONTENT, { targetColumns: 4 });
    const container = projectedOf(projection, "g");
    expect(container.form).toBe("collapsed");
    expect({ colSpan: container.colSpan, rowSpan: container.rowSpan }).toEqual({
      colSpan: 1,
      rowSpan: 1,
    });
    expect(reasonsOf(projection, "g")).toContain("user-collapsed");
    expect(JSON.stringify(collapsed.state.layout)).toBe(before);
  });

  it("展开后投影回到完整形态；窄列数下完整形态可降级但保留容器身份", () => {
    const collapsed = applyCommand(createState(), {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    const restored = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "full",
    });

    const wide = projectLayout(restored.state.layout.main, CONTENT, { targetColumns: 4 });
    expect(projectedOf(wide, "g").form).toBe("full");
    expect(projectedOf(wide, "g").colSpan).toBe(2);

    const narrow = projectLayout(restored.state.layout.main, CONTENT, { targetColumns: 2 });
    const container = projectedOf(narrow, "g");
    expect(container.objectType).toBe("grid-split");
    expect(container.colSpan).toBeLessThanOrEqual(2);
    expect(container.objectId).toBe("g");
  });

  it("容器内部卡片仍各自拥有身份（投影不展开、不替换容器）", () => {
    const state = createState();
    const projection = projectLayout(state.layout.main, CONTENT, { targetColumns: 4 });
    expect(projection.objects.map((item) => item.objectId).sort()).toEqual(["g", "q"]);
    expect(projection.objects.every((item) => item.objectType !== "analysis-card")).toBe(true);
  });
});
