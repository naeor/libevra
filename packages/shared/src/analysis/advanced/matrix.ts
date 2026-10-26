/**
 * 二维矩阵（C-1 草案，A10「分类×月份」、A17「分类增长排行」的矩阵形态、
 * P13「多指标交叉表」的数学核心）。
 *
 * 约束：
 * - 稀疏存储：只存有值的单元格；空单元格是「该组合没有发生」，不是 0 金额的账目。
 * - 合计守恒：Σ rowTotals = Σ colTotals = grandTotal；由 `matrixIsConserved` 断言。
 *   要求调用方保证「行维度与列维度互斥」（例如同一个交易只落一个分类×一个月），
 *   否则行合计 ≠ 总计——这是业务口径错误，不能在展示层掩盖。
 * - 单元格金额用 bigint；不做币种混合（调用方须先保证单一币种或先走 S16-D）。
 */

import type { DraftMatrixCell, DraftMatrixResult } from "./draftTypes.js";

export interface MatrixDatum {
  readonly rowId: string;
  readonly colId: string;
  readonly amountMinor: bigint;
  readonly count: number;
}

export interface MatrixOptions {
  /** 行顺序（例如按账本分类 sortOrder）；缺省按数据首次出现顺序。 */
  readonly rowOrder?: readonly string[];
  /** 列顺序（例如月份升序）；缺省按数据首次出现顺序。 */
  readonly colOrder?: readonly string[];
}

/**
 * 由明细/聚合数据构建稀疏矩阵。
 *
 * @throws {RangeError} 重复维度成员出现在显式顺序里，或 count 非整数。
 */
export function buildMatrix(
  data: readonly MatrixDatum[],
  options: MatrixOptions = {},
): DraftMatrixResult {
  assertNoDuplicates(options.rowOrder, "rowOrder");
  assertNoDuplicates(options.colOrder, "colOrder");

  const cellMap = new Map<string, { amountMinor: bigint; count: number }>();
  const rowIds: string[] = options.rowOrder ? [...options.rowOrder] : [];
  const colIds: string[] = options.colOrder ? [...options.colOrder] : [];

  const knownRowIds = new Set(rowIds);
  const knownColIds = new Set(colIds);

  for (const datum of data) {
    if (!Number.isInteger(datum.count) || datum.count < 0) {
      throw new RangeError(`Matrix count must be a non-negative integer: ${String(datum.count)}`);
    }

    const key = cellKey(datum.rowId, datum.colId);
    const existing = cellMap.get(key);
    cellMap.set(key, {
      amountMinor: (existing?.amountMinor ?? 0n) + datum.amountMinor,
      count: (existing?.count ?? 0) + datum.count,
    });

    if (!knownRowIds.has(datum.rowId)) {
      knownRowIds.add(datum.rowId);
      rowIds.push(datum.rowId);
    }
    if (!knownColIds.has(datum.colId)) {
      knownColIds.add(datum.colId);
      colIds.push(datum.colId);
    }
  }

  const rowTotals = new Map<string, bigint>(rowIds.map((rowId) => [rowId, 0n]));
  const colTotals = new Map<string, bigint>(colIds.map((colId) => [colId, 0n]));

  let grandTotalMinor = 0n;
  let grandTotalCount = 0;
  let filledCellCount = 0;

  const cells: DraftMatrixCell[] = [];

  for (const rowId of rowIds) {
    for (const colId of colIds) {
      const entry = cellMap.get(cellKey(rowId, colId));
      if (entry === undefined) continue;

      cells.push({
        rowId,
        colId,
        amountMinor: entry.amountMinor,
        count: entry.count,
      });

      if (entry.amountMinor !== 0n || entry.count > 0) filledCellCount += 1;

      rowTotals.set(rowId, (rowTotals.get(rowId) ?? 0n) + entry.amountMinor);
      colTotals.set(colId, (colTotals.get(colId) ?? 0n) + entry.amountMinor);
      grandTotalMinor += entry.amountMinor;
      grandTotalCount += entry.count;
    }
  }

  return {
    rowIds,
    colIds,
    cells,
    rowTotals,
    colTotals,
    grandTotalMinor,
    grandTotalCount,
    filledCellCount,
  };
}

/** 查单元格；不存在返回 null（表示「该组合没有发生」，不是 0 金额）。 */
export function matrixCell(
  matrix: DraftMatrixResult,
  rowId: string,
  colId: string,
): DraftMatrixCell | null {
  return matrix.cells.find((cell) => cell.rowId === rowId && cell.colId === colId) ?? null;
}

/** 合计守恒自检：行合计、列合计、总和、单元格合计四者对齐。 */
export function matrixIsConserved(matrix: DraftMatrixResult): boolean {
  const rowSum = sumMapValues(matrix.rowTotals);
  const colSum = sumMapValues(matrix.colTotals);
  const cellSum = matrix.cells.reduce((total, cell) => total + cell.amountMinor, 0n);
  const countSum = matrix.cells.reduce((total, cell) => total + cell.count, 0);

  return (
    rowSum === matrix.grandTotalMinor &&
    colSum === matrix.grandTotalMinor &&
    cellSum === matrix.grandTotalMinor &&
    countSum === matrix.grandTotalCount
  );
}

function cellKey(rowId: string, colId: string): string {
  return `${rowId}\u0000${colId}`;
}

function assertNoDuplicates(ids: readonly string[] | undefined, label: string): void {
  if (ids === undefined) return;

  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new RangeError(`Duplicate id in ${label}: ${id}`);
    }
    seen.add(id);
  }
}

function sumMapValues(values: ReadonlyMap<string, bigint>): bigint {
  let total = 0n;
  for (const value of values.values()) total += value;
  return total;
}
