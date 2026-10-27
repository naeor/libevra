import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { addDays, aggregateFx, fxRangeMonths, type FxEntry, type FxLookup } from "@libellum/shared";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { FilterPanel } from "./FilterPanel.js";
import { FxStatus } from "./FxStatus.js";
import { customRangeProblem, filterUrlProblem, readFilters, resolveRange, writeFilters, type WorkbenchFilters } from "./filters.js";
import type { FxRangeView } from "./scope.js";

const defaults = readFilters(new URLSearchParams());
function panel(draft: WorkbenchFilters = defaults, options: { fxAvailable?: boolean; defaultCurrency?: "CNY" | "USD" } = {}): string {
  const currency = options.defaultCurrency ?? "CNY";
  return renderToStaticMarkup(<FilterPanel id="filters" draft={draft} effective={defaults} today="2026-10-27" fxAvailable={options.fxAvailable ?? true} fxTarget={currency} defaultCurrency={currency} currenciesInLedger={["USD", "HKD"]} onDraft={() => {}} onApply={() => {}} onRevert={() => {}} onCollapse={() => {}} />);
}
afterEach(() => applyLocale("zh-CN"));

describe("第二阶段新增：时间与币种选择", () => {
  it("时间仅五项且自定义最先，没有独立月份或本月上月入口", () => {
    applyLocale("zh-CN");
    const html = panel();
    const time = html.split('aria-label="时间"')[1]?.split("</fieldset>")[0] ?? "";
    expect(time.match(/aria-pressed=/g)).toHaveLength(5);
    expect(time.indexOf("自定义")).toBeLessThan(time.indexOf("近 7 天"));
    expect(time.indexOf("近 7 天")).toBeLessThan(time.indexOf("近 30 天"));
    expect(time.indexOf("近 30 天")).toBeLessThan(time.indexOf("近 90 天"));
    expect(time.indexOf("近 90 天")).toBeLessThan(time.indexOf("近一年"));
    expect(html).not.toContain('type="month"');
    expect(html).not.toContain("选择月份");
    expect(html).not.toContain('type="date"');
    expect(time).toContain("自定义");
  });

  it("仅自定义展开两个日期控件；超400天明确提示且不能应用", () => {
    applyLocale("zh-CN");
    const custom = { ...defaults, time: { kind: "custom" as const, from: "2024-01-01", to: "2026-10-27" } };
    const html = panel(custom);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).toContain("开始日期");
    expect(html).toContain("截止日期");
    expect(html).toContain("时间范围最长 400 天");
    expect(html).toMatch(/disabled="">应用/);
    expect(customRangeProblem("2025-01-01", addDays("2025-01-01", 399))).toBeNull();
    expect(customRangeProblem("2025-01-01", addDays("2025-01-01", 400))).toBe("too-long");
  });

  it("旧月份链接继续使用完整日历月，但筛选统一为自定义日期", () => {
    const filters = readFilters(new URLSearchParams("month=2028-02"));
    expect(resolveRange(filters.time, "2028-05-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    const html = panel(filters);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).toContain('value="2028-02-29"');
    expect(html).not.toContain('type="month"');
  });

  it("400天可能跨15个自然月，补读枚举包含首尾月份而不截断", () => {
    expect(customRangeProblem("2025-01-31", "2026-03-06")).toBeNull();
    const months = fxRangeMonths("2025-01-31", "2026-03-06");
    expect(months).toHaveLength(15);
    expect(months[0]).toBe("2025-01");
    expect(months[14]).toBe("2026-03");
  });

  it("综合与原币同栏且可区分，默认币种改变时综合目标跟随", () => {
    applyLocale("zh-CN");
    const combined = panel();
    expect(combined).toContain('aria-pressed="true" class="sw-chip sw-chip-on">综合折算（CNY）');
    expect(combined).toContain('aria-pressed="false" class="sw-chip ">人民币');
    expect(panel(defaults, { defaultCurrency: "USD" })).toContain("综合折算（USD）");
    const original = panel({ ...defaults, combined: false });
    expect(original).toContain('aria-pressed="false" class="sw-chip ">综合折算（CNY）');
    expect(original).toContain('aria-pressed="true" class="sw-chip sw-chip-on">人民币');
    expect(panel(defaults, { fxAvailable: false })).not.toContain("综合折算（");
  });

  it("中英文入口与筛选状态可在URL往返，非法自定义URL可被明确识别", () => {
    applyLocale("en-US");
    expect(panel()).toContain("Converted (CNY)");
    const original = { ...defaults, currency: "USD" as const, combined: false };
    expect(readFilters(writeFilters(new URLSearchParams("keep=1"), original))).toEqual(original);
    const params = new URLSearchParams("range=custom&from=2000-01-01&to=2026-10-27&month=2026-09");
    expect(filterUrlProblem(params)).toBe("too-long");
    expect(readFilters(params).time).toEqual(defaults.time);
  });
});

describe("第二阶段新增：综合小计与缺汇率定位", () => {
  it("混币缺汇率保留可定位的日期与币种，失败原件未计零也未修改", () => {
    applyLocale("zh-CN");
    const rows: FxEntry[] = [
      { id: "cny", bookId: "b", amountCents: 100, currency: "CNY", occurredLocalDate: "2026-10-23", kind: "expense", categoryId: "c" },
      { id: "usd", bookId: "b", amountCents: 100, currency: "USD", occurredLocalDate: "2026-10-23", kind: "expense", categoryId: "c" },
      { id: "old-missing", bookId: "b", amountCents: 500, currency: "HKD", occurredLocalDate: "2025-10-01", kind: "expense", categoryId: "c" },
    ];
    const before = structuredClone(rows);
    const lookup: FxLookup = { status: "available", cached: true, snapshot: { base: "EUR", date: "2026-10-23", provider: "fixture", revision: "r1", fetchedAt: "2026-10-23T12:00:00Z", rates: { EUR: "1", USD: "1.25", CNY: "10" } } };
    const result = aggregateFx("a", "b", rows, "CNY", new Map([["2026-10-23", lookup]]));
    expect(result.complete).toBe(false);
    expect(result.totals.expenseMinor).toBe("900");
    expect(result.missingCount).toBe(1);
    expect(result.originalByCurrency["HKD"]?.expenseMinor).toBe("500");
    expect(rows).toEqual(before);
    const fx = { target: "CNY", result, sourceComplete: true, refresh: () => {} } as unknown as FxRangeView;
    const html = renderToStaticMarkup(<MemoryRouter><FxStatus fx={fx} /></MemoryRouter>);
    expect(html).toContain("统计不完整");
    expect(html).toContain("小计");
    expect(html).toContain("2025-10-01 · HKD");
    expect(html).toContain('href="/transactions/old-missing"');
    expect(() => aggregateFx("a", "other-book", rows, "CNY", new Map())).toThrow("fx_scope_mismatch");
    const usd = aggregateFx("a", "b", rows.slice(0, 2), "USD", new Map([["2026-10-23", lookup]]));
    expect(usd.totals.expenseMinor).toBe("113");
  });
});
