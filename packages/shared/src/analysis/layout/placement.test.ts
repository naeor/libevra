import { describe, expect, it } from "vitest";
import { applyCommand, createEditorState } from "./commands.js";
import { validateGeometry } from "./grid.js";
import { planSmartPlacement } from "./placement.js";
import { analysisCard, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";

const row = ["a", "b", "c", "d"].map((id, index) => object(id, "analysis-card", index + 1, 1, 1));
const anchors = (objects: readonly { objectId: string; anchor: number }[]) => Object.fromEntries(objects.map((item) => [item.objectId, item.anchor]));

describe("智能落位（D 正式规划）", () => {
  it("1×1 插入满行，原卡片依次后移，一步撤销/重做完整恢复", () => {
    const initial = createEditorState(contentOf(row.map((item) => analysisCard(item.objectId))), layoutOf(geometry(4, row)));
    const command = { type: "insert-card" as const, card: analysisCard("new"), anchor: 2, collisionPolicy: "reflow" as const };
    const preview = applyCommand(initial, command);
    const committed = applyCommand(initial, command);
    expect(preview.state.layout).toEqual(committed.state.layout);
    expect(anchors(committed.state.layout.main.objects)).toEqual({ a: 1, b: 3, c: 4, d: 5, new: 2 });
    expect(initial.history.past).toHaveLength(0);
    expect(committed.state.history.past).toHaveLength(1);
    const undone = applyCommand(committed.state, { type: "undo" });
    expect(undone.state.layout).toBe(initial.layout);
    expect(undone.state.content).toBe(initial.content);
    expect(applyCommand(undone.state, { type: "redo" }).state.layout).toEqual(committed.state.layout);
  });

  it("2×2 插入四张小卡片：目标矩形完整、旧顺序保留、无对象缩小", () => {
    const plan = planSmartPlacement(geometry(4, row), object("new", "analysis-card", 1, 2, 2));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(anchors(plan.geometry.objects)).toEqual({ a: 3, b: 4, c: 7, d: 8, new: 1 });
    expect(plan.geometry.objects.find((item) => item.objectId === "new")).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(validateGeometry(plan.geometry.objects, 4)).toEqual([]);
  });

  it("已有相同尺寸卡片优先交换，仅改变两个锚点", () => {
    const plan = planSmartPlacement(geometry(4, row), { ...row[0]!, anchor: 3 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(anchors(plan.geometry.objects)).toEqual({ a: 3, b: 2, c: 1, d: 4 });
    expect(plan.affectedIds).toEqual(["a", "c"]);
  });

  it("不同尺寸移动保留大卡片尺寸；远处无冲突对象不被无故移动", () => {
    const big = object("big", "analysis-card", 9, 2, 2);
    const distant = object("far", "spacer", 41, 1, 2);
    const plan = planSmartPlacement(geometry(4, [...row, big, distant]), { ...big, anchor: 1 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(anchors(plan.geometry.objects)).toEqual({ a: 3, b: 4, c: 7, d: 8, big: 1, far: 41 });
    expect(plan.geometry.objects.find((item) => item.objectId === "far")).toBe(distant);
    expect(plan.geometry.objects.find((item) => item.objectId === "big")).toMatchObject({ colSpan: 2, rowSpan: 2 });
  });

  it("Spacer 与折叠容器整体参与重排，内容和折叠配置原样保留", () => {
    const content = contentOf([analysisCard("child1"), analysisCard("child2")], [gridSplit("box", ["child1", "child2"])]);
    const box = object("box", "grid-split", 2, 1, 1, { presentation: "collapsed", expandedSize: { colSpan: 2, rowSpan: 2 } });
    const initial = createEditorState(content, layoutOf(geometry(4, [object("gap", "spacer", 1, 1, 2), box])));
    const result = applyCommand(initial, { type: "insert-card", card: analysisCard("new"), anchor: 1, size: { colSpan: 2, rowSpan: 2 }, collisionPolicy: "reflow" });
    expect(result.ok).toBe(true);
    expect(result.state.content.containers).toBe(content.containers);
    expect(result.state.content.cards.slice(0, 2)).toEqual(content.cards);
    expect(result.state.layout.main.objects.find((item) => item.objectId === "gap")).toMatchObject({ colSpan: 1, rowSpan: 2 });
    expect(result.state.layout.main.objects.find((item) => item.objectId === "box")).toMatchObject({ presentation: "collapsed", expandedSize: { colSpan: 2, rowSpan: 2 } });
  });

  it("越界宽度拒绝，不以自动缩小掩盖无效目标", () => {
    const initial = createEditorState(contentOf([analysisCard("a")]), layoutOf(geometry(2, [object("a", "analysis-card", 1, 2, 2)])));
    const result = applyCommand(initial, { type: "move", objectId: "a", anchor: 2, collisionPolicy: "reflow" });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("width-overflow");
    expect(result.state).toBe(initial);
  });

  it("在不同列数和目标位置，规划保持所有对象唯一与合法且确定", () => {
    for (let columns = 1; columns <= 6; columns += 1) {
      const objects = Array.from({ length: 12 }, (_, index) => object(`item-${index}`, index % 3 === 0 ? "spacer" : "analysis-card", index * columns + 1, Math.min(columns, index % 2 + 1), 1));
      for (let anchor = 1; anchor < columns * 8; anchor += 1) {
        const candidate = object("insert", "spacer", anchor, Math.min(columns, 2), 2);
        const plan = planSmartPlacement(geometry(columns, objects), candidate);
        expect(plan).toEqual(planSmartPlacement(geometry(columns, objects), candidate));
        if (!plan.ok) continue;
        expect(validateGeometry(plan.geometry.objects, columns)).toEqual([]);
        expect(new Set(plan.geometry.objects.map((item) => item.objectId)).size).toBe(objects.length + 1);
        const old = plan.geometry.objects.filter((item) => item.objectId !== "insert");
        expect(old.map((item) => item.anchor)).toEqual(old.map((item) => item.anchor).sort((a, b) => a - b));
        expect(old.map(({ objectId, objectType, colSpan, rowSpan }) => ({ objectId, objectType, colSpan, rowSpan })))
          .toEqual(objects.map(({ objectId, objectType, colSpan, rowSpan }) => ({ objectId, objectType, colSpan, rowSpan })));
      }
    }
  });
});
