/**
 * A-4 准备工作：26 项分析的静态目录（W1 卡片配置 → 分析实现的查找表）。
 *
 * 边界（2026-10-27 Lead 批准的范围）：
 * - 纯类型 + 纯数据 + 纯函数；**不加入 barrel、不接页面、不改既有响应/判据**；
 * - **不新增或改写 S-01 v2 形状字段**（`analysisType`/`metric` 目前只是本实现目录的
 *   draft 占位命名，S-01 v2 冻结后由 A 按冻结稿统一归一，见 `ANALYSIS_CATALOG_DRAFT` 说明）；
 * - 目录只登记「哪个 analysisId 用哪个装配函数、默认 kind/groupBy/结果形状」，
 *   不含金额、不含账本 ID、不含请求参数白名单（G-12a 发布形态待冻结后另行发布）。
 *
 * 每个条目都复用 `packages/shared/src/analysis/analyses/` 中已验收的装配函数，
 * 因此目录本身不会改变任何已通过的账单口径。
 */
import type { AnalysisEntry, AnalysisKind } from "./primitives.js";
import {
  assembleAverageExpensePerTransaction,
  assembleDailyAverageExpense,
  assembleExpenseCount,
  assembleIncomeCount,
  assembleNetAmount,
  assembleTotalExpense,
  assembleTotalIncome,
} from "./analyses/basic.js";
import {
  assembleCategoryCount,
  assembleCategoryFrequency,
  assembleExpenseCategoryComposition,
  assembleExpenseCategoryRanking,
  assembleIncomeCategoryComposition,
  assembleIncomeCategoryRanking,
  assembleMaxExpenseCategory,
  assemblePaymentMethodAnalysis,
} from "./analyses/category.js";
import {
  assembleDaysWithExpenseRecords,
  assembleDaysWithoutExpenseRecords,
  assembleExpenseIncomeRatio,
  assembleLedgerSurplusRatio,
  assembleMaxExpenseTransaction,
  assembleMaxIncomeTransaction,
  assembleMedianExpense,
  assembleMinExpenseTransaction,
  assembleMostRecordedDay,
  assemblePeakExpenseDay,
  assemblePeakIncomeDay,
} from "./analyses/statistics.js";
import { makeDefinition, type DefaultKind, type WorkbenchState } from "./context.js";
import type { AnalysisDefinition, AnalysisResult } from "./types.js";

/** 26 项（B01–B20、I01–I05、I17）的规范编号；与 S-01 v2 的 84 项责任表一致。 */
export const ANALYSIS_CATALOG_IDS = [
  "AN-B01",
  "AN-B02",
  "AN-B03",
  "AN-B04",
  "AN-B05",
  "AN-B06",
  "AN-B07",
  "AN-B08",
  "AN-B09",
  "AN-B10",
  "AN-B11",
  "AN-B12",
  "AN-B13",
  "AN-B14",
  "AN-B15",
  "AN-B16",
  "AN-B17",
  "AN-B18",
  "AN-B19",
  "AN-B20",
  "AN-I01",
  "AN-I02",
  "AN-I03",
  "AN-I04",
  "AN-I05",
  "AN-I17",
] as const;

export type CatalogAnalysisId = (typeof ANALYSIS_CATALOG_IDS)[number];

/**
 * 目录条目。字段全部只读；`assemble` 为已验收装配函数本体，目录不包装、不改写结果。
 */
export interface AnalysisCatalogEntry {
  readonly analysisId: CatalogAnalysisId;
  /**
   * draft 占位命名（S-01 v2 冻结前不构成协议）。当前沿用各分析既有测试的
   * `analysisType` 取值；冻结后按 `<domain>.<name>` 统一归一。
   */
  readonly analysisType: string;
  /** draft 占位命名；含义见各项能力定义，不含显示文案。 */
  readonly metric: string;
  /** 不指定 filters.kind 时该项分析的默认统计口径。 */
  readonly defaultKind: DefaultKind;
  /** 结果分组维度；`null` = 不分组（标量/极值）。 */
  readonly groupBy: NonNullable<AnalysisDefinition["groupBy"]> | null;
  /** 装配函数产出的结果形状（W1 用来选择图表输入适配器）。 */
  readonly shape: AnalysisResult["shape"];
  readonly assemble: (
    entries: readonly AnalysisEntry[],
    definition: AnalysisDefinition,
    workbench: WorkbenchState,
  ) => AnalysisResult;
}

/** 目录为 draft 数据：S-01 v2 冻结后整体复核一次（命名/默认 kind/形状映射）。 */
export const ANALYSIS_CATALOG_DRAFT = true;

const SCALAR = "scalar";
const RECORD_EXTREME = "record-extreme";
const COMPOSITION = "distribution";
const RANKED = "distribution";

/**
 * 26 项静态目录。顺序即 `ANALYSIS_CATALOG_IDS` 的顺序，便于 W1 按需渲染/验收。
 */
export const ANALYSIS_CATALOG: readonly AnalysisCatalogEntry[] = Object.freeze([
  {
    analysisId: "AN-B01",
    analysisType: SCALAR,
    metric: "expense-total",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleTotalExpense,
  },
  {
    analysisId: "AN-B02",
    analysisType: SCALAR,
    metric: "income-total",
    defaultKind: "income",
    groupBy: null,
    shape: "scalar",
    assemble: assembleTotalIncome,
  },
  {
    analysisId: "AN-B03",
    analysisType: SCALAR,
    metric: "net-amount",
    defaultKind: "both",
    groupBy: null,
    shape: "scalar",
    assemble: assembleNetAmount,
  },
  {
    analysisId: "AN-B04",
    analysisType: SCALAR,
    metric: "expense-count",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleExpenseCount,
  },
  {
    analysisId: "AN-B05",
    analysisType: SCALAR,
    metric: "income-count",
    defaultKind: "income",
    groupBy: null,
    shape: "scalar",
    assemble: assembleIncomeCount,
  },
  {
    analysisId: "AN-B06",
    analysisType: SCALAR,
    metric: "daily-average-expense",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleDailyAverageExpense,
  },
  {
    analysisId: "AN-B07",
    analysisType: SCALAR,
    metric: "average-expense-per-transaction",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleAverageExpensePerTransaction,
  },
  {
    analysisId: "AN-B08",
    analysisType: SCALAR,
    metric: "median-expense",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleMedianExpense,
  },
  {
    analysisId: "AN-B09",
    analysisType: RECORD_EXTREME,
    metric: "max-expense-transaction",
    defaultKind: "expense",
    groupBy: "record",
    shape: "record-extreme",
    assemble: assembleMaxExpenseTransaction,
  },
  {
    analysisId: "AN-B10",
    analysisType: RECORD_EXTREME,
    metric: "min-expense-transaction",
    defaultKind: "expense",
    groupBy: "record",
    shape: "record-extreme",
    assemble: assembleMinExpenseTransaction,
  },
  {
    analysisId: "AN-B11",
    analysisType: RECORD_EXTREME,
    metric: "peak-expense-day",
    defaultKind: "expense",
    groupBy: "day",
    shape: "record-extreme",
    assemble: assemblePeakExpenseDay,
  },
  {
    analysisId: "AN-B12",
    analysisType: RECORD_EXTREME,
    metric: "peak-income-day",
    defaultKind: "income",
    groupBy: "day",
    shape: "record-extreme",
    assemble: assemblePeakIncomeDay,
  },
  {
    analysisId: "AN-B13",
    analysisType: SCALAR,
    metric: "days-with-expense-records",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleDaysWithExpenseRecords,
  },
  {
    analysisId: "AN-B14",
    analysisType: SCALAR,
    metric: "days-without-expense-records",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleDaysWithoutExpenseRecords,
  },
  {
    analysisId: "AN-B15",
    analysisType: RECORD_EXTREME,
    metric: "max-expense-category",
    defaultKind: "expense",
    groupBy: "category",
    shape: "record-extreme",
    assemble: assembleMaxExpenseCategory,
  },
  {
    analysisId: "AN-B16",
    analysisType: SCALAR,
    metric: "category-count",
    defaultKind: "expense",
    groupBy: null,
    shape: "scalar",
    assemble: assembleCategoryCount,
  },
  {
    analysisId: "AN-B17",
    analysisType: RECORD_EXTREME,
    metric: "max-income-transaction",
    defaultKind: "income",
    groupBy: "record",
    shape: "record-extreme",
    assemble: assembleMaxIncomeTransaction,
  },
  {
    analysisId: "AN-B18",
    analysisType: SCALAR,
    metric: "expense-income-ratio",
    defaultKind: "both",
    groupBy: null,
    shape: "scalar",
    assemble: assembleExpenseIncomeRatio,
  },
  {
    analysisId: "AN-B19",
    analysisType: SCALAR,
    metric: "ledger-surplus-ratio",
    defaultKind: "both",
    groupBy: null,
    shape: "scalar",
    assemble: assembleLedgerSurplusRatio,
  },
  {
    analysisId: "AN-B20",
    analysisType: RECORD_EXTREME,
    metric: "most-recorded-day",
    defaultKind: "both",
    groupBy: "day",
    shape: "record-extreme",
    assemble: assembleMostRecordedDay,
  },
  {
    analysisId: "AN-I01",
    analysisType: COMPOSITION,
    metric: "expense-category-composition",
    defaultKind: "expense",
    groupBy: "category",
    shape: "composition",
    assemble: assembleExpenseCategoryComposition,
  },
  {
    analysisId: "AN-I02",
    analysisType: COMPOSITION,
    metric: "income-category-composition",
    defaultKind: "income",
    groupBy: "category",
    shape: "composition",
    assemble: assembleIncomeCategoryComposition,
  },
  {
    analysisId: "AN-I03",
    analysisType: RANKED,
    metric: "expense-category-ranking",
    defaultKind: "expense",
    groupBy: "category",
    shape: "ranked-groups",
    assemble: assembleExpenseCategoryRanking,
  },
  {
    analysisId: "AN-I04",
    analysisType: RANKED,
    metric: "income-category-ranking",
    defaultKind: "income",
    groupBy: "category",
    shape: "ranked-groups",
    assemble: assembleIncomeCategoryRanking,
  },
  {
    analysisId: "AN-I05",
    analysisType: RANKED,
    metric: "category-frequency",
    defaultKind: "expense",
    groupBy: "category",
    shape: "ranked-groups",
    assemble: assembleCategoryFrequency,
  },
  {
    analysisId: "AN-I17",
    analysisType: COMPOSITION,
    metric: "payment-method-composition",
    defaultKind: "expense",
    groupBy: "paymentMethod",
    shape: "composition",
    assemble: assemblePaymentMethodAnalysis,
  },
]);

const CATALOG_BY_ID: ReadonlyMap<string, AnalysisCatalogEntry> = new Map(
  ANALYSIS_CATALOG.map((entry) => [entry.analysisId, entry] as const),
);

/** 按 analysisId 取目录条目；未知编号返回 `null`（不抛错，便于只读占位降级）。 */
export function getAnalysisCatalogEntry(
  analysisId: string,
): AnalysisCatalogEntry | null {
  return CATALOG_BY_ID.get(analysisId) ?? null;
}

/**
 * 生成 W1 用的默认 `AnalysisDefinition`：`time.mode="inherit"`、货币继承、
 * `filters.kind=defaultKind`、`groupBy` 取目录默认；**不填入任何账本/交易 ID**。
 */
export function defaultDefinitionFor(
  analysisId: CatalogAnalysisId,
): AnalysisDefinition {
  const entry = getAnalysisCatalogEntry(analysisId);
  if (entry === null) {
    throw new RangeError(`unknown_analysis_id:${analysisId}`);
  }

  return makeDefinition({
    analysisId: entry.analysisId,
    analysisType: entry.analysisType,
    metric: entry.metric,
    ...(entry.groupBy === null ? {} : { groupBy: entry.groupBy }),
    filters: { kind: entry.defaultKind },
    time: { mode: "inherit" },
  });
}

/** 按编号取得默认 kind（W1 选择数据范围/币种时用）。 */
export function defaultKindFor(analysisId: CatalogAnalysisId): DefaultKind {
  const entry = getAnalysisCatalogEntry(analysisId);
  if (entry === null) {
    throw new RangeError(`unknown_analysis_id:${analysisId}`);
  }
  return entry.defaultKind;
}

/** 按编号取得结果形状（W1 选择图表输入适配器用）。 */
export function shapeFor(analysisId: CatalogAnalysisId): AnalysisResult["shape"] {
  const entry = getAnalysisCatalogEntry(analysisId);
  if (entry === null) {
    throw new RangeError(`unknown_analysis_id:${analysisId}`);
  }
  return entry.shape;
}

/** 断言辅助：把任意字符串收窄为目录编号（未知抛 RangeError）。 */
export function requireCatalogAnalysisId(value: string): CatalogAnalysisId {
  const entry = getAnalysisCatalogEntry(value);
  if (entry === null) {
    throw new RangeError(`unknown_analysis_id:${value}`);
  }
  return entry.analysisId;
}

/** 仅供 W1 诊断/契约测试：某 kind 的示例分析编号（不参与生产逻辑）。 */
export type CatalogAnalysisKindFilter = AnalysisKind | "both";
