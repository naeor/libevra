import { describe, expect, it } from "vitest";
import {
  ANALYSIS_METHOD,
  ANOMALY_METHOD_STRINGS,
  FROZEN_METHOD_ALIASES,
  FROZEN_METHODS,
  OPEN_EXTENSION_METHODS,
  anomalyMethodString,
  canonicalMethodString,
  isFrozenMethod,
  methodSupport,
} from "./analysisMethod.js";

describe("S-01 v2 v2.0.1 frozen method strings", () => {
  it("keeps B internal ids separate from externally supported frozen values", () => {
    // B 内部 id：只用于结果 formula 字段，不是对外支持列表。
    expect(ANALYSIS_METHOD.exactMean).toBe("exact-mean-v1");
    expect(ANALYSIS_METHOD.populationStandardDeviation).toBe("population-standard-deviation-v1");
    expect(ANALYSIS_METHOD.coefficientOfVariation).toBe("coefficient-of-variation-v1");
    expect(ANALYSIS_METHOD.anomalyMad).toBe("robust-z-score-v1");
    expect(ANALYSIS_METHOD.anomalyIqr).toBe("tukey-fence-v1");
    expect(ANALYSIS_METHOD.anomalyQuantile).toBe("percentile-threshold-v1");
    expect(ANALYSIS_METHOD.extremeThreshold).toBe("abs-deviation-gt-sigma-multiple-v1");

    // 对外冻结值逐字（去掉 -v1），且与内部 id 分表。
    expect(FROZEN_METHODS.populationStandardDeviation).toBe("population-stddev");
    expect(FROZEN_METHODS.coefficientOfVariation).toBe("sample-cv-fixedpoint");
    expect(FROZEN_METHODS.madMedian).toBe("mad-median");
    expect(FROZEN_METHODS.iqrQuantile).toBe("iqr-quantile");
    expect(Object.values(FROZEN_METHODS) as string[]).not.toContain(
      ANALYSIS_METHOD.populationStandardDeviation,
    );
  });

  it("maps every input form (internal id / frozen alias) to the frozen literal", () => {
    // 标准差：内部 id 与冻结别名都输出冻结值。
    expect(canonicalMethodString(ANALYSIS_METHOD.populationStandardDeviation)).toBe(
      "population-stddev",
    );
    expect(canonicalMethodString("population-stddev")).toBe("population-stddev");
    // 变异系数。
    expect(canonicalMethodString(ANALYSIS_METHOD.coefficientOfVariation)).toBe(
      "sample-cv-fixedpoint",
    );
    expect(canonicalMethodString("sample-cv-fixedpoint")).toBe("sample-cv-fixedpoint");
    // A19 两种冻结方法。
    expect(canonicalMethodString(ANALYSIS_METHOD.anomalyMad)).toBe("mad-median");
    expect(canonicalMethodString("mad-median")).toBe("mad-median");
    expect(canonicalMethodString(ANALYSIS_METHOD.anomalyIqr)).toBe("iqr-quantile");
    expect(canonicalMethodString("iqr-quantile")).toBe("iqr-quantile");
    expect(methodSupport("mad-median")).toBe("frozen");
    expect(methodSupport(ANALYSIS_METHOD.anomalyIqr)).toBe("frozen");
    expect(isFrozenMethod("sample-cv-fixedpoint")).toBe(true);
  });

  it("does not claim type7-linear: nearest-rank quantile stays an open extension", () => {
    // B 的分位阈值是 nearest-rank，与 Type 7 线性插值不等价，不得冒充冻结值。
    expect(canonicalMethodString(ANALYSIS_METHOD.anomalyQuantile)).toBe("quantile-threshold");
    expect(canonicalMethodString("quantile-threshold")).toBe("quantile-threshold");
    expect(canonicalMethodString("type7-linear")).toBe("type7-linear"); // 未实现，未知串原样
    expect(methodSupport("quantile-threshold")).toBe("open-extension");
    expect(methodSupport(ANALYSIS_METHOD.anomalyQuantile)).toBe("open-extension");
    expect(methodSupport("type7-linear")).toBe("unregistered");
    expect(isFrozenMethod("type7-linear")).toBe(false);
    expect(Object.values(FROZEN_METHODS) as string[]).not.toContain("type7-linear");
  });

  it("marks B-owned unregistered methods as open extensions (not supported)", () => {
    expect(OPEN_EXTENSION_METHODS.exactMean).toBe("exact-mean-v1");
    expect(OPEN_EXTENSION_METHODS.robustZScore).toBe("robust-z-score-v1");
    expect(OPEN_EXTENSION_METHODS.tukeyFence).toBe("tukey-fence-v1");
    expect(OPEN_EXTENSION_METHODS.absDeviationSigmaMultiple).toBe(
      "abs-deviation-gt-sigma-multiple-v1",
    );
    expect(methodSupport(ANALYSIS_METHOD.exactMean)).toBe("open-extension");
    expect(methodSupport(ANALYSIS_METHOD.anomalyMad)).toBe("frozen"); // 已映射冻结值
    expect(methodSupport(ANALYSIS_METHOD.anomalyQuantile)).toBe("open-extension");
    expect(Object.values(FROZEN_METHODS) as string[]).not.toContain(
      OPEN_EXTENSION_METHODS.exactMean,
    );
  });

  it("maps the anomaly methods to frozen/annotated descriptive strings", () => {
    expect(ANOMALY_METHOD_STRINGS.mad).toBe("mad-median");
    expect(ANOMALY_METHOD_STRINGS.iqr).toBe("iqr-quantile");
    expect(ANOMALY_METHOD_STRINGS["zero-dispersion-quantile"]).toBe("quantile-threshold");
    expect(anomalyMethodString("mad")).toBe("mad-median");
    expect(anomalyMethodString("iqr")).toBe("iqr-quantile");
    expect(anomalyMethodString("zero-dispersion-quantile")).toBe("quantile-threshold");
  });

  it("keeps unknown open strings untouched and returns no empty surprises", () => {
    expect(canonicalMethodString("histogram-nice-bin-width")).toBe("histogram-nice-bin-width");
    expect(canonicalMethodString("some-unknown-method")).toBe("some-unknown-method");
    expect(canonicalMethodString("")).toBe("");
    expect(methodSupport("histogram-nice-bin-width")).toBe("unregistered");
  });

  it("keeps FROZEN_METHOD_ALIASES as frozen outputs only", () => {
    expect(FROZEN_METHOD_ALIASES["population-stddev"]).toBe("population-stddev");
    expect(FROZEN_METHOD_ALIASES["sample-cv-fixedpoint"]).toBe("sample-cv-fixedpoint");
    expect(FROZEN_METHOD_ALIASES["mad-median"]).toBe("mad-median");
    expect(FROZEN_METHOD_ALIASES["iqr-quantile"]).toBe("iqr-quantile");
    expect(Object.values(FROZEN_METHOD_ALIASES) as string[]).not.toContain("population-standard-deviation-v1");
  });
});
