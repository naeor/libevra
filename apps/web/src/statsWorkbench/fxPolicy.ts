/**
 * 每张卡片在综合折算下「缺汇率时怎么算、怎么说」的唯一出处。
 *
 * 缺汇率的账目没有可用的目标币种金额。**绝不当 0 算，也不宣称完整。** 按分析的数学性质分七类：
 *
 * - `count`        与金额无关（笔数 / 天数 / 分类数 / 频次 / 日记录数）。用**全部**账目计算，结果精确，
 *                  不受汇率影响，也不显示「部分」。
 * - `sum`          金额合计。缺汇率时给「已成功折算部分的小计」，并明确标注，不当作总额。
 * - `partial`      由合计派生、仍是下界含义的值（日均支出）：标注为已折算部分的日均。
 * - `undetermined` 平均 / 中位数 / 比率：缺一笔就可能改变结果且没有单向界，缺汇率时「无法确定」，
 *                  只说明缺了几笔。
 * - `extreme`      极值（最大 / 最小 / 峰值日 / 最大分类）：只给「已折算账目中的结果」，明确不是全局极值。
 * - `composition`  构成：给已折算部分的小计，不给占比（分母不完整），图形退化为排行。
 * - `ranking`      排行：给已折算部分的小计排行，明确「排名可能因缺汇率账目而变化」。
 * - `series`       时间序列：含缺汇率账目的日期所在的时间段标记为「未知」，不画成 0，也不参与合计。
 *
 * 每类还带 `kinds`：缺汇率只影响它的口径——缺汇率的**支出**不影响收入类分析，反之亦然；
 * 这让「收入合计」在只有支出缺汇率时仍可以诚实地宣称完整。
 */
import type { FxKindScope } from "./fxProjection.js";

export type FxCardClass = "count" | "sum" | "partial" | "undetermined" | "extreme" | "composition" | "ranking" | "series";

export interface FxCardPolicy {
  readonly class: FxCardClass;
  /** 缺汇率会影响此卡片的哪一类账目；`count` 恒为 `none`。 */
  readonly kinds: FxKindScope;
}

const E: FxKindScope = "expense";
const I: FxKindScope = "income";
const B: FxKindScope = "both";
const N: FxKindScope = "none";

/** 与 `CARD_TYPES` 一一对应（`fxCards.test.tsx` 守护：缺一张就失败）。 */
export const FX_CARD_POLICIES: Readonly<Record<string, FxCardPolicy>> = {
  "AN-B01": { class: "sum", kinds: E },
  "AN-B02": { class: "sum", kinds: I },
  "AN-B03": { class: "sum", kinds: B },
  "AN-B04": { class: "count", kinds: N },
  "AN-B05": { class: "count", kinds: N },
  "AN-B06": { class: "partial", kinds: E },
  "AN-B07": { class: "undetermined", kinds: E },
  "AN-B08": { class: "undetermined", kinds: E },
  "AN-B09": { class: "extreme", kinds: E },
  "AN-B10": { class: "extreme", kinds: E },
  "AN-B11": { class: "extreme", kinds: E },
  "AN-B12": { class: "extreme", kinds: I },
  "AN-B13": { class: "count", kinds: N },
  "AN-B14": { class: "count", kinds: N },
  "AN-B15": { class: "extreme", kinds: E },
  "AN-B16": { class: "count", kinds: N },
  "AN-B17": { class: "extreme", kinds: I },
  "AN-B18": { class: "undetermined", kinds: B },
  "AN-B19": { class: "undetermined", kinds: B },
  "AN-B20": { class: "count", kinds: N },
  "AN-I01": { class: "composition", kinds: E },
  "AN-I02": { class: "composition", kinds: I },
  "AN-I03": { class: "ranking", kinds: E },
  "AN-I04": { class: "ranking", kinds: I },
  "AN-I05": { class: "count", kinds: N },
  "AN-I17": { class: "composition", kinds: E },
  "AN-I06": { class: "series", kinds: E },
  "AN-I07": { class: "series", kinds: I },
  "AN-I08": { class: "series", kinds: E },
  "AN-I09": { class: "series", kinds: E },
  "AN-I10": { class: "series", kinds: I },
  "AN-I11": { class: "series", kinds: B },
  "AN-I12": { class: "series", kinds: E },
  "AN-I15": { class: "series", kinds: E },
  "AN-I16": { class: "series", kinds: E },
  "AN-I19": { class: "count", kinds: N },
  "AN-I20": { class: "series", kinds: E },
  "AN-A01": { class: "series", kinds: B },
};

export function fxPolicyFor(id: string): FxCardPolicy | null {
  return FX_CARD_POLICIES[id] ?? null;
}
