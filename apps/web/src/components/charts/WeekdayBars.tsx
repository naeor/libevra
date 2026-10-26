import type { WeekdayPatternResult } from "@libellum/shared";

import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";
import { buildWeekdayModel, type WeekdayMode } from "../../lib/chart/categoryChart.js";
import { EXPENSE_COLOR } from "../../lib/chart/theme.js";

/**
 * **星期分布柱（CF-B09，I13）**。
 *
 * 两种口径用同一个坐标轴：`total` 是区间合计，`average` 是“当天平均”，
 * 后者只对区间内实际出现过的该星期日期求平均（不是除以 7）。
 */
export function WeekdayBars({
  pattern,
  mode,
  weekdayLabels,
  title,
  formatAxis,
  formatValue,
  height = 200,
  notice,
  note,
}: {
  readonly pattern: WeekdayPatternResult;
  readonly mode: WeekdayMode;
  readonly weekdayLabels: readonly string[];
  readonly title: string;
  readonly formatAxis: (value: number) => string;
  readonly formatValue: (minor: string) => string;
  readonly height?: number;
  readonly notice?: string | null;
  /** 样本不足等提示，显示在图表下方。 */
  readonly note?: string | null;
}): React.JSX.Element {
  return (
    <div>
      <ChartFrame
        height={height}
        padding={{ top: 12, right: 8, bottom: 24, left: 44 }}
        title={title}
        notice={notice ?? null}
      >
        {(layout) => {
          const model = buildWeekdayModel(pattern, { box: layout, mode });

          return (
            <>
              <YAxis layout={layout} ticks={model.ticks} scale={(value) => model.scale(value)} format={formatAxis} />
              <Baseline layout={layout} y={model.zeroY} />
              {model.bars.map((bar) =>
                bar.value === null || bar.exactText === null ? null : (
                  <rect
                    key={bar.weekday}
                    data-weekday={bar.weekday}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    rx={1}
                    fill={EXPENSE_COLOR}
                    fillOpacity={0.85}
                  >
                    <title>{formatValue(bar.exactText)}</title>
                  </rect>
                ),
              )}
              <XAxis
                layout={layout}
                labels={weekdayLabels}
                slotWidth={model.slotWidth}
                y={model.zeroY}
              />
            </>
          );
        }}
      </ChartFrame>
      {note === null || note === undefined || note === "" ? null : (
        <p className="mt-1 text-xs text-muted">{note}</p>
      )}
    </div>
  );
}
