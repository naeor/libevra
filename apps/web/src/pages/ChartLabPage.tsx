import type { CategoryTotal, PeriodTotals, StatsSeriesPoint } from "@libellum/shared";
import { useState } from "react";

import { CalendarHeatmap } from "../components/charts/CalendarHeatmap.js";
import { CategoryDonut } from "../components/charts/CategoryDonut.js";
import { ComparisonPanel, YearOverview } from "../components/charts/SummaryPanel.js";
import { TrendChart } from "../components/charts/TrendChart.js";
import { EntrySaved } from "../components/EntrySaved.js";
import { DefaultAvatar } from "../components/DefaultAvatar.js";
import { useI18n } from "../i18n/index.js";

/**
 * A development harness — **not a shipped feature**.
 *
 * The route exists only under `import.meta.env.DEV`, so it is removed from a
 * production build. It renders the **real chart components** against data
 * chosen to be awkward on purpose: a month with one enormous day, days with
 * nothing at all, an all-zero period, a single category, a period with no
 * comparison. Those are the inputs that break charts, and they are far cheaper
 * to look at here than to discover on a phone.
 *
 * No session is needed: every number below is a constant.
 */

const CURRENCY = "CNY";

function monthSeries(values: readonly number[], year = "2026"): StatsSeriesPoint[] {
  return values.map((expenseMinor, index) => ({
    bucket: `${year}-${String(index + 1).padStart(2, "0")}`,
    expenseMinor,
    incomeMinor: 200_000,
  }));
}

/** One enormous day among ordinary ones — the case the heat scale exists for. */
const SPIKY_MONTH = [
  0, 1_200, 0, 800, 4_500, 0, 0, 3_000, 0, 1_500, 0, 2_200, 0, 0, 900, 1_800, 0, 0, 12_000, 0,
  700, 2_600, 0, 1_100, 0, 0, 3_300, 0, 1_400, 0,
];

const SPIKY_DAYS: StatsSeriesPoint[] = SPIKY_MONTH.map((expenseMinor, index) => ({
  bucket: `2026-10-${String(index + 1).padStart(2, "0")}`,
  expenseMinor,
  incomeMinor: 0,
}));

const MONTHS = monthSeries([82_000, 124_000, 66_000, 198_000, 91_000, 105_000, 143_000, 78_000, 112_000, 96_000, 131_000, 89_000]);

/** 样例数据，模拟服务器返回的分类原名（预置名在英文界面会经 `displayCategoryName` 显示成英文）。 */
const CATEGORIES: CategoryTotal[] = [
  { categoryId: "1", name: "餐饮", kind: "expense", minor: 124_000, share: 0.41 }, // i18n-ignore：样例数据（分类原名）
  { categoryId: "2", name: "购物", kind: "expense", minor: 86_000, share: 0.28 }, // i18n-ignore：样例数据（分类原名）
  { categoryId: "3", name: "服务", kind: "expense", minor: 42_000, share: 0.14 }, // i18n-ignore：样例数据（分类原名）
  { categoryId: "4", name: "娱乐", kind: "expense", minor: 31_000, share: 0.1 }, // i18n-ignore：样例数据（分类原名）
  { categoryId: "5", name: "其它", kind: "expense", minor: 19_000, share: 0.07 }, // i18n-ignore：样例数据（用户自建分类名）
];

const TOTALS: PeriodTotals = {
  expenseMinor: 302_000,
  incomeMinor: 600_000,
  netMinor: 298_000,
  count: 42,
  largestExpenseMinor: 68_000,
};

const EMPTY_TOTALS: PeriodTotals = {
  expenseMinor: 0,
  incomeMinor: 0,
  netMinor: 0,
  count: 0,
  largestExpenseMinor: 0,
};

export function ChartLabPage(): React.JSX.Element {
  const { t } = useI18n();
  const [range, setRange] = useState<"7d" | "month">("month");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-8 px-4 py-8">
      <header>
        <h1 className="text-xl font-semibold text-ink">{t("stats.lab.title")}</h1>
        <p className="mt-1.5 text-body-relaxed text-muted">
          {t("stats.lab.intro")}
        </p>
      </header>

      <Section title={t("stats.lab.meHeader")}>
        <div className="-m-4 overflow-hidden rounded-card">
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 bg-brand px-6 py-10 text-on-brand">
            <DefaultAvatar />
            <p className="mt-1 text-page-title">Tao</p>
            <p className="text-xs text-on-brand/75">@naeor</p>
          </div>
        </div>
      </Section>

      <Section title={t("stats.lab.entrySaved")}>
        {/*
          Both shapes, because they differ in a way a screenshot has to show:
          the last entry of a batch offers a way home, and one part-way through
          a batch does not — going home there would abandon the screenshots
          still waiting. This page exists to make that difference visible
          without having to photograph three receipts to see it.
        */}
        <div className="-m-4 overflow-hidden rounded-card">
          <EntrySaved
            entry={{
              id: "preview",
              kind: "expense",
              amountCents: 2000,
              currency: "CNY",
              categoryId: "c1",
              categoryName: "餐饮", // i18n-ignore：样例数据（分类原名）
              categoryIsSystem: false,
              paymentMethodId: "p1",
              paymentMethodName: "微信", // i18n-ignore：样例数据（支付方式原名）
              occurredAt: "2026-10-09T04:00:00.000Z",
              occurredLocalDate: "2026-10-09",
              occurredTz: "Asia/Shanghai",
              note: null,
              tags: [],
              version: 1,
            }}
            categoryName="餐饮" // i18n-ignore：样例数据（分类原名）
            paymentName="微信" // i18n-ignore：样例数据（支付方式原名）
            remaining={0}
            onHome={() => undefined}
            onAgain={() => undefined}
          />
        </div>
      </Section>

      <Section title={t("stats.lab.entrySavedBatch")}>
        <div className="-m-4 overflow-hidden rounded-card">
          <EntrySaved
            entry={{
              id: "preview-batch",
              kind: "expense",
              amountCents: 3850,
              currency: "CNY",
              categoryId: "c1",
              categoryName: "餐饮", // i18n-ignore：样例数据（分类原名）
              categoryIsSystem: false,
              paymentMethodId: "p1",
              paymentMethodName: "微信", // i18n-ignore：样例数据（支付方式原名）
              occurredAt: "2026-10-09T04:00:00.000Z",
              occurredLocalDate: "2026-10-09",
              occurredTz: "Asia/Shanghai",
              note: null,
              tags: [],
              version: 1,
            }}
            categoryName="餐饮" // i18n-ignore：样例数据（分类原名）
            paymentName="微信" // i18n-ignore：样例数据（支付方式原名）
            remaining={2}
            onHome={() => undefined}
            onAgain={() => undefined}
          />
        </div>
      </Section>

      <Section title={t("stats.lab.trend")}>
        <TrendChart points={MONTHS} currency={CURRENCY} bucket="month" hasEntries />
      </Section>

      <Section title={t("stats.lab.donut")}>
        <CategoryDonut totals={CATEGORIES} currency={CURRENCY} />
      </Section>

      <Section title={t("stats.lab.comparisonMonthToDate")}>
        <ComparisonPanel
          current={TOTALS}
          previous={{ ...TOTALS, expenseMinor: 268_000 }}
          monthToDate
          currentDays={9}
          previousDays={9}
          currency={CURRENCY}
        />
      </Section>

      <Section title={t("stats.lab.comparisonNone")}>
        <ComparisonPanel
          current={TOTALS}
          previous={null}
          monthToDate={false}
          currentDays={30}
          previousDays={0}
          currency={CURRENCY}
        />
      </Section>

      <Section title={t("stats.lab.year")}>
        <YearOverview months={MONTHS} totals={TOTALS} currency={CURRENCY} />
      </Section>

      <Section title={t("stats.lab.heatmap")}>
        <div className="mb-3 flex gap-2">
          {(["7d", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setRange(option);
              }}
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                range === option ? "bg-brand text-on-brand" : "bg-canvas text-muted"
              }`}
            >
              {option === "7d" ? t("stats.range.7d") : t("stats.thisMonth")}
            </button>
          ))}
        </div>
        <CalendarHeatmap
          days={range === "7d" ? SPIKY_DAYS.slice(-7) : SPIKY_DAYS}
          currency={CURRENCY}
          hasEntries
        />
      </Section>

      <Section title={t("stats.lab.edgeCases")}>
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.noData")}</p>
            <TrendChart points={[]} currency={CURRENCY} bucket="day" hasEntries={false} />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">
              {t("stats.lab.gapFilled")}
            </p>
            <TrendChart
              points={Array.from({ length: 7 }, (_, index) => ({
                bucket: `2026-10-0${String(index + 1)}`,
                expenseMinor: 0,
                incomeMinor: 0,
              }))}
              currency="HKD"
              bucket="day"
              hasEntries={false}
            />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.allZero")}</p>
            <TrendChart
              points={[{ bucket: "2026-10-01", expenseMinor: 0, incomeMinor: 0 }]}
              currency={CURRENCY}
              bucket="day"
              hasEntries
            />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.singleCategory")}</p>
            <CategoryDonut
              totals={[{ categoryId: "1", name: "餐饮", kind: "expense", minor: 5_000, share: 1 }]} // i18n-ignore：样例数据（分类原名）
              currency={CURRENCY}
            />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.yearAllZero")}</p>
            <YearOverview
              months={monthSeries(Array.from({ length: 12 }, () => 0))}
              totals={EMPTY_TOTALS}
              currency={CURRENCY}
            />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.yearNegative")}</p>
            <YearOverview
              months={monthSeries([120_000, 300_000, 480_000, 90_000, 210_000, 260_000, 150_000, 88_000, 300_000, 190_000, 240_000, 420_000])}
              totals={{ ...TOTALS, incomeMinor: 100_000, netMinor: -202_000 }}
              currency={CURRENCY}
            />
          </div>
          <div>
            <p className="mb-2 text-helper text-ink">{t("stats.lab.yen")}</p>
            <TrendChart
              points={[
                { bucket: "2026-08", expenseMinor: 12_000, incomeMinor: 30_000 },
                { bucket: "2026-09", expenseMinor: 48_000, incomeMinor: 30_000 },
                { bucket: "2026-10", expenseMinor: 26_000, incomeMinor: 30_000 },
              ]}
              currency="JPY"
              bucket="month"
              hasEntries
            />
          </div>
        </div>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <div className="rounded-card border border-line bg-surface p-4">{children}</div>
    </section>
  );
}
