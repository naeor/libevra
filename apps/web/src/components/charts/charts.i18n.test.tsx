import type { CategoryTotal, PeriodTotals, StatsSeriesPoint } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../i18n/index.js";
import { CalendarHeatmap } from "./CalendarHeatmap.js";
import { CategoryDonut } from "./CategoryDonut.js";
import { ComparisonPanel, YearOverview } from "./SummaryPanel.js";
import { TrendChart } from "./TrendChart.js";

/**
 * **分析页图表的两种语言（S16）。**
 *
 * 中文：句子与以前逐字相同（现有页面与截图都按它核对）。英文：整块输出里不能出现一个中文字——
 * 预置分类名经 `displayCategoryName` 显示成英文，用户自建的分类名是数据，原样显示。
 */
const CJK = /[㐀-鿿]/;

const TOTALS: PeriodTotals = {
  expenseMinor: 302_000,
  incomeMinor: 600_000,
  netMinor: 298_000,
  count: 42,
  largestExpenseMinor: 68_000,
};

const MONTHS: StatsSeriesPoint[] = Array.from({ length: 12 }, (_, index) => ({
  bucket: `2026-${String(index + 1).padStart(2, "0")}`,
  expenseMinor: 10_000 * (index + 1),
  incomeMinor: 200_000,
}));

const DAYS: StatsSeriesPoint[] = Array.from({ length: 30 }, (_, index) => ({
  bucket: `2026-10-${String(index + 1).padStart(2, "0")}`,
  expenseMinor: index % 3 === 0 ? 1_000 * (index + 1) : 0,
  incomeMinor: 0,
}));

/** 七个预置分类名（全是数据库里的中文原名）：超过六片，最后一片并进「其它 N 项」。 */
const PRESET_TOTALS: CategoryTotal[] = ["餐饮", "购物", "服务", "娱乐", "交通", "教育", "生活缴费"].map(
  (name, index) => ({ categoryId: String(index + 1), name, kind: "expense", minor: 10_000 * (7 - index), share: 0.1 }),
);

function renderAll(): string {
  return renderToStaticMarkup(
    <>
      <ComparisonPanel
        current={TOTALS}
        previous={{ ...TOTALS, expenseMinor: 268_000 }}
        monthToDate
        currentDays={9}
        previousDays={1}
        currency="CNY"
      />
      <ComparisonPanel current={TOTALS} previous={null} monthToDate={false} currentDays={30} previousDays={0} currency="CNY" />
      <YearOverview months={MONTHS} totals={TOTALS} currency="CNY" />
      <CalendarHeatmap days={DAYS} currency="CNY" hasEntries />
      <TrendChart points={MONTHS} currency="CNY" bucket="month" hasEntries />
      <TrendChart points={[]} currency="HKD" bucket="day" hasEntries={false} />
      <CategoryDonut totals={PRESET_TOTALS} currency="CNY" />
      <CategoryDonut totals={[]} currency="CNY" />
    </>,
  );
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("分析页图表（中文，默认）", () => {
  it("keeps the original Chinese sentences", () => {
    const html = renderAll();

    expect(html).toContain("对比为“上月同期”：本期 9 天，对比上期 1 天。本期尚未结束，与完整月份比较会失真。");
    expect(html).toContain("所选时段没有可对比的历史数据，因此不显示变化幅度。");
    expect(html).toContain("42 笔");
    expect(html).toContain("颜色表示“在本期内的相对高低”。");
    expect(html).toContain("人民币支出最多的一天是 2026-10-28，");
    expect(html).toContain("所选时段暂无收支记录。");
    expect(html).toContain("其它 1 项");
    expect(html).toContain("餐饮");
    expect(html).toContain(">一</span>");
  });
});

describe("分析页图表（英文）", () => {
  it("renders without a single Chinese character", () => {
    applyLocale("en-US");
    const html = renderAll();

    expect(html).not.toMatch(CJK);
    expect(html).toContain("Compared with the same days last month: 9 days this period, 1 day before.");
    expect(html).toContain("42 entries");
    expect(html).toContain("No income or spending recorded in this period.");
    expect(html).toContain("No spending recorded in this period.");
    // 预置分类名按当前语言显示；“其它 N 项”同样按语言生成。
    expect(html).toContain("Food &amp; drink");
    expect(html).toContain("1 other");
    expect(html).toContain(">Mo</span>");
    // 日期按英文习惯显示，不再是 YYYY-MM-DD。
    expect(html).toContain("Oct 28, 2026");
  });

  it("keeps a user-made category name exactly as stored", () => {
    applyLocale("en-US");
    const html = renderToStaticMarkup(
      <CategoryDonut
        totals={[
          { categoryId: "a", name: "猫粮", kind: "expense", minor: 3_000, share: 0.6 },
          { categoryId: "b", name: "餐饮", kind: "expense", minor: 2_000, share: 0.4 },
        ]}
        currency="CNY"
      />,
    );

    expect(html).toContain("猫粮");
    expect(html).toContain("Food &amp; drink");
  });
});
