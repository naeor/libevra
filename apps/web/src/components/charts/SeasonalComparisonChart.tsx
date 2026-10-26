import type { SeasonalComparisonResult, SeasonalMonthCell } from "@libellum/shared";

import { linePath } from "../../lib/chart/geometry.js";
import { categoricalColor } from "../../lib/chart/theme.js";
import { buildSeasonalModel } from "../../lib/chart/advancedChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 季节性比较图（A18，CF-B14）：1–12 月分类轴，每年一条线。
 *
 * 月份是**分类轴**而不是连续日期轴（规格 §34.1）；未结束/未知月份的 y 为
 * `null`，折线在此断开；`comparable = false` 的点不画实心圆。
 */
export interface SeasonalComparisonChartProps {
  readonly result: SeasonalComparisonResult;
  readonly title: string;
  /** 12 个月的短标签（由调用方 i18n）。 */
  readonly monthLabels: readonly string[];
  /** 图例：每年一项，颜色由 `colorIndex` 决定。 */
  readonly legend: readonly { readonly label: string; readonly colorIndex: number }[];
  readonly formatValue: (cell: SeasonalMonthCell) => string;
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
}

export function SeasonalComparisonChart({
  result,
  title,
  monthLabels,
  legend,
  formatValue,
  formatAxis,
  height = 200,
  notice = null,
}: SeasonalComparisonChartProps) {
  return (
    <ChartFrame
      height={height}
      padding={{ top: 14, right: 12, bottom: 26, left: 42 }}
      title={title}
      notice={notice}
    >
      {(layout: ChartLayout) => {
        const model = buildSeasonalModel(result, layout);
        return (
          <svg
            aria-label={title}
            height={layout.height}
            role="img"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width="100%"
          >
            <YAxis format={formatAxis} layout={layout} scale={model.scale} ticks={model.ticks} />
            <Baseline layout={layout} y={model.zeroY} />
            {model.years.map((year) => {
              const color = categoricalColor(year.colorIndex);
              const segments: { x: number; y: number }[][] = [];
              let current: { x: number; y: number }[] = [];
              for (const point of year.points) {
                if (point.y === null) {
                  if (current.length > 0) segments.push(current);
                  current = [];
                } else {
                  current.push({ x: point.x, y: point.y });
                }
              }
              if (current.length > 0) segments.push(current);
              return (
                <g data-year={year.year} key={year.year}>
                  {segments.map((segment, index) =>
                    segment.length > 1 ? (
                      <path
                        d={linePath(segment)}
                        fill="none"
                        key={`seg-${index}`}
                        stroke={color}
                        strokeWidth={2}
                      />
                    ) : (
                      <circle cx={segment[0]!.x} cy={segment[0]!.y} fill={color} key={`seg-${index}`} r={2.4} />
                    ),
                  )}
                  {year.points.map((point, index) =>
                    point.y === null ? null : (
                      <circle
                        cx={point.x}
                        cy={point.y}
                        fill={point.comparable ? color : "transparent"}
                        key={`dot-${point.key}`}
                        r={2.2}
                        stroke={color}
                        strokeWidth={1.2}
                      >
                        <title>{formatValue(result.years[model.years.indexOf(year)]!.months[index]!)}</title>
                      </circle>
                    ),
                  )}
                </g>
              );
            })}
            <XAxis
              approxLabelWidth={Math.max(16, model.slotWidth / 2)}
              labels={monthLabels}
              layout={layout}
              slotWidth={model.slotWidth}
            />
            <g>
              {legend.map((item, index) => (
                <g key={item.label} transform={`translate(${layout.padding.left + index * 56}, ${layout.padding.top - 6})`}>
                  <rect fill={categoricalColor(item.colorIndex)} height={3} width={12} y={-6} />
                  <text fill="currentColor" fontSize={10} x={16} y={-2}>
                    {item.label}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        );
      }}
    </ChartFrame>
  );
}
