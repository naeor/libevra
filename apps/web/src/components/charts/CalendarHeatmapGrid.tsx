import type { CalendarDayCell, CalendarHeatmapResult } from "@libellum/shared";

import { heatColor } from "../../lib/chart/theme.js";

/**
 * **日历热力图（CF-B08，I12）**。
 *
 * 用 DOM 网格而非 SVG：格子随容器宽度自适应，屏幕阅读器能逐日读出日期与
 * 金额。着色只用于比较已确认的日金额；未知/未来格子不着色、不可点击，
 * 也不会被当成 0。
 */
export function CalendarHeatmapGrid({
  heatmap,
  title,
  monthLabel,
  weekdayLabels,
  formatDay,
  onSelectDate,
}: {
  readonly heatmap: CalendarHeatmapResult;
  readonly title: string;
  readonly monthLabel: (monthKey: string) => string;
  readonly weekdayLabels: readonly string[];
  readonly formatDay: (cell: CalendarDayCell) => string;
  readonly onSelectDate?: (cell: CalendarDayCell) => void;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={title} data-metric={heatmap.metric}>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {weekdayLabels.map((label, index) => (
          <span key={`${String(index)}:${label}`} className="text-center text-[10px] leading-4 text-muted">
            {label}
          </span>
        ))}
      </div>
      {heatmap.months.map((month) => (
        <section key={month.monthKey} aria-label={monthLabel(month.monthKey)} className="mb-2">
          <p className="pb-1 text-xs text-muted">{monthLabel(month.monthKey)}</p>
          <div className="grid grid-cols-7 gap-1">
            {month.weeks.map((week, weekIndex) => (
              <div key={`${month.monthKey}:${String(weekIndex)}`} className="contents">
                {week.days.map((cell, dayIndex) =>
                  cell === null ? (
                    // 同一周可能有多个空格（月初/月末），键里带上星期序号，避免 React 重复键。
                    <span key={`${String(weekIndex)}:blank:${String(dayIndex)}`} aria-hidden="true" />
                  ) : (
                    <button
                      key={cell.date}
                      type="button"
                      data-date={cell.date}
                      data-state={cell.state}
                      data-level={cell.level === null ? undefined : String(cell.level)}
                      aria-label={formatDay(cell)}
                      title={formatDay(cell)}
                      disabled={onSelectDate === undefined}
                      onClick={onSelectDate === undefined ? undefined : () => onSelectDate(cell)}
                      className="aspect-square min-h-6 w-full rounded-[2px] border-none p-0"
                      style={{
                        backgroundColor:
                          cell.level === null ? "var(--color-chart-rule)" : heatColor(cell.level),
                        opacity: cell.level === null ? 0.35 : 1,
                        cursor: onSelectDate === undefined ? "default" : "pointer",
                      }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
