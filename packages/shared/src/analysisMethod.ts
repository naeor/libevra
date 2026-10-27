/**
 * **S-01 v2 冻结后的方法串（method strings）——B 侧唯一来源（2026-10-27）**。
 *
 * 背景：S-01 v2 于 2026-10-27 09:30 CST 冻结（`s01-v2`）。B 的结果对象用
 * `formula` 字段自解释“怎么算的”，A 的 `ComputationMetadata.method` 是同一语义
 * 的开放字符串。为避免两边各写一套字面量，这里集中定义：
 *
 *  1. `ANALYSIS_METHOD`：B 已实现方法的**规范串**（逐字与冻结口径一致）；
 *  2. `FROZEN_METHOD_ALIASES`：冻结文档中出现的**别名/旧版串** → 规范串，只做
 *     入参/展示解析，**不反向暴露**为新规范名；
 *  3. `ANOMALY_METHOD_STRINGS`：A19 三种描述性方法对应的结果 `methodString`。
 *     其中 `quantile-threshold` 是 B 开放扩展，**未在冻结枚举内、不宣称已支持**。
 *
 * 未实现的方法不得出现在任何结果里（“未实现的不宣称”）。
 */

/** B 已实现、且与 S-01 v2 冻结口径逐字一致的方法串。 */
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
  /** A19 兜底：分位阈值。 */
  anomalyQuantile: "percentile-threshold-v1",
  /** A12 极端日阈值判定。 */
  extremeThreshold: "abs-deviation-gt-sigma-multiple-v1",
} as const;

export type CanonicalMethodString = (typeof ANALYSIS_METHOD)[keyof typeof ANALYSIS_METHOD];

/**
 * 冻结文档里的别名/旧版串 → B 规范串。
 *
 * 来源：S-01 v2 §16.6 旧版映射（`population-stddev`/`sample-cv-fixedpoint`）、
 * §12 `method` 行、B-V2-10 补充取值（`mad-median`/`iqr-quantile`）。
 * **别名只用于解析，不作为 B 结果的输出值。**
 */
export const FROZEN_METHOD_ALIASES: Readonly<Record<string, CanonicalMethodString>> = {
  "population-stddev": ANALYSIS_METHOD.populationStandardDeviation,
  "sample-cv-fixedpoint": ANALYSIS_METHOD.coefficientOfVariation,
  "mad-median": ANALYSIS_METHOD.anomalyMad,
  "iqr-quantile": ANALYSIS_METHOD.anomalyIqr,
  "percentile-threshold": ANALYSIS_METHOD.anomalyQuantile,
};

/**
 * 把冻结文档/旧工具传入的方法串解析为 B 规范串；未知的开放扩展串原样返回
 * （协议允许开放字符串，不得拒绝或静默替换）。
 */
export function canonicalMethodString(value: string): string {
  return FROZEN_METHOD_ALIASES[value] ?? value;
}

/** A19 三种描述性方法在结果里的 `methodString`。 */
export const ANOMALY_METHOD_STRINGS = {
  mad: "mad-median",
  iqr: "iqr-quantile",
  "zero-dispersion-quantile": "quantile-threshold",
} as const;

export type AnomalyMethodString =
  (typeof ANOMALY_METHOD_STRINGS)[keyof typeof ANOMALY_METHOD_STRINGS];

/** 由 A19 内部方法名取结果 `methodString`。 */
export function anomalyMethodString(
  method: keyof typeof ANOMALY_METHOD_STRINGS,
): AnomalyMethodString {
  return ANOMALY_METHOD_STRINGS[method];
}
