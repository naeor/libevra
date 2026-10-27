/** 单分析自定义卡片：使用正式 AnalysisCardNode；不另存结果、模板或账本信息。 */
import { validateAnalysisParams, type AnalysisCardNode } from "@libellum/shared/analysis/layout";
import { CARD_TYPES, cardType, type ChartFamily } from "./catalog.js";
import { newCard } from "./defaults.js";
import { customRangeProblem } from "./filters.js";

/**
 * 自定义卡片可选的指标。
 *
 * 两类来源：
 * 1. A 协议分析（26 项）——必须通过 G-12a 的 params 白名单校验才开放，不绕过冻结协议；
 * 2. 工作台自己派生、**不接受任何布局参数**的分析（B 的 24 项，含本次接入的 12 项）——
 *    它们的卡片只保存分析编号与展示方式，参数恒为 `{}`，因此不涉及 G-12a 参数语义；
 *    这里用显式集合登记，未知编号仍按只读占位处理。
 */
const LEGACY_CUSTOMIZABLE_IDS: ReadonlySet<string> = new Set([
  "AN-I06",
  "AN-I07",
  "AN-I08",
  "AN-I09",
  "AN-I10",
  "AN-I11",
  "AN-I12",
  "AN-I13",
  "AN-I14",
  "AN-I15",
  "AN-I16",
  "AN-I19",
  "AN-I20",
  "AN-A01",
  "AN-A02",
  "AN-A03",
  "AN-A04",
  "AN-A05",
  "AN-A12",
  "AN-A13",
  "AN-A14",
  "AN-A18",
  "AN-A19",
  "AN-A20",
]);

/** 仅开放「正式参数登记 + 无参数派生」两类已有能力；C 的 34 项待各自接入后再进入。 */
export const CUSTOM_CARD_TYPES = CARD_TYPES.filter(
  (type) => LEGACY_CUSTOMIZABLE_IDS.has(type.id) || validateAnalysisParams({ analysisId: type.id, params: {} }).status === "valid",
);

export interface CustomCardDraft {
  readonly analysisId: string;
  readonly family: ChartFamily;
  readonly name: string;
  readonly pinnedRange?: { readonly from: string; readonly to: string };
}

export function customCardProblem(draft: CustomCardDraft): "analysis" | "family" | "name" | "range" | null {
  const type = cardType(draft.analysisId);
  if (type === null || !CUSTOM_CARD_TYPES.some((entry) => entry.id === draft.analysisId)) return "analysis";
  if (!type.families.includes(draft.family)) return "family";
  if (draft.name.trim().length === 0 || draft.name.trim().length > 40) return "name";
  if (draft.pinnedRange !== undefined && customRangeProblem(draft.pinnedRange.from, draft.pinnedRange.to) !== null) return "range";
  return null;
}

export function createCustomCard(draft: CustomCardDraft, objectId?: string): AnalysisCardNode | null {
  if (customCardProblem(draft) !== null) return null;
  return {
    ...newCard(draft.analysisId, objectId),
    chart: { chartFamily: draft.family },
    title: { kind: "custom", text: draft.name.trim() },
    rangePolicy: draft.pinnedRange === undefined ? "inherit" : "pinned",
    ...(draft.pinnedRange === undefined ? {} : { pinnedRange: draft.pinnedRange }),
  };
}

/** 「我的自定义」是已保存卡片实例的视图；删除实例即删除该项，不假装是独立模板库。 */
export function customCardsIn(cards: readonly AnalysisCardNode[]): readonly AnalysisCardNode[] {
  return cards.filter((card) => card.title?.kind === "custom");
}
