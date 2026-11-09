import type { Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";
import { emptyDetailFilters } from "../lib/detailFilters.js";
import { normalizeFilter, takeFilterParams } from "../lib/ledgerFilter.js";
import { matchesWorkbenchFilters } from "./filters.js";
import { ledgerFilterFromWorkbench, takeAnalysisParams, workbenchFromLedgerFilter } from "./ledgerFilterBridge.js";

const display = { currency: null, combined: true } as const;
const today = "2026-11-09";

function entry(patch: Partial<Transaction>): Transaction {
  return {
    id: "t1", kind: "expense", amountCents: 1200, currency: "CNY", categoryId: "c1", categoryName: "餐饮", categoryIsSystem: false,
    paymentMethodId: null, paymentMethodName: null, occurredAt: "2026-08-03T04:00:00.000Z", occurredLocalDate: "2026-08-03",
    occurredTz: "Asia/Shanghai", note: null, tags: [], version: 1, ...patch,
  };
}

describe("明细与分析共用筛选：换算（1.19.53）", () => {
  it("月份对应那个月，当月对应“本月”", () => {
    expect(workbenchFromLedgerFilter(emptyDetailFilters("2026-08"), display, today).filters.time).toEqual({ kind: "month", month: "2026-08" });
    expect(workbenchFromLedgerFilter(emptyDetailFilters("2026-11"), display, today).filters.time).toEqual({ kind: "this-month" });
  });

  it("全部时间与超过 400 天的范围按最近 400 天计算，并标明", () => {
    const all = workbenchFromLedgerFilter(emptyDetailFilters("all"), display, today);
    expect(all.capped).toBe(true);
    expect(all.filters.time).toEqual({ kind: "custom", from: "2025-10-06", to: today });
    const long = workbenchFromLedgerFilter({ ...emptyDetailFilters("all"), from: "2024-01-01", to: "2026-06-30" }, display, today);
    expect(long.capped).toBe(true);
    expect(long.filters.time).toEqual({ kind: "custom", from: "2025-05-27", to: "2026-06-30" });
    const short = workbenchFromLedgerFilter({ ...emptyDetailFilters("all"), from: "2026-07-01", to: "2026-08-31" }, display, today);
    expect(short.capped).toBe(false);
  });

  it("分类、支付方式（含未指定）、标签、币种与附件逐项生效", () => {
    const value = { ...emptyDetailFilters("2026-08"), payments: ["none"], currencies: ["CNY"], attachment: "has" };
    const { filters } = workbenchFromLedgerFilter(value, display, today);
    expect(matchesWorkbenchFilters(entry({ attachmentCount: 1 }), filters)).toBe(true);
    expect(matchesWorkbenchFilters(entry({ attachmentCount: 0 }), filters)).toBe(false);
    expect(matchesWorkbenchFilters(entry({ attachmentCount: 1, paymentMethodId: "p1" }), filters)).toBe(false);
    expect(matchesWorkbenchFilters(entry({ attachmentCount: 1, currency: "USD" }), filters)).toBe(false);
  });

  it("不选“未指定”时，没有支付方式的账目照旧不保留", () => {
    const { filters } = workbenchFromLedgerFilter({ ...emptyDetailFilters("2026-08"), payments: ["p1"] }, display, today);
    expect(matchesWorkbenchFilters(entry({ paymentMethodId: null }), filters)).toBe(false);
    expect(matchesWorkbenchFilters(entry({ paymentMethodId: "p1" }), filters)).toBe(true);
  });

  it("旧分析链接与布局预设：近 N 天变成具体日期，维度保留", () => {
    const back = ledgerFilterFromWorkbench({ time: { kind: "preset", preset: "7d" }, currency: null, combined: true, categoryIds: ["c1"], tagIds: ["t1"] }, today);
    expect(back.month).toBe("all");
    expect([back.from, back.to]).toEqual(["2026-11-03", today]);
    expect(back.categories).toEqual(["c1"]);
    expect(back.tags).toEqual(["t1"]);
    const taken = takeAnalysisParams(new URLSearchParams("month=2026-05&currency=USD&analysis=currency"), today);
    expect(taken?.value.month).toBe("2026-05");
    expect(taken?.rest.toString()).toBe("currency=USD&analysis=currency");
    expect(takeAnalysisParams(new URLSearchParams("currency=USD"), today)).toBeNull();
  });
});

describe("本机保存的筛选", () => {
  it("规范化：非法月份回到给定月份，非“全部”时去掉日期范围，未知字段丢弃", () => {
    expect(normalizeFilter({ month: "2026-13", from: "2026-01-01", extra: 1 }, "2026-11")).toEqual(emptyDetailFilters("2026-11"));
    expect(normalizeFilter({ month: "all", from: "2026-01-01", to: "2026-02-01", tags: ["a", ""] })).toMatchObject({ month: "all", from: "2026-01-01", to: "2026-02-01", tags: ["a"] });
    expect(normalizeFilter(null)).toBeNull();
  });

  it("地址栏带来的条件读入后移除，其它参数保留", () => {
    const { value, rest } = takeFilterParams(new URLSearchParams("month=2026-08&f.tags=a&book=b1"), emptyDetailFilters("2026-11"));
    expect(value.month).toBe("2026-08");
    expect(value.tags).toEqual(["a"]);
    expect(rest.toString()).toBe("book=b1");
  });
});
