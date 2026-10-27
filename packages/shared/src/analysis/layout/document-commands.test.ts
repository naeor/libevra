import { describe, expect, it } from "vitest";
import { applyCommand, createEditorState } from "./commands.js";
import { analysisCard, carousel, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";

function fixture() {
  const children = [analysisCard("one"), analysisCard("two")];
  const content = contentOf([...children, analysisCard("root")], [gridSplit("box", ["one", "two"])]);
  return createEditorState(content, layoutOf(geometry(4, [object("box", "grid-split", 1, 2, 2), object("root", "analysis-card", 3, 1, 1), object("gap", "spacer", 4, 1, 1)])));
}

describe("D 正式内容文档命令", () => {
  it("预演和提交共用正式容量边界，不出现几何可放但内容超限的合法结果", () => {
    const cards = Array.from({ length: 40 }, (_, index) => analysisCard(`full-${index}`));
    const initial = createEditorState(contentOf(cards), layoutOf(geometry(4, cards.map((card, index) => object(card.objectId, "analysis-card", index + 1, 1, 1)))));
    const refused = applyCommand(initial, { type: "insert-card", card: analysisCard("new"), anchor: 1, collisionPolicy: "reflow" });
    expect(refused.ok).toBe(false);
    expect(refused.issues[0]?.code).toBe("too-many-objects");
    expect(refused.state).toBe(initial);
    const containers = Array.from({ length: 12 }, (_, index) => carousel(`box-${index}`, [`child-${index}-a`, `child-${index}-b`]));
    const nestedCards = containers.flatMap((item) => item.children.map((id) => analysisCard(id)));
    const full = createEditorState(contentOf(nestedCards, containers), layoutOf(geometry(4, containers.map((item, index) => object(item.objectId, "carousel", index + 1, 1, 1)))));
    const rejectedBox = applyCommand(full, { type: "insert-container", container: carousel("extra", ["new-a", "new-b"]), children: [analysisCard("new-a"), analysisCard("new-b")], size: { colSpan: 1, rowSpan: 1 }, anchor: 1, collisionPolicy: "reflow" });
    expect(rejectedBox.ok).toBe(false);
    expect(rejectedBox.issues[0]?.code).toBe("too-many-containers");
    expect(rejectedBox.state).toBe(full);
  });

  it("新容器与子卡片一起插入，碰撞顺延保留Spacer，一步撤销恢复全部", () => {
    const initial = fixture();
    const children = [analysisCard("three"), analysisCard("four")];
    const result = applyCommand(initial, { type: "insert-container", container: gridSplit("new", ["three", "four"]), children, anchor: 3, size: { colSpan: 2, rowSpan: 2 }, collisionPolicy: "reflow" });
    expect(result.ok).toBe(true);
    expect(result.state.layout.main.objects.find((item) => item.objectId === "gap")).toBeDefined();
    expect(result.state.content.cards).toHaveLength(5);
    expect(result.state.content.containers).toHaveLength(2);
    expect(result.state.history.past).toHaveLength(1);
    const undone = applyCommand(result.state, { type: "undo" });
    expect(undone.state.layout).toBe(initial.layout);
    expect(undone.state.content).toBe(initial.content);
  });

  it("拒绝把Spacer身份替换成容器，也拒绝偷用既有卡片作为新子卡片", () => {
    const initial = fixture();
    const children = [analysisCard("three"), analysisCard("four")];
    const collision = applyCommand(initial, { type: "insert-container", container: gridSplit("gap", ["three", "four"]), children, anchor: 4, size: { colSpan: 1, rowSpan: 1 }, collisionPolicy: "reflow" });
    expect(collision.ok).toBe(false);
    expect(collision.state).toBe(initial);
    const stolen = applyCommand(initial, { type: "insert-container", container: gridSplit("new", ["root", "three"]), children: [analysisCard("root"), analysisCard("three")], size: { colSpan: 2, rowSpan: 2 } });
    expect(stolen.ok).toBe(false);
    expect(stolen.issues[0]?.code).toBe("duplicate-object-id");
  });

  it("容器替换子卡片保留排序及配置、清理移出卡片并统一撤销", () => {
    const initial = fixture();
    const updated = { ...analysisCard("two"), chart: { chartFamily: "table" } };
    const result = applyCommand(initial, { type: "replace-container-children", containerId: "box", children: [updated, analysisCard("three")] });
    expect(result.ok).toBe(true);
    expect(result.state.content.containers[0]?.children).toEqual(["two", "three"]);
    expect(result.state.content.cards.find((item) => item.objectId === "two")?.chart).toEqual(updated.chart);
    expect(result.state.content.cards.some((item) => item.objectId === "one")).toBe(false);
    expect(result.state.layout).toBe(initial.layout);
    expect(applyCommand(result.state, { type: "undo" }).state.content).toBe(initial.content);
    const stolen = applyCommand(initial, { type: "replace-container-children", containerId: "box", children: [analysisCard("one"), analysisCard("root")] });
    expect(stolen.ok).toBe(false);
    const tooFew = applyCommand(initial, { type: "replace-container-children", containerId: "box", children: [analysisCard("one")] });
    expect(tooFew.ok).toBe(false);
    const split = { columnSplitPermille: 350, rowSplitPermille: 500 };
    const withSplit = applyCommand(initial, { type: "replace-container-children", containerId: "box", children: initial.content.cards.slice(0, 2), split });
    expect(withSplit.ok).toBe(true);
    expect(withSplit.state.content.containers[0]).toMatchObject({ split });
    expect(withSplit.state.history.past).toHaveLength(1);
    expect(applyCommand(withSplit.state, { type: "undo" }).state.content).toBe(initial.content);
  });

  it("整组删除与配置提交使用D统一历史，配置不改变几何", () => {
    const initial = fixture();
    const removed = applyCommand(initial, { type: "delete", objectId: "box" });
    expect(removed.ok).toBe(true);
    expect(removed.state.content.cards.map((item) => item.objectId)).toEqual(["root"]);
    expect(removed.state.content.containers).toEqual([]);
    expect(applyCommand(removed.state, { type: "undo" }).state.content).toBe(initial.content);
    const configured = applyCommand(initial, { type: "update-card", card: { ...analysisCard("one"), rangePolicy: "pinned", pinnedRange: { from: "2026-01-01", to: "2026-01-31" } } });
    expect(configured.ok).toBe(true);
    expect(configured.state.layout).toBe(initial.layout);
    expect(configured.state.history.past).toHaveLength(1);
    expect(applyCommand(configured.state, { type: "undo" }).state.content).toBe(initial.content);
  });
});
