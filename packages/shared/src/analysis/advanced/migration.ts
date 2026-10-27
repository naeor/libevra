/**
 * P09 分类排名迁移（Rank Migration，C-2 草案，DRAFT 未冻结）。
 *
 * 输入是两期的分类金额聚合（调用方负责只传「该期有金额」的分类，或传 0 金额分类
 * 但需自行接受其名次落位），输出名次变化。金额权威是 bigint，本模块不做展示派生。
 *
 * 名次口径（与 S-01 排行一致）：金额降序、同额按 id 升序、同额共享名次
 * （competition rank，例如 100/100/50 → 1/1/3）。名次差 = 上期名次 - 本期名次，
 * 正数表示名次上升；任一期缺失时为 null（不是 0，也不是「消失」）。
 */

import type { DraftRankMigrationResult, DraftRankMigrationRow } from "./draftTypes.js";

export interface RankSnapshotEntry {
  readonly id: string;
  readonly label: string;
  readonly minor: bigint;
}

function assertSnapshot(entries: readonly RankSnapshotEntry[], label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new RangeError(`Duplicate id in ${label}: ${entry.id}`);
    }
    seen.add(entry.id);
    if (entry.minor < 0n) {
      throw new RangeError(`${label} expects non-negative amounts, received: ${entry.id}`);
    }
  }
}

function rankMap(entries: readonly RankSnapshotEntry[]): Map<string, number> {
  const sorted = [...entries].sort((left, right) => {
    if (left.minor !== right.minor) return left.minor > right.minor ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const ranks = new Map<string, number>();
  let rank = 0;
  let previousMinor: bigint | null = null;

  sorted.forEach((entry, index) => {
    if (previousMinor === null || entry.minor !== previousMinor) {
      rank = index + 1;
      previousMinor = entry.minor;
    }
    ranks.set(entry.id, rank);
  });

  return ranks;
}

/**
 * 两期分类金额 → 排名迁移。
 *
 * @throws {RangeError} 任一期出现重复 id 或负金额。
 */
export function rankMigration(
  previous: readonly RankSnapshotEntry[],
  current: readonly RankSnapshotEntry[],
): DraftRankMigrationResult {
  assertSnapshot(previous, "previous snapshot");
  assertSnapshot(current, "current snapshot");

  const previousRanks = rankMap(previous);
  const currentRanks = rankMap(current);
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.map((entry) => [entry.id, entry]));

  const currentOrdered = [...current].sort((left, right) => {
    const leftRank = currentRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = currentRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const removedOrdered = [...previous]
    .filter((entry) => !currentById.has(entry.id))
    .sort((left, right) => {
      const leftRank = previousRanks.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = previousRanks.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  const rows: DraftRankMigrationRow[] = [];

  for (const entry of [...currentOrdered, ...removedOrdered]) {
    const before = previousById.get(entry.id);
    const after = currentById.get(entry.id);
    const previousRank = before === undefined ? null : (previousRanks.get(entry.id) ?? null);
    const currentRank = after === undefined ? null : (currentRanks.get(entry.id) ?? null);
    const previousMinor = before?.minor ?? 0n;
    const currentMinor = after?.minor ?? 0n;

    rows.push({
      id: entry.id,
      label: after?.label ?? before?.label ?? entry.label,
      previousRank,
      currentRank,
      rankDelta:
        previousRank === null || currentRank === null ? null : previousRank - currentRank,
      previousMinor,
      currentMinor,
      amountDeltaMinor: currentMinor - previousMinor,
      isNew: before === undefined,
      isRemoved: after === undefined,
    });
  }

  let movedCount = 0;
  let newCount = 0;
  let removedCount = 0;

  for (const row of rows) {
    if (row.isNew) newCount += 1;
    else if (row.isRemoved) removedCount += 1;
    else if (row.rankDelta !== null && row.rankDelta !== 0) movedCount += 1;
  }

  return {
    previousEntryCount: previous.length,
    currentEntryCount: current.length,
    rows,
    movedCount,
    newCount,
    removedCount,
    rankingPolicy: "amount-desc-id-asc-ties-share-rank",
  };
}
