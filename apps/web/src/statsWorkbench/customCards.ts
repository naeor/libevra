/**
 * 自定义卡片（1.17.10 起为**组合卡片**）：一张卡片可以放一个或多个内容槽位，配一个卡片内容模板。
 *
 * 只保存「分析引用 + 展示形式 + 模板 + 名称 + 时间策略」，**不存金额、汇率、账本身份**；形状与旧配置的
 * 兼容规则见 `composition.ts`。卡片仍是 Agent D 的正式 `AnalysisCardNode`，插入、更新、撤销全部走 D 的命令。
 */
import { validateAnalysisParams, type AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { CARD_TYPES, cardType, type CardType } from "./catalog.js";
import {
  countSlots,
  isCustomCard,
  readComposition,
  templateFit,
  templateOf,
  withComposition,
  type CompositionSlot,
  type TemplateId,
} from "./composition.js";
import { newCard } from "./defaults.js";
import { customRangeProblem } from "./filters.js";

/**
 * 自定义卡片可选的指标：目录里**全部已正式实现**的分析。
 *
 * A 协议分析必须通过 G-12a 的 params 白名单（`valid`）才开放，不绕过冻结协议；B / C 的分析不接受任何
 * 布局参数（`params` 恒为 `{}`），在 G-12a 里是只读登记（`readonly`），卡片只存编号与展示方式。
 */
export const CUSTOM_CARD_TYPES: readonly CardType[] = CARD_TYPES.filter(
  (type) => type.source !== "agent-a" || validateAnalysisParams({ analysisId: type.id, params: {} }).status === "valid",
);

const SELECTABLE = new Set(CUSTOM_CARD_TYPES.map((type) => type.id));

export function isSelectableAnalysis(analysisId: string): boolean {
  return SELECTABLE.has(analysisId);
}

export const CUSTOM_NAME_MAX = 40;

export interface CompositeDraft {
  readonly template: TemplateId;
  readonly slots: readonly CompositionSlot[];
  /** 留空 = 自动名称（随界面语言，按内容生成）。 */
  readonly name: string;
  readonly pinnedRange?: { readonly from: string; readonly to: string };
}

export type DraftProblem = "empty" | "analysis" | "family" | "template" | "name" | "range";

/** 草稿能不能保存；不能时给出第一个问题（界面据此说明，不静默修正）。 */
export function draftProblem(draft: CompositeDraft): DraftProblem | null {
  if (draft.slots.length === 0) return "empty";
  for (const slot of draft.slots) {
    const type = cardType(slot.analysisId);
    if (type === null || !SELECTABLE.has(slot.analysisId)) return "analysis";
    if (!type.families.includes(slot.family)) return "family";
  }
  const template = templateOf(draft.template);
  if (template === null || templateFit(template, countSlots(draft.slots)).status !== "ok") return "template";
  if (draft.name.trim().length > CUSTOM_NAME_MAX) return "name";
  if (draft.pinnedRange !== undefined && customRangeProblem(draft.pinnedRange.from, draft.pinnedRange.to) !== null) return "range";
  return null;
}

/**
 * 由草稿生成卡片。
 * - 新建（没有 `base`）：总是写入组合配置，这张卡片因此出现在「我的自定义」里；
 * - 编辑：保留原卡片的 objectId 与其它字段；原来是普通单项卡片、编辑后仍是单项时**不**写组合配置
 *   （行为与旧版「配置卡片」一致，不把目录卡片悄悄变成自定义卡片）。
 */
export function buildCard(draft: CompositeDraft, base?: AnalysisCardNode, objectId?: string): AnalysisCardNode | null {
  if (draftProblem(draft) !== null) return null;
  const first = draft.slots[0]!;
  const trimmed = draft.name.trim();
  const origin: AnalysisCardNode = base ?? newCard(first.analysisId, objectId);
  const scoped: AnalysisCardNode = {
    objectId: origin.objectId,
    type: "analysis-card",
    analysis: origin.analysis,
    chart: origin.chart,
    title: trimmed === "" ? { kind: "preset" } : { kind: "custom", text: trimmed },
    rangePolicy: draft.pinnedRange === undefined ? "inherit" : "pinned",
    ...(draft.pinnedRange === undefined ? {} : { pinnedRange: draft.pinnedRange }),
  };
  const keepPlain = base !== undefined && readComposition(base).source === "plain" && draft.template === "single";
  if (keepPlain) {
    const sameAnalysis = scoped.analysis.analysisId === first.analysisId;
    return {
      ...scoped,
      analysis: sameAnalysis ? scoped.analysis : { analysisId: first.analysisId, params: {} },
      chart: { ...scoped.chart, chartFamily: first.family },
    };
  }
  return withComposition(scoped, draft.template, draft.slots);
}

/** 「我的自定义」是已保存卡片实例的视图；删除实例即删除该项，不假装是独立模板库。 */
export function customCardsIn(cards: readonly AnalysisCardNode[]): readonly AnalysisCardNode[] {
  return cards.filter(isCustomCard);
}
