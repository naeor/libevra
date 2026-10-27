import { describe, expect, it } from "vitest";
import { createEditorState } from "./commands.js";
import type { EditorState } from "./commands.js";
import {
  commandForKey,
  currentFocus,
  findDirectionalNeighbor,
  focusedGeometry,
  moveFocus,
} from "./focus.js";
import { analysisCard, contentOf, geometry, object } from "./test-support.js";
import { LAYOUT_ALGORITHM_VERSION, LAYOUT_SCHEMA_VERSION } from "./types.js";
import type { LayoutGeometry } from "./types.js";

/** 2 列网格：A@1 B@2 / C@3 D@4。 */
function gridGeometry(): LayoutGeometry {
  return geometry(2, [
    object("a", "analysis-card", 1, 1, 1),
    object("b", "analysis-card", 2, 1, 1),
    object("c", "analysis-card", 3, 1, 1),
    object("d", "analysis-card", 4, 1, 1),
  ]);
}

function editorWith(selection: string | null = null): EditorState {
  const content = contentOf([
    analysisCard("a"),
    analysisCard("b"),
    analysisCard("c"),
    analysisCard("d"),
  ]);
  const state = createEditorState(content, {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: "unified",
    main: gridGeometry(),
  });
  return selection === null ? state : { ...state, selection };
}

describe("方向焦点导航", () => {
  it("按四方向找最近邻居", () => {
    const layout = gridGeometry();
    expect(findDirectionalNeighbor(layout, "a", "right")).toBe("b");
    expect(findDirectionalNeighbor(layout, "b", "left")).toBe("a");
    expect(findDirectionalNeighbor(layout, "a", "down")).toBe("c");
    expect(findDirectionalNeighbor(layout, "b", "down")).toBe("d");
    expect(findDirectionalNeighbor(layout, "c", "up")).toBe("a");
    expect(findDirectionalNeighbor(layout, "d", "up")).toBe("b");
  });

  it("边界返回 null；无焦点时落到第一个对象", () => {
    const layout = gridGeometry();
    expect(findDirectionalNeighbor(layout, "b", "right")).toBeNull();
    expect(findDirectionalNeighbor(layout, "a", "up")).toBeNull();
    expect(findDirectionalNeighbor(layout, null, "down")).toBe("a");
  });

  it("moveFocus 只改选中、不改布局", () => {
    const state = editorWith("a");
    const moved = moveFocus(state, "right");
    expect(moved.selection).toBe("b");
    expect(moved.layout).toBe(state.layout);
    expect(moved.layout.main.objects.map((item) => item.anchor)).toEqual([1, 2, 3, 4]);
  });

  it("currentFocus / focusedGeometry 与选中一致", () => {
    expect(currentFocus(editorWith(null))).toBe("a");
    expect(currentFocus(editorWith("c"))).toBe("c");
    expect(focusedGeometry(editorWith(null))).toBeUndefined();
    expect(focusedGeometry(editorWith("c"))?.anchor).toBe(3);
  });
});

describe("键盘映射（草案）", () => {
  it("Delete 删除选中对象；无选中时返回 null", () => {
    expect(commandForKey(editorWith("b"), { key: "Delete" })).toEqual({
      type: "delete",
      objectId: "b",
    });
    expect(commandForKey(editorWith(null), { key: "Delete" })).toBeNull();
  });

  it("方向键 move-by 1 格，Shift+方向键 resize", () => {
    expect(commandForKey(editorWith("b"), { key: "ArrowLeft" })).toEqual({
      type: "move-by",
      objectId: "b",
      rowDelta: 0,
      colDelta: -1,
    });
    expect(commandForKey(editorWith("b"), { key: "ArrowRight", shift: true })).toEqual({
      type: "resize",
      objectId: "b",
      colSpan: 2,
    });
    expect(commandForKey(editorWith("b"), { key: "ArrowUp", shift: true })).toEqual({
      type: "resize",
      objectId: "b",
      rowSpan: 1,
    });
  });

  it("撤销/重做快捷键", () => {
    expect(commandForKey(editorWith("a"), { key: "z", ctrl: true })).toEqual({ type: "undo" });
    expect(commandForKey(editorWith("a"), { key: "z", meta: true, shift: true })).toEqual({
      type: "redo",
    });
    expect(commandForKey(editorWith("a"), { key: "y", ctrl: true })).toEqual({ type: "redo" });
  });

  it("无选中时方向键不改布局；未知按键返回 null", () => {
    expect(commandForKey(editorWith(null), { key: "ArrowRight" })).toBeNull();
    expect(commandForKey(editorWith("a"), { key: "Enter" })).toBeNull();
  });
});
