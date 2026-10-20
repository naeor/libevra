/**
 * OCR 候选的分类联想（复用语音记账已有的 `matchCategory`）。
 *
 * 为什么放在概览层、而不是扫描页：扫描页只负责“这截图切成了几笔”，分类是核对阶段的
 * 决定；把建议写在这里，用户能看见“系统建议”并随时改，扫描分流保持原样。
 *
 * ⚠️ **只从本账本已有分类里挑，绝不新建分类。** `matchCategory` 的规则也一样：它只把
 * 文字匹配到传入的分类列表，列表里没有就返回 `null`。这本账的主人把分类叫「吃饭」，
 * 系统不能替它建一个「餐饮」。
 *
 * ⚠️ **不编造置信度。** `matchCategory` 没有分数，所以这里不做“置信度 0.8”这种假数值；
 * 能表达不确定的只有两个已有信号：
 *  1. 交易对象与备注各自匹配到**不同**分类 → 视为有歧义，不填；
 *  2. 两边都匹配不到 → 保持 `null`（“未分类”），让用户点一下选。
 * 局限：同一个文字里两个分类打平时，`matchCategory` 自己的并列规则会选一个，这里看不见，
 * 所以它仍可能给出一个用户不认同的建议——界面上必须标「系统建议」，且随时可改。
 *
 * ⚠️ **不动金额、币种、日期、方向、支付方式、标签、备注。** 这个模块只写 `categoryId`
 * 和 `categorySource`；也不能因为猜出分类就把某个“待核对”消掉——完整性判断在
 * `types.ts` 里，和分类无关。
 */

import { matchCategory, type CategoryCandidate } from "@libellum/shared";

import { categorySourceOf, type OcrBatchCandidate } from "./types.js";

/**
 * 联想需要的分类形状。
 *
 * 与共享 `CategoryCandidate` 相容，额外把 `isSystem` 列为可选：系统分类（例如“暂无分类”）
 * 是兜底用的，不能作为建议。
 */
export interface CategoryLike extends CategoryCandidate {
  readonly isSystem?: boolean;
}

/** 一条可展示的建议；`matched` 是命中的词，界面可以说明“为什么是它”。 */
export interface CategorySuggestion {
  readonly categoryId: string;
  readonly matched: readonly string[];
}

/**
 * 当前账本里可以参与联想的分类：类型一致、未归档、非系统、名字非空。
 *
 * `matchCategory` 自己会过滤 kind/归档/空名；`isSystem` 只能在这里过滤，因为共享层不
 * 认识这个概念（语音那边直接传账本分类，从未遇到系统分类）。
 */
export function usableCategories(
  categories: readonly CategoryLike[],
  kind: "expense" | "income",
): CategoryLike[] {
  return categories.filter(
    (category) =>
      category.kind === kind &&
      !category.isArchived &&
      category.isSystem !== true &&
      category.name.trim() !== "",
  );
}

/** 只取一段文字，空白当没有；不拿 rawText，避免把整屏噪声当证据。 */
function textOf(value: string | null): string {
  return value === null ? "" : value.trim();
}

/**
 * 这一笔的建议分类，`null` 表示“没有可靠建议，留给用户”。
 *
 * 顺序是刻意的：
 *  1. 用户/平台已经给了分类 → 不动（`categoryId !== null` 或来源是 `user`）；
 *  2. 已标记无效 → 不再猜（用户已经决定排除它）；
 *  3. 转账、退款 → 不做普通分类联想（见下）；
 *  4. 方向不明 → 不做（分类带 kind，猜错方向比不猜更糟）；
 *  5. 交易对象、备注分别匹配；只有两边一致或只有一边命中才采纳。
 *
 * 转账与退款为什么不联想：账本没有 transfer 类型（`TransactionKind` 只有 expense/income），
 * 转账的默认分类由 `batch.ts` 按识别到的转账标记映射到账本已有的「转账」分类；退款的方向
 * 和“钱到底算不算支出”在现有模型里本身就需要人确认。这两类硬套一个普通分类，等于把
 * 业务语义没定清楚的地方用猜的填平——宁可空着。
 */
export function inferCategory(
  item: OcrBatchCandidate,
  categories: readonly CategoryLike[],
): CategorySuggestion | null {
  if (item.categoryId !== null) return null;
  if (categorySourceOf(item) === "user") return null;
  if (item.invalid) return null;
  if (item.isTransfer || item.isRefund) return null;
  if (item.direction !== "expense" && item.direction !== "income") return null;

  const usable = usableCategories(categories, item.direction);
  if (usable.length === 0) return null;

  const merchant = textOf(item.merchant);
  const note = textOf(item.note);

  const fromMerchant =
    merchant === "" ? null : matchCategory(merchant, usable, item.direction);
  const fromNote = note === "" ? null : matchCategory(note, usable, item.direction);

  // 两段文字各指一个分类：证据互相矛盾，不猜。
  if (fromMerchant !== null && fromNote !== null && fromMerchant.id !== fromNote.id) {
    return null;
  }

  const match = fromMerchant ?? fromNote;
  if (match === null) return null;

  return { categoryId: match.id, matched: [...match.matched] };
}

/**
 * 把建议写进批次候选（返回新数组，不修改输入）。
 *
 * `null` 表示**没有任何候选需要改**，调用方据此避免无谓的状态更新与存储写入；这让
 * “每次进概览都重算”是幂等的：已经推断过的项 `categoryId` 不再为空，直接跳过。
 *
 * 只有 `categorySource` 也一起写，界面才能把“系统建议”和用户自己选的区分开；用户改了
 * 分类（`user`）之后，这里永远不会再覆盖。
 */
export function applyCategorySuggestions(
  items: readonly OcrBatchCandidate[],
  categories: readonly CategoryLike[],
): OcrBatchCandidate[] | null {
  let changed = false;

  const next = items.map((item) => {
    const suggestion = inferCategory(item, categories);
    if (suggestion === null) return item;

    changed = true;
    return {
      ...item,
      categoryId: suggestion.categoryId,
      categorySource: "inferred" as const,
    };
  });

  return changed ? next : null;
}
