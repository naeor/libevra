/**
 * 行优先网格几何：编号、占格、合法性、碰撞检测。
 *
 * 所有函数都是纯函数：不读时钟、不读视口、不读财务数据、不产生随机数。
 * 编号公式（所有者规格 §4，布局格式模板规格 §12）：
 * - `position = row × columns + col + 1`（row/col 从 0 起，position 从 1 起）
 * - `row = floor((position − 1) / columns)`
 * - `col = (position − 1) mod columns`
 * 位置取对象左上角格子编号；尺寸独立用 `colSpan × rowSpan` 表示。
 *
 * 注意（待决）：单元格的实际像素高度尚未冻结（OQ-LM-02/09），本层只做
 * 整数格几何，不把格子语义解释为正方形像素。
 */

import type { GridSize, LayoutValidationIssue, ObjectGeometry } from "./types.js";
import { MAX_COLUMNS, MAX_ROW_SPAN, MIN_COLUMNS } from "./types.js";

/** 正整数判断（供几何参数校验复用）。 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** 位置编号是否在合法范围（相对给定列数，1 起）。 */
export function isCoordinateInColumn(position: number, columns: number): boolean {
  const zeroBased = position - 1;
  return zeroBased >= 0 && (zeroBased % columns) + 1 <= columns;
}

/** 行优先位置编号 → { row, col }（均从 1 起）。 */
export function positionToRowCol(position: number, columns: number): { readonly row: number; readonly col: number } {
  if (!isPositiveInteger(position) || !isPositiveInteger(columns)) {
    throw new RangeError("positionToRowCol 需要正整数 position 与 columns");
  }
  const zeroBased = position - 1;
  return {
    row: Math.floor(zeroBased / columns) + 1,
    col: (zeroBased % columns) + 1,
  };
}

/** { row, col }（从 1 起）→ 行优先位置编号。 */
export function rowColToPosition(row: number, col: number, columns: number): number {
  if (!isPositiveInteger(row) || !isPositiveInteger(col) || !isPositiveInteger(columns)) {
    throw new RangeError("rowColToPosition 需要正整数 row/col/columns");
  }
  if (col > columns) {
    throw new RangeError("col 超出 columns");
  }
  return (row - 1) * columns + col;
}

/** 该占格放得下吗（不检查碰撞，只检查不越出列数；行方向无上限）。 */
export function placementFitsColumns(anchor: number, size: GridSize, columns: number): boolean {
  if (!isPositiveInteger(anchor) || !isPositiveInteger(columns)) {
    return false;
  }
  if (!isPositiveInteger(size.colSpan) || !isPositiveInteger(size.rowSpan)) {
    return false;
  }
  const { col } = positionToRowCol(anchor, columns);
  return col + size.colSpan - 1 <= columns;
}

/**
 * 占格覆盖的格子编号列表（行优先升序）。
 * 无效输入抛 RangeError；调用方应先用 `placementFitsColumns` 判断。
 */
export function placementCells(anchor: number, size: GridSize, columns: number): readonly number[] {
  if (!placementFitsColumns(anchor, size, columns)) {
    throw new RangeError("占格非法：越出列数或参数不是正整数");
  }
  const { row, col } = positionToRowCol(anchor, columns);
  const cells: number[] = [];
  for (let rowOffset = 0; rowOffset < size.rowSpan; rowOffset += 1) {
    for (let colOffset = 0; colOffset < size.colSpan; colOffset += 1) {
      cells.push((row - 1 + rowOffset) * columns + (col - 1 + colOffset) + 1);
    }
  }
  return cells;
}

/** 两个占格是否共享至少一个格子（调用方保证两者都按同一 `columns` 合法）。 */
export function placementCellsOverlap(first: readonly number[], second: readonly number[]): boolean {
  const smaller = first.length <= second.length ? first : second;
  const larger = first.length <= second.length ? second : first;
  const largerSet = new Set(larger);
  return smaller.some((cell) => largerSet.has(cell));
}

/** 把占格列表换成 Set，便于投影循环里做 O(1) 碰撞判断。 */
export function toCellSet(cells: readonly number[]): Set<number> {
  return new Set(cells);
}

/** 格子编号集合中的最大编号；空集合返回 0。 */
function maxCell(cells: ReadonlySet<number>): number {
  let max = 0;
  for (const cell of cells) {
    if (cell > max) {
      max = cell;
    }
  }
  return max;
}

/**
 * 从编号 1 开始找最早的、能容下 `size` 且不碰撞的合法位置。
 * 返回 null 表示该尺寸在当前列数下永远放不下（宽度超限）。
 *
 * 行方向无限，搜索上界只由当前占用的最大编号 + 一个完整对象高度决定，
 * 因此结果有限且确定。
 */
export function findEarliestFreeAnchor(
  occupied: ReadonlySet<number>,
  size: GridSize,
  columns: number,
): number | null {
  if (!isPositiveInteger(columns) || !placementFitsColumns(1, size, columns)) {
    return null;
  }
  const lastOccupied = maxCell(occupied);
  const limit = lastOccupied + columns * (size.rowSpan + 1) + columns;
  for (let anchor = 1; anchor <= limit; anchor += 1) {
    const occupiedCells = placementCells(anchor, size, columns);
    let collision = false;
    for (const cell of occupiedCells) {
      if (occupied.has(cell)) {
        collision = true;
        break;
      }
    }
    if (!collision) {
      return anchor;
    }
  }
  // 理论上不可达：一个空行足够放下任何合法尺寸；保留兜底返回。
  return null;
}

/** 校验一份几何：列数、编号、尺寸、越界与重叠。返回问题列表，空数组表示合法。 */
export function validateGeometry(
  objects: readonly ObjectGeometry[],
  columns: number,
): readonly LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];
  if (!isPositiveInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    issues.push({
      code: "invalid-columns",
      detail: `列数必须是 ${MIN_COLUMNS}–${MAX_COLUMNS} 的整数，实际 ${String(columns)}`,
    });
    return issues;
  }

  const seenIds = new Set<string>();
  const placed: Array<{ readonly objectId: string; readonly cells: readonly number[] }> = [];

  for (const object of objects) {
    if (seenIds.has(object.objectId)) {
      issues.push({
        objectId: object.objectId,
        code: "duplicate-object-id",
        detail: "同一布局中 objectId 重复；按损坏数据规则只保留首次出现",
      });
      continue;
    }
    seenIds.add(object.objectId);

    if (!isPositiveInteger(object.anchor)) {
      issues.push({
        objectId: object.objectId,
        code: "invalid-anchor",
        detail: `位置编号必须是正整数，实际 ${String(object.anchor)}`,
      });
      continue;
    }
    if (!isPositiveInteger(object.colSpan) || !isPositiveInteger(object.rowSpan)) {
      issues.push({
        objectId: object.objectId,
        code: "invalid-size",
        detail: "占格必须是正整数",
      });
      continue;
    }
    if (object.rowSpan > MAX_ROW_SPAN) {
      issues.push({
        objectId: object.objectId,
        code: "row-span-too-large",
        detail: `行跨度超过上限 ${MAX_ROW_SPAN}`,
      });
      continue;
    }
    if (!placementFitsColumns(object.anchor, { colSpan: object.colSpan, rowSpan: object.rowSpan }, columns)) {
      issues.push({
        objectId: object.objectId,
        code: "width-overflow",
        detail: `对象宽度 ${object.colSpan} 超出目标列数 ${columns} 或位置非法`,
      });
      continue;
    }

    const cells = placementCells(
      object.anchor,
      { colSpan: object.colSpan, rowSpan: object.rowSpan },
      columns,
    );
    for (const other of placed) {
      if (placementCellsOverlap(cells, other.cells)) {
        issues.push({
          objectId: object.objectId,
          code: "overlap",
          detail: `与 ${other.objectId} 占格重叠`,
        });
        break;
      }
    }
    placed.push({ objectId: object.objectId, cells });
  }

  return issues;
}
