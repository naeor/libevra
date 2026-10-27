/**
 * **S-01 v2 冻结后的方法串（method strings）——B 侧唯一来源（2026-10-27）**。
 *
 * 背景：S-01 v2 于 2026-10-27 09:30 CST 冻结（`s01-v2`），随后 A 发布 v2.0.1
 * （`492b1b6`/`6f72f9f`）澄清方法串口径。B 的结果对象用 `formula` 字段自解释
 * “怎么算的”；对外宣称/对接只用**冻结登记值逐字**，B 内部 id 不得冒充冻结值。
 *
 * 三个层次（不得混用）：
 *
 *  1. `ANALYSIS_METHOD`：B **内部**方法 id，仅用于结果 `formula` 字段与测试，
 *     **不是**对外支持列表（如 `population-standard-deviation-v1` 只是 B 内部名）；
 *  2. `FROZEN_METHODS`：S-01 v2 v2.0.1 冻结登记、B 已实现且**可对外宣称**的值
 *     （`population-stddev`/`sample-cv-fixedpoint`/`mad-median`/`iqr-quantile`），
 *     `canonicalMethodString` 对这些方法只输出这里的字面量；
 *  3. `OPEN_EXTENSION_METHODS`：B 自有的开放扩展（未登记、**不宣称已支持**），
 *     保留 `-v1`/开放名并集中标注；与冻结值分表，不得混进“已支持”列表。
 *
 * 已明确不冒充的冻结值：`type7-linear`。B 的 95 分位阈值实现是 nearest-rank
 * （`ceil(n·q)−1`），不是 Type 7 线性插值，因此 A19 兜底方法对外用开放扩展名
 * `quantile-threshold`，**不得**映射为 `type7-linear`。
 *
 * 未实现的方法不得出现在任何结果里（“未实现的不宣称”）。
 */

/** B 内部方法 id（结果 `formula` 字段使用；不是对外支持列表）。 */
export const ANALYSIS_METHOD = {
  /** 精确均值（`μ = Σxᵢ / n`，`Ratio` 分子/分母）。 */
  exactMean: "exact-mean-v1",
  /** 总体标准差 `σ = √(Σ(xᵢ−μ)²/n)`，`SqrtValue` 表示。 */
  populationStandardDeviation: "population-standard-deviation-v1",
  /** 变异系数 `CV = σ ÷ μ`，无量纲 `Ratio`，展示 `percent-100`。 */
  coefficientOfVariation: "coefficient-of-variation-v1",
  /** A19 默认：稳健 z（中位数 + 绝对中位差）。 */
  anomalyMad: "robust-z-score-v1",
  /** A19 次选：Tukey 围栏（Q3 + k·IQR）。 */
  anomalyIqr: "tukey-fence-v1",
  /** A19 兜底：分位阈值（nearest-rank，非 Type 7 线性插值）。 */
  anomalyQuantile: "percentile-threshold-v1",
  /** A12 极端日阈值判定。 */
  extremeThreshold: "abs-deviation-gt-sigma-multiple-v1",
} as const;

/** 兼容既有 `index.ts` 导出：B 内部方法 id 的联合类型。 */
export type CanonicalMethodString = (typeof ANALYSIS_METHOD)[keyof typeof ANALYSIS_METHOD];

/** S-01 v2 v2.0.1 冻结登记、B 已实现且可对外宣称的方法串（逐字）。 */
export const FROZEN_METHODS = {
  populationStandardDeviation: "population-stddev",
  coefficientOfVariation: "sample-cv-fixedpoint",
  madMedian: "mad-median",
  iqrQuantile: "iqr-quantile",
} as const;

export type FrozenMethod = (typeof FROZEN_METHODS)[keyof typeof FROZEN_METHODS];

/** B 开放扩展方法串：保留 `-v1`/开放名，集中标注“不宣称已支持”。 */
export const OPEN_EXTENSION_METHODS = {
  exactMean: ANALYSIS_METHOD.exactMean,
  robustZScore: ANALYSIS_METHOD.anomalyMad,
  tukeyFence: ANALYSIS_METHOD.anomalyIqr,
  /**
   * B 的分位阈值实现为 nearest-rank（`sorted[ceil(n·q)−1]`），**不等价 Type 7**
   * 线性插值；故使用开放扩展名，不映射冻结值 `type7-linear`。
   */
  percentileThreshold: "quantile-threshold",
  absDeviationSigmaMultiple: ANALYSIS_METHOD.extremeThreshold,
} as const;

export type OpenExtensionMethod =
  (typeof OPEN_EXTENSION_METHODS)[keyof typeof OPEN_EXTENSION_METHODS];

/** 对外方法串的登记状态。 */
export type MethodSupport = "frozen" | "open-extension" | "unregistered";

/** B 内部 id / 冻结别名 / 开放扩展名 → 对外输出串。 */
const METHOD_OUTPUT: Readonly<Record<string, string>> = {
  [ANALYSIS_METHOD.populationStandardDeviation]: FROZEN_METHODS.populationStandardDeviation,
  "population-stddev": FROZEN_METHODS.populationStandardDeviation,
  [ANALYSIS_METHOD.coefficientOfVariation]: FROZEN_METHODS.coefficientOfVariation,
  "sample-cv-fixedpoint": FROZEN_METHODS.coefficientOfVariation,
  [ANALYSIS_METHOD.anomalyMad]: FROZEN_METHODS.madMedian,
  "mad-median": FROZEN_METHODS.madMedian,
  [ANALYSIS_METHOD.anomalyIqr]: FROZEN_METHODS.iqrQuantile,
  "iqr-quantile": FROZEN_METHODS.iqrQuantile,
  [ANALYSIS_METHOD.anomalyQuantile]: OPEN_EXTENSION_METHODS.percentileThreshold,
  "quantile-threshold": OPEN_EXTENSION_METHODS.percentileThreshold,
};

/**
 * 冻结文档/B 内部 id/旧工具传入的方法串 → 对外输出串：
 * 已实现且冻结登记的方法输出冻结值；开放扩展输出开放名；未知串原样返回
 * （协议允许开放字符串，不得拒绝或静默替换）。
 */
export function canonicalMethodString(value: string): string {
  return METHOD_OUTPUT[value] ?? value;
}

/** 冻结别名 → 冻结输出值（保留给既有测试/文档引用）。 */
export const FROZEN_METHOD_ALIASES: Readonly<Record<string, FrozenMethod>> = {
  "population-stddev": FROZEN_METHODS.populationStandardDeviation,
  "sample-cv-fixedpoint": FROZEN_METHODS.coefficientOfVariation,
  "mad-median": FROZEN_METHODS.madMedian,
  "iqr-quantile": FROZEN_METHODS.iqrQuantile,
};

/** 判断方法串（任意输入形态）在对外口径下的登记状态。 */
export function methodSupport(value: string): MethodSupport {
  const output = canonicalMethodString(value);
  if ((Object.values(FROZEN_METHODS) as readonly string[]).includes(output)) {
    return "frozen";
  }
  if ((Object.values(OPEN_EXTENSION_METHODS) as readonly string[]).includes(output)) {
    return "open-extension";
  }
  return "unregistered";
}

/** 是否为可对外宣称的冻结方法（含其内部名/别名输入）。 */
export function isFrozenMethod(value: string): boolean {
  return methodSupport(value) === "frozen";
}

/** A19 三种描述性方法在结果里的 `methodString`（仅前两项是冻结值）。 */
export const ANOMALY_METHOD_STRINGS = {
  mad: FROZEN_METHODS.madMedian,
  iqr: FROZEN_METHODS.iqrQuantile,
  /** 开放扩展：nearest-rank 分位阈值，非 Type 7，不宣称已支持。 */
  "zero-dispersion-quantile": OPEN_EXTENSION_METHODS.percentileThreshold,
} as const;

export type AnomalyMethodString =
  (typeof ANOMALY_METHOD_STRINGS)[keyof typeof ANOMALY_METHOD_STRINGS];

/** 由 A19 内部方法名取结果 `methodString`。 */
export function anomalyMethodString(
  method: keyof typeof ANOMALY_METHOD_STRINGS,
): AnomalyMethodString {
  return ANOMALY_METHOD_STRINGS[method];
}
