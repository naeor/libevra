import { describe, expect, it } from "vitest";
import { DEFAULT_UNDO_LIMIT, applyCommand, createEditorState } from "./commands.js";
import type { EditorState } from "./commands.js";
import { analysisCard, contentOf, geometry, gridSplit, object, size } from "./test-support.js";
import {
  LAYOUT_ALGORITHM_VERSION,
  LAYOUT_SCHEMA_VERSION,
  MAX_ROW_SPAN,
} from "./types.js";
import type {
  LayoutDocumentV1,
  ObjectGeometry,
  WorkbenchContentDocumentV1,
} from "./types.js";

function layoutOf(baseCols: number, objects: readonly ObjectGeometry[]): LayoutDocumentV1 {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: "unified",
    main: geometry(baseCols, objects),
  };
}

function editorOf(
  content: WorkbenchContentDocumentV1,
  baseCols: number,
  objects: readonly ObjectGeometry[],
  undoLimit?: number,
): EditorState {
  return createEditorState(
    content,
    layoutOf(baseCols, objects),
    undoLimit === undefined ? {} : { undoLimit },
  );
}

function anchorsOf(state: EditorState): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const item of state.layout.main.objects) {
    result[item.objectId] = item.anchor;
  }
  return result;
}

describe("select", () => {
  it("选中存在的对象、清空选择、拒绝不存在的对象", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const selected = applyCommand(state, { type: "select", objectId: "a" });
    expect(selected.ok).toBe(true);
    expect(selected.state.selection).toBe("a");

    const cleared = applyCommand(selected.state, { type: "select", objectId: null });
    expect(cleared.ok).toBe(true);
    expect(cleared.state.selection).toBeNull();

    const unknown = applyCommand(state, { type: "select", objectId: "missing" });
    expect(unknown.ok).toBe(false);
    expect(unknown.issues[0]?.code).toBe("unknown-object");
    expect(unknown.state.selection).toBeNull();
  });
});

describe("move / move-by", () => {
  it("move 改变锚点并进入撤销栈", () => {
    const state = editorOf(contentOf([analysisCard("a"), analysisCard("b")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
    ]);
    const result = applyCommand(state, { type: "move", objectId: "a", anchor: 4 });
    expect(result.ok).toBe(true);
    expect(anchorsOf(result.state)["a"]).toBe(4);
    expect(result.state.history.past.length).toBe(1);
  });

  it("相同锚点是空操作，不产生历史", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const result = applyCommand(state, { type: "move", objectId: "a", anchor: 1 });
    expect(result.ok).toBe(true);
    expect(result.state.history.past.length).toBe(0);
  });

  it("移动到被占用格失败且状态不变", () => {
    const state = editorOf(contentOf([analysisCard("a"), analysisCard("b")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
    ]);
    const result = applyCommand(state, { type: "move", objectId: "a", anchor: 2 });
    expect(result.ok).toBe(false);
    expect(result.issues.some((item) => item.code === "overlap")).toBe(true);
    expect(anchorsOf(result.state)["a"]).toBe(1);
  });

  it("move-by 按行/列偏移，越界失败", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const down = applyCommand(state, {
      type: "move-by",
      objectId: "a",
      rowDelta: 1,
      colDelta: 0,
    });
    expect(down.ok).toBe(true);
    expect(anchorsOf(down.state)["a"]).toBe(3);

    const left = applyCommand(state, {
      type: "move-by",
      objectId: "a",
      rowDelta: 0,
      colDelta: -1,
    });
    expect(left.ok).toBe(false);
    expect(left.issues[0]?.code).toBe("invalid-anchor");
  });
});

describe("resize", () => {
  it("放大/缩小占格", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const grown = applyCommand(state, { type: "resize", objectId: "a", colSpan: 2 });
    expect(grown.ok).toBe(true);
    const item = grown.state.layout.main.objects[0];
    expect(item?.colSpan).toBe(2);
    expect(item?.rowSpan).toBe(1);
  });

  it("行跨度超上限与非法尺寸都失败", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const tooTall = applyCommand(state, {
      type: "resize",
      objectId: "a",
      rowSpan: MAX_ROW_SPAN + 1,
    });
    expect(tooTall.ok).toBe(false);
    expect(tooTall.issues[0]?.code).toBe("row-span-too-large");

    const invalid = applyCommand(state, { type: "resize", objectId: "a", colSpan: 0 });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues[0]?.code).toBe("invalid-size");
  });

  it("用户主动收缩的容器需先恢复再改尺寸（OQ-LM-06 暂定）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")], [
      gridSplit("g", ["a", "b"]),
    ]);
    const state = editorOf(content, 4, [object("g", "grid-split", 1, 2, 2)]);
    const collapsed = applyCommand(state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    expect(collapsed.ok).toBe(true);

    const resize = applyCommand(collapsed.state, {
      type: "resize",
      objectId: "g",
      colSpan: 2,
    });
    expect(resize.ok).toBe(false);
    expect(resize.issues[0]?.code).toBe("user-collapsed");
  });
});

describe("set-presentation（容器 1×1 保底，OQ-LM-06 占位字段）", () => {
  it("折叠保存 expandedSize，恢复还原完整尺寸并清空字段", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")], [
      gridSplit("g", ["a", "b"]),
    ]);
    const state = editorOf(content, 4, [object("g", "grid-split", 1, 2, 2)]);

    const collapsed = applyCommand(state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "collapsed",
    });
    expect(collapsed.ok).toBe(true);
    const folded = collapsed.state.layout.main.objects[0];
    expect(folded).toMatchObject({
      objectId: "g",
      colSpan: 1,
      rowSpan: 1,
      presentation: "collapsed",
      expandedSize: { colSpan: 2, rowSpan: 2 },
    });

    const restored = applyCommand(collapsed.state, {
      type: "set-presentation",
      objectId: "g",
      presentation: "full",
    });
    expect(restored.ok).toBe(true);
    const full = restored.state.layout.main.objects[0];
    expect(full?.colSpan).toBe(2);
    expect(full?.rowSpan).toBe(2);
    expect(full?.presentation).toBeUndefined();
    expect(full?.expandedSize).toBeUndefined();
  });

  it("卡片不支持折叠形态", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const result = applyCommand(state, {
      type: "set-presentation",
      objectId: "a",
      presentation: "collapsed",
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("invalid-presentation");
  });
});

describe("insert", () => {
  it("insert-card 追加内容与几何，自动找最早空位", () => {
    const content = contentOf([analysisCard("a")]);
    const state = editorOf(content, 2, [object("a", "analysis-card", 1, 1, 1)]);
    const result = applyCommand(state, {
      type: "insert-card",
      card: analysisCard("b"),
    });
    expect(result.ok).toBe(true);
    expect(result.state.content.cards.map((card) => card.objectId)).toEqual(["a", "b"]);
    expect(anchorsOf(result.state)["b"]).toBe(2);
  });

  it("insert-card 重复 ID / 宽度超列数失败", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const duplicated = applyCommand(state, {
      type: "insert-card",
      card: analysisCard("a"),
    });
    expect(duplicated.ok).toBe(false);
    expect(duplicated.issues[0]?.code).toBe("duplicate-object-id");

    const tooWide = applyCommand(state, {
      type: "insert-card",
      card: analysisCard("b"),
      size: size(3, 1),
    });
    expect(tooWide.ok).toBe(false);
    expect(tooWide.issues[0]?.code).toBe("width-overflow");
  });

  it("insert-spacer 只改布局文档，不改内容文档", () => {
    const content = contentOf([analysisCard("a")]);
    const state = editorOf(content, 2, [object("a", "analysis-card", 1, 1, 1)]);
    const snapshot = JSON.stringify(state.content);
    const result = applyCommand(state, {
      type: "insert-spacer",
      objectId: "s1",
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.state.content)).toBe(snapshot);
    expect(anchorsOf(result.state)["s1"]).toBe(2);
  });
});

describe("delete", () => {
  it("同时移除内容文档与布局文档，并清空选中", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const state = editorOf(content, 2, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
    ]);
    const selected = applyCommand(state, { type: "select", objectId: "a" });
    const result = applyCommand(selected.state, { type: "delete", objectId: "a" });
    expect(result.ok).toBe(true);
    expect(result.state.content.cards.map((card) => card.objectId)).toEqual(["b"]);
    expect(result.state.layout.main.objects.map((item) => item.objectId)).toEqual(["b"]);
    expect(result.state.selection).toBeNull();
  });
});

describe("undo / redo", () => {
  it("撤销与重做在文档间往返", () => {
    const state = editorOf(contentOf([analysisCard("a"), analysisCard("b")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
    ]);
    const moved = applyCommand(state, { type: "move", objectId: "a", anchor: 4 });
    const undone = applyCommand(moved.state, { type: "undo" });
    expect(undone.ok).toBe(true);
    expect(anchorsOf(undone.state)["a"]).toBe(1);
    expect(undone.state.history.future.length).toBe(1);

    const redone = applyCommand(undone.state, { type: "redo" });
    expect(redone.ok).toBe(true);
    expect(anchorsOf(redone.state)["a"]).toBe(4);
  });

  it("新命令清空重做栈；撤销栈按上限截断", () => {
    const state = editorOf(
      contentOf([analysisCard("a"), analysisCard("b")]),
      3,
      [object("a", "analysis-card", 1, 1, 1), object("b", "analysis-card", 2, 1, 1)],
      2,
    );
    let current = applyCommand(state, { type: "move", objectId: "a", anchor: 4 }).state;
    current = applyCommand(current, { type: "move", objectId: "a", anchor: 7 }).state;
    current = applyCommand(current, { type: "move", objectId: "a", anchor: 10 }).state;
    expect(current.history.past.length).toBe(2);

    const undone = applyCommand(current, { type: "undo" });
    expect(undone.state.history.future.length).toBe(1);
    const afterNew = applyCommand(undone.state, { type: "move", objectId: "a", anchor: 1 });
    expect(afterNew.ok).toBe(true);
    expect(afterNew.state.history.future.length).toBe(0);
  });

  it("空栈撤销/重做失败并说明原因", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    expect(applyCommand(state, { type: "undo" }).issues[0]?.code).toBe("undo-empty");
    expect(applyCommand(state, { type: "redo" }).issues[0]?.code).toBe("redo-empty");
  });

  it("默认撤销栈上限为 50（候选值）", () => {
    const state = editorOf(contentOf([analysisCard("a")]), 2, [
      object("a", "analysis-card", 1, 1, 1),
    ]);
    expect(state.history.limit).toBe(DEFAULT_UNDO_LIMIT);
    expect(DEFAULT_UNDO_LIMIT).toBe(50);
  });
});

describe("投影预览", () => {
  it("给出 targetColumns 时附带投影，且不写回权威布局", () => {
    const state = editorOf(contentOf([analysisCard("a"), analysisCard("b")]), 3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 3, 1, 1),
    ]);
    const result = applyCommand(
      state,
      { type: "select", objectId: "a" },
      { targetColumns: 2 },
    );
    expect(result.projection?.columns).toBe(2);
    expect(state.layout.main.baseCols).toBe(3);
  });
});
