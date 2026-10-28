/**
 * 分析卡片目录（S17：分析能力 → 展示能力 → 卡片实例）。
 *
 * ⚠️ **这里只登记「哪种卡片用哪个已验收的计算、能怎么展示、占多大」，不含任何计算。**
 * 计算全部来自已有实现：
 *
 * | 来源 | 卡片 | 计算入口 |
 * |---|---|---|
 * | Agent A（`@libellum/shared` analysisCatalog） | AN-B01…B20、AN-I01…I05、AN-I17 | `getAnalysisCatalogEntry(id).assemble` |
 * | Agent B（`lib/analysisData.ts`） | AN-I06…I11、AN-I15、AN-I16、AN-I19、AN-I20 | `derive*Analysis` |
 * | 既有分析页（1.16.23 已发布） | AN-I12 日历热力、AN-A01 上期比较、AN-I11 折线 | `computeStats`（与旧页同一实现） |
 *
 * 编号沿用 S-01 v2 的 84 项责任表（`AN-` + 所有者编号），**没有自造新的分析编号**。
 * 尺寸以 `宽×高` 占格表示（D 的 `GridSize`），数值是首版原型值（OQ-LM-02 仍待真机冻结）。
 */
import type { GridSize } from "@libellum/shared/analysis/layout";

/** 结果 → 展示家族（只决定“怎么画”，不改变结果）。 */
export type ChartFamily =
  | "number"
  | "extreme"
  | "donut"
  | "ranking"
  | "table"
  | "line"
  | "area"
  | "bar"
  | "flow-bars"
  | "flow-lines"
  | "stacked"
  | "share-bands"
  | "cumulative"
  | "heatmap"
  | "comparison"
  // ---- S17-C 专用图表家族（1.17.10；编号按 C0 §3.4 暂编 CF-C01…CF-C20，QC-15 待统一） ----
  | "record-table"
  | "diverging"
  | "waterfall"
  | "pareto"
  | "histogram"
  | "boxplot"
  | "matrix"
  | "stacked-bars"
  | "treemap"
  | "bump"
  | "scatter"
  | "bubble"
  | "pivot"
  | "small-multiples"
  | "calendar-year"
  | "slope"
  // ---- 1.17.12：布局预设需要的展示形式（同一计算结果的另一种读法，不新增分析编号） ----
  /** 两期变化里增加最多 / 减少最多的一个分类（A17）。 */
  | "top-rise"
  | "top-fall"
  /** 单笔支出的第 90 百分位（A10，与四分位同一 Type 7 分位方法）。 */
  | "p90"
  /** 两条简短观察：总变化与最大贡献分类（A06 归因结果的文字读法）。 */
  | "insights"
  /** 支出总额 → 分类的归属流向（P06 分类结构的桑基读法；shared 层级桑基，守恒校验）。 */
  | "sankey"
  /** 数据状态卡：笔数与完整性（P16）/ 汇率覆盖率（P19）。 */
  | "status"
  /** 本期与上一可比期的逐日累计支出对比（A01）。 */
  | "cumulative-compare";

/** 页面既有展示别名 → A/B 权威图表家族；仅作读取适配，不另造图表类别。 */
export const FORMAL_CHART_FAMILIES: Readonly<Record<ChartFamily, string>> = {
  number: "CF-A01", extreme: "CF-A02", donut: "CF-A03", ranking: "CF-A04", table: "CF-A07",
  line: "CF-B01", area: "CF-B02", bar: "CF-B03", "flow-bars": "CF-B04", "flow-lines": "CF-B01",
  stacked: "CF-B05", "share-bands": "CF-B06", cumulative: "CF-B11", heatmap: "CF-B08", comparison: "CF-B10",
  "record-table": "CF-C01", diverging: "CF-C02", waterfall: "CF-C03", pareto: "CF-C04", histogram: "CF-C05",
  boxplot: "CF-C06", matrix: "CF-C08", "stacked-bars": "CF-C09", treemap: "CF-C11", bump: "CF-C13",
  scatter: "CF-C14", bubble: "CF-C15", pivot: "CF-C16", "small-multiples": "CF-C17", "calendar-year": "CF-C18",
  slope: "CF-C20",
  // 1.17.12：极值 / 数值 / 累计沿用既有家族编号；桑基按 C0 §3.4 的 CF-C12；文字观察与状态卡暂编 CF-A10 / CF-A11（QC-15 待统一）。
  "top-rise": "CF-A02", "top-fall": "CF-A02", p90: "CF-A01", insights: "CF-A10", sankey: "CF-C12", status: "CF-A11",
  "cumulative-compare": "CF-B11",
};

export function formalChartFamily(family: string): string {
  return FORMAL_CHART_FAMILIES[family as ChartFamily] ?? family;
}

/** 分析库中的分组（与能力目录 Basic / Insight / Advanced / Professional 技术等级对齐；**不是**面向用户的目录分类，见 `metricCatalog.ts`）。 */
export type CardGroup = "basic" | "insight" | "advanced" | "professional";

export interface CardType {
  readonly id: string;
  readonly group: CardGroup;
  /** 「系统推荐」分组里出现。 */
  readonly recommended: boolean;
  readonly families: readonly ChartFamily[];
  readonly defaultSize: GridSize;
  /** 可读的最小占格；布局层绝不让它更小（卡片规格 §5.6）。 */
  readonly minSize: GridSize;
  /** 「调整尺寸」里可选的尺寸。 */
  readonly sizes: readonly GridSize[];
  /** 是否有综合折算（汇率）模式下的权威结果；没有就明确显示「暂不支持」，不拿原币数字冒充。 */
  readonly combined: boolean;
  /** 卡片自带时间窗（不跟随顶部时间筛选）：「近 12 个月」，或「所选时间所在的自然年」（全年日历）。 */
  readonly ownWindow?: "12m" | "year";
  /** 只有综合折算模式才有意义的分析（汇率诊断类）；原币模式下显示说明与切换入口，而不是空图。 */
  readonly requiresCombined?: boolean;
  /** 计算来源，仅用于详情页的「计算方法」说明。 */
  readonly source: "agent-a" | "agent-b" | "agent-c" | "legacy";
}

const S11: GridSize = { colSpan: 1, rowSpan: 1 };
const S21: GridSize = { colSpan: 2, rowSpan: 1 };
const S12: GridSize = { colSpan: 1, rowSpan: 2 };
const S22: GridSize = { colSpan: 2, rowSpan: 2 };
const S23: GridSize = { colSpan: 2, rowSpan: 3 };
const S24: GridSize = { colSpan: 2, rowSpan: 4 };

const NUMBER_SIZES = [S11, S21, S12, S22] as const;
const CHART_SIZES = [S21, S12, S22, S23] as const;

/**
 * `extra`：除数字外**语义上成立**的其它展示形式（例如「总支出」按时间展开成趋势）。这些形式不另算，
 * 由 `DISPLAY_ALIASES` 交给同一口径的已验收分析去画（见下方说明），兼容性规则不会因此放宽。
 */
function numberCard(id: string, group: CardGroup, recommended: boolean, extra: readonly ChartFamily[] = []): CardType {
  return {
    id,
    group,
    recommended,
    families: ["number", ...extra],
    defaultSize: S11,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-a",
  };
}

function extremeCard(id: string, recommended: boolean, extra: readonly ChartFamily[] = []): CardType {
  return {
    id,
    group: "basic",
    recommended,
    families: ["extreme", ...extra],
    defaultSize: S11,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-a",
  };
}

export const CARD_TYPES: readonly CardType[] = [
  // ---- 基础（Agent A） ----
  numberCard("AN-B01", "basic", true, ["line", "area", "bar", "cumulative"]),
  numberCard("AN-B02", "basic", true, ["line", "area", "bar"]),
  numberCard("AN-B03", "basic", true, ["flow-bars", "flow-lines"]),
  numberCard("AN-B04", "basic", false),
  numberCard("AN-B05", "basic", false),
  numberCard("AN-B06", "basic", true),
  numberCard("AN-B07", "basic", false),
  numberCard("AN-B08", "basic", false, ["boxplot"]),
  extremeCard("AN-B09", true, ["record-table"]),
  extremeCard("AN-B10", false),
  extremeCard("AN-B11", true),
  extremeCard("AN-B12", false),
  numberCard("AN-B13", "basic", false),
  numberCard("AN-B14", "basic", false),
  extremeCard("AN-B15", true, ["ranking", "donut"]),
  numberCard("AN-B16", "basic", false),
  extremeCard("AN-B17", false),
  numberCard("AN-B18", "basic", false),
  numberCard("AN-B19", "basic", false),
  extremeCard("AN-B20", false),
  // ---- 常用分析：构成与排行（Agent A） ----
  {
    id: "AN-I01",
    group: "insight",
    recommended: true,
    families: ["donut", "ranking", "table"],
    defaultSize: S23,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  {
    id: "AN-I02",
    group: "insight",
    recommended: false,
    families: ["donut", "ranking", "table"],
    defaultSize: S23,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  {
    id: "AN-I03",
    group: "insight",
    recommended: true,
    families: ["ranking", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  {
    id: "AN-I04",
    group: "insight",
    recommended: false,
    families: ["ranking", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  {
    id: "AN-I05",
    group: "insight",
    recommended: false,
    families: ["ranking", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  {
    id: "AN-I17",
    group: "insight",
    recommended: false,
    families: ["donut", "ranking", "table"],
    defaultSize: S23,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-a",
  },
  // ---- 常用分析：时间（Agent B） ----
  {
    id: "AN-I06",
    group: "insight",
    recommended: true,
    families: ["line", "area", "bar", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I07",
    group: "insight",
    recommended: false,
    families: ["line", "area", "bar", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I08",
    group: "insight",
    recommended: false,
    families: ["bar", "line", "area", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I09",
    group: "insight",
    recommended: true,
    families: ["bar", "line", "area", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    ownWindow: "12m",
    source: "agent-b",
  },
  {
    id: "AN-I10",
    group: "insight",
    recommended: false,
    families: ["bar", "line", "area", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    ownWindow: "12m",
    source: "agent-b",
  },
  {
    id: "AN-I11",
    group: "insight",
    recommended: true,
    families: ["flow-bars", "flow-lines", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "legacy",
  },
  {
    id: "AN-I12",
    group: "insight",
    recommended: true,
    families: ["heatmap"],
    defaultSize: S23,
    minSize: S23,
    sizes: [S23],
    combined: true,
    source: "legacy",
  },
  {
    id: "AN-I15",
    group: "advanced",
    recommended: false,
    families: ["stacked", "line"],
    defaultSize: S22,
    minSize: S22,
    sizes: [S22, S23],
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I16",
    group: "advanced",
    recommended: false,
    families: ["share-bands"],
    defaultSize: S22,
    minSize: S22,
    sizes: [S22, S23],
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I19",
    group: "insight",
    recommended: false,
    families: ["bar", "line", "table"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I20",
    group: "insight",
    recommended: false,
    families: ["cumulative"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  // ---- 深入分析 ----
  {
    id: "AN-A01",
    group: "advanced",
    recommended: true,
    // 1.17.12：「较上期变化」数字与「逐日累计对比」两种读法，同一套两期读取（本期 + comparisonRangeFor）。
    families: ["comparison", "number", "cumulative-compare"],
    defaultSize: S22,
    minSize: S22,
    sizes: [S22, S23],
    combined: true,
    source: "legacy",
  },
  // ---- S17-B 第二批：已算好、这次接入卡片与自定义卡（2026-10-28，1.17.8） ----
  // 口径：`apps/web/src/lib/analysisData.ts` 的派生层只决定读哪段账目；金额与完整性全部由
  // `packages/shared` 的同一份引擎给出，卡片层只格式化，不再另算一套。
  {
    id: "AN-I13",
    group: "insight",
    recommended: false,
    families: ["bar"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-I14",
    group: "insight",
    recommended: false,
    families: ["line"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A02",
    group: "advanced",
    recommended: false,
    families: ["number"],
    defaultSize: S21,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A03",
    group: "advanced",
    recommended: false,
    families: ["number"],
    defaultSize: S21,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A04",
    group: "advanced",
    recommended: false,
    families: ["bar"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A05",
    group: "advanced",
    recommended: false,
    families: ["number"],
    defaultSize: S21,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A12",
    group: "advanced",
    recommended: false,
    families: ["area"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A13",
    group: "advanced",
    recommended: false,
    families: ["line"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A14",
    group: "advanced",
    recommended: false,
    families: ["line"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A18",
    group: "advanced",
    recommended: false,
    families: ["line"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A19",
    group: "advanced",
    recommended: false,
    families: ["line"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  {
    id: "AN-A20",
    group: "advanced",
    recommended: false,
    families: ["number"],
    defaultSize: S22,
    minSize: S21,
    sizes: CHART_SIZES,
    combined: true,
    source: "agent-b",
  },
  // ---- S17-C 深入与专业分析（1.17.10）：计算在 `@libellum/shared/analysis/advanced`，卡片层在 `cCards.tsx` ----
  // P05 分类层级结构、P07 分类层级桑基需要真实的父子分类模型（当前分类只有一级，C0 QC-03 待所有者决定），
  // 不按名称猜层级，**不登记**；P21 自定义多维分析需要每个槽位的维度参数，本轮未开放（见能力说明 §7）。
  cCard("AN-I18", "advanced", ["record-table", "ranking"], S22, S21, CHART_SIZES),
  cCard("AN-A06", "advanced", ["diverging", "waterfall", "insights"], S22, S21, CHART_SIZES),
  cCard("AN-A07", "advanced", ["diverging", "slope"], S22, S21, CHART_SIZES),
  cCard("AN-A08", "advanced", ["number", "pareto"], S11, S11, NUMBER_SIZES),
  cCard("AN-A09", "advanced", ["histogram"], S22, S21, CHART_SIZES),
  cCard("AN-A10", "advanced", ["boxplot", "number", "p90"], S21, S21, CHART_SIZES),
  cCard("AN-A11", "advanced", ["number", "histogram"], S11, S11, NUMBER_SIZES),
  cCard("AN-A15", "advanced", ["number", "table"], S11, S11, NUMBER_SIZES),
  cCard("AN-A16", "advanced", ["number", "pareto", "record-table"], S11, S11, NUMBER_SIZES),
  cCard("AN-A17", "advanced", ["diverging", "table", "top-rise", "top-fall"], S22, S21, CHART_SIZES),
  cCard("AN-P01", "professional", ["matrix"], S22, S22, [S22, S23, S24]),
  cCard("AN-P02", "professional", ["matrix"], S22, S22, [S22, S23, S24]),
  cCard("AN-P03", "professional", ["matrix", "stacked-bars"], S22, S22, [S22, S23, S24]),
  cCard("AN-P04", "professional", ["stacked-bars", "table"], S22, S21, CHART_SIZES),
  // 桑基读法（1.17.12）只画「支出总额 → 分类」这一真实归属关系（shared `buildHierarchy` + `buildHierarchySankey`）；
  // 所有者规格 §23 不允许把「收入 → 支付方式 → 分类」连成资金流向，分类层级（P07）等 QC-03。
  cCard("AN-P06", "professional", ["treemap", "ranking", "sankey"], S22, S21, CHART_SIZES),
  cCard("AN-P08", "professional", ["pareto", "table"], S22, S21, CHART_SIZES),
  cCard("AN-P09", "professional", ["bump", "table"], S22, S22, [S22, S23]),
  cCard("AN-P10", "professional", ["scatter"], S22, S21, CHART_SIZES),
  cCard("AN-P11", "professional", ["bubble", "table"], S22, S22, [S22, S23]),
  cCard("AN-P12", "professional", ["boxplot", "table"], S23, S22, [S22, S23, S24]),
  cCard("AN-P13", "professional", ["pivot"], S23, S22, [S22, S23, S24]),
  cCard("AN-P14", "professional", ["small-multiples"], S23, S22, [S22, S23, S24]),
  // 53 周 × 7 天在手机宽度下每格约 6–7 像素，2×1 的高度放不下日历与合计行，默认 2×2。
  { ...cCard("AN-P15", "professional", ["calendar-year"], S22, S21, [S21, S22]), ownWindow: "year" },
  cCard("AN-P16", "professional", ["ranking", "table", "status"], S22, S21, CHART_SIZES),
  { ...cCard("AN-P17", "professional", ["ranking", "table"], S22, S21, CHART_SIZES), requiresCombined: true },
  { ...cCard("AN-P18", "professional", ["scatter", "table"], S22, S21, CHART_SIZES), requiresCombined: true },
  { ...cCard("AN-P19", "professional", ["table", "matrix", "status"], S22, S21, CHART_SIZES), requiresCombined: true },
  { ...cCard("AN-P20", "professional", ["bar", "table"], S22, S21, CHART_SIZES), requiresCombined: true },
  cCard("AN-P22", "professional", ["waterfall", "table"], S22, S21, CHART_SIZES),
  cCard("AN-P23", "professional", ["boxplot", "table"], S23, S22, [S22, S23, S24]),
  cCard("AN-P24", "professional", ["slope", "diverging", "table"], S22, S22, [S22, S23]),
];

function cCard(id: string, group: CardGroup, families: readonly ChartFamily[], defaultSize: GridSize, minSize: GridSize, sizes: readonly GridSize[]): CardType {
  return { id, group, recommended: false, families, defaultSize, minSize, sizes, combined: true, source: "agent-c" };
}

const BY_ID = new Map(CARD_TYPES.map((type) => [type.id, type] as const));

/** 未知编号返回 `null`：来自新版本的配置以只读占位显示，不删除（S-03 / G-12b）。 */
export function cardType(id: string): CardType | null {
  return BY_ID.get(id) ?? null;
}

/**
 * **展示别名**：一个以数字为主的指标，在语义成立时可以换成「同一口径、加一个维度」的图形展示——
 * 例如「总支出」按时间展开就是「每日支出趋势」（图上方的合计正是总支出）。这里**不新增计算**，
 * 只把（指标, 展示形式）指到已经验收的那一项分析去画；数字形式本身不受影响。
 *
 * 规则：只登记「图形里能直接读回原指标」的组合（合计 = 序列之和、最大的一天 = 日历里最深的格、
 * 最多的分类 = 排行第一），不登记只是「主题相近」的组合。
 */
const DISPLAY_ALIASES: Readonly<Record<string, Partial<Record<ChartFamily, string>>>> = {
  "AN-B01": { line: "AN-I06", area: "AN-I06", bar: "AN-I06", cumulative: "AN-I20" },
  "AN-B02": { line: "AN-I07", area: "AN-I07", bar: "AN-I07" },
  "AN-B03": { "flow-bars": "AN-I11", "flow-lines": "AN-I11" },
  "AN-B15": { ranking: "AN-I03", donut: "AN-I01" },
  // 支出中位数 = 四分位箱线的中线（同一 Type 7 分位方法）；最大单笔支出 = 大额交易排行第一名。
  "AN-B08": { boxplot: "AN-A10" },
  "AN-B09": { "record-table": "AN-I18" },
};

/** （指标, 展示形式）实际交给哪一项分析画；没有别名时就是它自己。 */
export function resolveDisplay(analysisId: string, family: ChartFamily): { readonly analysisId: string; readonly family: ChartFamily } {
  const target = DISPLAY_ALIASES[analysisId]?.[family];
  return target === undefined ? { analysisId, family } : { analysisId: target, family };
}

/** 小空间可退成迷你趋势线的时间序列分析（卡片规格 CF-B07；其余图表放不下时不画，而不是挤小）。 */
export const SPARK_CAPABLE_IDS: ReadonlySet<string> = new Set(["AN-I06", "AN-I07", "AN-I08", "AN-I09", "AN-I10", "AN-I19"]);

/** 数字形式带第二行说明的分析（例如环比同时给支出与收入），组合卡片排布时多给一行高度。 */
export const TALL_NUMBER_IDS: ReadonlySet<string> = new Set(["AN-A02", "AN-A03", "AN-A05", "AN-A20"]);

export function sizeKey(size: GridSize): string {
  return `${String(size.colSpan)}×${String(size.rowSpan)}`;
}

/** 布局容器在添加区里的种类（Spacer 只是入口分组，不是容器类型）。 */
export type LayoutObjectChoice = "carousel" | "grid-split" | "spacer";

export const CONTAINER_DEFAULT_SIZE: Readonly<Record<LayoutObjectChoice, GridSize>> = {
  carousel: S22,
  "grid-split": S22,
  spacer: S11,
};

export const CONTAINER_SIZES: Readonly<Record<LayoutObjectChoice, readonly GridSize[]>> = {
  carousel: [S11, S21, S12, S22, S23],
  "grid-split": [S21, S22, S23],
  spacer: [S11, S21, S12, S22],
};
