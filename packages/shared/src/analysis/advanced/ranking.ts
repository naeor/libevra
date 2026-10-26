/**
 * 记录级排行与集中度（C-1 草案）。
 *
 * 对应能力：
 * - I18「大额交易排行」（记录级，`ranked-records`，需 T2 只读投影）；
 * - A08「支出集中度」/ P08「帕累托集中度曲线」：由排行/分类金额派生 TopN 占比与
 *   累计曲线，**不新增结果形状**（owner 规格 §47 允许的派生，S-01 v2 映射时确认）。
 *
 * 排行规则（owner 规格 §5）：
 * - 金额降序 → 业务日期升序 → 记录 id 升序（稳定、确定，任意端一致）；
 * - 并列名次采用「竞赛排名」：1,1,3；`tieCount` 表示同金额记录数（含自己）；
 * - 截断时 `truncated=true` 且 `sampleComplete=false`；**不得**把截断样本当全量
 *   用于占比，因此 `totalMinor` 必须由调用方显式传入（缺失即 null）。
 * - 份额分母为 0 或未知时为 null，不写 0。
 */

import type {
  DraftConcentration,
  DraftParetoRow,
  DraftRankedRecord,
  DraftRankedRecordItem,
  DraftRankingResult,
  DraftRational,
} from "./draftTypes.js";
import { compareRational, makeRational, RATIONAL_ONE } from "./rational.js";

export interface RankRecordsOptions {
  /** 份额分母（例如该期支出总额）；未知时为 null/缺省，item.share 全为 null。 */
  readonly totalMinor?: bigint | null;
  /** 只返回前 N 条；缺省返回全部。截断不改名次。 */
  readonly limit?: number;
}

function compareRecords(left: DraftRankedRecord, right: DraftRankedRecord): number {
  if (left.amountMinor !== right.amountMinor) {
    return left.amountMinor > right.amountMinor ? -1 : 1;
  }
  if (left.occurredLocalDate !== right.occurredLocalDate) {
    return left.occurredLocalDate < right.occurredLocalDate ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function assertUniqueIds(records: readonly DraftRankedRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new RangeError(`Duplicate record id in ranking input: ${record.id}`);
    }
    seen.add(record.id);
  }
}

/**
 * 记录级排行（`ranked-records` 草稿）。
 *
 * @throws {RangeError} 记录 id 重复、limit 非法、金额为负（金额负值代表口径错误，
 *   支出/收入方向由 kind 表达，与 owner 规格「不引入负流水」一致）。
 */
export function rankRecords(
  records: readonly DraftRankedRecord[],
  options: RankRecordsOptions = {},
): DraftRankingResult {
  assertUniqueIds(records);

  const limit = options.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError(`limit must be a positive integer, received: ${String(limit)}`);
  }

  for (const record of records) {
    if (record.amountMinor < 0n) {
      throw new RangeError(`Ranking expects non-negative amounts, received: ${record.id}`);
    }
  }

  const totalMinor = options.totalMinor === undefined ? null : options.totalMinor;
  if (totalMinor !== null && totalMinor < 0n) {
    throw new RangeError(`totalMinor must be non-negative when provided, received: ${String(totalMinor)}`);
  }

  const sorted = [...records].sort(compareRecords);
  const tieCountByAmount = new Map<bigint, number>();
  for (const record of sorted) {
    tieCountByAmount.set(record.amountMinor, (tieCountByAmount.get(record.amountMinor) ?? 0) + 1);
  }

  const visibleCount = limit === undefined ? sorted.length : Math.min(limit, sorted.length);
  const items: DraftRankedRecordItem[] = [];

  let previousAmount: bigint | null = null;
  let previousRank = 0;

  sorted.forEach((record, index) => {
    const rank = previousAmount !== null && record.amountMinor === previousAmount ? previousRank : index + 1;
    previousAmount = record.amountMinor;
    previousRank = rank;

    if (index >= visibleCount) return;

    const share: DraftRational | null =
      totalMinor !== null && totalMinor > 0n ? makeRational(record.amountMinor, totalMinor) : null;

    items.push({
      ...record,
      rank,
      tieCount: tieCountByAmount.get(record.amountMinor) ?? 1,
      share,
    });
  });

  const truncated = limit !== undefined && sorted.length > limit;

  return {
    items,
    totalMinor,
    tiePolicy: "amount-desc-date-asc-id-asc",
    truncated,
    sampleComplete: !truncated,
  };
}

export interface ConcentrationInput {
  readonly id: string;
  readonly label: string;
  readonly minor: bigint;
}

export interface ConcentrationOptions {
  /** 要输出的 TopN 占比；缺省 [1, 3, 5, 10]。 */
  readonly topNs?: readonly number[];
}

/**
 * 帕累托 / 集中度：按金额降序累计，输出每行占比与累计占比，以及 TopN 占比。
 *
 * 只统计正金额分类（0 金额分类不参与，避免「0/0 份额」）；出现负金额直接报错，
 * 因为那意味着口径错误（支出分类不应出现负数）。
 *
 * @throws {RangeError} id 重复、负金额、topNs 非法。
 */
export function paretoOf(
  items: readonly ConcentrationInput[],
  options: ConcentrationOptions = {},
): DraftConcentration {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new RangeError(`Duplicate id in concentration input: ${item.id}`);
    }
    seen.add(item.id);

    if (item.minor < 0n) {
      throw new RangeError(`Concentration expects non-negative amounts, received: ${item.id}`);
    }
  }

  const topNs = options.topNs ?? [1, 3, 5, 10];
  for (const topN of topNs) {
    if (!Number.isInteger(topN) || topN < 1) {
      throw new RangeError(`topNs must contain positive integers, received: ${String(topN)}`);
    }
  }

  const positive = items.filter((item) => item.minor > 0n);
  const totalMinor = positive.reduce((total, item) => total + item.minor, 0n);

  if (positive.length === 0 || totalMinor === 0n) {
    return { totalMinor: 0n, rows: [], ratios: [] };
  }

  const sorted = [...positive].sort((left, right) => {
    if (left.minor !== right.minor) return left.minor > right.minor ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  let cumulativeMinor = 0n;
  const rows: DraftParetoRow[] = sorted.map((item) => {
    cumulativeMinor += item.minor;

    return {
      id: item.id,
      label: item.label,
      amountMinor: item.minor,
      share: makeRational(item.minor, totalMinor),
      cumulativeMinor,
      cumulativeShare: makeRational(cumulativeMinor, totalMinor),
    };
  });

  const ratios = topNs.map((topN) => {
    const covered = sorted.slice(0, Math.min(topN, sorted.length));
    const coveredMinor = covered.reduce((total, item) => total + item.minor, 0n);

    return {
      topN,
      share: makeRational(coveredMinor, totalMinor),
      coveredMinor,
    };
  });

  return { totalMinor, rows, ratios };
}

/** 帕累托曲线自检：累计占比单调不减，且最终恰好为 1。 */
export function paretoIsMonotonic(result: DraftConcentration): boolean {
  if (result.rows.length === 0) return result.totalMinor === 0n;

  let previous = result.rows[0]?.cumulativeShare ?? RATIONAL_ONE;
  for (const row of result.rows) {
    if (compareRational(row.cumulativeShare, previous) < 0) return false;
    previous = row.cumulativeShare;
  }

  return compareRational(previous, RATIONAL_ONE) === 0;
}
