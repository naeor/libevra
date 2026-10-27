import { describe, expect, it } from "vitest";

import {
  addRational,
  buildHistogram,
  coefficientOfVariation,
  compareMinorToRational,
  compareRational,
  divRational,
  floorDiv,
  histogramIsConserved,
  integerSqrt,
  iqrFences,
  iqrOf,
  makeRational,
  medianOf,
  mulRational,
  niceBinWidth,
  populationVariance,
  powerOfTen,
  quantileOfSorted,
  quantilesOf,
  rationalToDecimalText,
  roundRationalToMinor,
  sortMinorAscending,
  standardDeviationScaled,
  subRational,
  summariseDistribution,
  toNumberForDisplay,
} from "./index.js";

describe("rational（精确有理数）", () => {
  it("约分并把负号放在分子、分母保持为正", () => {
    expect(makeRational(6n, -8n)).toEqual({ numerator: -3n, denominator: 4n });
    expect(makeRational(0n, 5n)).toEqual({ numerator: 0n, denominator: 1n });
    expect(makeRational(-10n, 4n)).toEqual({ numerator: -5n, denominator: 2n });
  });

  it("四则运算结果均为最简分数", () => {
    const oneThird = makeRational(1n, 3n);
    const oneSixth = makeRational(1n, 6n);

    expect(addRational(oneThird, oneSixth)).toEqual({ numerator: 1n, denominator: 2n });
    expect(subRational(makeRational(5n, 4n), makeRational(1n, 4n))).toEqual({
      numerator: 1n,
      denominator: 1n,
    });
    expect(mulRational(makeRational(2n, 3n), makeRational(3n, 4n))).toEqual({
      numerator: 1n,
      denominator: 2n,
    });
    expect(divRational(makeRational(1n, 2n), makeRational(3n, 4n))).toEqual({
      numerator: 2n,
      denominator: 3n,
    });
  });

  it("分母为 0 或除以 0 时报错，不返回 Infinity", () => {
    expect(() => makeRational(1n, 0n)).toThrow(RangeError);
    expect(() => divRational(makeRational(1n, 2n), makeRational(0n, 1n))).toThrow(RangeError);
  });

  it("比较与舍入遵循 minor-half-away-v1", () => {
    expect(compareRational(makeRational(-1n, 2n), makeRational(1n, 2n))).toBe(-1);
    expect(roundRationalToMinor(makeRational(5n, 2n))).toBe(3n);
    expect(roundRationalToMinor(makeRational(-5n, 2n))).toBe(-3n);
    expect(roundRationalToMinor(makeRational(7n, 3n))).toBe(2n);
    expect(roundRationalToMinor(makeRational(8n, 3n))).toBe(3n);
  });

  it("十进制文本按固定小数位输出（只用于展示）", () => {
    expect(rationalToDecimalText(makeRational(1n, 3n), 6)).toBe("0.333333");
    expect(rationalToDecimalText(makeRational(2n, 3n), 6)).toBe("0.666667");
    expect(rationalToDecimalText(makeRational(-5n, 2n), 2)).toBe("-2.50");
    expect(rationalToDecimalText(makeRational(7n, 1n), 0)).toBe("7");
    expect(powerOfTen(3)).toBe(1000n);
    expect(toNumberForDisplay(makeRational(1n, 4n))).toBe(0.25);
  });
});

describe("quantiles（Type 7 分位）", () => {
  it("Type 7 在 p=0.5 与 A 的中位数口径一致", () => {
    const sorted = sortMinorAscending([400n, 100n, 300n, 200n]);
    expect(sorted).toEqual([100n, 200n, 300n, 400n]);
    expect(quantileOfSorted(sorted, makeRational(1n, 2n))).toEqual({ numerator: 250n, denominator: 1n });
    expect(medianOf([400n, 100n, 300n, 200n])).toEqual({ numerator: 250n, denominator: 1n });
    expect(medianOf([1n, 2n, 3n])).toEqual({ numerator: 2n, denominator: 1n });
  });

  it("分位点位置正确：p25/p10/p0/p100", () => {
    const sorted = [100n, 200n, 300n, 400n];

    expect(quantileOfSorted(sorted, makeRational(1n, 4n))).toEqual({ numerator: 175n, denominator: 1n });
    expect(quantileOfSorted(sorted, makeRational(1n, 10n))).toEqual({
      numerator: 130n,
      denominator: 1n,
    });
    expect(quantileOfSorted(sorted, makeRational(0n, 1n))).toEqual({
      numerator: 100n,
      denominator: 1n,
    });
    expect(quantileOfSorted(sorted, makeRational(1n, 1n))).toEqual({
      numerator: 400n,
      denominator: 1n,
    });
  });

  it("单样本返回自身，空样本返回 null，未排序输入报错", () => {
    expect(quantileOfSorted([42n], makeRational(1n, 2n))).toEqual({ numerator: 42n, denominator: 1n });
    expect(quantileOfSorted([], makeRational(1n, 2n))).toBeNull();
    expect(() => quantileOfSorted([2n, 1n], makeRational(1n, 2n))).toThrow(RangeError);
    expect(() => quantilesOf([], [makeRational(1n, 2n)])).toThrow(RangeError);
  });

  it("四分位距 IQR", () => {
    expect(iqrOf([1n, 2n, 3n, 4n, 5n])).toEqual({ numerator: 2n, denominator: 1n });
    expect(iqrOf([])).toBeNull();
  });
});

describe("distribution（总体方差 / 直方图 / 围栏）", () => {
  it("描述性总体方差使用 n 作为分母", () => {
    expect(populationVariance([1n, 2n, 3n, 4n])).toEqual({ numerator: 5n, denominator: 4n });
    expect(populationVariance([5n, 5n, 5n])).toEqual({ numerator: 0n, denominator: 1n });
    expect(populationVariance([])).toBeNull();
  });

  it("标准差为定点小数；整数开方与向下取整正确", () => {
    const variance = populationVariance([3n, 4n]);
    expect(variance).toEqual({ numerator: 1n, denominator: 4n });
    expect(standardDeviationScaled(variance, 6)).toEqual({ scaled: 500000n, decimals: 6 });
    expect(integerSqrt(16n)).toBe(4n);
    expect(integerSqrt(17n)).toBe(4n);
    expect(integerSqrt(0n)).toBe(0n);
    expect(integerSqrt(10n ** 24n)).toBe(10n ** 12n);
  });

  it("变异系数 = 标准差 / 均值；均值为 0 时不可计算", () => {
    expect(
      coefficientOfVariation(makeRational(7n, 2n), populationVariance([3n, 4n]), 6),
    ).toEqual({ numerator: 1n, denominator: 7n });
    expect(coefficientOfVariation(makeRational(0n, 1n), makeRational(1n, 4n), 6)).toBeNull();
  });

  it("直方图分箱守恒，末箱含上界，0 金额单列", () => {
    const histogram = buildHistogram([1n, 3n, 5n, 7n, 9n, 2n, 4n, 6n, 8n, 10n], {
      targetBins: 4,
    });

    expect(histogram.binWidthMinor).toBe(5n);
    expect(histogram.sampleCount).toBe(10);
    expect(histogram.zeroCount).toBe(0);
    expect(histogram.minMinor).toBe(1n);
    expect(histogram.maxMinor).toBe(10n);
    expect(histogramIsConserved(histogram)).toBe(true);
    expect(histogram.bins.map((bin) => bin.count)).toEqual([4, 5, 1]);
    expect(histogram.bins[2]?.lowerMinor).toBe(10n);
    expect(histogram.bins[2]?.upperMinor).toBe(15n);
    expect(histogram.bins[2]?.isLast).toBe(true);
  });

  it("全等金额与 0 金额边界", () => {
    const allEqual = buildHistogram([7n, 7n, 7n]);
    expect(allEqual.bins).toHaveLength(1);
    expect(allEqual.bins[0]?.count).toBe(3);
    expect(allEqual.zeroCount).toBe(0);

    const withZero = buildHistogram([0n, 1n, 2n]);
    expect(withZero.zeroCount).toBe(1);
    expect(withZero.bins.map((bin) => bin.count)).toEqual([1, 1, 1]);
    expect(histogramIsConserved(withZero)).toBe(true);
  });

  it("空样本不得伪造直方图", () => {
    expect(() => buildHistogram([])).toThrow(RangeError);
  });

  it("1.5×IQR 围栏与异常值", () => {
    const clean = iqrFences([1n, 2n, 3n, 4n]);
    expect(clean.iqr).toEqual({ numerator: 3n, denominator: 2n });
    expect(clean.outliers).toEqual([]);
    expect(clean.withinCount).toBe(4);

    const withOutlier = iqrFences([1n, 2n, 3n, 4n, 100n]);
    expect(withOutlier.outliers).toEqual([100n]);
    expect(withOutlier.withinCount).toBe(4);
  });

  it("一次性摘要：分位/方差/直方图/空样本完整性", () => {
    const summary = summariseDistribution([1n, 2n, 3n, 4n]);
    expect(summary.sampleCount).toBe(4);
    expect(summary.completeness).toBe("complete");
    expect(summary.minMinor).toBe(1n);
    expect(summary.maxMinor).toBe(4n);
    expect(summary.sumMinor).toBe(10n);
    expect(summary.mean).toEqual({ numerator: 5n, denominator: 2n });
    expect(summary.standardDeviation).toEqual({ scaled: 1118033n, decimals: 6 });
    expect(summary.histogram?.sampleCount).toBe(4);

    const empty = summariseDistribution([]);
    expect(empty.completeness).toBe("no-transactions");
    expect(empty.sampleCount).toBe(0);
    expect(empty.mean).toBeNull();
    expect(empty.median).toBeNull();
    expect(empty.histogram).toBeNull();
    expect(empty.sumMinor).toBe(0n);
  });

  it("工具函数：floorDiv / niceBinWidth / compareMinorToRational", () => {
    expect(floorDiv(-1n, 5n)).toBe(-1n);
    expect(floorDiv(10n, 5n)).toBe(2n);
    expect(floorDiv(-10n, 5n)).toBe(-2n);
    expect(niceBinWidth(9n, 4)).toBe(5n);
    expect(niceBinWidth(0n)).toBe(1n);
    expect(compareMinorToRational(5n, makeRational(1n, 2n))).toBe(1);
    expect(compareMinorToRational(0n, makeRational(0n, 1n))).toBe(0);
  });
});
