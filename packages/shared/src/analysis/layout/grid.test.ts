import { describe, expect, it } from "vitest";

import {
  findEarliestFreeAnchor,
  placementCells,
  placementCellsOverlap,
  placementFitsColumns,
  positionToRowCol,
  rowColToPosition,
  validateGeometry,
} from "./grid.js";

/**
 * 行优先编号与占格几何是布局层最底层的契约：编号错一格，迁移、碰撞、
 * 收缩全部跟着错。这里的用例按所有者规格 §4 与布局格式模板规格 §12
 * 逐条钉死公式与边界。
 */
describe("positionToRowCol / rowColToPosition", () => {
  it("按行优先从 1 起编号（2 列）", () => {
    expect(positionToRowCol(1, 2)).toEqual({ row: 1, col: 1 });
    expect(positionToRowCol(2, 2)).toEqual({ row: 1, col: 2 });
    expect(positionToRowCol(3, 2)).toEqual({ row: 2, col: 1 });
    expect(positionToRowCol(4, 2)).toEqual({ row: 2, col: 2 });
    expect(positionToRowCol(7, 2)).toEqual({ row: 4, col: 1 });
  });

  it("按行优先从 1 起编号（3 列）", () => {
    expect(positionToRowCol(7, 3)).toEqual({ row: 3, col: 1 });
    expect(positionToRowCol(8, 3)).toEqual({ row: 3, col: 2 });
  });

  it("与 rowColToPosition 互为逆运算", () => {
    for (const columns of [1, 2, 3, 4, 6]) {
      for (let position = 1; position <= 24; position += 1) {
        const { row, col } = positionToRowCol(position, columns);
        expect(rowColToPosition(row, col, columns)).toBe(position);
      }
    }
  });

  it("拒绝非正整数输入", () => {
    expect(() => positionToRowCol(0, 2)).toThrow(RangeError);
    expect(() => positionToRowCol(1.5, 2)).toThrow(RangeError);
    expect(() => rowColToPosition(1, 3, 2)).toThrow(RangeError);
  });
});

describe("placementFitsColumns", () => {
  it("宽度不超过剩余列数才合法", () => {
    expect(placementFitsColumns(1, { colSpan: 2, rowSpan: 2 }, 3)).toBe(true);
    expect(placementFitsColumns(2, { colSpan: 2, rowSpan: 1 }, 3)).toBe(true);
    expect(placementFitsColumns(3, { colSpan: 2, rowSpan: 1 }, 3)).toBe(false);
    expect(placementFitsColumns(1, { colSpan: 3, rowSpan: 1 }, 2)).toBe(false);
  });
});

describe("placementCells", () => {
  it("返回行优先升序的格子编号", () => {
    expect(placementCells(1, { colSpan: 2, rowSpan: 2 }, 3)).toEqual([1, 2, 4, 5]);
    expect(placementCells(2, { colSpan: 2, rowSpan: 1 }, 3)).toEqual([2, 3]);
    expect(placementCells(4, { colSpan: 1, rowSpan: 2 }, 2)).toEqual([4, 6]);
  });

  it("越界占格抛错", () => {
    expect(() => placementCells(3, { colSpan: 2, rowSpan: 1 }, 3)).toThrow(RangeError);
  });
});

describe("placementCellsOverlap", () => {
  it("共享任一格子即视为重叠", () => {
    expect(placementCellsOverlap([1, 2], [2, 3])).toBe(true);
    expect(placementCellsOverlap([1, 2], [3, 4])).toBe(false);
  });
});

describe("findEarliestFreeAnchor", () => {
  it("从 1 起找最早空位", () => {
    expect(findEarliestFreeAnchor(new Set([1]), { colSpan: 1, rowSpan: 1 }, 2)).toBe(2);
    expect(findEarliestFreeAnchor(new Set([1, 2, 3]), { colSpan: 1, rowSpan: 1 }, 2)).toBe(4);
    expect(findEarliestFreeAnchor(new Set(), { colSpan: 2, rowSpan: 1 }, 2)).toBe(1);
  });

  it("宽度超过列数时永远返回 null", () => {
    expect(findEarliestFreeAnchor(new Set(), { colSpan: 3, rowSpan: 1 }, 2)).toBeNull();
  });
});

describe("validateGeometry", () => {
  it("合法几何没有问题", () => {
    expect(
      validateGeometry(
        [
          { objectId: "a", objectType: "analysis-card", anchor: 1, colSpan: 2, rowSpan: 2 },
          { objectId: "b", objectType: "analysis-card", anchor: 3, colSpan: 1, rowSpan: 1 },
        ],
        3,
      ),
    ).toEqual([]);
  });

  it("识别重复 ID、越界、行跨度超限与重叠", () => {
    const issues = validateGeometry(
      [
        { objectId: "a", objectType: "analysis-card", anchor: 1, colSpan: 2, rowSpan: 2 },
        { objectId: "a", objectType: "analysis-card", anchor: 3, colSpan: 1, rowSpan: 1 },
        { objectId: "c", objectType: "analysis-card", anchor: 3, colSpan: 2, rowSpan: 1 },
        { objectId: "d", objectType: "analysis-card", anchor: 2, colSpan: 1, rowSpan: 9 },
      ],
      3,
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      "duplicate-object-id",
      "width-overflow",
      "row-span-too-large",
    ]);
  });

  it("拒绝非法列数", () => {
    expect(validateGeometry([], 0)[0]?.code).toBe("invalid-columns");
  });
});
