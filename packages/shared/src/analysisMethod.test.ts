import { describe, expect, it } from "vitest";
import {
  ANALYSIS_METHOD,
  ANOMALY_METHOD_STRINGS,
  FROZEN_METHOD_ALIASES,
  anomalyMethodString,
  canonicalMethodString,
} from "./analysisMethod.js";

describe("s01-v2 frozen method strings", () => {
  it("uses the literal canonical strings (no reformatting)", () => {
    expect(ANALYSIS_METHOD.exactMean).toBe("exact-mean-v1");
    expect(ANALYSIS_METHOD.populationStandardDeviation).toBe("population-standard-deviation-v1");
    expect(ANALYSIS_METHOD.coefficientOfVariation).toBe("coefficient-of-variation-v1");
    expect(ANALYSIS_METHOD.anomalyMad).toBe("robust-z-score-v1");
    expect(ANALYSIS_METHOD.anomalyIqr).toBe("tukey-fence-v1");
    expect(ANALYSIS_METHOD.anomalyQuantile).toBe("percentile-threshold-v1");
    expect(ANALYSIS_METHOD.extremeThreshold).toBe("abs-deviation-gt-sigma-multiple-v1");
  });

  it("maps the anomaly methods to their frozen descriptive strings", () => {
    expect(ANOMALY_METHOD_STRINGS.mad).toBe("mad-median");
    expect(ANOMALY_METHOD_STRINGS.iqr).toBe("iqr-quantile");
    expect(ANOMALY_METHOD_STRINGS["zero-dispersion-quantile"]).toBe("quantile-threshold");
    expect(anomalyMethodString("mad")).toBe("mad-median");
    expect(anomalyMethodString("iqr")).toBe("iqr-quantile");
    expect(anomalyMethodString("zero-dispersion-quantile")).toBe("quantile-threshold");
  });

  it("keeps canonical strings byte-identical and leaves unknown open strings untouched", () => {
    for (const canonical of Object.values(ANALYSIS_METHOD)) {
      expect(canonicalMethodString(canonical)).toBe(canonical);
    }
    expect(canonicalMethodString("histogram-nice-bin-width")).toBe("histogram-nice-bin-width");
    expect(canonicalMethodString("some-unknown-method")).toBe("some-unknown-method");
    expect(canonicalMethodString("")).toBe("");
  });

  it("parses every frozen legacy alias into the B canonical string", () => {
    expect(canonicalMethodString("population-stddev")).toBe(
      "population-standard-deviation-v1",
    );
    expect(canonicalMethodString("sample-cv-fixedpoint")).toBe("coefficient-of-variation-v1");
    expect(canonicalMethodString("mad-median")).toBe("robust-z-score-v1");
    expect(canonicalMethodString("iqr-quantile")).toBe("tukey-fence-v1");
    expect(canonicalMethodString("percentile-threshold")).toBe("percentile-threshold-v1");
    // 别名只用于入参/展示解析，不得反向暴露为新规范名。
    expect(Object.values(FROZEN_METHOD_ALIASES)).not.toContain("mad-median");
  });
});
