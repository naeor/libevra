/**
 * P21 · 自定义多维分析（DRAFT，未冻结）。
 *
 * 能力检查 + 声明式交叉立方。**不执行任意 SQL、不接受表达式**：维度与指标都来自
 * 允许列表，超出能力时返回显式拒绝（`ok: false`），不抛异常给展示层猜（owner 规格 §37）。
 *
 * 输出是标准结果的原料：1 维可退化为排行 / 分布，2 维映射 Matrix，3 维由上层选择
 * 兼容图表；本模块不决定图种。
 *
 * 安全不变量：金额类指标跨原币且币种不在维度里 → 拒绝（不得混加不同原币）；
 * 组合数超限 → 拒绝（查询成本控制）；维度重复 → 拒绝；不允许 0 维。
 */

import type {
  DraftCrossCubeCell,
  DraftCrossCubeResult,
  DraftCubeAxis,
  DraftCubeRejectionReason,
} from "./draftTypes.js";
import {
  ADVANCED_DIMENSIONS,
  assertRecordShape,
  collectDimensionValues,
  currenciesOf,
  dimensionKeyOf,
  isAdvancedDimension,
  type AdvancedDimension,
  type AdvancedRecord,
} from "./dimensions.js";

export const MAX_CUBE_DIMENSIONS = 3;
export const MAX_CUBE_COMBINATIONS = 5_000;

const COORD_SEPARATOR = "\u0001";

export interface CrossCubeSpec {
  readonly metric: "amount" | "count";
  readonly dimensions: readonly AdvancedDimension[];
  readonly kind?: "expense" | "income";
  /** 组合数上限；默认 5000。 */
  readonly maxCombinations?: number;
}

export type DraftCrossCubeOutcome =
  | { readonly ok: true; readonly result: DraftCrossCubeResult }
  | { readonly ok: false; readonly reason: DraftCubeRejectionReason; readonly detail: string };

function reject(reason: DraftCubeRejectionReason, detail: string): DraftCrossCubeOutcome {
  return { ok: false, reason, detail };
}

/**
 * 记录 → 多维交叉立方。
 *
 * 拒绝原因（均为可展示的能力检查结论）：
 * - `unsupported-dimension` / `unsupported-metric`
 * - `duplicate-dimension` / `too-many-dimensions` / `too-many-combinations`
 * - `mixed-currency`（金额指标跨原币且未按币种分组）
 */
export function crossCubeOf(
  records: readonly AdvancedRecord[],
  spec: CrossCubeSpec,
): DraftCrossCubeOutcome {
  if (spec.metric !== "amount" && spec.metric !== "count") {
    return reject("unsupported-metric", `unsupported metric: ${String(spec.metric)}`);
  }

  const dimensions = [...spec.dimensions];

  if (dimensions.length === 0) {
    return reject("too-many-dimensions", "at least one dimension is required");
  }
  if (dimensions.length > MAX_CUBE_DIMENSIONS) {
    return reject(
      "too-many-dimensions",
      `at most ${String(MAX_CUBE_DIMENSIONS)} dimensions are supported, received: ${String(dimensions.length)}`,
    );
  }

  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (!isAdvancedDimension(dimension)) {
      return reject("unsupported-dimension", `unsupported dimension: ${String(dimension)}`);
    }
    if (seen.has(dimension)) {
      return reject("duplicate-dimension", `duplicate dimension: ${dimension}`);
    }
    seen.add(dimension);
  }

  const filtered =
    spec.kind === undefined ? records : records.filter((record) => record.kind === spec.kind);
  for (const record of filtered) assertRecordShape(record);

  if (spec.metric === "amount") {
    const currencies = currenciesOf(filtered);
    if (currencies.length > 1 && !dimensions.includes("currency")) {
      return reject(
        "mixed-currency",
        `mixed original currencies (${currencies.join(", ")}) cannot be summed; add the currency dimension or filter to one currency`,
      );
    }
  }

  const maxCombinations = spec.maxCombinations ?? MAX_CUBE_COMBINATIONS;
  if (!Number.isInteger(maxCombinations) || maxCombinations < 1) {
    return reject("too-many-combinations", `maxCombinations must be a positive integer, received: ${String(maxCombinations)}`);
  }

  const axes: DraftCubeAxis[] = dimensions.map((dimension) => {
    const collected = collectDimensionValues(filtered, dimension);
    return {
      dimension,
      values: collected.values,
      labels: collected.labels,
    };
  });

  const combinations = axes.reduce((product, axis) => product * Math.max(1, axis.values.length), 1);
  if (combinations > maxCombinations) {
    return reject(
      "too-many-combinations",
      `cube combinations ${String(combinations)} exceed limit ${String(maxCombinations)}`,
    );
  }

  const positions = new Map(dimensions.map((dimension, index) => [dimension, index]));
  const cells = new Map<string, { coords: string[]; amountMinor: bigint; count: number }>();
  let totalMinor = 0n;
  let totalCount = 0;

  for (const record of filtered) {
    const coords = dimensions.map((dimension) => dimensionKeyOf(record, dimension));
    const key = coords.join(COORD_SEPARATOR);
    const existing = cells.get(key);
    if (existing === undefined) {
      cells.set(key, { coords, amountMinor: record.amountMinor, count: 1 });
    } else {
      existing.amountMinor += record.amountMinor;
      existing.count += 1;
    }
    totalMinor += record.amountMinor;
    totalCount += 1;
  }

  const axisOrder = axes.map((axis) => new Map(axis.values.map((value, index) => [value, index])));
  const cellList: DraftCrossCubeCell[] = [...cells.values()]
    .map((cell) => ({ coords: cell.coords, amountMinor: cell.amountMinor, count: cell.count }))
    .sort((left, right) => {
      for (let index = 0; index < dimensions.length; index += 1) {
        const order = axisOrder[index];
        if (order === undefined) continue;
        const leftValue = left.coords[index] ?? "";
        const rightValue = right.coords[index] ?? "";
        const delta = (order.get(leftValue) ?? 0) - (order.get(rightValue) ?? 0);
        if (delta !== 0) return delta;
      }
      return 0;
    });

  const scaleNodeCount = axes.map((axis) => axis.values.length);
  const cubeSize = scaleNodeCount.reduce((product, size) => product * Math.max(1, size), 1);

  const result: DraftCrossCubeResult = {
    metric: spec.metric,
    dimensions: dimensions as readonly AdvancedDimension[],
    axes,
    cells: cellList,
    totalMinor,
    totalCount,
    scaleNodeCount,
    combinations: cubeSize,
    filledCellCount: cellList.length,
    completeness: filtered.length === 0 ? "no-transactions" : "complete",
    supportedDimensions: ADVANCED_DIMENSIONS,
    dimensionPositions: positions,
  };

  return { ok: true, result };
}
