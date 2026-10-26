import type { MovingAveragePoint, MovingAverageResult } from "@libellum/shared";

import { linePath } from "../../lib/chart/geometry.js";
import { bucketLabel } from "../../lib/chart/format.js";
import { categoricalColor, EXPENSE_COLOR } from "../../lib/chart/theme.js";
import { buildMovingAverageModel } from "../../lib/chart/advancedChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 移动平均图（A13/A14，CF-B12）：原始每日支出 + 7/30 日尾随平均。
 *
 * **只做画。** 平均值来自 shared 的精确分数，未知窗口在图上断开（不连到 0、
 * 不插值）；原始序列与平均序列都来自同一个 `MovingAverageResult`。
 */
export interface MovingAverageChartProps {
  readonly result: MovingAverageResult;
  readonly title: string;
  /** 图例文字：原始序列与移动平均（由调用方 i18n）。 */
  readonly labels: { readonly raw: string; readonly average: string };
  /** 提示框/无障碍名称里的精确值。 */
  readonly formatValue: (point: MovingAveragePoint) => string;
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
}

const RAW_COLOR = categoricalColor(2);
const AVERAGE_COLOR = EXPENSE_COLOR;

export function MovingAverageChart({
  result,
  title,
  labels,
  formatValue,
  formatAxis,
  height = 200,
  notice = null,
}: MovingAverageChartProps) {
  return (
    <ChartFrame
      height={height}
      padding={{ top: 14, right: 12, bottom: 26, left: 42 }}
      title={title}
      notice={notice}
    >
      {(layout: ChartLayout) => {
        const model = buildMovingAverageModel(result, layout);
        const count = model.points.length;
        const labelsX = model.points.map((point) => bucketLabel(point.key, "day"));
        const approx = Math.max(24, layout.innerWidth / Math.max(count, 1) / 2);
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
            {model.rawSegments.map((segment, index) =>
              segment.length > 1 ? (
                <path
                  d={linePath(segment)}
                  fill="none"
                  key={`raw-${index}`}
                  stroke={RAW_COLOR}
                  strokeWidth={1.5}
                />
              ) : (
                <circle
                  cx={segment[0]!.x}
                  cy={segment[0]!.y}
                  fill={RAW_COLOR}
                  key={`raw-${index}`}
                  r={1.4}
                />
              ),
            )}
            {model.averageSegments.map((segment, index) =>
              segment.length > 1 ? (
                <path
                  d={linePath(segment)}
                  fill="none"
                  key={`avg-${index}`}
                  stroke={AVERAGE_COLOR}
                  strokeWidth={2}
                />
              ) : (
                <circle
                  cx={segment[0]!.x}
                  cy={segment[0]!.y}
                  fill={AVERAGE_COLOR}
                  key={`avg-${index}`}
                  r={2}
                />
              ),
            )}
            {model.points.map((point, index) =>
              point.yAverage === null ? null : (
                <circle
                  cx={point.x}
                  cy={point.yAverage}
                  fill={AVERAGE_COLOR}
                  key={`dot-${point.key}`}
                  r={2.2}
                >
                  <title>{formatValue(result.points[index]!)}</title>
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
              <rect fill={RAW_COLOR} height={3} width={12} x={layout.padding.left} y={layout.padding.top - 10} />
              <text fill="currentColor" fontSize={10} x={layout.padding.left + 16} y={layout.padding.top - 7}>
                {labels.raw}
              </text>
              <rect
                fill={AVERAGE_COLOR}
                height={3}
                width={12}
                x={layout.padding.left + 96}
                y={layout.padding.top - 10}
              />
              <text
                fill="currentColor"
                fontSize={10}
                x={layout.padding.left + 112}
                y={layout.padding.top - 7}
              >
                {labels.average}
              </text>
            </g>
          </svg>
        );
      }}
    </ChartFrame>
  );
}
