/**
 * 垂直紧凑（OQ-LM-03 待所有者确认，默认关闭；本文件只提供可切换的纯函数）。
 *
 * 口径（所有者规格 §14 / 布局规格 §14，2026-10-27 确认部分）：
 * - 只适用于**投影结果**；不得写回权威布局，也不改变对象集合、宽高、形态、列号；
 * - 每个对象只**向上平移**（行减少），列保持不变；
 * - Spacer 锚定：自身不上浮，且其它对象不得穿过它（列范围重叠时只能停在 Spacer 下方）；
 * - 容器整体平移，内部结构/比例/页序不变（本文件不进入容器内部）；
 * - 顺序：按（当前行, 列, objectId）升序逐个处理；同输入同输出（确定性）。
 *
 * 注意：OQ-LM-03 的“紧凑与投影组合方式”仍未决；`projectLayout` 仅在
 * `options.verticalCompact === true` 时调用本函数，默认不压缩。
 */

import type { ProjectedObject } from "./types.js";
import {
  MAX_COLUMNS,
  MIN_COLUMNS,
} from "./types.js";
import {
  isPositiveInteger,
  placementCells,
  positionToRowCol,
  rowColToPosition,
} from "./grid.js";

export interface CompactionResult {
  /** 按输入顺序返回的新投影对象（只改 `anchor`；其余字段原样保留）。 */
  readonly objects: readonly ProjectedObject[];
  /** 实际被上移的对象数量（用于测试/遥测，不持久化）。 */
  readonly movedCount: number;
}

interface SpacerBound {
  readonly row: number;
  readonly bottom: number;
  readonly colStart: number;
  readonly colEnd: number;
}

function isUsableColumns(columns: number): boolean {
  return isPositiveInteger(columns) && columns >= MIN_COLUMNS && columns <= MAX_COLUMNS;
}

function compareByRowColId(
  left: ProjectedObject,
  right: ProjectedObject,
  columns: number,
): number {
  const leftPosition = positionToRowCol(left.anchor, columns);
  const rightPosition = positionToRowCol(right.anchor, columns);
  if (leftPosition.row !== rightPosition.row) {
    return leftPosition.row - rightPosition.row;
  }
  if (leftPosition.col !== rightPosition.col) {
    return leftPosition.col - rightPosition.col;
  }
  return left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0;
}

/**
 * 对投影结果做确定性垂直紧凑。
 *
 * @param objects 投影后的对象（可含 Spacer；行优先编号相对 `columns`）
 * @param columns 目标列数；非法时原样返回（视为调用方错误，不猜测）
 */
export function compactVertically(
  objects: readonly ProjectedObject[],
  columns: number,
): CompactionResult {
  if (!isUsableColumns(columns)) {
    return { objects, movedCount: 0 };
  }

  const occupied = new Set<number>();
  const spacerBounds: SpacerBound[] = [];

  for (const object of objects) {
    if (object.objectType !== "spacer") {
      continue;
    }
    const position = positionToRowCol(object.anchor, columns);
    const size = { colSpan: object.colSpan, rowSpan: object.rowSpan };
    for (const cell of placementCells(object.anchor, size, columns)) {
      occupied.add(cell);
    }
    spacerBounds.push({
      row: position.row,
      bottom: position.row + object.rowSpan,
      colStart: position.col,
      colEnd: position.col + object.colSpan - 1,
    });
  }

  const movable = objects
    .filter((object) => object.objectType !== "spacer")
    .slice()
    .sort((left, right) => compareByRowColId(left, right, columns));

  const anchorByObjectId = new Map<string, number>();
  let movedCount = 0;

  for (const object of movable) {
    const position = positionToRowCol(object.anchor, columns);
    const colEnd = position.col + object.colSpan - 1;

    let minRow = 1;
    for (const bound of spacerBounds) {
      const overlapsColumns = bound.colStart <= colEnd && bound.colEnd >= position.col;
      if (overlapsColumns && bound.row < position.row) {
        minRow = Math.max(minRow, bound.bottom);
      }
    }

    let targetRow = position.row;
    for (let candidateRow = minRow; candidateRow <= position.row; candidateRow += 1) {
      const candidateAnchor = rowColToPosition(candidateRow, position.col, columns);
      const cells = placementCells(candidateAnchor, object, columns);
      if (cells.every((cell) => !occupied.has(cell))) {
        targetRow = candidateRow;
        break;
      }
    }

    const anchor = rowColToPosition(targetRow, position.col, columns);
    for (const cell of placementCells(anchor, object, columns)) {
      occupied.add(cell);
    }
    anchorByObjectId.set(object.objectId, anchor);
    if (anchor !== object.anchor) {
      movedCount += 1;
    }
  }

  return {
    objects: objects.map((object) => {
      const anchor = anchorByObjectId.get(object.objectId);
      if (anchor === undefined || anchor === object.anchor) {
        return object;
      }
      return { ...object, anchor };
    }),
    movedCount,
  };
}
