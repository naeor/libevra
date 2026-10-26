import type { AnomalyResult, TimeSeriesBucketPoint } from "@libellum/shared";

import { linePath } from "../../lib/chart/geometry.js";
import { bucketLabel } from "../../lib/chart/format.js";
import { categoricalColor, EXPENSE_COLOR } from "../../lib/chart/theme.js";
import { buildAnomalyModel } from "../../lib/chart/advancedChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 异常日期标记图（A19，CF-B15）：每日支出折线 + 异常日期标记点。
 *
 * 标记由 shared 的稳健统计（MAD/IQR/分位）给出，**图表不自行判定异常**；
 * `description` 用于把“怎么得出异常”的说明展示在图上（规格 §34.4），
 * 具体文案由调用方 i18n 提供。
 */
export interface AnomalyMarkerChartProps {
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly anomaly: AnomalyResult;
  readonly title: string;
  /** 图例中异常标记的名称（由调用方 i18n）。 */
  readonly label: string;
  /** 悬停/无障碍名称里的精确值。 */
  readonly formatValue: (point: TimeSeriesBucketPoint) => string;
  readonly formatAxis: (value: number) => string;
  /** 异常判定口径说明（由调用方 i18n；不显示则传 null）。 */
  readonly description?: string | null;
  readonly height?: number;
  readonly notice?: string | null;
}

const MARK_COLOR = categoricalColor(4);

export function AnomalyMarkerChart({
  points,
  anomaly,
  title,
  label,
  formatValue,
  formatAxis,
  description = null,
  height = 200,
  notice = null,
}: AnomalyMarkerChartProps) {
  return (
    <ChartFrame
      height={height}
      padding={{ top: 14, right: 12, bottom: 26, left: 42 }}
      title={title}
      notice={notice}
    >
      {(layout: ChartLayout) => {
        const model = buildAnomalyModel(points, anomaly, layout);
        const count = model.points.length;
        const labelsX = model.points.map((point) => bucketLabel(point.key, "day"));
        const approx = Math.max(24, layout.innerWidth / Math.max(count, 1) / 2);
        return (
          <div>
            <svg
              aria-label={title}
              height={layout.height}
              role="img"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width="100%"
            >
              <YAxis format={formatAxis} layout={layout} scale={model.scale} ticks={model.ticks} />
              <Baseline layout={layout} y={model.zeroY} />
              {model.segments.map((segment, index) =>
                segment.length > 1 ? (
                  <path
                    d={linePath(segment)}
                    fill="none"
                    key={`line-${index}`}
                    stroke={EXPENSE_COLOR}
                    strokeWidth={1.8}
                  />
                ) : (
                  <circle
                    cx={segment[0]!.x}
                    cy={segment[0]!.y}
                    fill={EXPENSE_COLOR}
                    key={`line-${index}`}
                    r={2}
                  />
                ),
              )}
              {model.points.map((point, index) =>
                point.y === null ? null : (
                  <circle cx={point.x} cy={point.y} fill={EXPENSE_COLOR} key={`dot-${point.key}`} r={1.8}>
                    <title>{formatValue(points[index]!)}</title>
                  </circle>
                ),
              )}
              {model.marks.map((mark) => (
                <g data-mark-date={mark.date} key={mark.date}>
                  <circle cx={mark.x} cy={mark.y} fill={MARK_COLOR} r={4} stroke="white" strokeWidth={1.2}>
                    <title>{`${mark.date} · ${formatValue(points.find((point) => point.bucket.key === mark.date)!)}`}</title>
                  </circle>
                </g>
              ))}
              <XAxis
                approxLabelWidth={approx}
                labels={labelsX}
                layout={layout}
                slotWidth={count === 0 ? layout.innerWidth : layout.innerWidth / count}
              />
              <g>
                <circle cx={layout.padding.left + 5} cy={layout.padding.top - 8} fill={MARK_COLOR} r={4} />
                <text fill="currentColor" fontSize={10} x={layout.padding.left + 14} y={layout.padding.top - 4}>
                  {label}
                </text>
              </g>
            </svg>
            {description === null ? null : (
              <p className="px-1 text-[11px] leading-4 text-ink-3">{description}</p>
            )}
          </div>
        );
      }}
    </ChartFrame>
  );
}
