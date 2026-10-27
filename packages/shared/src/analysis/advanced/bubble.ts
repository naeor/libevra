/**
 * P11 分类气泡（Category Bubble，C-2 草案，DRAFT 未冻结）。
 *
 * 每个分类一个气泡：金额（气泡大小）、笔数（x 轴，由 web 适配层归一化）、
 * 均值（y 轴）。均值是权威计算（sum / count，有理数），份额是展示派生但仍在
 * 本模块给出精确有理数，避免 web 用浮点重算。
 *
 * 约束：金额必须非负（支出分类），负金额说明口径错误直接报错；count = 0 时均值为
 * null，不写 0（缺失 ≠ 零）。
 */

import { makeRational } from "./rational.js";
import type { DraftBubbleDatum, DraftBubbleResult } from "./draftTypes.js";

export interface BubbleInputDatum {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly count: number;
  readonly sumMinor: bigint;
}

/**
 * 分类聚合 → 气泡结果。
 *
 * @throws {RangeError} id 重复、count 非负整数、金额为负。
 */
export function bubblesOf(data: readonly BubbleInputDatum[]): DraftBubbleResult {
  const seen = new Set<string>();
  let totalMinor = 0n;
  let totalCount = 0;

  for (const datum of data) {
    if (seen.has(datum.categoryId)) {
      throw new RangeError(`Duplicate category id in bubble input: ${datum.categoryId}`);
    }
    seen.add(datum.categoryId);

    if (!Number.isInteger(datum.count) || datum.count < 0) {
      throw new RangeError(
        `Bubble count must be a non-negative integer: ${datum.categoryId} -> ${String(datum.count)}`,
      );
    }
    if (datum.sumMinor < 0n) {
      throw new RangeError(`Bubble expects non-negative amounts, received: ${datum.categoryId}`);
    }

    totalMinor += datum.sumMinor;
    totalCount += datum.count;
  }

  const bubbles: DraftBubbleDatum[] = [...data]
    .sort((left, right) => {
      if (left.sumMinor !== right.sumMinor) return left.sumMinor > right.sumMinor ? -1 : 1;
      return left.categoryId < right.categoryId ? -1 : left.categoryId > right.categoryId ? 1 : 0;
    })
    .map((datum) => ({
      categoryId: datum.categoryId,
      categoryLabel: datum.categoryLabel,
      count: datum.count,
      sumMinor: datum.sumMinor,
      meanMinor: datum.count > 0 ? makeRational(datum.sumMinor, BigInt(datum.count)) : null,
      shareOfTotal: totalMinor > 0n ? makeRational(datum.sumMinor, totalMinor) : null,
    }));

  return {
    bubbles,
    totalMinor,
    totalCount,
    completeness: totalMinor > 0n ? "complete" : "no-transactions",
  };
}
