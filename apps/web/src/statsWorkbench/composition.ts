/**
 * S17 自定义组合卡片（1.17.10）：**一张工作台卡片内部的内容槽位与卡片内容模板。**
 *
 * 两套布局职责分开（任务 §2）：
 *
 * | 层级 | 负责 | 实现 |
 * |---|---|---|
 * | 工作台布局（Workspace Layout） | 卡片放在哪、占几格、怎么排、保存/恢复/撤销 | Agent D 的布局文档与命令（**本文件不碰**） |
 * | 卡片内容模板（Card Composition） | 一张卡片**内部**有哪些内容、怎么排 | 本文件：槽位 + 模板 + 推荐 + 槽位排布 |
 *
 * 组合卡片在工作台里仍是**一张** `AnalysisCardNode`（同一个 objectId、一个几何对象），统一拖动、缩放、
 * 保存与删除；槽位只是卡片的内部配置，**不是嵌套的卡片实例**，不进入布局文档、不产生自己的几何。
 *
 * ## 保存形状（不改冻结的 D 文档 schema，也不需要数据库迁移）
 *
 * 组合配置写在 `card.chart.options.composition`（D 的 `ChartPresentation.options` 本来就是自由对象，
 * 校验器只要求它是对象；序列化是普通 JSON，往返不丢字段）：
 *
 * ```json
 * { "v": 1, "template": "T3", "slots": [{ "id": "s1", "analysisId": "AN-I06", "family": "line" }, …] }
 * ```
 *
 * - `card.analysis.analysisId` / `card.chart.chartFamily` **镜像第一个槽位**。旧版本（≤ 1.17.9）读到组合卡片
 *   时把它当作第一个槽位的单指标卡片显示——安全降级，不白屏；G-12a 参数校验也照常作用于这个主分析。
 * - 没有 `composition` 的卡片（全部旧卡片）读成「单槽位」：`analysis` + `chart.chartFamily` 就是唯一槽位。
 *   **旧配置不需要迁移脚本**，读取时映射，写回前不改动。
 * - `v` 大于本版本能理解的版本：只显示主槽位并说明，编辑器拒绝改写内容（不能用旧逻辑覆盖新内容）。
 * - 结构损坏：退回主槽位显示，不让整页崩溃。
 *
 * 所有槽位共享卡片的账本、时间范围（`rangePolicy` / `pinnedRange`）、币种与综合折算模式、分类 / 支付方式 /
 * 标签筛选——它们本来就是卡片级或工作台级条件，槽位不另存，保证同卡可比（任务 §5）。槽位只存
 * 「分析引用 + 展示形式」，不存金额、汇率或账本身份。未来若要每槽位独立条件，在 `v: 2` 里加字段并在
 * `readComposition` 里迁移；本版不预留没有使用者的字段（AGENTS §6）。
 */
import type { AnalysisCardNode, GridSize } from "@libellum/shared/analysis/layout";

import { cardType, resolveDisplay, SPARK_CAPABLE_IDS, TALL_NUMBER_IDS, type ChartFamily } from "./catalog.js";

export const COMPOSITION_VERSION = 1;
export const MAX_SLOTS = 8;
export const MAX_NUMBER_SLOTS = 6;
export const MAX_CHART_SLOTS = 4;

/** 槽位内容的种类：数字（单值，可紧凑排列）或图表（需要绘图区）。 */
export type SlotKind = "number" | "chart";

const NUMBER_FAMILIES: ReadonlySet<string> = new Set(["number", "extreme"]);

export function slotKindOf(family: string): SlotKind {
  return NUMBER_FAMILIES.has(family) ? "number" : "chart";
}

export interface CompositionSlot {
  /** 卡片内稳定的槽位 ID（`s1`、`s2`…），只用于排序与编辑，不进布局文档。 */
  readonly id: string;
  readonly analysisId: string;
  readonly family: ChartFamily;
}

export type TemplateId = "single" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8";

export interface CompositionV1 {
  readonly v: 1;
  readonly template: TemplateId;
  readonly slots: readonly CompositionSlot[];
}

/** 卡片内部的排布方式（与工作台网格无关，按卡片内容区的真实像素计算）。 */
export type Arrangement = "single" | "numbers" | "chart-numbers" | "number-chart" | "charts" | "mixed";

export interface CardTemplate {
  readonly id: TemplateId;
  /** 数字槽位数量范围 [最少, 最多]。 */
  readonly numbers: readonly [number, number];
  /** 图表槽位数量范围。 */
  readonly charts: readonly [number, number];
  readonly arrangement: Arrangement;
  /** 允许的工作台占格（`宽×高`），**按推荐顺序**（小 → 大）；`single` 由分析自己的尺寸决定。 */
  readonly sizes: readonly GridSize[];
}

const S11: GridSize = { colSpan: 1, rowSpan: 1 };
const S21: GridSize = { colSpan: 2, rowSpan: 1 };
const S12: GridSize = { colSpan: 1, rowSpan: 2 };
const S22: GridSize = { colSpan: 2, rowSpan: 2 };
const S23: GridSize = { colSpan: 2, rowSpan: 3 };
const S24: GridSize = { colSpan: 2, rowSpan: 4 };

/** 单个数字卡片可选的尺寸（与目录 `NUMBER_SIZES` 相同）。 */
export const NUMBER_SIZES: readonly GridSize[] = [S11, S21, S12, S22];
/** 单个图表卡片的默认可选尺寸（与目录 `CHART_SIZES` 相同）。 */
export const CHART_SIZES: readonly GridSize[] = [S21, S12, S22, S23];

/**
 * 首批卡片内容模板（任务 §6）。尺寸记法 `宽×高`：`1×2` 是一列宽、两行高（竖长），`2×1` 是两列宽、一行高（横长）。
 * 模板只声明「能放什么、多少、建议多大」，**不声明像素**；像素排布由 `layoutComposition` 按卡片真实宽高算。
 */
export const CARD_TEMPLATES: readonly CardTemplate[] = [
  { id: "single", numbers: [0, 1], charts: [0, 1], arrangement: "single", sizes: [] },
  { id: "T1", numbers: [2, 2], charts: [0, 0], arrangement: "numbers", sizes: [S11, S21, S12, S22] },
  { id: "T2", numbers: [4, 4], charts: [0, 0], arrangement: "numbers", sizes: [S21, S12, S22] },
  { id: "T3", numbers: [2, 2], charts: [1, 1], arrangement: "chart-numbers", sizes: [S12, S22, S23] },
  { id: "T4", numbers: [3, 6], charts: [1, 1], arrangement: "chart-numbers", sizes: [S22, S23, S24] },
  { id: "T5", numbers: [0, 0], charts: [2, 2], arrangement: "charts", sizes: [S22, S23, S24] },
  // 2×3 留给需要较高绘图区的图形（日历热力、上期比较等）。
  { id: "T6", numbers: [1, 1], charts: [1, 1], arrangement: "number-chart", sizes: [S21, S22, S12, S23] },
  { id: "T7", numbers: [3, 6], charts: [0, 0], arrangement: "numbers", sizes: [S21, S12, S22, S23] },
  { id: "T8", numbers: [0, 6], charts: [2, 4], arrangement: "mixed", sizes: [S22, S23, S24] },
];

const TEMPLATE_BY_ID = new Map(CARD_TEMPLATES.map((template) => [template.id, template] as const));

export function templateOf(id: string): CardTemplate | null {
  return TEMPLATE_BY_ID.get(id as TemplateId) ?? null;
}

export interface SlotCounts {
  readonly numbers: number;
  readonly charts: number;
}

export function countSlots(slots: readonly Pick<CompositionSlot, "family">[]): SlotCounts {
  let numbers = 0;
  let charts = 0;
  for (const slot of slots) {
    if (slotKindOf(slot.family) === "number") numbers += 1;
    else charts += 1;
  }
  return { numbers, charts };
}

/** 模板与当前内容的关系：正好合适 / 还要再加 / 放不下（选它会丢内容，所以不允许）。 */
export type TemplateFit =
  | { readonly status: "ok" }
  | { readonly status: "needs"; readonly numbers: number; readonly charts: number }
  | { readonly status: "excess"; readonly numbers: number; readonly charts: number };

export function templateFit(template: CardTemplate, counts: SlotCounts): TemplateFit {
  const total = counts.numbers + counts.charts;
  if (template.id === "single") {
    if (total === 1) return { status: "ok" };
    return total === 0 ? { status: "needs", numbers: 1, charts: 0 } : { status: "excess", numbers: Math.max(0, counts.numbers - 1), charts: counts.charts };
  }
  const excessNumbers = Math.max(0, counts.numbers - template.numbers[1]);
  const excessCharts = Math.max(0, counts.charts - template.charts[1]);
  if (excessNumbers > 0 || excessCharts > 0 || total > MAX_SLOTS) return { status: "excess", numbers: excessNumbers, charts: excessCharts };
  const needNumbers = Math.max(0, template.numbers[0] - counts.numbers);
  const needCharts = Math.max(0, template.charts[0] - counts.charts);
  if (needNumbers > 0 || needCharts > 0) return { status: "needs", numbers: needNumbers, charts: needCharts };
  return { status: "ok" };
}

/**
 * **自动推荐的默认模板**（任务 §3.3）：只看数字与图表各有几个；没有一个模板能装下时返回 `null`
 * （编辑器在添加时就会阻止超过上限）。推荐是确定的，同样的内容永远推荐同一个模板。
 */
export function recommendTemplate(counts: SlotCounts): TemplateId | null {
  const { numbers: n, charts: c } = counts;
  if (n + c === 0) return null;
  if (n + c > MAX_SLOTS || n > MAX_NUMBER_SLOTS || c > MAX_CHART_SLOTS) return null;
  if (n + c === 1) return "single";
  if (c === 0) return n === 2 ? "T1" : n === 4 ? "T2" : "T7";
  if (c === 1) return n === 1 ? "T6" : n === 2 ? "T3" : "T4";
  if (c === 2 && n === 0) return "T5";
  return "T8";
}

/** 与当前内容兼容的模板（推荐的排第一）。用户可以手动切换其中任何一个，内容不丢。 */
export function compatibleTemplates(counts: SlotCounts): readonly TemplateId[] {
  const recommended = recommendTemplate(counts);
  const ok = CARD_TEMPLATES.filter((template) => templateFit(template, counts).status === "ok").map((template) => template.id);
  return recommended === null ? ok : [recommended, ...ok.filter((id) => id !== recommended)];
}

// ---------------------------------------------------------------------------
// 读写（旧卡片映射为单槽位；损坏 / 更新版本安全降级）
// ---------------------------------------------------------------------------

export type CompositionSource =
  /** 旧卡片或目录卡片：没有组合配置，唯一槽位来自 `analysis` + `chart`。 */
  | "plain"
  /** 本版本保存的组合配置。 */
  | "composite"
  /** 来自更新版本：只显示主槽位，不允许本版本改写内容。 */
  | "future"
  /** 组合配置损坏：退回主槽位。 */
  | "invalid";

export interface ReadComposition {
  readonly source: CompositionSource;
  readonly template: TemplateId;
  readonly slots: readonly CompositionSlot[];
  /** 读取时做过修正（展示形式不兼容、模板与内容不符等），写回时会保存修正后的值。 */
  readonly adjusted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 展示形式不在该分析允许的范围内（来自旧配置）：退回第一种，而不是白屏（卡片规格 §3.2）。 */
function normalisedFamily(analysisId: string, family: string): { readonly family: ChartFamily; readonly changed: boolean } {
  const type = cardType(analysisId);
  if (type === null) return { family: family as ChartFamily, changed: false };
  if (type.families.includes(family as ChartFamily)) return { family: family as ChartFamily, changed: false };
  return { family: type.families[0] ?? "number", changed: true };
}

function plainSlot(card: AnalysisCardNode): CompositionSlot {
  return { id: "s1", analysisId: card.analysis.analysisId, family: card.chart.chartFamily as ChartFamily };
}

function compositionValue(card: AnalysisCardNode): unknown {
  const options = card.chart.options;
  return isRecord(options) ? options["composition"] : undefined;
}

export function hasComposition(card: AnalysisCardNode): boolean {
  return compositionValue(card) !== undefined;
}

export function readComposition(card: AnalysisCardNode): ReadComposition {
  const raw = compositionValue(card);
  if (raw === undefined) return { source: "plain", template: "single", slots: [plainSlot(card)], adjusted: false };
  if (!isRecord(raw)) return { source: "invalid", template: "single", slots: [plainSlot(card)], adjusted: true };
  const version = raw["v"];
  if (typeof version === "number" && Number.isInteger(version) && version > COMPOSITION_VERSION) {
    return { source: "future", template: "single", slots: [plainSlot(card)], adjusted: false };
  }
  const rawSlots = raw["slots"];
  if (version !== COMPOSITION_VERSION || !Array.isArray(rawSlots) || rawSlots.length === 0 || rawSlots.length > MAX_SLOTS) {
    return { source: "invalid", template: "single", slots: [plainSlot(card)], adjusted: true };
  }
  const seen = new Set<string>();
  const slots: CompositionSlot[] = [];
  let adjusted = false;
  for (const value of rawSlots) {
    if (!isRecord(value)) return { source: "invalid", template: "single", slots: [plainSlot(card)], adjusted: true };
    const id = value["id"];
    const analysisId = value["analysisId"];
    const family = value["family"];
    if (typeof id !== "string" || id === "" || seen.has(id) || typeof analysisId !== "string" || analysisId === "" || typeof family !== "string" || family === "") {
      return { source: "invalid", template: "single", slots: [plainSlot(card)], adjusted: true };
    }
    seen.add(id);
    const normal = normalisedFamily(analysisId, family);
    adjusted ||= normal.changed;
    slots.push({ id, analysisId, family: normal.family });
  }
  // 主分析与第一个槽位不一致：说明卡片被不认识组合配置的旧版本改过主分析——以最新一次修改（卡片本身）为准。
  const first = slots[0]!;
  if (first.analysisId !== card.analysis.analysisId || first.family !== card.chart.chartFamily) {
    const normal = normalisedFamily(card.analysis.analysisId, card.chart.chartFamily);
    slots[0] = { id: first.id, analysisId: card.analysis.analysisId, family: normal.family };
    adjusted = true;
  }
  const counts = countSlots(slots);
  const declared = templateOf(typeof raw["template"] === "string" ? raw["template"] : "");
  const fits = declared !== null && templateFit(declared, counts).status === "ok";
  const template = fits ? declared.id : recommendTemplate(counts);
  if (template === null) return { source: "invalid", template: "single", slots: [plainSlot(card)], adjusted: true };
  return { source: "composite", template, slots, adjusted: adjusted || !fits };
}

/** 卡片是不是用户在「自定义卡片」里做的（有组合配置，或沿用旧版的自定义标题）。 */
export function isCustomCard(card: AnalysisCardNode): boolean {
  return card.title?.kind === "custom" || hasComposition(card);
}

/** 有不止一个槽位、需要按模板排布的卡片。 */
export function isMultiSlot(card: AnalysisCardNode): boolean {
  const read = readComposition(card);
  return read.source === "composite" && read.slots.length > 1;
}

/**
 * 把组合配置写回卡片：主分析 / 主展示形式镜像第一个槽位；`chart.options` 里的其它键原样保留。
 * 主分析没变时保留原 `analysis` 对象（含 `analysisVersion` / `params`），不擅自改写。
 */
export function withComposition(card: AnalysisCardNode, template: TemplateId, slots: readonly CompositionSlot[]): AnalysisCardNode {
  const first = slots[0];
  if (first === undefined) return card;
  const options: Record<string, unknown> = isRecord(card.chart.options) ? { ...card.chart.options } : {};
  options["composition"] = { v: COMPOSITION_VERSION, template, slots: slots.map((slot) => ({ id: slot.id, analysisId: slot.analysisId, family: slot.family })) } satisfies CompositionV1;
  return {
    ...card,
    analysis: card.analysis.analysisId === first.analysisId ? card.analysis : { analysisId: first.analysisId, params: {} },
    chart: { chartFamily: first.family, options },
  };
}

export function nextSlotId(slots: readonly Pick<CompositionSlot, "id">[]): string {
  let max = 0;
  for (const slot of slots) {
    const match = /^s(\d+)$/.exec(slot.id);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return `s${String(max + 1)}`;
}

/** 某个槽位作为「虚拟卡片」交给既有渲染层：共享父卡片的 objectId 前缀、时间策略与固定区间。 */
export function slotCard(card: AnalysisCardNode, slot: CompositionSlot): AnalysisCardNode {
  return {
    objectId: `${card.objectId}#${slot.id}`,
    type: "analysis-card",
    analysis: { analysisId: slot.analysisId, params: {} },
    chart: { chartFamily: slot.family },
    title: { kind: "preset" },
    rangePolicy: card.rangePolicy,
    ...(card.pinnedRange === undefined ? {} : { pinnedRange: card.pinnedRange }),
  };
}

// ---------------------------------------------------------------------------
// 尺寸：工作台占格（宽×高）
// ---------------------------------------------------------------------------

export interface CardSizing {
  readonly defaultSize: GridSize;
  readonly minSize: GridSize;
  /** 「调整尺寸」可选的占格，按推荐顺序。 */
  readonly sizes: readonly GridSize[];
}

function area(size: GridSize): number {
  return size.colSpan * size.rowSpan;
}

function smallest(sizes: readonly GridSize[]): GridSize {
  return [...sizes].sort((a, b) => area(a) - area(b) || a.rowSpan - b.rowSpan)[0] ?? S11;
}

/** 单个槽位（单项卡片）的尺寸：展示形式与分析的主形式同类时沿用目录尺寸，否则按种类给通用尺寸。 */
function singleSizing(analysisId: string, family: ChartFamily): CardSizing {
  const type = cardType(analysisId);
  const kind = slotKindOf(family);
  if (type !== null && slotKindOf(type.families[0] ?? "number") === kind) {
    return { defaultSize: type.defaultSize, minSize: type.minSize, sizes: type.sizes };
  }
  return kind === "number"
    ? { defaultSize: S11, minSize: S11, sizes: NUMBER_SIZES }
    : { defaultSize: S22, minSize: S21, sizes: CHART_SIZES };
}

export function sizingFor(template: TemplateId, slots: readonly CompositionSlot[]): CardSizing {
  const first = slots[0];
  if (template === "single" || first === undefined) return singleSizing(first?.analysisId ?? "", first?.family ?? "number");
  const declared = templateOf(template);
  const sizes = declared?.sizes ?? CHART_SIZES;
  return { defaultSize: sizes[0] ?? S22, minSize: smallest(sizes), sizes };
}

/** 任意卡片（旧卡片、目录卡片、组合卡片）的占格约束——工作台尺寸面板与 D 的投影契约都从这里取。 */
export function cardSizing(card: AnalysisCardNode): CardSizing {
  const read = readComposition(card);
  return sizingFor(read.template, read.slots);
}

// ---------------------------------------------------------------------------
// 卡片内部排布（按卡片内容区的真实像素；与工作台网格是两套约束）
// ---------------------------------------------------------------------------

/** 槽位间距（px）。 */
export const SLOT_GAP = 8;
/**
 * 可读性下限（px，原型值，按 1.17.10 真机前的浏览器测量取）：
 * - 数字「单行」：左名称、右数值，至少 120 宽、24 高（数值优先完整显示，名称放不下时截断并保留完整提示）；
 * - 数字「两行」：上名称、下数值，至少 92 宽、46 高（有第二行说明的指标再加 16）；
 * - 图表：名称一行 + 至少 72 高的绘图区，至少 140 宽；
 * - 迷你趋势（只对时间序列开放）：名称一行 + 40 高的线，至少 110 宽。
 * **不靠无限缩小字号塞内容**：放不下就少放、推荐更大尺寸或换模板。
 */
export const READABLE = {
  inline: { minWidth: 120, height: 24 },
  stacked: { minWidth: 92, height: 46 },
  tallExtra: 16,
  chart: { minWidth: 140, minHeight: 96 },
  spark: { minWidth: 110, minHeight: 58 },
} as const;

export type SlotMode = "full" | "inline" | "stacked" | "chart" | "spark";

export interface SlotPlacement {
  readonly slotId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly mode: SlotMode;
}

export interface CompositionLayout {
  readonly placements: readonly SlotPlacement[];
  /** 放不下而没有画出的槽位（卡片上显示「另有 N 项」，详情页完整显示）。 */
  readonly hidden: readonly string[];
  /** 全部内容都按可读下限放下了。 */
  readonly fits: boolean;
}

export interface SlotSpec {
  readonly id: string;
  readonly kind: SlotKind;
  /** 时间序列：小空间可画迷你趋势。 */
  readonly spark: boolean;
  /** 数字带第二行说明（例如环比同时给支出与收入）。 */
  readonly tall: boolean;
  /** 这种图形在槽位里（含名称一行）至少要多高才不被裁切；没有时用通用的图表下限。 */
  readonly minHeight?: number;
}

/** 迷你趋势只对线 / 面积 / 柱这类「一条序列」的图形有意义；表格、累计曲线等放不下就不画。 */
const SPARK_FAMILIES: ReadonlySet<ChartFamily> = new Set(["line", "area", "bar"]);

/**
 * 需要比通用下限更高的图形（含槽位名称一行，按 1.17.10 浏览器逐项测量：日历热力的格子不小于 14px、
 * 上期比较带说明段落、小多图每个分类至少一行小图）。
 */
const FAMILY_MIN_SLOT_HEIGHT: Partial<Record<ChartFamily, number>> = {
  // 卡片里的日历格子最小 16px 高（卡片里格子不可点）：6 周的月份正文约 168px，再加名称一行。
  heatmap: 190,
  comparison: 196,
  "small-multiples": 150,
  // 箱线图横向一条箱体 + 一行数轴说明即可读（单组约 44px），比通用下限低：2×1 也能完整显示。
  boxplot: 64,
};

/** 单项卡片（不是组合卡片）在给定正文尺寸下怎么画：完整图表 / 迷你趋势 / 空间不足（点开看）。 */
export type SinglePresentation = "full" | "spark" | "too-small";

/**
 * 单项卡片的展示判断，与组合小格同一套可读下限（单项卡片没有槽位名称那一行，所以下限少 16px）。
 * 编辑器的「放得下」检查、工作台卡片与预览都用它，三处结论一致。
 */
export function singlePresentation(spec: SlotSpec, width: number, height: number): SinglePresentation {
  if (spec.kind === "number") return "full";
  const minHeight = (spec.minHeight ?? READABLE.chart.minHeight) - 16;
  if (width >= READABLE.chart.minWidth && height >= minHeight) return "full";
  if (spec.spark && width >= READABLE.spark.minWidth && height >= READABLE.spark.minHeight - 16) return "spark";
  return "too-small";
}

/**
 * S17-A 的构成 / 排行 / 列表视图按密度只画放得下的行数（紧凑时 2 行），矮卡片（2×1）也能完整显示，
 * 下限比通用图表低（按 1.17.10 浏览器逐项测量）。
 */
const ADAPTIVE_LIST_FAMILIES: ReadonlySet<ChartFamily> = new Set(["ranking", "table", "donut"]);
const ADAPTIVE_LIST_MIN = 64;

export function slotSpecs(slots: readonly CompositionSlot[]): readonly SlotSpec[] {
  return slots.map((slot) => {
    const shown = resolveDisplay(slot.analysisId, slot.family);
    const adaptive = ADAPTIVE_LIST_FAMILIES.has(slot.family) && cardType(shown.analysisId)?.source === "agent-a";
    const minHeight = adaptive ? ADAPTIVE_LIST_MIN : FAMILY_MIN_SLOT_HEIGHT[slot.family];
    return {
      id: slot.id,
      kind: slotKindOf(slot.family),
      spark: SPARK_CAPABLE_IDS.has(shown.analysisId) && SPARK_FAMILIES.has(slot.family),
      tall: TALL_NUMBER_IDS.has(shown.analysisId),
      ...(minHeight === undefined ? {} : { minHeight }),
    };
  });
}

interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface NumberGrid {
  readonly placements: SlotPlacement[];
  readonly hidden: string[];
  readonly score: number;
}

/** 一组数字在给定区域里的最佳网格：先求全部放下（优先两行大字），放不下才少放。 */
function solveNumbers(specs: readonly SlotSpec[], region: Region): NumberGrid {
  const n = specs.length;
  if (n === 0) return { placements: [], hidden: [], score: 0 };
  const tall = specs.some((spec) => spec.tall);
  for (let shown = n; shown >= 1; shown -= 1) {
    let best: { cols: number; rows: number; mode: "inline" | "stacked"; score: number } | null = null;
    for (let cols = 1; cols <= shown; cols += 1) {
      const rows = Math.ceil(shown / cols);
      const cellWidth = (region.width - SLOT_GAP * (cols - 1)) / cols;
      const cellHeight = (region.height - SLOT_GAP * (rows - 1)) / rows;
      let mode: "inline" | "stacked" | null = null;
      if (cellWidth >= READABLE.stacked.minWidth && cellHeight >= READABLE.stacked.height + (tall ? READABLE.tallExtra : 0)) mode = "stacked";
      else if (cellWidth >= READABLE.inline.minWidth && cellHeight >= READABLE.inline.height + (tall ? READABLE.tallExtra : 0)) mode = "inline";
      if (mode === null) continue;
      const empty = rows * cols - shown;
      const aspect = cellWidth / Math.max(cellHeight, 1);
      const target = mode === "stacked" ? 2.4 : 7;
      const score = (mode === "stacked" ? 1000 : 500) - empty * 60 - Math.abs(Math.log(aspect / target)) * 20;
      if (best === null || score > best.score) best = { cols, rows, mode, score };
    }
    if (best !== null) {
      const cellWidth = (region.width - SLOT_GAP * (best.cols - 1)) / best.cols;
      const cellHeight = (region.height - SLOT_GAP * (best.rows - 1)) / best.rows;
      const placements = specs.slice(0, shown).map((spec, index) => ({
        slotId: spec.id,
        x: region.x + (index % best.cols) * (cellWidth + SLOT_GAP),
        y: region.y + Math.floor(index / best.cols) * (cellHeight + SLOT_GAP),
        width: cellWidth,
        height: cellHeight,
        mode: best.mode,
      }));
      return { placements, hidden: specs.slice(shown).map((spec) => spec.id), score: best.score };
    }
  }
  return { placements: [], hidden: specs.map((spec) => spec.id), score: -Infinity };
}

/** 数字带在给定宽度下需要的最小高度（优先两行大字，其次单行）。放不下返回 `null`。 */
function numbersBandHeight(specs: readonly SlotSpec[], width: number, preferStacked: boolean): number | null {
  const n = specs.length;
  if (n === 0) return 0;
  const tall = specs.some((spec) => spec.tall) ? READABLE.tallExtra : 0;
  let best: { height: number; stacked: boolean } | null = null;
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cellWidth = (width - SLOT_GAP * (cols - 1)) / cols;
    const options: { height: number; stacked: boolean }[] = [];
    if (cellWidth >= READABLE.stacked.minWidth) options.push({ height: rows * (READABLE.stacked.height + tall) + SLOT_GAP * (rows - 1), stacked: true });
    if (cellWidth >= READABLE.inline.minWidth) options.push({ height: rows * (READABLE.inline.height + tall) + SLOT_GAP * (rows - 1), stacked: false });
    for (const option of options) {
      if (best === null) best = option;
      else if (preferStacked && option.stacked !== best.stacked) best = option.stacked ? option : best;
      else if (option.height < best.height) best = option;
    }
  }
  return best?.height ?? null;
}

function chartPlacement(spec: SlotSpec, region: Region): SlotPlacement | null {
  const full = region.width >= READABLE.chart.minWidth && region.height >= (spec.minHeight ?? READABLE.chart.minHeight);
  if (full) return { slotId: spec.id, ...region, mode: "chart" };
  const spark = spec.spark && region.width >= READABLE.spark.minWidth && region.height >= READABLE.spark.minHeight;
  return spark ? { slotId: spec.id, ...region, mode: "spark" } : null;
}

interface Candidate {
  readonly placements: SlotPlacement[];
  readonly hidden: string[];
  readonly chartArea: number;
}

function better(a: Candidate | null, b: Candidate): Candidate {
  if (a === null) return b;
  if (b.hidden.length !== a.hidden.length) return b.hidden.length < a.hidden.length ? b : a;
  return b.chartArea > a.chartArea ? b : a;
}

/** 图表网格：尽量全部放下且每张都达到可读下限；放不下的图表留到「另有 N 项」。 */
function solveCharts(specs: readonly SlotSpec[], region: Region): Candidate {
  const n = specs.length;
  let best: Candidate | null = null;
  for (let cols = 1; cols <= Math.min(n, 3); cols += 1) {
    const rows = Math.ceil(n / cols);
    const width = (region.width - SLOT_GAP * (cols - 1)) / cols;
    const height = (region.height - SLOT_GAP * (rows - 1)) / rows;
    const placements: SlotPlacement[] = [];
    const hidden: string[] = [];
    specs.forEach((spec, index) => {
      const placed = chartPlacement(spec, {
        x: region.x + (index % cols) * (width + SLOT_GAP),
        y: region.y + Math.floor(index / cols) * (height + SLOT_GAP),
        width,
        height,
      });
      if (placed === null) hidden.push(spec.id);
      else placements.push(placed);
    });
    const aspect = width / Math.max(height, 1);
    const chartArea = placements.length * width * height - Math.abs(Math.log(aspect / 2)) * 1000;
    best = better(best, { placements, hidden, chartArea });
  }
  return best ?? { placements: [], hidden: specs.map((spec) => spec.id), chartArea: 0 };
}

/**
 * **卡片内部排布**：输入槽位与卡片内容区的真实宽高，输出每个槽位的位置与展示密度。
 * 纯函数（同样输入同样输出），卡片、编辑器预览和尺寸推荐都用它，保证「预览能放下 = 卡片能放下」。
 */
export function layoutComposition(template: TemplateId, specs: readonly SlotSpec[], width: number, height: number): CompositionLayout {
  const box: Region = { x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) };
  const declared = templateOf(template);
  if (declared === null || specs.length === 0) return { placements: [], hidden: specs.map((spec) => spec.id), fits: specs.length === 0 };
  const numbers = specs.filter((spec) => spec.kind === "number");
  const charts = specs.filter((spec) => spec.kind === "chart");
  const finish = (candidate: { placements: SlotPlacement[]; hidden: string[] }): CompositionLayout => {
    // 输出顺序按用户排列的槽位顺序（读屏顺序 = 用户顺序）。
    const order = new Map(specs.map((spec, index) => [spec.id, index] as const));
    const placements = [...candidate.placements].sort((a, b) => (order.get(a.slotId) ?? 0) - (order.get(b.slotId) ?? 0));
    const hidden = [...candidate.hidden].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return { placements, hidden, fits: hidden.length === 0 };
  };

  switch (declared.arrangement) {
    case "single": {
      const spec = specs[0]!;
      if (spec.kind === "number") return finish({ placements: [{ slotId: spec.id, ...box, mode: "full" }], hidden: [] });
      // 与工作台卡片同一判断：迷你趋势也算「完整显示」（只是更紧凑的形态），「空间不足」才算放不下。
      const presentation = singlePresentation(spec, box.width, box.height);
      return { placements: [{ slotId: spec.id, ...box, mode: presentation === "spark" ? "spark" : "full" }], hidden: [], fits: presentation !== "too-small" };
    }
    case "numbers":
      return finish(solveNumbers(specs, box));
    case "charts":
      return finish(solveCharts(charts, box));
    case "chart-numbers":
    case "number-chart":
    case "mixed": {
      let best: Candidate | null = null;
      // A：数字在上方一条，图表占下方剩余空间（窄卡、竖长卡）。
      const band = numbersBandHeight(numbers, box.width, declared.arrangement !== "mixed");
      if (band !== null) {
        const top = solveNumbers(numbers, { ...box, height: band });
        const rest = { x: 0, y: band + (band > 0 ? SLOT_GAP : 0), width: box.width, height: box.height - band - (band > 0 ? SLOT_GAP : 0) };
        const chartPart = rest.height > 0 ? solveCharts(charts, rest) : { placements: [], hidden: charts.map((spec) => spec.id), chartArea: 0 };
        best = better(best, { placements: [...top.placements, ...chartPart.placements], hidden: [...top.hidden, ...chartPart.hidden], chartArea: chartPart.chartArea });
      }
      // B：图表在左、数字竖排在右（横长卡）；混合模板的多图表不做左右分，避免图表被压窄。
      if (declared.arrangement !== "mixed" || charts.length === 1) {
        const numberWidth = Math.max(READABLE.stacked.minWidth, Math.min(Math.round(box.width * 0.36), 200));
        const chartWidth = box.width - numberWidth - SLOT_GAP;
        if (chartWidth >= READABLE.spark.minWidth) {
          const side = solveNumbers(numbers, { x: chartWidth + SLOT_GAP, y: 0, width: numberWidth, height: box.height });
          const chartPart = solveCharts(charts, { x: 0, y: 0, width: chartWidth, height: box.height });
          best = better(best, { placements: [...chartPart.placements, ...side.placements], hidden: [...chartPart.hidden, ...side.hidden], chartArea: chartPart.chartArea });
        }
      }
      return finish(best ?? { placements: [], hidden: specs.map((spec) => spec.id), chartArea: 0 });
    }
  }
}

// ---------------------------------------------------------------------------
// 尺寸推荐：在「当前设备」的真实列宽下，选第一个能完整放下的占格
// ---------------------------------------------------------------------------

/** 工作台网格在当前设备上的像素度量（编辑器从分析页拿真实列宽）。 */
export interface GridMetrics {
  readonly columnWidth: number;
  readonly rowHeight: number;
  readonly gap: number;
  /** 当前工作台的列数：占格宽度不能超过它。 */
  readonly columns: number;
  /** 卡片外框与标题占掉的像素（左右合计、上下合计）。 */
  readonly chromeWidth: number;
  readonly chromeHeight: number;
}

/** 卡片内容区在某个占格下的像素尺寸。 */
export function bodyBox(size: GridSize, metrics: GridMetrics): { readonly width: number; readonly height: number } {
  const width = metrics.columnWidth * size.colSpan + metrics.gap * (size.colSpan - 1) - metrics.chromeWidth;
  const height = metrics.rowHeight * size.rowSpan + metrics.gap * (size.rowSpan - 1) - metrics.chromeHeight;
  return { width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) };
}

export interface SizeCheck {
  readonly size: GridSize;
  /** 超出当前工作台列数。 */
  readonly tooWide: boolean;
  readonly fits: boolean;
  readonly hidden: number;
}

export function checkSizes(template: TemplateId, slots: readonly CompositionSlot[], metrics: GridMetrics): readonly SizeCheck[] {
  const specs = slotSpecs(slots);
  return sizingFor(template, slots).sizes.map((size) => {
    const tooWide = size.colSpan > metrics.columns;
    const box = bodyBox(size, metrics);
    const layout = layoutComposition(template, specs, box.width, box.height);
    return { size, tooWide, fits: !tooWide && layout.fits, hidden: layout.hidden.length };
  });
}

/**
 * 推荐尺寸：单项卡片沿用目录默认尺寸（与以往一致）；组合卡片在当前设备的列宽下按模板顺序找第一个
 * 能完整放下的占格，都放不下时给最大的那个（并在编辑器里说明）。
 */
export function recommendSize(template: TemplateId, slots: readonly CompositionSlot[], metrics: GridMetrics | null): GridSize {
  const sizing = sizingFor(template, slots);
  const clamp = (size: GridSize): GridSize => (metrics === null ? size : { colSpan: Math.min(size.colSpan, Math.max(1, metrics.columns)), rowSpan: size.rowSpan });
  if (template === "single" || metrics === null) return clamp(sizing.defaultSize);
  const checks = checkSizes(template, slots, metrics);
  const fitting = checks.find((check) => check.fits);
  if (fitting !== undefined) return fitting.size;
  const allowed = checks.filter((check) => !check.tooWide);
  const largest = [...(allowed.length > 0 ? allowed : checks)].sort((a, b) => area(b.size) - area(a.size))[0];
  return clamp(largest?.size ?? sizing.defaultSize);
}

/** 当前尺寸是否在该内容允许的尺寸里（换模板后旧尺寸可能不再合法）。 */
export function sizeAllowed(template: TemplateId, slots: readonly CompositionSlot[], size: GridSize): boolean {
  return sizingFor(template, slots).sizes.some((item) => item.colSpan === size.colSpan && item.rowSpan === size.rowSpan);
}
