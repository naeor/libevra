/** 单分析自定义卡片：使用正式 AnalysisCardNode；不另存结果、模板或账本信息。 */
import { validateAnalysisParams, type AnalysisCardNode } from "@libellum/shared/analysis/layout";
import { CARD_TYPES, cardType, type ChartFamily } from "./catalog.js";
import { newCard } from "./defaults.js";
import { customRangeProblem } from "./filters.js";

/** 仅开放已有正式参数登记的能力；B/C 待登记后自然进入，不绕过 G-12a。 */
export const CUSTOM_CARD_TYPES = CARD_TYPES.filter((type) => validateAnalysisParams({ analysisId: type.id, params: {} }).status === "valid");

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
