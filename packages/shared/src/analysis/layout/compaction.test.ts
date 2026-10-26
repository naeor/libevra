/**
 * D-3 垂直紧凑（OQ-LM-03 未决，默认关闭；本文件验证“可切换开关”的纯函数语义）。
 *
 * 规则：只向上平移、列不变、不改宽高/形态；Spacer 锚定不上浮且不得被穿过；
 * 容器整体平移；同输入同输出；不写回权威布局。
 */

import { describe, expect, it } from "vitest";
import { compactVertically } from "./compaction.js";
import { findEarliestFreeAnchor, placementCells, positionToRowCol, validateGeometry } from "./grid.js";
import { projectLayout } from "./projection.js";
import { createTestPrng } from "./test-prng.js";
import {
  analysisCard,
  contentOf,
  geometry,
  gridSplit,
  layoutOf,
  object,
  projectedOf,
} from "./test-support.js";
import type { LayoutGeometry, ProjectedObject, ProjectionResult } from "./types.js";

function geometryOf(projected: readonly ProjectedObject[]): readonly {
  objectId: string;
  objectType: ProjectedObject["objectType"];
  anchor: number;
  colSpan: number;
  rowSpan: number;
}[] {
  return projected.map((object) => ({
    objectId: object.objectId,
    objectType: object.objectType,
    anchor: object.anchor,
    colSpan: object.colSpan,
    rowSpan: object.rowSpan,
  }));
}

function projected2D(content: ReturnType<typeof contentOf>, layout: LayoutGeometry): ProjectionResult {
  return projectLayout(layout, content, { targetColumns: layout.baseCols });
}

describe("基础紧凑语义", () => {
  it("向上平移填补空洞（2 列：B 从 4 移到 2）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const layout = geometry(2, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 4, 1, 1),
    ]);
    const result = compactVertically(projected2D(content, layout).objects, 2);
    expect(result.movedCount).toBe(1);
    expect(result.objects.find((item) => item.objectId === "b")?.anchor).toBe(2);
  });

  it("Spacer 锚定不上浮，其它对象不得穿过它（1 列）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const layout = geometry(1, [
      object("a", "analysis-card", 1, 1, 1),
      object("s", "spacer", 2, 1, 1),
      object("b", "analysis-card", 4, 1, 1),
    ]);
    const before = projected2D(content, layout).objects;
    const result = compactVertically(before, 1);
    const spacer = result.objects.find((item) => item.objectId === "s");
    const card = result.objects.find((item) => item.objectId === "b");
    expect(spacer?.anchor).toBe(2);
    // b 至少要在 Spacer 下方（行 3），不能穿到行 1–2。
    expect(positionToRowCol(card?.anchor ?? 0, 1).row).toBeGreaterThanOrEqual(3);
  });

  it("容器整体平移：尺寸/形态不变（3 列）", () => {
    const content = contentOf(
      [analysisCard("a"), analysisCard("b"), analysisCard("c1"), analysisCard("c2")],
      [gridSplit("g", ["c1", "c2"])],
    );
    const layout = geometry(3, [
      object("a", "analysis-card", 1, 1, 1),
      object("g", "grid-split", 4, 2, 1),
      object("b", "analysis-card", 9, 1, 1),
    ]);
    const before = projected2D(content, layout).objects;
    const result = compactVertically(before, 3);
    const container = result.objects.find((item) => item.objectId === "g");
    const card = result.objects.find((item) => item.objectId === "b");
    expect(container?.anchor).toBe(4);
    expect(container?.colSpan).toBe(2);
    expect(container?.rowSpan).toBe(1);
    // b 原在行 3 列 3；行 1 列 3 空，应上移到锚点 3。
    expect(card?.anchor).toBe(3);
  });

  it("紧凑不改变宽高、形态与对象集合", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const layout = geometry(2, [
      object("a", "analysis-card", 1, 1, 2),
      object("b", "analysis-card", 5, 1, 1),
    ]);
    const before = projected2D(content, layout).objects;
    const after = compactVertically(before, 2).objects;
    expect(after.map((item) => item.objectId).sort()).toEqual(
      before.map((item) => item.objectId).sort(),
    );
    for (const object of after) {
      const original = before.find((item) => item.objectId === object.objectId);
      expect({ colSpan: object.colSpan, rowSpan: object.rowSpan, form: object.form }).toEqual({
        colSpan: original?.colSpan,
        rowSpan: original?.rowSpan,
        form: original?.form,
      });
    }
    expect(validateGeometry(geometryOf(after), 2)).toEqual([]);
  });

  it("默认关闭：不带开关的投影保持源位置；开关打开后等价于手动紧凑", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const layout = geometry(2, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 6, 1, 1),
    ]);
    const plain = projectLayout(layout, content, { targetColumns: 2 });
    expect(projectedOf(plain, "b").anchor).toBe(6);

    const compacted = projectLayout(layout, content, { targetColumns: 2, verticalCompact: true });
    const manual = compactVertically(plain.objects, 2);
    expect(geometryOf(compacted.objects)).toEqual(geometryOf(manual.objects));
  });

  it("紧凑是幂等的", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b"), analysisCard("c")]);
    const layout = geometry(3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 9, 1, 1),
      object("c", "analysis-card", 12, 1, 1),
    ]);
    const once = compactVertically(projected2D(content, layout).objects, 3);
    const twice = compactVertically(once.objects, 3);
    expect(twice.objects).toEqual(once.objects);
    expect(twice.movedCount).toBe(0);
  });

  it("非法列数原样返回", () => {
    const content = contentOf([analysisCard("a")]);
    const layout = geometry(2, [object("a", "analysis-card", 1, 1, 1)]);
    const projected = projectLayout(layout, content, { targetColumns: 2 }).objects;
    expect(compactVertically(projected, 0)).toEqual({ objects: projected, movedCount: 0 });
  });
});

describe("属性测试：随机合法布局的紧凑不变量（固定种子）", () => {
  it("800 个随机场景：几何合法、对象不丢、Spacer 不动、只上移、宽高形态不变", () => {
    const prng = createTestPrng(0x5f17d0a3);
    let checkedWithMoves = 0;
    let checked = 0;

    for (let scenario = 0; scenario < 800; scenario += 1) {
      const columns = prng.nextInt(1, 4);
      const objectCount = prng.nextInt(2, 8);
      const objects: {
        objectId: string;
        objectType: ProjectedObject["objectType"];
        anchor: number;
        colSpan: number;
        rowSpan: number;
      }[] = [];
      const occupied = new Set<number>();
      const cards = [];

      for (let index = 0; index < objectCount; index += 1) {
        const isSpacer = prng.chance(0.25);
        const objectId = `${isSpacer ? "s" : "c"}${String(index)}`;
        const size = prng.chance(0.2) && columns >= 2
          ? { colSpan: 2, rowSpan: 1 }
          : { colSpan: 1, rowSpan: prng.chance(0.2) ? 2 : 1 };
        const anchor = findEarliestFreeAnchor(occupied, size, columns);
        if (anchor === null) {
          continue;
        }
        // 主动留出空洞：随机把锚点整体下移 0–3 行（仍然合法、非重叠）。
        const rowsToSkip = prng.nextInt(0, 3);
        const position = positionToRowCol(anchor, columns);
        const shiftedAnchor = (position.row + rowsToSkip - 1) * columns + position.col;
        const shiftedCells = placementCells(shiftedAnchor, size, columns);
        if (shiftedCells.some((cell) => occupied.has(cell))) {
          continue;
        }
        for (const cell of shiftedCells) {
          occupied.add(cell);
        }
        objects.push({
          objectId,
          objectType: isSpacer ? "spacer" : "analysis-card",
          anchor: shiftedAnchor,
          ...size,
        });
        if (!isSpacer) {
          cards.push(analysisCard(objectId));
        }
      }

      if (objects.length < 2) {
        continue;
      }

      const content = contentOf(cards);
      const layout = geometry(columns, objects);
      const projected = projectLayout(layout, content, { targetColumns: columns });
      const compacted = compactVertically(projected.objects, columns);
      checked += 1;

      expect(validateGeometry(geometryOf(compacted.objects), columns)).toEqual([]);
      expect(compacted.objects.map((item) => item.objectId).sort()).toEqual(
        projected.objects.map((item) => item.objectId).sort(),
      );

      for (const object of compacted.objects) {
        const original = projected.objects.find((item) => item.objectId === object.objectId);
        expect(original).toBeDefined();
        if (original === undefined) {
          continue;
        }
        expect({ colSpan: object.colSpan, rowSpan: object.rowSpan, form: object.form }).toEqual({
          colSpan: original.colSpan,
          rowSpan: original.rowSpan,
          form: original.form,
        });
        const originalPosition = positionToRowCol(original.anchor, columns);
        const compactedPosition = positionToRowCol(object.anchor, columns);
        expect(compactedPosition.col).toBe(originalPosition.col);
        expect(compactedPosition.row).toBeLessThanOrEqual(originalPosition.row);
        if (object.objectType === "spacer") {
          expect(object.anchor).toBe(original.anchor);
        }
      }

      if (compacted.movedCount > 0) {
        checkedWithMoves += 1;
      }

      // 多次紧凑必须幂等。
      expect(compactVertically(compacted.objects, columns).objects).toEqual(compacted.objects);
      // 不写回权威布局。
      expect(JSON.stringify(layout)).toBe(JSON.stringify({ baseCols: columns, objects }));
      // 投影 + 紧凑：内容文档不被修改。
      expect(layoutOf(layout).main).toBe(layout);
    }

    expect(checked).toBeGreaterThan(700);
    expect(checkedWithMoves).toBeGreaterThan(500);
  });
});
