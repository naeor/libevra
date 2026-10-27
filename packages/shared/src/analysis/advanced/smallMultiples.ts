/**
 * P14 · 分类周期小多图 Small Multiples（DRAFT，未冻结）。
 *
 * 多个分类共享同一时间桶序列（默认按月的金额趋势），由展示层排成小多图。
 *
 * 关键规则（owner 规格 §30）：
 * - **默认共享纵轴尺度**（`scaleMode = "shared"`），`sharedMaxMinor` 取所有回传面板的
 *   最大单桶值；只有调用方显式选择独立尺度时才用 `panelMaxMinor`，且展示层必须标注
 *   「各图独立尺度」。
 * - 计算复用 Agent B 的分类时间序列：本模块只是 C 分支上的**临时实现**（B 的
 *   `timeSeries.ts` 不在 C 分支），键规则与 B 对齐后由 B 替换；登记 QC-27。
 */

import type { DraftSmallMultiplePanel, DraftSmallMultiplesResult, DraftSmallMultiplePoint } from "./draftTypes.js";
import {
  assertRecordShape,
  dimensionKeyOf,
  dimensionLabelOf,
  monthKeyOf,
  parseCalendarDate,
  type AdvancedRecord,
} from "./dimensions.js";

export const DEFAULT_SMALL_MULTIPLES_TOP_N = 12;
export const MAX_SMALL_MULTIPLES_TOP_N = 24;

export interface SmallMultiplesOptions {
  readonly kind?: "expense" | "income";
  /** 回传前 N 个分类（按总金额降序）；默认 12，上限 24。 */
  readonly topN?: number;
  /** 显式时间桶（`YYYY-MM`）序列；缺省取记录里出现过的最早到最晚月份。 */
  readonly months?: readonly string[];
  readonly scaleMode?: "shared" | "independent";
}

interface MonthCell {
  amountMinor: bigint;
  count: number;
}

interface CategoryBucket {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly months: Map<string, MonthCell>;
}

/**
 * 分类 → 每月金额小多图数据。
 *
 * @throws {RangeError} 记录非法、topN 非法、显式月份非法、参数非法。
 */
export function smallMultiplesOf(
  records: readonly AdvancedRecord[],
  options: SmallMultiplesOptions = {},
): DraftSmallMultiplesResult {
  const kind = options.kind ?? "expense";
  if (kind !== "expense" && kind !== "income") throw new RangeError(`unsupported kind: ${String(kind)}`);

  const topN = options.topN ?? DEFAULT_SMALL_MULTIPLES_TOP_N;
  if (!Number.isInteger(topN) || topN < 1 || topN > MAX_SMALL_MULTIPLES_TOP_N) {
    throw new RangeError(
      `topN must be an integer in [1, ${String(MAX_SMALL_MULTIPLES_TOP_N)}], received: ${String(topN)}`,
    );
  }

  const filtered = records.filter((record) => record.kind === kind);
  for (const record of filtered) assertRecordShape(record);

  const months = resolveMonths(options.months, filtered);
  const categories = new Map<string, CategoryBucket>();

  for (const record of filtered) {
    const month = dimensionKeyOf(record, "month");
    if (!months.includes(month)) continue;

    const bucket = categories.get(record.categoryId);
    if (bucket === undefined) {
      categories.set(record.categoryId, {
        categoryId: record.categoryId,
        categoryLabel: dimensionLabelOf(record, "category"),
        months: new Map([[month, { amountMinor: record.amountMinor, count: 1 }]]),
      });
      continue;
    }

    const cell = bucket.months.get(month);
    if (cell === undefined) {
      bucket.months.set(month, { amountMinor: record.amountMinor, count: 1 });
    } else {
      cell.amountMinor += record.amountMinor;
      cell.count += 1;
    }
  }

  const ordered = [...categories.values()]
    .map((bucket) => {
      const totalMinor = [...bucket.months.values()].reduce((sum, cell) => sum + cell.amountMinor, 0n);
      const maxMinor = [...bucket.months.values()].reduce(
        (max, cell) => (cell.amountMinor > max ? cell.amountMinor : max),
        0n,
      );
      return { bucket, totalMinor, maxMinor };
    })
    .sort((left, right) => {
      if (left.totalMinor !== right.totalMinor) return left.totalMinor > right.totalMinor ? -1 : 1;
      return left.bucket.categoryId < right.bucket.categoryId
        ? -1
        : left.bucket.categoryId > right.bucket.categoryId
          ? 1
          : 0;
    });

  const panelsAll: DraftSmallMultiplePanel[] = ordered.map(({ bucket, totalMinor, maxMinor }) => {
    const points: DraftSmallMultiplePoint[] = months.map((month) => {
      const cell = bucket.months.get(month);
      return {
        bucketKey: month,
        valueMinor: cell?.amountMinor ?? 0n,
        count: cell?.count ?? 0,
      };
    });
    return {
      categoryId: bucket.categoryId,
      categoryLabel: bucket.categoryLabel,
      points,
      totalMinor,
      maxMinor,
    };
  });

  const panels = panelsAll.slice(0, topN);
  const sharedMaxMinor = panelsAll.reduce((max, panel) => (panel.maxMinor > max ? panel.maxMinor : max), 0n);

  return {
    panels,
    bucketKeys: months,
    bucketLabels: months.map(monthLabel),
    sharedMaxMinor,
    panelMaxMinor: new Map(panelsAll.map((panel) => [panel.categoryId, panel.maxMinor])),
    scaleMode: options.scaleMode ?? "shared",
    topN,
    truncated: panelsAll.length > panels.length,
    omittedCategoryCount: panelsAll.length - panels.length,
    completeness: filtered.length === 0 ? "no-transactions" : "complete",
  };
}

function monthLabel(month: string): string {
  const monthNumber = Number(month.slice(5, 7));
  return `${String(monthNumber)}月`;
}

function resolveMonths(
  explicit: readonly string[] | undefined,
  records: readonly AdvancedRecord[],
): string[] {
  if (explicit !== undefined) {
    if (explicit.length === 0) throw new RangeError("months must not be empty when provided");
    const result: string[] = [];
    for (const month of explicit) {
      parseCalendarDate(`${month}-01`);
      if (result.includes(month)) throw new RangeError(`duplicate month in months: ${month}`);
      result.push(month);
    }
    return result.sort();
  }

  if (records.length === 0) return [];

  const months = records.map((record) => monthKeyOf(record.occurredLocalDate));
  const unique = [...new Set(months)].sort();
  return unique;
}
