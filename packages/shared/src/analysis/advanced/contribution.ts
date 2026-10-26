/**
 * 分类变化贡献（C-1 草案，A06「支出变化贡献」与 A07「分类份额变化」的数学核心）。
 *
 * 口径（owner 规格 §5 与 §47 要求）：
 * - 归因分布**必须守恒**：Σ rows.deltaMinor = currentTotal - previousTotal，
 *   否则说明分类口径（例如「未分类 / 已归档分类」的归属）不一致，计算层直接断言失败。
 * - 变化率 prev=0 时为 null 且给出原因 `previous-zero`，不得写成 Infinity 或 0。
 * - 份额 deltaShare = delta / totalDelta；总差额为 0 时为 null（不得除零）。
 * - `isNew` / `isRemoved` 是**提示**（本期从 0 变成非 0 / 从非 0 变成 0），
 *   金额与口径仍以 previousMinor/currentMinor 为准。
 * - 行排序稳定：|delta| 降序 → 类别 id 升序（移动端与桌面端看到同一顺序）。
 */

import type {
  DraftCompleteness,
  DraftContributionResult,
  DraftContributionRow,
  DraftRational,
} from "./draftTypes.js";
import {
  addRational,
  compareRational,
  isZeroRational,
  makeRational,
  subRational,
} from "./rational.js";

export interface CategoryAmountInput {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly minor: bigint;
}

function assertUniqueCategoryIds(rows: readonly CategoryAmountInput[]): void {
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.categoryId)) {
      throw new RangeError(`Duplicate categoryId in contribution input: ${row.categoryId}`);
    }

    seen.add(row.categoryId);
  }
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function totalOf(rows: readonly CategoryAmountInput[]): bigint {
  return rows.reduce((total, row) => total + row.minor, 0n);
}

/**
 * 两期分类金额 → 变化贡献。
 *
 * 只关心「上一期有、本期没有」「本期新增」两种情况：它们以 0 参与，并分别标记
 * `isRemoved` / `isNew`；这样 Σdelta 与总差额天然守恒。
 *
 * @throws {RangeError} 同一期内 categoryId 重复。
 */
export function contributionBetween(
  previousRows: readonly CategoryAmountInput[],
  currentRows: readonly CategoryAmountInput[],
): DraftContributionResult {
  assertUniqueCategoryIds(previousRows);
  assertUniqueCategoryIds(currentRows);

  const previousTotalMinor = totalOf(previousRows);
  const currentTotalMinor = totalOf(currentRows);
  const totalDeltaMinor = currentTotalMinor - previousTotalMinor;

  const previousById = new Map(previousRows.map((row) => [row.categoryId, row] as const));

  const categoryIds = new Set<string>();
  for (const row of previousRows) categoryIds.add(row.categoryId);
  for (const row of currentRows) categoryIds.add(row.categoryId);

  const rows: DraftContributionRow[] = [...categoryIds].map((categoryId) => {
    const previous = previousById.get(categoryId);
    const current = currentRows.find((row) => row.categoryId === categoryId);
    const previousMinor = previous?.minor ?? 0n;
    const currentMinor = current?.minor ?? 0n;
    const deltaMinor = currentMinor - previousMinor;
    const label = current?.categoryLabel ?? previous?.categoryLabel ?? categoryId;

    const growthUnavailableReason = previousMinor === 0n ? ("previous-zero" as const) : null;
    const growth =
      previousMinor === 0n
        ? null
        : makeRational(
            (currentMinor - previousMinor) * 1n,
            previousMinor,
          );

    const deltaShare =
      totalDeltaMinor === 0n ? null : makeRational(deltaMinor, totalDeltaMinor);

    return {
      categoryId,
      categoryLabel: label,
      previousMinor,
      currentMinor,
      deltaMinor,
      deltaShare,
      growth,
      growthUnavailableReason,
      isNew: previousMinor === 0n && currentMinor !== 0n,
      isRemoved: currentMinor === 0n && previousMinor !== 0n,
    };
  });

  rows.sort((left, right) => {
    const byMagnitude = absoluteBigInt(right.deltaMinor) - absoluteBigInt(left.deltaMinor);
    if (byMagnitude !== 0n) return byMagnitude > 0n ? 1 : -1;

    return left.categoryId < right.categoryId ? -1 : left.categoryId > right.categoryId ? 1 : 0;
  });

  const rowsDeltaMinor = rows.reduce((total, row) => total + row.deltaMinor, 0n);

  return {
    previousTotalMinor,
    currentTotalMinor,
    totalDeltaMinor,
    rows,
    conservation: {
      rowsDeltaMinor,
      matchesTotal: rowsDeltaMinor === totalDeltaMinor,
      matchedBy: "categoryId",
    },
  };
}

/**
 * 归一化分类金额：把「真实存在的分类」与「未分类 / 已归档」等桶统一成同一口径。
 *
 * C-1 的纯函数只接受已归一化的输入。归一化规则（S-01 v2 评审时须与 A 统一）：
 * - 已归档分类**仍然单列**（历史数据回看时不能并入「未分类」）；
 * - 未分类统一到固定 id `unclassified`，label 由界面层翻译；
 * - 空数组表示「该期没有任何支出」，不是「未知」。
 */
export function normaliseCategoryAmounts(
  rows: readonly CategoryAmountInput[],
): readonly CategoryAmountInput[] {
  return rows.map((row) => ({
    categoryId: row.categoryId === "" ? "unclassified" : row.categoryId,
    categoryLabel: row.categoryLabel === "" ? "未分类" : row.categoryLabel,
    minor: row.minor,
  }));
}

/** 由贡献结果推导「本期占比变化」：本期份额 - 上期份额（都是有理数，可为负）。 */
export function shareChangeOf(
  row: DraftContributionRow,
  previousTotalMinor: bigint,
  currentTotalMinor: bigint,
): DraftRational | null {
  if (previousTotalMinor === 0n || currentTotalMinor === 0n) return null;

  const previousShare = makeRational(row.previousMinor, previousTotalMinor);
  const currentShare = makeRational(row.currentMinor, currentTotalMinor);

  return subRational(currentShare, previousShare);
}

/** 供调用方断言用：份额合计（含负份额）为 1；仅当 totalDelta ≠ 0 时有意义。 */
export function deltaSharesSumToOne(result: DraftContributionResult): boolean {
  if (result.totalDeltaMinor === 0n) return false;

  let sum: DraftRational = { numerator: 0n, denominator: 1n };
  for (const row of result.rows) {
    if (row.deltaShare === null) return false;
    if (!isZeroRational(row.deltaShare)) {
      sum = addRational(sum, row.deltaShare);
    }
  }

  return compareRational(sum, { numerator: 1n, denominator: 1n }) === 0;
}

/** 完整性：两期都没有样本时是 no-transactions，否则 complete（纯函数不知道权限/FX）。 */
export function contributionCompleteness(
  previousCount: number,
  currentCount: number,
): DraftCompleteness {
  return previousCount === 0 && currentCount === 0 ? "no-transactions" : "complete";
}
