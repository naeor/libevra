/**
 * H-1 `dominantBins`（`s01-v2` v2.0.4 additive，A §17）实现测试。
 *
 * 覆盖：单峰唯一主桶 / 双峰并列 / 全桶并列且 >8 截断 / 全同值 / 0 值样本参与 /
 * 空样本（无字段、抛 RangeError）/ wire 序列化（十进制字符串、与父桶一致）/
 * 跨尺寸一致性（同一输入重算逐值相同，适配层无需重算）。
 */
import { describe, expect, it } from "vitest";

import {
  HISTOGRAM_DOMINANT_MAX_BINS,
  buildHistogram,
  histogramIsConserved,
  summariseDistribution,
} from "./distribution.js";

/** wire 形态（A §17.1/§17.8）：金额十进制字符串、完整桶对象、不含 isLast。 */
interface DominantHistogramBinWire {
  readonly index: number;
  readonly lowerMinor: string;
  readonly upperMinor: string;
  readonly count: number;
}

function toWire(histogram: ReturnType<typeof buildHistogram>): readonly DominantHistogramBinWire[] {
  return histogram.dominantBins.map((bin) => ({
    index: bin.index,
    lowerMinor: bin.lowerMinor.toString(),
    upperMinor: bin.upperMinor.toString(),
    count: bin.count,
  }));
}

describe("H-1 dominantBins（v2.0.4 additive）", () => {
  it("单峰：唯一主桶，dominantBinCount=1", () => {
    const histogram = buildHistogram([1n, 2n, 3n, 10n, 10n, 10n]);

    expect(histogram.dominantBinCount).toBe(1);
    expect(histogram.dominantBins).toHaveLength(1);
    expect(histogram.dominantBins[0]?.count).toBe(3);
    expect(histogram.dominantBins[0]?.index).toBe(
      histogram.bins.findIndex((bin) => bin.count === 3),
    );
    expect(histogramIsConserved(histogram)).toBe(true);
  });

  it("双峰并列：全部返回、按 index 升序", () => {
    const histogram = buildHistogram([1n, 2n, 11n, 12n], { targetBins: 2 });

    expect(histogram.bins).toHaveLength(2);
    expect(histogram.dominantBinCount).toBe(2);
    expect(histogram.dominantBins.map((bin) => bin.index)).toEqual([0, 1]);
    expect(histogram.dominantBins.map((bin) => bin.count)).toEqual([2, 2]);
    expect(histogramIsConserved(histogram)).toBe(true);
  });

  it("全桶并列且超过上限：按 index 升序截断，dominantBinCount 保留真实总数", () => {
    const histogram = buildHistogram([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);

    expect(histogram.bins).toHaveLength(10);
    expect(histogram.dominantBinCount).toBe(10);
    expect(histogram.dominantBins).toHaveLength(HISTOGRAM_DOMINANT_MAX_BINS);
    expect(histogram.dominantBins.map((bin) => bin.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(histogramIsConserved(histogram)).toBe(true);
  });

  it("全同值：单桶即主桶", () => {
    const histogram = buildHistogram([7n, 7n, 7n]);

    expect(histogram.bins).toHaveLength(1);
    expect(histogram.dominantBinCount).toBe(1);
    expect(histogram.dominantBins[0]).toMatchObject({ index: 0, count: 3 });
  });

  it("0 值样本照常参与判定（zeroCount 不排除所属桶）", () => {
    const histogram = buildHistogram([0n, 0n, 5n], { targetBins: 2 });

    expect(histogram.zeroCount).toBe(2);
    expect(histogram.dominantBinCount).toBe(1);
    expect(histogram.dominantBins[0]?.count).toBe(2);
    expect(histogramIsConserved(histogram)).toBe(true);
  });

  it("空样本：抛 RangeError；summariseDistribution 的 histogram 为 null（两字段不出现）", () => {
    expect(() => buildHistogram([])).toThrow(RangeError);

    const summary = summariseDistribution([]);
    expect(summary.histogram).toBeNull();
    expect(summary.completeness).toBe("no-transactions");
    // histogram === null 时不存在 dominantBins/dominantBinCount 字段（不是 []/0）。
    expect(summary.histogram === null || !("dominantBins" in summary.histogram)).toBe(true);
  });

  it("wire 序列化：金额为十进制字符串且与父桶逐值一致", () => {
    const histogram = buildHistogram([1n, 2n, 3n, 10n, 10n, 10n]);
    const wire = toWire(histogram);

    expect(wire).toHaveLength(1);
    for (const item of wire) {
      const parent = histogram.bins[item.index];
      expect(parent).toBeDefined();
      expect(typeof item.lowerMinor).toBe("string");
      expect(typeof item.upperMinor).toBe("string");
      expect(item.lowerMinor).toBe(parent?.lowerMinor.toString());
      expect(item.upperMinor).toBe(parent?.upperMinor.toString());
      expect(item.count).toBe(parent?.count);
      expect("isLast" in item).toBe(false);
    }
  });

  it("跨尺寸一致性：同一输入重算逐值相同（适配层无需重算）", () => {
    const values = [3n, 1n, 4n, 1n, 5n, 9n, 2n, 6n];
    const first = buildHistogram(values);
    const second = buildHistogram([...values].reverse());

    expect(second.dominantBins).toEqual(first.dominantBins);
    expect(second.dominantBinCount).toBe(first.dominantBinCount);
    expect(second.bins).toEqual(first.bins);
    expect(histogramIsConserved(second)).toBe(true);
  });
});
