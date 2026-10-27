/**
 * P13 · 多指标交叉表 / 数据透视表（DRAFT，未冻结）。
 *
 * 受控维度 × 受控指标：只接受允许列表里的维度与指标，不解析表达式、不生成动态 SQL
 * （owner 规格 §29 限制）。行列合计由本模块给出，**展示层禁止重新统计**（规格 §6.4）。
 *
 * 原币守卫：金额类指标在跨币种且币种不在维度里时直接拒绝，绝不先混加再解释。
 *
 * 指标：
 * - `amount`   ← 金额（原币最小单位）
 * - `count`    ← 交易笔数
 * - `average`  ← 平均单笔（金额 / 笔数；笔数为 0 时 null）
 * - `share`    ← 单元格金额 / 总计金额（总金额为 0 时 null）
 */

import { makeRational } from "./rational.js";
import type {
  DraftPivotAggregate,
  DraftPivotCell,
  DraftPivotMetric,
  DraftPivotResult,
  DraftRational,
} from "./draftTypes.js";
import {
  assertRecordShape,
  assertSingleCurrencyUnlessDimension,
  collectDimensionValues,
  dimensionKeyOf,
  isAdvancedDimension,
  type AdvancedDimension,
  type AdvancedRecord,
} from "./dimensions.js";

export const PIVOT_METRICS: readonly DraftPivotMetric[] = ["amount", "count", "average", "share"];
export const MAX_PIVOT_CELLS = 2_500;

const CELL_SEPARATOR = "\u0001";

export interface PivotSpec {
  readonly rowDimension: AdvancedDimension;
  readonly colDimension: AdvancedDimension;
  readonly metric: DraftPivotMetric;
  /** 只统计一个方向；默认全部（支出 + 收入）。 */
  readonly kind?: "expense" | "income";
}

interface CellAccumulator {
  readonly rowId: string;
  readonly colId: string;
  amountMinor: bigint;
  count: number;
}

function aggregateOf(
  amountMinor: bigint,
  count: number,
  metric: DraftPivotMetric,
  grandTotalMinor: bigint,
): DraftPivotAggregate {
  let metricValue: DraftRational | null;
  switch (metric) {
    case "amount":
      metricValue = makeRational(amountMinor, 1n);
      break;
    case "count":
      metricValue = makeRational(BigInt(count), 1n);
      break;
    case "average":
      metricValue = count === 0 ? null : makeRational(amountMinor, BigInt(count));
      break;
    case "share":
      metricValue = grandTotalMinor === 0n ? null : makeRational(amountMinor, grandTotalMinor);
      break;
  }
  return { amountMinor, count, metricValue };
}

/**
 * 两个维度 + 一个指标 → 交叉表。
 *
 * @throws {RangeError} 维度/指标不在允许列表、行列同维度、混合原币、单元格数超限、记录非法。
 */
export function pivotOf(records: readonly AdvancedRecord[], spec: PivotSpec): DraftPivotResult {
  if (!isAdvancedDimension(spec.rowDimension)) {
    throw new RangeError(`unsupported row dimension: ${String(spec.rowDimension)}`);
  }
  if (!isAdvancedDimension(spec.colDimension)) {
    throw new RangeError(`unsupported column dimension: ${String(spec.colDimension)}`);
  }
  if (spec.rowDimension === spec.colDimension) {
    throw new RangeError(`row and column dimension must differ, got: ${spec.rowDimension}`);
  }
  if (!PIVOT_METRICS.includes(spec.metric)) {
    throw new RangeError(`unsupported pivot metric: ${String(spec.metric)}`);
  }

  const filtered =
    spec.kind === undefined ? records : records.filter((record) => record.kind === spec.kind);
  for (const record of filtered) assertRecordShape(record);

  assertSingleCurrencyUnlessDimension(
    filtered,
    [spec.rowDimension, spec.colDimension],
    spec.metric !== "count",
  );

  const rows = collectDimensionValues(filtered, spec.rowDimension);
  const cols = collectDimensionValues(filtered, spec.colDimension);

  if (rows.values.length * cols.values.length > MAX_PIVOT_CELLS) {
    throw new RangeError(
      `pivot result too large: ${String(rows.values.length)} x ${String(cols.values.length)} exceeds ${String(MAX_PIVOT_CELLS)} cells`,
    );
  }

  const accumulators = new Map<string, CellAccumulator>();
  let grandTotalMinor = 0n;
  let grandTotalCount = 0;

  for (const record of filtered) {
    const rowId = dimensionKeyOf(record, spec.rowDimension);
    const colId = dimensionKeyOf(record, spec.colDimension);
    const key = `${rowId}${CELL_SEPARATOR}${colId}`;
    const accumulator = accumulators.get(key);
    if (accumulator === undefined) {
      accumulators.set(key, { rowId, colId, amountMinor: record.amountMinor, count: 1 });
    } else {
      accumulator.amountMinor += record.amountMinor;
      accumulator.count += 1;
    }
    grandTotalMinor += record.amountMinor;
    grandTotalCount += 1;
  }

  const rowOrder = new Map(rows.values.map((value, index) => [value, index]));
  const colOrder = new Map(cols.values.map((value, index) => [value, index]));

  const cells: DraftPivotCell[] = [...accumulators.values()]
    .map((accumulator) => ({
      rowId: accumulator.rowId,
      colId: accumulator.colId,
      ...aggregateOf(accumulator.amountMinor, accumulator.count, spec.metric, grandTotalMinor),
    }))
    .sort((left, right) => {
      const rowDelta = (rowOrder.get(left.rowId) ?? 0) - (rowOrder.get(right.rowId) ?? 0);
      if (rowDelta !== 0) return rowDelta;
      return (colOrder.get(left.colId) ?? 0) - (colOrder.get(right.colId) ?? 0);
    });

  const rowAmounts = new Map<string, { amountMinor: bigint; count: number }>();
  const colAmounts = new Map<string, { amountMinor: bigint; count: number }>();

  for (const accumulator of accumulators.values()) {
    const rowEntry = rowAmounts.get(accumulator.rowId) ?? { amountMinor: 0n, count: 0 };
    rowEntry.amountMinor += accumulator.amountMinor;
    rowEntry.count += accumulator.count;
    rowAmounts.set(accumulator.rowId, rowEntry);

    const colEntry = colAmounts.get(accumulator.colId) ?? { amountMinor: 0n, count: 0 };
    colEntry.amountMinor += accumulator.amountMinor;
    colEntry.count += accumulator.count;
    colAmounts.set(accumulator.colId, colEntry);
  }

  const rowTotals = new Map<string, DraftPivotAggregate>();
  for (const [rowId, entry] of rowAmounts) {
    rowTotals.set(rowId, aggregateOf(entry.amountMinor, entry.count, spec.metric, grandTotalMinor));
  }
  const colTotals = new Map<string, DraftPivotAggregate>();
  for (const [colId, entry] of colAmounts) {
    colTotals.set(colId, aggregateOf(entry.amountMinor, entry.count, spec.metric, grandTotalMinor));
  }
  const grandTotal = aggregateOf(grandTotalMinor, grandTotalCount, spec.metric, grandTotalMinor);

  const cellAmountSum = cells.reduce((sum, cell) => sum + cell.amountMinor, 0n);
  const cellCountSum = cells.reduce((sum, cell) => sum + cell.count, 0);

  return {
    rowDimension: spec.rowDimension,
    colDimension: spec.colDimension,
    metric: spec.metric,
    rowIds: rows.values,
    colIds: cols.values,
    rowLabels: rows.labels,
    colLabels: cols.labels,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    sampleCount: filtered.length,
    completeness: filtered.length === 0 ? "no-transactions" : "complete",
    conservation: {
      amountsMatch: cellAmountSum === grandTotalMinor,
      countsMatch: cellCountSum === grandTotalCount,
    },
  };
}
