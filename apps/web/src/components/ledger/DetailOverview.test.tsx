import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { DetailOverview } from "./DetailOverview.js";
import { DEFAULT_DETAIL_CARDS } from "../../lib/detailCards.js";
describe("明细收支展示", () => {
  const props = { config: DEFAULT_DETAIL_CARDS, summary: { currency: "CNY", expenseCents: 101, incomeCents: 200, balanceCents: 99, volumeCents: 301, expenseCount: 1, incomeCount: 1 }, currency: "CNY", label: "2026年11月", days: 2, fx: null, hidden: false, loading: false, onCurrencies() {} };
  it("收入支出分别呈现，日均按最小货币单位取整", () => {
    const html = renderToStaticMarkup(<DetailOverview {...props} />);
    for (const text of ["1.01", "2.00", "0.99", "0.51", "CNY"]) expect(html).toContain(text);
  });
  it("加载期间不把未知金额显示成零", () => {
    const html = renderToStaticMarkup(<DetailOverview {...props} summary={null} loading />);
    expect(html).not.toContain("0.00"); expect(html).toContain("—");
  });
  it("全部时间不擅自推算日均，明细态摘要不可聚焦", () => {
    const html = renderToStaticMarkup(<DetailOverview {...props} days={null} hidden />);
    expect(html).toContain("选择时间范围后显示"); expect(html).toContain('aria-hidden="true"'); expect(html).toContain('inert=""');
  });
});
