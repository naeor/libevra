import { describe, expect, it } from "vitest";

import type { Transaction } from "@libellum/shared";

import {
  AnalysisRangeError,
  AnalyzeEntryError,
  MAX_ANALYSIS_DAYS,
  analysisSpan,
  assertSupportedGranularity,
  buildAnalysisInput,
  toTimeSeriesEntries,
  trailingWindow,
} from "./analysisData.js";

let nextId = 1;

/** Minimal well-formed transaction: only the fields the analysis layer reads. */
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `t-${String(nextId++).padStart(3, "0")}`,
    kind: "expense",
    amountCents: 1_000,
    currency: "CNY",
    categoryId: "category-1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: "2026-10-20T04:00:00.000Z",
    occurredLocalDate: "2026-10-20",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

describe("analysisSpan", () => {
  it("把闭区间业务日期转成半开区间", () => {
    expect(analysisSpan({ from: "2026-10-01", to: "2026-10-27" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-28",
    });
  });

  it("单日窗口是 [当天, 次日)", () => {
    expect(analysisSpan({ from: "2026-10-27", to: "2026-10-27" })).toEqual({
      start: "2026-10-27",
      end: "2026-10-28",
    });
  });

  it("恰好 400 天允许，401 天按上限拒绝（不截断）", () => {
    expect(() => analysisSpan({ from: "2025-09-23", to: "2026-10-27" })).not.toThrow();
    expect(() => analysisSpan({ from: "2025-09-22", to: "2026-10-27" })).toThrow(AnalysisRangeError);
    try {
      analysisSpan({ from: "2025-09-22", to: "2026-10-27" });
    } catch (error) {
      expect((error as AnalysisRangeError).code).toBe("analysis-range-too-long");
    }
  });

  it("开始晚于结束是非法区间", () => {
    expect(() => analysisSpan({ from: "2026-10-27", to: "2026-10-01" })).toThrow(AnalysisRangeError);
  });

  it("非法日期格式直接拒绝", () => {
    expect(() => analysisSpan({ from: "2026-02-30", to: "2026-10-01" })).toThrow();
    expect(() => analysisSpan({ from: "2026/10/01", to: "2026-10-01" })).toThrow();
  });

  it("maxDays 可由调用方覆盖（S-01 §17 参数化）", () => {
    expect(() => analysisSpan({ from: "2025-10-01", to: "2026-10-27" }, 500)).not.toThrow();
    expect(MAX_ANALYSIS_DAYS).toBe(400);
  });
});

describe("trailingWindow", () => {
  it("最近 30 天含今天", () => {
    expect(trailingWindow(30, "2026-10-27")).toEqual({ from: "2026-09-28", to: "2026-10-27" });
  });

  it("天数必须是正整数", () => {
    expect(() => trailingWindow(0, "2026-10-27")).toThrow(AnalysisRangeError);
    expect(() => trailingWindow(1.5, "2026-10-27")).toThrow(AnalysisRangeError);
  });
});

describe("toTimeSeriesEntries", () => {
  it("保留收入/支出与业务日期，金额取精确分", () => {
    const input = [
      entry({ kind: "expense", amountCents: 12_345, occurredLocalDate: "2026-10-01" }),
      entry({ kind: "income", amountCents: 500_000, occurredLocalDate: "2026-10-02" }),
    ];
    expect(toTimeSeriesEntries(input)).toEqual([
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 12_345 },
      { occurredLocalDate: "2026-10-02", kind: "income", amountMinor: 500_000 },
    ]);
  });

  it("已删除的账目不进入分析（不把删除的账目画回来）", () => {
    const input = [
      entry({ occurredLocalDate: "2026-10-01" }),
      entry({ occurredLocalDate: "2026-10-02", deletedAt: "2026-10-03T00:00:00.000Z" }),
    ];
    expect(toTimeSeriesEntries(input)).toHaveLength(1);
  });

  it("非法金额抛出可定位错误而不是猜测", () => {
    expect(() => toTimeSeriesEntries([entry({ amountCents: -1 })])).toThrow(AnalyzeEntryError);
    expect(() => toTimeSeriesEntries([entry({ amountCents: 1.5 })])).toThrow(AnalyzeEntryError);
  });

  it("空输入得到空数组", () => {
    expect(toTimeSeriesEntries([])).toEqual([]);
  });
});

describe("buildAnalysisInput", () => {
  it("给出区间、条目、未知覆盖与空 dataVersion（S0 事实）", () => {
    const input = buildAnalysisInput([entry({ occurredLocalDate: "2026-10-05" })], {
      from: "2026-10-01",
      to: "2026-10-27",
    });
    expect(input.span).toEqual({ start: "2026-10-01", end: "2026-10-28" });
    expect(input.entries).toHaveLength(1);
    expect(input.coverageEnd).toBeNull();
    expect(input.dataVersion).toBeNull();
  });
});

describe("assertSupportedGranularity", () => {
  it("接受 day/week/month，拒绝 year", () => {
    expect(() => assertSupportedGranularity("day")).not.toThrow();
    expect(() => assertSupportedGranularity("week")).not.toThrow();
    expect(() => assertSupportedGranularity("month")).not.toThrow();
    expect(() => assertSupportedGranularity("year")).toThrow(AnalysisRangeError);
  });
});
