/**
 * Agent C · C-1 图表适配层类型（web 侧，DRAFT 未冻结）。
 *
 * 职责边界（owner 规格 §2 / Lead 2026-10-27）：
 * - **数学权威在 `@libellum/shared`**（分位、方差、归因、矩阵、排行）；
 * - 本目录只做「结果 → 图表输入」的映射、文本格式化与几何布局；
 * - **几何层不得重算金额、占比、分位、归因**：这里出现的 `*Fraction` / `*Text`
 *   都是 shared 结果的「展示派生」，只用于绘图与排版，不构成新的财务结论。
 *
 * 这些类型是 C-1 内部草稿，正式图表输入协议以 S-01 v2 的 `ChartInput` 为准。
 */

/** 图表输入的共同来源信息：同一分析定义、同一币种、同一完整性。 */
export interface ChartSource {
  readonly analysisId: string;
  readonly title: string;
  readonly currency: string;
  readonly complete: boolean;
}

/** 金额文本：minor 为权威整数，text 为已格式化的展示文本。 */
export interface MoneyText {
  readonly minor: bigint;
  readonly text: string;
}

/** 排行表（I18 / 精确排行表 CF-10 的数据表形态）。 */
export interface RankingTableRow {
  readonly rank: number;
  readonly id: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly occurredLocalDate: string;
  readonly categoryLabel: string;
  readonly paymentMethodLabel: string | null;
  readonly shareText: string | null;
  readonly tieCount: number;
}

export interface RankingTableInput {
  readonly source: ChartSource;
  readonly rows: readonly RankingTableRow[];
  readonly totalText: string | null;
  readonly truncated: boolean;
  readonly sampleComplete: boolean;
  /** 行数摘要，例如「共 5 笔，显示前 4 笔」由界面层拼接，这里只给事实。 */
  readonly visibleCount: number;
}

/** 发散条（A06 支出变化贡献：正=增加、负=减少）。 */
export interface DivergingBarDatum {
  readonly id: string;
  readonly label: string;
  readonly deltaMinor: bigint;
  readonly deltaText: string;
  readonly direction: "increase" | "decrease" | "flat";
  /** 供几何层缩放：|delta| / max|delta|，仅展示派生。 */
  readonly fractionOfMax: number;
  readonly shareText: string | null;
  readonly isNew: boolean;
  readonly isRemoved: boolean;
}

export interface DivergingBarsInput {
  readonly source: ChartSource;
  readonly rows: readonly DivergingBarDatum[];
  readonly totalDeltaText: string;
  readonly previousTotalText: string;
  readonly currentTotalText: string;
}

/** 瀑布图（A06 的累计解释形态）。 */
export interface WaterfallStep {
  readonly id: string;
  readonly label: string;
  readonly kind: "start" | "delta" | "total";
  readonly deltaText: string | null;
  readonly cumulativeText: string;
  /** 相对「上/下界最大绝对值」的归一化位置，仅几何使用。 */
  readonly startFraction: number;
  readonly endFraction: number;
  readonly direction: "increase" | "decrease" | "flat";
}

export interface WaterfallInput {
  readonly source: ChartSource;
  readonly steps: readonly WaterfallStep[];
  readonly unitText: string;
}

/** 直方图（A09 金额分布）。 */
export interface HistogramBar {
  readonly index: number;
  readonly lowerMinor: bigint;
  readonly upperMinor: bigint;
  readonly label: string;
  readonly count: number;
  /** count / maxCount，仅几何使用。 */
  readonly fractionOfMax: number;
  readonly containsZero: boolean;
  readonly isLast: boolean;
}

export interface HistogramInput {
  readonly source: ChartSource;
  readonly bars: readonly HistogramBar[];
  readonly sampleCount: number;
  readonly zeroCount: number;
  readonly binWidthText: string;
  readonly minText: string | null;
  readonly maxText: string | null;
}

/** 箱线图（A10 四分位数 / P12）。 */
export interface BoxplotInput {
  readonly source: ChartSource;
  readonly sampleCount: number;
  readonly minText: string;
  readonly q1Text: string;
  readonly medianText: string;
  readonly q3Text: string;
  readonly maxText: string;
  readonly lowerFenceText: string;
  readonly upperFenceText: string;
  /** 归一化位置（0..1，按 min..max 轴），仅几何使用。 */
  readonly minFraction: number;
  readonly q1Fraction: number;
  readonly medianFraction: number;
  readonly q3Fraction: number;
  readonly maxFraction: number;
  readonly outlierTexts: readonly string[];
  readonly outlierFractions: readonly number[];
}

/** 帕累托 / 集中度（A08 支出集中度 / P08 累计曲线）。 */
export interface ParetoRow {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly shareText: string;
  readonly cumulativeText: string;
  readonly cumulativeFraction: number;
}

export interface ParetoInput {
  readonly source: ChartSource;
  readonly rows: readonly ParetoRow[];
  readonly totalText: string;
  readonly top1Text: string | null;
  readonly top3Text: string | null;
  readonly top5Text: string | null;
}

/* ------------------------------------------------------------------------- *
 * C-2 新增图表输入（P01–P04 矩阵/堆叠、P09 排名迁移、P10 散点、P11 气泡）
 *
 * 与 C-1 相同：输入里的 *Text / *Fraction 都是 shared 结果的展示派生，
 * 只用于排版与坐标；金额/占比/分位的权威值一律来自 shared。
 * ------------------------------------------------------------------------- */

/** 热力矩阵的一个单元格（P01 分类×月份 / P02 分类×星期 / P03 分类×支付方式）。 */
export interface HeatmapCell {
  readonly rowId: string;
  readonly colId: string;
  readonly rowLabel: string;
  readonly colLabel: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly count: number;
  /** amount / 行合计；行合计为 0 时为 null（不写 0）。 */
  readonly shareOfRow: number | null;
  /** |amount| / 全表最大 |amount|，仅用于色阶强度。 */
  readonly intensity: number;
  readonly isNegative: boolean;
}

export interface HeatmapRow {
  readonly id: string;
  readonly label: string;
  readonly totalText: string;
}

export interface HeatmapColumn {
  readonly id: string;
  readonly label: string;
}

export interface HeatmapInput {
  readonly source: ChartSource;
  readonly rows: readonly HeatmapRow[];
  readonly cols: readonly HeatmapColumn[];
  readonly cells: readonly HeatmapCell[];
  readonly maxText: string;
  readonly totalText: string;
  readonly filledCellCount: number;
  /** 空单元格的显示文本（「该组合没有发生」，不是 0）。 */
  readonly emptyCellText: string;
}

/** 堆叠柱的一个时间桶（P04 时间×支付方式；行=时间桶、列=支付方式）。 */
export interface StackedBarsRow {
  readonly bucketLabel: string;
  readonly totalText: string;
}

export interface StackedBarSegment {
  readonly rowIndex: number;
  readonly seriesId: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  /** amount / 该行合计；行合计为 0 时为 0（由适配层给出，几何直接使用）。 */
  readonly fraction: number;
  /** 该段之前的累计占比（0..1），几何直接使用。 */
  readonly offsetFraction: number;
}

export interface StackedBarSeries {
  readonly id: string;
  readonly label: string;
  readonly segments: readonly StackedBarSegment[];
}

export interface StackedBarsInput {
  readonly source: ChartSource;
  readonly rows: readonly StackedBarsRow[];
  readonly series: readonly StackedBarSeries[];
  readonly unitText: string;
}

/** 排名迁移一行（P09 Bump/斜率图）。 */
export interface RankMigrationDatum {
  readonly id: string;
  readonly label: string;
  readonly previousRank: number | null;
  readonly currentRank: number | null;
  readonly rankDelta: number | null;
  readonly movement: "up" | "down" | "flat" | "new" | "removed";
  /** 本期金额文本（消失分类显示上期金额）。 */
  readonly amountText: string;
  readonly deltaText: string;
  /** 名次 → 纵向比例（1 = 第 1 名在顶部）；该期不存在时为 null。 */
  readonly previousFraction: number | null;
  readonly currentFraction: number | null;
}

export interface RankMigrationInput {
  readonly source: ChartSource;
  readonly rows: readonly RankMigrationDatum[];
  readonly movedCount: number;
  readonly newCount: number;
  readonly removedCount: number;
  readonly maxRank: number;
}

/** 散点图的一个点（P10）。 */
export interface ScatterDatum {
  readonly id: string;
  /** 业务日期的序数（同一个日期共享同一个 x 位置）。 */
  readonly dateIndex: number;
  readonly dateLabel: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly categoryId: string;
  /** amount / 最大金额（0..1），仅几何使用。 */
  readonly yFraction: number;
}

export interface ScatterInput {
  readonly source: ChartSource;
  readonly points: readonly ScatterDatum[];
  readonly sampleCount: number;
  readonly plottedCount: number;
  readonly omittedCount: number;
  readonly xLabels: readonly string[];
  readonly minText: string | null;
  readonly maxText: string | null;
}

/** 气泡图的一个气泡（P11：金额=大小、笔数=x、均值=y）。 */
export interface BubbleDatum {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly sumMinor: bigint;
  readonly sumText: string;
  readonly countText: string;
  readonly meanText: string | null;
  readonly shareText: string | null;
  /** sqrt(金额占比)，仅用于半径。 */
  readonly radiusFraction: number;
  readonly xFraction: number;
  readonly yFraction: number;
}

export interface BubbleInput {
  readonly source: ChartSource;
  readonly bubbles: readonly BubbleDatum[];
  readonly totalText: string;
  readonly totalCount: number;
}

/* ------------------------------------------------------------------------- *
 * C-2 第二批图表输入（P12 分类箱线 / P13 交叉表 / P14 小多图 / P15 全年日历 / P21 多维长表）
 *
 * 与前面相同：`*Text` / `*Fraction` 都是 shared 结果的展示派生，只用于排版与坐标；
 * 金额、占比、分位、归因的权威值一律在 shared，几何层不得重算。
 * ------------------------------------------------------------------------- */

/** 箱线图的一组（一个分类），位置已按「所有组共同 domain」归一化。 */
export interface BoxplotGroupDatum {
  readonly categoryId: string;
  readonly label: string;
  readonly sampleCount: number;
  /** 样本数达到 shared 的 minReliableSample；false 时展示层必须弱化箱体。 */
  readonly reliable: boolean;
  readonly minText: string;
  readonly q1Text: string;
  readonly medianText: string;
  readonly q3Text: string;
  readonly maxText: string;
  readonly lowerFenceText: string;
  readonly upperFenceText: string;
  readonly outlierTexts: readonly string[];
  readonly minFraction: number;
  readonly q1Fraction: number;
  readonly medianFraction: number;
  readonly q3Fraction: number;
  readonly maxFraction: number;
  readonly lowerFenceFraction: number;
  readonly upperFenceFraction: number;
  readonly outlierFractions: readonly number[];
}

export interface BoxplotByCategoryInput {
  readonly source: ChartSource;
  readonly groups: readonly BoxplotGroupDatum[];
  /** 例如「Type 7 线性插值」；分位方法必须全图一致。 */
  readonly quantileMethodText: string;
  readonly minReliableSample: number;
  readonly domainMinText: string;
  readonly domainMaxText: string;
}

/** 交叉表表头（行/列各一个方向）。 */
export interface PivotHeaderCell {
  readonly id: string;
  readonly label: string;
  /** 该行/列的合计文本（口径与单元格一致）。 */
  readonly totalText: string;
}

export interface PivotBodyCell {
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly valueText: string;
  /** 占比文本；仅当行合计可算（非 0）时给出，否则 null。 */
  readonly shareText: string | null;
  readonly isNegative: boolean;
}

/** 交叉表（P13；CF-10 表格家族，DOM 表格渲染，不需要 SVG 几何）。 */
export interface PivotTableInput {
  readonly source: ChartSource;
  readonly rowDimensionText: string;
  readonly colDimensionText: string;
  readonly metricText: string;
  readonly rowHeaders: readonly PivotHeaderCell[];
  readonly colHeaders: readonly PivotHeaderCell[];
  readonly cells: readonly PivotBodyCell[];
  readonly grandTotalText: string;
  /** 空单元格文本：表示「该组合没有发生」，不是金额 0。 */
  readonly emptyCellText: string;
  readonly filledCellCount: number;
  /** 守恒校验失败时的说明；通过时为 null（展示层不得自行重算合计）。 */
  readonly conservationText: string | null;
}

/** 小多图的一个时间点（P14）。 */
export interface SmallMultiplePoint {
  readonly bucketLabel: string;
  readonly valueText: string;
  /** 相对本图纵轴域最大值的位置（0..1）；共享尺度时即全局 sharedMax。 */
  readonly fractionOfMax: number;
}

export interface SmallMultiplePanel {
  readonly categoryId: string;
  readonly label: string;
  readonly totalText: string;
  readonly maxText: string;
  readonly points: readonly SmallMultiplePoint[];
}

export interface SmallMultiplesInput {
  readonly source: ChartSource;
  readonly panels: readonly SmallMultiplePanel[];
  readonly bucketLabels: readonly string[];
  readonly scaleMode: "shared" | "independent";
  readonly sharedMaxText: string;
  readonly truncated: boolean;
  readonly omittedCategoryCount: number;
  /** 截断/独立尺度等需要显式提示的文本；无提示时为 null。 */
  readonly noteText: string | null;
}

/** 日历的一个日期（P15；CF-06 年度热力日历）。 */
export interface CalendarHeatmapDay {
  readonly date: string;
  /** ISO 星期：周一 = 1 … 周日 = 7（行）。 */
  readonly weekday: number;
  /** 周一起始的年内周列号（0 基，列）。 */
  readonly weekIndex: number;
  readonly month: number;
  readonly state: "complete" | "no-data" | "in-progress" | "future" | "unknown";
  readonly valueText: string;
  readonly countText: string;
  /** 强度 0..1；无数据/未来/未知为 0（不得与真实零值混淆，靠 state 区分）。 */
  readonly intensity: number;
}

export interface CalendarHeatmapInput {
  readonly source: ChartSource;
  readonly year: number;
  readonly leapYear: boolean;
  readonly weekCount: number;
  readonly monthLabels: readonly string[];
  /** 每月 1 号所在列（0 基，长度 12），用于月份标签定位。 */
  readonly monthStartWeekIndex: readonly number[];
  readonly days: readonly CalendarHeatmapDay[];
  readonly totalText: string;
  readonly maxText: string | null;
  readonly noDataText: string;
  readonly unknownText: string;
  readonly futureText: string;
}

/** 多维长表的一列（P21：维度数 > 2 时不画矩阵，退回长表）。 */
export interface CrossCubePathCell {
  readonly dimensionText: string;
  readonly label: string;
}

export interface CrossCubeRow {
  readonly key: string;
  readonly path: readonly CrossCubePathCell[];
  readonly valueText: string;
  readonly shareText: string | null;
  readonly countText: string;
}

export interface CrossCubeTableInput {
  readonly source: ChartSource;
  readonly dimensionTexts: readonly string[];
  readonly metricText: string;
  readonly rows: readonly CrossCubeRow[];
  readonly totalText: string;
  readonly truncated: boolean;
}

/** 多维交叉的能力检查结果：被拒绝时给可展示原因，不抛异常给界面猜。 */
export type CrossCubeAdapterResult =
  | { readonly ok: true; readonly input: CrossCubeTableInput }
  | { readonly ok: false; readonly reason: string; readonly reasonText: string };

/* ------------------------------------------------------------------------- *
 * C-3 新增图表输入：P05 分类层级 / P06 分类矩形树图 / P07 层级桑基
 *
 * 约束与前几批相同：
 * - 金额来自 shared 结果（权威值），这里只做文本化与「仅用于坐标」的 number；
 * - 几何/布局函数只接收已归一化的 number，不重算金额、占比、分位；
 * - 数据模型当前**没有分类父子关系**（QC-03/QC-27）：没有真实层级时，这些输入
 *   必须显式给出 `available=false` / `nestingText`，不得用分类名猜层级、
 *   不得把平面分类画成业务层级（owner 规格 §21/§23）；
 * - 这些结构是 DRAFT，待 S-01 v2 评审后决定是否并入公共协议（QC-27…QC-29）。
 * ------------------------------------------------------------------------- */

/** 层级表的一行：P05 的表格/可展开列表形态，也是旭日图的无障碍与降级替代表。 */
export interface HierarchyTableRow {
  readonly nodeId: string;
  /** 1 = 顶层分类（0 是合成根，不在表格里显示）。 */
  readonly depth: number;
  readonly label: string;
  readonly subtreeAmountMinor: bigint;
  readonly subtreeAmountText: string;
  readonly directAmountMinor: bigint;
  readonly directAmountText: string;
  readonly countText: string;
  readonly shareOfParentText: string | null;
  readonly shareOfTotalText: string | null;
  readonly isLeaf: boolean;
  readonly hasMissingRelation: boolean;
}

export interface HierarchyTableInput {
  readonly source: ChartSource;
  readonly available: boolean;
  /** 不可用时展示的原因（空范围、取数失败等）；可用时为 null。 */
  readonly unavailableReason: string | null;
  readonly rows: readonly HierarchyTableRow[];
  readonly totalText: string;
  readonly rowsTruncated: boolean;
  /** 层级状态说明：无真实层级时必须显示「当前无分类层级（数据模型依赖）」。 */
  readonly nestingText: string;
}

/** 旭日图的一个节点；角度与半径由 `geometry4.computeSunburstArcs` 计算。 */
export interface SunburstArcDatum {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly kind: "root" | "category" | "direct";
  readonly label: string;
  readonly subtreeAmountMinor: bigint;
  readonly subtreeAmountText: string;
  /** 占父节点子树金额的份额（仅用于弧角）；根为 null。 */
  readonly fractionOfParent: number | null;
  readonly isLeaf: boolean;
  readonly hasMissingRelation: boolean;
}

export interface SunburstInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly nodes: readonly SunburstArcDatum[];
  readonly totalText: string;
  readonly maxDepth: number;
  readonly nestingText: string;
}

/** 旭日图门控：无真实层级 / 有未声明分类 / 范围不完整时拒绝画图并给原因。 */
export type SunburstAdapterResult =
  | { readonly ok: true; readonly input: SunburstInput }
  | { readonly ok: false; readonly reason: string; readonly reasonText: string };

/** 矩形树图的一个节点（P06；矩形面积 = 金额占比，由 geometry 计算）。 */
export interface TreemapNodeDatum {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly fractionOfTotal: number | null;
  readonly isLeaf: boolean;
  readonly hasMissingRelation: boolean;
}

export interface TreemapInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly nodes: readonly TreemapNodeDatum[];
  readonly totalText: string;
  /** true = 无真实层级，只画一层分类（平面 Treemap），不得暗示父子关系。 */
  readonly flattened: boolean;
  readonly nestingText: string;
}

export type TreemapAdapterResult =
  | { readonly ok: true; readonly input: TreemapInput }
  | { readonly ok: false; readonly reason: string; readonly reasonText: string };

/** 桑基图节点（P07；只表示真实层级金额归属，owner 规格 §23）。 */
export interface SankeyNodeDatum {
  readonly nodeId: string;
  readonly label: string;
  readonly depth: number;
  readonly kind: "root" | "category" | "direct";
  readonly inflowMinor: bigint;
  readonly inflowText: string;
  readonly outflowMinor: bigint;
  readonly outflowText: string;
  /** max(流入, 流出) / 总额，仅用于节点高度；总额为 0 时是 0。 */
  readonly valueFraction: number;
  readonly isTerminal: boolean;
}

/** 桑基连线；`fractionOfTotal` 仅用于连线厚度。 */
export interface SankeyLinkDatum {
  readonly fromId: string;
  readonly toId: string;
  readonly amountMinor: bigint;
  readonly amountText: string;
  readonly fractionOfTotal: number;
  readonly shareOfSource: number | null;
}

export interface SankeyInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly nodes: readonly SankeyNodeDatum[];
  readonly links: readonly SankeyLinkDatum[];
  readonly totalText: string;
}

/** 桑基门控：无真实层级 / 有未声明分类 / 范围不完整时拒绝启用并给原因。 */
export type SankeyAdapterResult =
  | { readonly ok: true; readonly input: SankeyInput }
  | { readonly ok: false; readonly reason: string; readonly reasonText: string };

/* ------------------------------------------------------------------------- *
 * C-4 新增图表输入：P16 币种交易构成 / P17 综合金额币种贡献 / P18 汇率历史趋势 /
 * P19 汇率完整性 / P20 回退使用（DRAFT；QC-12 / QC-29）。
 *
 * 约束（owner 规格 §32–§36、§49）：
 * - 只是 shared 草案结果的投影，不重算汇率/折算/完整性；
 * - 金额文本一律 bigint + 币种小数位排版，几何比例才用 number；
 * - 缺汇率、缺观测、状态不确定必须有显式可用性字段与原因，不得画成 0 或空白；
 * - 每个输入都带 `basisNote`，渲染层必须原样显示计算依据（不得省略）。
 * ------------------------------------------------------------------------- */

/** P16 一行：某个原币的笔数构成（不折算，金额只在该币种内显示）。 */
export interface CurrencyCompositionRowDatum {
  readonly currency: string;
  readonly recordCount: number;
  readonly recordCountText: string;
  readonly incomeCount: number;
  readonly expenseCount: number;
  /** 该币种原币收入合计文本（形如 `12.34 CNY`，只用于该币种内展示）。 */
  readonly incomeText: string;
  readonly expenseText: string;
  /** 笔数份额（0..1），仅用于柱长/环弧；无数据为 null。 */
  readonly recordShare: number | null;
  readonly shareText: string;
}

export interface CurrencyCompositionInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly rows: readonly CurrencyCompositionRowDatum[];
  readonly totalRecordCount: number;
  readonly totalText: string;
  readonly currencyCount: number;
  /** 必须原样显示：按笔数构成，不代表金额份额、不折算、不跨币种相加。 */
  readonly basisNote: string;
}

/** P17 一行：某个原始币种对「已折算金额」的贡献。 */
export interface FxContributionRowDatum {
  readonly currency: string;
  readonly convertedMinor: bigint;
  readonly convertedText: string;
  /** 该币种原币合计文本（只用于「原币」列，不参与目标币合计）。 */
  readonly originalText: string;
  readonly convertedCount: number;
  readonly fallbackCount: number;
  readonly missingCount: number;
  readonly shareOfConverted: number | null;
  readonly shareText: string;
}

export interface FxContributionChartInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly targetCurrency: string;
  readonly rows: readonly FxContributionRowDatum[];
  readonly totalMinor: bigint;
  readonly totalText: string;
  readonly convertedCount: number;
  readonly missingCount: number;
  /** 明示「缺汇率 N 笔，未计入合计」；无缺失时为空串（不能隐藏丢失）。 */
  readonly missingText: string;
  readonly sharesOverConvertedOnly: true;
  readonly basisNote: string;
}

/** P18 一个离散观测点（`xFraction`/`yFraction` 仅用于几何）。 */
export interface FxRateTrendPointDatum {
  readonly rateDate: string;
  readonly rateText: string;
  readonly provider: string;
  readonly xFraction: number;
  readonly yFraction: number;
}

export interface FxRateTrendInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly currency: string;
  readonly targetCurrency: string;
  readonly points: readonly FxRateTrendPointDatum[];
  readonly observationCount: number;
  readonly missingDateCount: number;
  readonly missingDatesText: string;
  readonly changeText: string | null;
  /** 永远是 "none"：P18 只画离散观测，不插值。 */
  readonly interpolation: "none";
  readonly basisNote: string;
}

/** P19 单元格状态（与 shared 结果一一对应，不新增语义）。 */
export type FxCoverageCellStatus = "exact" | "fallback" | "missing" | "not-needed";

export interface FxCoverageCellDatum {
  readonly currency: string;
  readonly date: string;
  readonly status: FxCoverageCellStatus;
  readonly statusLabel: string;
  readonly recordCount: number;
}

export interface FxCoverageRowDatum {
  readonly currency: string;
  readonly recordCount: number;
  readonly convertedCount: number;
  readonly missingCount: number;
  readonly coverageFraction: number | null;
  readonly coverageText: string;
}

export interface FxCoverageMatrixInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly targetCurrency: string;
  readonly rows: readonly FxCoverageRowDatum[];
  readonly columns: readonly string[];
  readonly cells: readonly FxCoverageCellDatum[];
  readonly needsConversionCount: number;
  readonly convertedCount: number;
  readonly missingCount: number;
  readonly coverageFraction: number | null;
  readonly coverageText: string;
  /** 首版不提供金额覆盖率：渲染层必须显示原因，不得暗示金额覆盖。 */
  readonly amountCoverageAvailable: false;
  readonly amountCoverageReason: string;
  readonly missingCombinationsText: readonly string[];
  readonly basisNote: string;
}

/** P20 按币种的回退使用一行。 */
export interface FxFallbackBarDatum {
  readonly currency: string;
  readonly directCount: number;
  readonly fallbackCount: number;
  readonly missingCount: number;
  readonly fallbackText: string;
}

/** P20 回退天数分布的一柱（`fraction` 仅用于柱高）。 */
export interface FxFallbackDistributionDatum {
  readonly fallbackDays: number;
  readonly label: string;
  readonly count: number;
  readonly fraction: number;
}

export interface FxFallbackUsageInput {
  readonly source: ChartSource;
  readonly available: boolean;
  readonly unavailableReason: string | null;
  readonly targetCurrency: string;
  readonly rows: readonly FxFallbackBarDatum[];
  readonly fallbackRecordCount: number;
  readonly needsConversionCount: number;
  readonly maxFallbackDays: number;
  readonly distribution: readonly FxFallbackDistributionDatum[];
  readonly providersText: string;
  readonly datesText: string;
  readonly missingRateCount: number;
  readonly basisNote: string;
}

