/**
 * P10 记录级散点（Record Scatter，C-2 草案，DRAFT 未冻结）。
 *
 * 把「一笔交易」投影成散点：x = 业务日期（由 web 适配层按序数摆放）、y = 原始金额。
 * 本模块只负责**取点与确定性抽样**，不做像素坐标、不做展示派生。
 *
 * 抽样必须显式：超过 `maxPoints` 时按金额取前 N 笔（同额按 id 升序），再按日期
 * 升序输出，并给出 `omittedCount` / `strategy` / `complete=false`——展示层必须显示
 * 「仅绘制 N/M 笔」，不得把抽样样本当作全量结论（owner 规格 §5 可比性 / §46 测试）。
 */

import type { DraftScatterPoint, DraftScatterResult } from "./draftTypes.js";

export interface ScatterRecord {
  readonly id: string;
  readonly occurredLocalDate: string;
  readonly amountMinor: bigint;
  readonly categoryId: string;
}

export interface ScatterOptions {
  /** 最多绘制多少点；缺省 500（owner 规格 §45 的图表成本控制）。 */
  readonly maxPoints?: number;
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function compareByDateThenAmount(left: DraftScatterPoint, right: DraftScatterPoint): number {
  if (left.occurredLocalDate !== right.occurredLocalDate) {
    return left.occurredLocalDate < right.occurredLocalDate ? -1 : 1;
  }
  if (left.amountMinor !== right.amountMinor) return left.amountMinor > right.amountMinor ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * 记录 → 散点投影。
 *
 * @throws {RangeError} 日期不是 YYYY-MM-DD、金额为负、id 重复、maxPoints 非正整数。
 */
export function scatterOf(
  records: readonly ScatterRecord[],
  options: ScatterOptions = {},
): DraftScatterResult {
  const maxPoints = options.maxPoints ?? 500;
  if (!Number.isInteger(maxPoints) || maxPoints < 1) {
    throw new RangeError(`maxPoints must be a positive integer, received: ${String(maxPoints)}`);
  }

  const seen = new Set<string>();
  const points: DraftScatterPoint[] = [];

  for (const record of records) {
    if (seen.has(record.id)) {
      throw new RangeError(`Duplicate id in scatter records: ${record.id}`);
    }
    seen.add(record.id);

    if (!CALENDAR_DATE_PATTERN.test(record.occurredLocalDate)) {
      throw new RangeError(`Invalid calendar date: ${record.occurredLocalDate}`);
    }
    if (record.amountMinor < 0n) {
      throw new RangeError(`Scatter expects non-negative amounts, received: ${record.id}`);
    }

    points.push({
      id: record.id,
      occurredLocalDate: record.occurredLocalDate,
      amountMinor: record.amountMinor,
      categoryId: record.categoryId,
    });
  }

  if (points.length === 0) {
    return {
      points: [],
      sampleCount: 0,
      plottedCount: 0,
      omittedCount: 0,
      strategy: "none",
      complete: true,
      completeness: "no-transactions",
    };
  }

  if (points.length <= maxPoints) {
    return {
      points: [...points].sort(compareByDateThenAmount),
      sampleCount: points.length,
      plottedCount: points.length,
      omittedCount: 0,
      strategy: "none",
      complete: true,
      completeness: "complete",
    };
  }

  const sampled = [...points]
    .sort((left, right) => {
      if (left.amountMinor !== right.amountMinor) {
        return left.amountMinor > right.amountMinor ? -1 : 1;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .slice(0, maxPoints)
    .sort(compareByDateThenAmount);

  return {
    points: sampled,
    sampleCount: points.length,
    plottedCount: sampled.length,
    omittedCount: points.length - sampled.length,
    strategy: "top-amount",
    complete: false,
    completeness: "complete",
  };
}
