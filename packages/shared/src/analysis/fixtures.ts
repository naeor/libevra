/**
 * S-01 draft — shared test samples A–O (owner specification §21.1).
 *
 * These fixtures are the common ground for the calculation primitives, the
 * chart adapters and the eventual page-level tests. They are importable by
 * tests only (not re-exported from the package barrel) so sample data never
 * ships in the app bundle.
 *
 * The lettering follows the owner's specification exactly:
 *   A empty · B income only · C expense only · D equal amounts · E one
 *   category · F many categories · G large integers · H across months ·
 *   I multiple currencies · J missing FX · K shared viewing · L offline
 *   incomplete · M deleted and restored · N precision edges · O filters.
 */

import type { AnalysisEntry, AnalysisKind } from "./primitives.js";

export interface AnalysisSample {
  readonly letter: string;
  readonly name: string;
  /** What the sample exists to prove; tests quote this in their titles. */
  readonly purpose: string;
  readonly today: string;
  readonly range: { readonly from: string; readonly to: string };
  readonly entries: readonly AnalysisEntry[];
}

interface ExtraFields {
  readonly categoryName?: string;
  readonly categoryIsSystem?: boolean;
  readonly paymentMethodId?: string | null;
  readonly paymentMethodName?: string | null;
  readonly deletedAt?: string | null;
}

function entry(
  id: string,
  kind: AnalysisKind,
  amountMinor: bigint,
  occurredLocalDate: string,
  categoryId: string,
  extra: ExtraFields = {},
): AnalysisEntry {
  return {
    id,
    kind,
    amountMinor,
    currency: "CNY",
    occurredLocalDate,
    categoryId,
    categoryName: extra.categoryName ?? categoryId,
    categoryIsSystem: extra.categoryIsSystem ?? false,
    paymentMethodId: extra.paymentMethodId ?? null,
    paymentMethodName: extra.paymentMethodName ?? null,
    deletedAt: extra.deletedAt ?? null,
  };
}

const OCTOBER = { from: "2026-10-01", to: "2026-10-31" } as const;

/** A · 空账本：everything must be zero/empty, averages and medians cannot exist. */
export const SAMPLE_A_EMPTY_BOOK: AnalysisSample = {
  letter: "A",
  name: "空账本",
  purpose: "总额为零、笔数为零、平均与中位数不可计算、极值无结果、构成图为空态",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [],
};

/** B · 只有收入：expense is a real zero, the expense average does not exist. */
export const SAMPLE_B_INCOME_ONLY: AnalysisSample = {
  letter: "B",
  name: "只有收入",
  purpose: "收入合计正确、支出为零、净差额正确、支出平均不可计算、支出构成为空",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("b-salary-1", "income", 10_000n, "2026-10-03", "cat-salary", {
      categoryName: "工资",
    }),
    entry("b-salary-2", "income", 25_050n, "2026-10-17", "cat-salary", {
      categoryName: "工资",
    }),
  ],
};

/** C · 只有支出：2 000 支出分三个分类（1 200 / 600 / 200). */
export const SAMPLE_C_EXPENSE_ONLY: AnalysisSample = {
  letter: "C",
  name: "只有支出",
  purpose: "支出合计/构成比例/排名正确，收入为零、收入平均不可计算",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("c-meal", "expense", 1_200n, "2026-10-01", "cat-meal", {
      categoryName: "餐饮",
      paymentMethodId: "pm-wallet",
      paymentMethodName: "钱包",
    }),
    entry("c-transport", "expense", 600n, "2026-10-02", "cat-transport", {
      categoryName: "交通",
      paymentMethodId: "pm-card",
      paymentMethodName: "银行卡",
    }),
    entry("c-fun", "expense", 200n, "2026-10-02", "cat-fun", {
      categoryName: "娱乐",
    }),
  ],
};

/** D · 金额相同：ties must not change order between refreshes. */
export const SAMPLE_D_EQUAL_AMOUNTS: AnalysisSample = {
  letter: "D",
  name: "金额相同",
  purpose: "确定性排序（同金额按分类 id）、并列计数",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("d-1", "expense", 5_000n, "2026-10-05", "cat-b", { categoryName: "B 类" }),
    entry("d-2", "expense", 5_000n, "2026-10-06", "cat-a", { categoryName: "A 类" }),
    entry("d-3", "expense", 5_000n, "2026-10-07", "cat-c", { categoryName: "C 类" }),
  ],
};

/** E · 一个分类：a single, complete share of the whole. */
export const SAMPLE_E_ONE_CATEGORY: AnalysisSample = {
  letter: "E",
  name: "一个分类",
  purpose: "单一完整扇区、占比 100%、来源合计等于金额",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("e-1", "expense", 1_200n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("e-2", "expense", 600n, "2026-10-02", "cat-meal", { categoryName: "餐饮" }),
  ],
};

/** F · 大量分类：24 categories → folding into "其他" must preserve the total. */
export const SAMPLE_F_MANY_CATEGORIES: AnalysisSample = {
  letter: "F",
  name: "大量分类",
  purpose: "其他分类折叠后金额守恒、排行/图例/小扇区可用",
  today: "2026-10-27",
  range: OCTOBER,
  entries: Array.from({ length: 24 }, (_, index) =>
    entry(
      `f-${String(index + 1).padStart(2, "0")}`,
      "expense",
      BigInt((24 - index) * 1_000),
      "2026-10-10",
      `cat-${String(index + 1).padStart(2, "0")}`,
      { categoryName: `分类 ${String(index + 1).padStart(2, "0")}` },
    ),
  ),
};

/** G · 大整数金额：sums above Number.MAX_SAFE_INTEGER stay exact (sample G). */
export const SAMPLE_G_LARGE_INTEGERS: AnalysisSample = {
  letter: "G",
  name: "大整数金额",
  purpose: "超过 Number.MAX_SAFE_INTEGER 的求和/排序/平均/中位数/格式化仍然精确",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("g-1", "expense", 9_007_199_254_740_993n, "2026-10-01", "cat-big", {
      categoryName: "超大额",
    }),
    entry("g-2", "expense", 1n, "2026-10-02", "cat-small", { categoryName: "小额" }),
    entry("g-3", "expense", 3n, "2026-10-03", "cat-small", { categoryName: "小额" }),
  ],
};

/** H · 跨月份：October range must exclude September 30th and November 1st. */
export const SAMPLE_H_ACROSS_MONTHS: AnalysisSample = {
  letter: "H",
  name: "跨月份",
  purpose: "区间过滤只包含 10-01…10-31，月末/月初边界不串月",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("h-sep-30", "expense", 900n, "2026-09-30", "cat-meal", { categoryName: "餐饮" }),
    entry("h-oct-01", "expense", 100n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("h-oct-15", "expense", 200n, "2026-10-15", "cat-meal", { categoryName: "餐饮" }),
    entry("h-oct-31", "expense", 300n, "2026-10-31", "cat-meal", { categoryName: "餐饮" }),
    entry("h-nov-01", "expense", 800n, "2026-11-01", "cat-meal", { categoryName: "餐饮" }),
  ],
};

/** I · 多币种：CNY/USD/EUR amounts must never be added without conversion. */
export const SAMPLE_I_MULTI_CURRENCY: AnalysisSample = {
  letter: "I",
  name: "多币种",
  purpose: "原币隔离（不跨币种相加）；综合模式需逐笔折算与完整性",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    { ...entry("i-cny", "expense", 10_000n, "2026-10-01", "cat-meal"), currency: "CNY" },
    { ...entry("i-usd", "expense", 2_000n, "2026-10-02", "cat-transport"), currency: "USD" },
    { ...entry("i-eur", "expense", 3_000n, "2026-10-03", "cat-fun"), currency: "EUR" },
  ],
};

/** J · 汇率缺失：aggregate completeness must say so, not silently drop or re-normalise. */
export const SAMPLE_J_MISSING_FX: AnalysisSample = {
  letter: "J",
  name: "汇率缺失",
  purpose: "缺汇率的笔目不能把可折算部分重新归一化为 100%，完整性必须可见",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("j-cny", "expense", 10_000n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    { ...entry("j-usd-missing", "expense", 2_000n, "2026-10-02", "cat-transport"), currency: "USD" },
  ],
};

/** K · 多人共享：a viewer's result scope is the same; the query layer owns permissions. */
export const SAMPLE_K_SHARED_READONLY: AnalysisSample = {
  letter: "K",
  name: "多人共享",
  purpose: "只读成员的统计范围不扩大、不缩小；权限校验发生在查询层",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("k-1", "expense", 1_000n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("k-2", "expense", 500n, "2026-10-02", "cat-meal", { categoryName: "餐饮" }),
  ],
};

/** L · 离线数据不足：only the first 3 days of a 30-day window are covered. */
export const SAMPLE_L_OFFLINE_INCOMPLETE: AnalysisSample = {
  letter: "L",
  name: "离线数据不足",
  purpose: "无支出记录天数等覆盖率分析不能给出虚假完整",
  today: "2026-10-30",
  range: { from: "2026-10-01", to: "2026-10-30" },
  entries: [
    entry("l-1", "expense", 100n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("l-2", "expense", 200n, "2026-10-02", "cat-meal", { categoryName: "餐饮" }),
    entry("l-3", "expense", 300n, "2026-10-03", "cat-meal", { categoryName: "餐饮" }),
  ],
};

/** M · 删除及恢复：a soft-deleted row is excluded; the live one is included. */
export const SAMPLE_M_DELETED_AND_RESTORED: AnalysisSample = {
  letter: "M",
  name: "删除及恢复",
  purpose: "软删除记录不参与统计，恢复后重新参与；来源与统计一致",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("m-live", "expense", 700n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("m-deleted", "expense", 300n, "2026-10-02", "cat-meal", {
      categoryName: "餐饮",
      deletedAt: "2026-10-05T08:00:00.000Z",
    }),
  ],
};

/** N · 特殊小数精度：medians may land on half a minor unit; ratios are not rounded. */
export const SAMPLE_N_PRECISION_EDGES: AnalysisSample = {
  letter: "N",
  name: "特殊小数精度",
  purpose: "偶数样本中位数半最小单位、不能整除的平均、百分比舍入不改变金额",
  today: "2026-10-27",
  range: OCTOBER,
  entries: [
    entry("n-1", "expense", 1_001n, "2026-10-01", "cat-meal", { categoryName: "餐饮" }),
    entry("n-2", "expense", 1_002n, "2026-10-02", "cat-meal", { categoryName: "餐饮" }),
    entry("n-3", "expense", 1_003n, "2026-10-03", "cat-meal", { categoryName: "餐饮" }),
    entry("n-4", "expense", 1_004n, "2026-10-04", "cat-meal", { categoryName: "餐饮" }),
  ],
};

/** O · 不同过滤条件：mixed kinds/categories/dates for filter and cache isolation. */
export const SAMPLE_O_FILTERS: AnalysisSample = {
  letter: "O",
  name: "不同过滤条件",
  purpose: "时间/收支/分类/币种/账本过滤生效且互不污染（含缓存隔离）",
  today: "2026-10-27",
  range: { from: "2026-10-01", to: "2026-10-04" },
  entries: [
    entry("o-exp-a-1", "expense", 1_000n, "2026-10-01", "cat-a", { categoryName: "A 类" }),
    entry("o-exp-b-1", "expense", 2_000n, "2026-10-02", "cat-b", { categoryName: "B 类" }),
    entry("o-inc-1", "income", 5_000n, "2026-10-03", "cat-salary", { categoryName: "工资" }),
    entry("o-exp-a-2", "expense", 3_000n, "2026-10-04", "cat-a", { categoryName: "A 类" }),
  ],
};

/** All fifteen samples, in specification order. */
export const ANALYSIS_SAMPLES: readonly AnalysisSample[] = [
  SAMPLE_A_EMPTY_BOOK,
  SAMPLE_B_INCOME_ONLY,
  SAMPLE_C_EXPENSE_ONLY,
  SAMPLE_D_EQUAL_AMOUNTS,
  SAMPLE_E_ONE_CATEGORY,
  SAMPLE_F_MANY_CATEGORIES,
  SAMPLE_G_LARGE_INTEGERS,
  SAMPLE_H_ACROSS_MONTHS,
  SAMPLE_I_MULTI_CURRENCY,
  SAMPLE_J_MISSING_FX,
  SAMPLE_K_SHARED_READONLY,
  SAMPLE_L_OFFLINE_INCOMPLETE,
  SAMPLE_M_DELETED_AND_RESTORED,
  SAMPLE_N_PRECISION_EDGES,
  SAMPLE_O_FILTERS,
];
