import type { DailyExpenseVariability, TimeSeriesBucketPoint } from "@libellum/shared";

import { linePath } from "../../lib/chart/geometry.js";
import { bucketLabel } from "../../lib/chart/format.js";
import { categoricalColor, EXPENSE_COLOR } from "../../lib/chart/theme.js";
import { buildVolatilityModel } from "../../lib/chart/advancedChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 波动性图（A12，CF-B13）：每日支出 + 均值线 + 均值±标准差带。
 *
 * 带状区由 shared 的精确均值/总体标准差换算而来；未结束的今天不参与统计，
 * 因此它的点画出来但不在带内判定（规格 §24）。
 */
export interface VolatilityBandChartProps {
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly variability: DailyExpenseVariability;
  readonly title: string;
  readonly labels: { readonly mean: string; readonly band: string };
  readonly formatValue: (point: TimeSeriesBucketPoint) => string;
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
}

const BAND_COLOR = categoricalColor(1);
const MEAN_COLOR = categoricalColor(3);

export function VolatilityBandChart({
  points,
  variability,
  title,
  labels,
  formatValue,
  formatAxis,
  height = 200,
  notice = null,
}: VolatilityBandChartProps) {
  return (
    <ChartFrame
      height={height}
      padding={{ top: 14, right: 12, bottom: 26, left: 42 }}
      title={title}
      notice={notice}
    >
      {(layout: ChartLayout) => {
        const model = buildVolatilityModel(points, variability, layout);
        const count = model.points.length;
        const labelsX = model.points.map((point) => bucketLabel(point.key, "day"));
        const approx = Math.max(24, layout.innerWidth / Math.max(count, 1) / 2);
        const knownPoints = model.points.filter((point) => point.y !== null);
        const bandTop = [...knownPoints].map((point) => ({ x: point.x, y: model.bandTopY }));
        const bandBottom = [...knownPoints]
          .reverse()
          .map((point) => ({ x: point.x, y: model.bandBottomY }));
        const bandPath =
          knownPoints.length > 1
            ? `${linePath(bandTop)} L ${bandBottom.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`
            : null;
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
            {bandPath === null ? null : (
              <path d={bandPath} fill={BAND_COLOR} fillOpacity={0.14} stroke="none" />
            )}
            <line
              stroke={MEAN_COLOR}
              strokeDasharray="5 3"
              strokeWidth={1.4}
              x1={layout.padding.left}
              x2={layout.width - layout.padding.right}
              y1={model.meanY}
              y2={model.meanY}
            />
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
            <XAxis
              approxLabelWidth={approx}
              labels={labelsX}
              layout={layout}
              slotWidth={count === 0 ? layout.innerWidth : layout.innerWidth / count}
            />
            <g>
              <rect fill={MEAN_COLOR} height={3} width={12} x={layout.padding.left} y={layout.padding.top - 10} />
              <text fill="currentColor" fontSize={10} x={layout.padding.left + 16} y={layout.padding.top - 7}>
                {labels.mean}
              </text>
              <rect
                fill={BAND_COLOR}
                fillOpacity={0.35}
                height={7}
                width={12}
                x={layout.padding.left + 88}
                y={layout.padding.top - 12}
              />
              <text fill="currentColor" fontSize={10} x={layout.padding.left + 104} y={layout.padding.top - 7}>
                {labels.band}
              </text>
            </g>
          </svg>
        );
      }}
    </ChartFrame>
  );
}
