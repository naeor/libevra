import type { StatsSeriesPoint } from "@libellum/shared";
import { useMemo, useState } from "react";

import { bucketOf, bucketThresholds } from "../../lib/chart/scales.js";
import { heatColor } from "../../lib/chart/theme.js";
import { formatExactAmount } from "../../lib/chart/format.js";
import { chartNotice } from "../../lib/chart/guards.js";
import { formatLocalDate } from "../../lib/datetime.js";
import { currencyName, formatMoney } from "../../lib/format.js";
import { isChineseLocale, useI18n } from "../../i18n/index.js";

const LEVELS = 4;
const COLUMNS = 7;
/** 周一开头。显示名在 `stats.heatmap.weekdays.<id>`，渲染时按当前语言取（S16）。 */
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Which days were heavy, as a grid of squares.
 *
 * The colours are **quantiles of the days that had any spending**, not a
 * linear ramp from zero. With a linear ramp one expensive day makes every
 * ordinary day look the same pale shade and the grid stops saying anything;
 * quantiles are rank-based, so the buckets fill by construction and the
 * outlier simply becomes the darkest square. Log scaling was the other
 * candidate and does not solve it — it compresses the outlier without
 * separating the ordinary days from each other.
 *
 * The consequence is deliberate and stated in the caption: a colour means
 * "heavy for this period", not a fixed amount.
 */
export function CalendarHeatmap({
  days,
  currency,
  hasEntries,
}: {
  readonly days: readonly StatsSeriesPoint[];
  readonly currency: string;
  /** Whether any entry exists in this period — the series is gap-filled. */
  readonly hasEntries: boolean;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  /** 日期显示：中文界面保持 `YYYY-MM-DD` 原样（与以前一致），其它语言按当地习惯（`Oct 9, 2026`）。 */
  const showDate = (bucket: string): string => (isChineseLocale(locale) ? bucket : formatLocalDate(bucket));

  const thresholds = useMemo(
    () => bucketThresholds(days.map((day) => day.expenseMinor), LEVELS),
    [days],
  );

  const notice = chartNotice(
    hasEntries,
    days.map((day) => day.expenseMinor),
    "expense",
  );

  if (notice !== null) {
    return (
      <p className="rounded-field bg-canvas px-4 py-3 text-helper-relaxed text-muted">{notice}</p>
    );
  }

  const total = days.reduce((sum, day) => sum + day.expenseMinor, 0);
  const spentDays = days.filter((day) => day.expenseMinor > 0).length;
  const peak = days.reduce(
    (best, day) => (day.expenseMinor > best.expenseMinor ? day : best),
    days[0] ?? { bucket: "", expenseMinor: 0, incomeMinor: 0 },
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-center text-[10px] text-muted">
            {t(`stats.heatmap.weekdays.${day}`)}
          </span>
        ))}

        {/* Leading blanks so the first day sits under its weekday. */}
        {Array.from({ length: leadingBlanks(days[0]?.bucket ?? "") }, (_, index) => (
          <span key={`blank-${String(index)}`} />
        ))}

        {days.map((day) => {
          const level = bucketOf(day.expenseMinor, thresholds);
          const isSelected = selected === day.bucket;

          return (
            <button
              key={day.bucket}
              type="button"
              onClick={() => {
                setSelected(isSelected ? null : day.bucket);
              }}
              aria-label={t("stats.heatmap.dayLabel", {
                date: showDate(day.bucket),
                amount: formatExactAmount(day.expenseMinor, currency),
                currency,
              })}
              aria-pressed={isSelected}
              className={`flex aspect-square items-center justify-center rounded text-[10px] transition ${
                isSelected ? "ring-2 ring-ink ring-offset-1" : ""
              } ${level >= 3 ? "text-on-heat" : "text-muted"}`}
              style={{ backgroundColor: heatColor(level) }}
            >
              {Number(day.bucket.slice(8, 10))}
            </button>
          );
        })}
      </div>

      {/* 英文图例更长：允许换行，色块不被压缩（S16）。 */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span>{t("stats.heatmap.less")}</span>
        {Array.from({ length: LEVELS + 1 }, (_, level) => (
          <span
            key={level}
            className="inline-block h-3 w-6 shrink-0 rounded-sm"
            style={{ backgroundColor: heatColor(level) }}
          />
        ))}
        <span>{t("stats.heatmap.more")}</span>
        <span className="ml-1">{t("stats.heatmap.leftmostNone")}</span>
      </div>

      <p className="text-helper-relaxed text-muted">
        {selected === null
          ? t("stats.heatmap.summary", { count: spentDays, total: formatMoney(total, currency) })
          : t("stats.heatmap.selected", {
              date: showDate(selected),
              amount: formatMoney(days.find((day) => day.bucket === selected)?.expenseMinor ?? 0, currency),
              level: String(
                bucketOf(
                  days.find((day) => day.bucket === selected)?.expenseMinor ?? 0,
                  thresholds,
                ),
              ),
            })}
      </p>

      {peak.expenseMinor > 0 ? (
        <p className="text-helper-relaxed text-muted">
          {t("stats.heatmap.peak", {
            currency: currencyName(currency),
            date: showDate(peak.bucket),
            amount: formatMoney(peak.expenseMinor, currency),
          })}
        </p>
      ) : null}
    </div>
  );
}

/** Weekday index of the first day, so the grid lines up with its column. */
function leadingBlanks(firstBucket: string): number {
  if (firstBucket === "") return 0;

  // Date.UTC is used purely as a civil calendar; the value is a date string,
  // never an instant, so no timezone can shift it.
  const weekday = new Date(`${firstBucket}T00:00:00Z`).getUTCDay();

  // The grid starts on Monday, and getUTCDay() calls Sunday 0.
  return (weekday + 6) % COLUMNS;
}
