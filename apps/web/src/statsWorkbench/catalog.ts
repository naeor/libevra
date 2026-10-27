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
  | "comparison";

/** 页面既有展示别名 → A/B 权威图表家族；仅作读取适配，不另造图表类别。 */
export const FORMAL_CHART_FAMILIES: Readonly<Record<ChartFamily, string>> = {
  number: "CF-A01", extreme: "CF-A02", donut: "CF-A03", ranking: "CF-A04", table: "CF-A07",
  line: "CF-B01", area: "CF-B02", bar: "CF-B03", "flow-bars": "CF-B04", "flow-lines": "CF-B01",
  stacked: "CF-B05", "share-bands": "CF-B06", cumulative: "CF-B11", heatmap: "CF-B08", comparison: "CF-B10",
};

export function formalChartFamily(family: string): string {
  return FORMAL_CHART_FAMILIES[family as ChartFamily] ?? family;
}

/** 分析库中的分组（与能力目录 Basic / Insight / Advanced 对齐）。 */
export type CardGroup = "basic" | "insight" | "advanced";

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
  /** 卡片自带时间窗（不跟随顶部时间筛选），例如「近 12 个月」。 */
  readonly ownWindow?: "12m";
  /** 计算来源，仅用于详情页的「计算方法」说明。 */
  readonly source: "agent-a" | "agent-b" | "legacy";
}

const S11: GridSize = { colSpan: 1, rowSpan: 1 };
const S21: GridSize = { colSpan: 2, rowSpan: 1 };
const S12: GridSize = { colSpan: 1, rowSpan: 2 };
const S22: GridSize = { colSpan: 2, rowSpan: 2 };
const S23: GridSize = { colSpan: 2, rowSpan: 3 };

const NUMBER_SIZES = [S11, S21, S12, S22] as const;
const CHART_SIZES = [S21, S12, S22, S23] as const;

function numberCard(id: string, group: CardGroup, recommended: boolean): CardType {
  return {
    id,
    group,
    recommended,
    families: ["number"],
    defaultSize: S11,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-a",
  };
}

function extremeCard(id: string, recommended: boolean): CardType {
  return {
    id,
    group: "basic",
    recommended,
    families: ["extreme"],
    defaultSize: S11,
    minSize: S11,
    sizes: NUMBER_SIZES,
    combined: true,
    source: "agent-a",
  };
}

export const CARD_TYPES: readonly CardType[] = [
  // ---- 基础（Agent A） ----
  numberCard("AN-B01", "basic", true),
  numberCard("AN-B02", "basic", true),
  numberCard("AN-B03", "basic", true),
  numberCard("AN-B04", "basic", false),
  numberCard("AN-B05", "basic", false),
  numberCard("AN-B06", "basic", true),
  numberCard("AN-B07", "basic", false),
  numberCard("AN-B08", "basic", false),
  extremeCard("AN-B09", true),
  extremeCard("AN-B10", false),
  extremeCard("AN-B11", true),
  extremeCard("AN-B12", false),
  numberCard("AN-B13", "basic", false),
  numberCard("AN-B14", "basic", false),
  extremeCard("AN-B15", true),
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
    families: ["line", "area", "bar"],
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
    families: ["line", "area", "bar"],
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
    families: ["bar", "line", "area"],
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
    families: ["bar", "line", "area"],
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
    families: ["bar", "line", "area"],
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
    families: ["flow-bars", "flow-lines"],
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
    families: ["bar", "line"],
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
    families: ["comparison"],
    defaultSize: S22,
    minSize: S22,
    sizes: [S22, S23],
    combined: true,
    source: "legacy",
  },
];

const BY_ID = new Map(CARD_TYPES.map((type) => [type.id, type] as const));

/** 未知编号返回 `null`：来自新版本的配置以只读占位显示，不删除（S-03 / G-12b）。 */
export function cardType(id: string): CardType | null {
  return BY_ID.get(id) ?? null;
}

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
