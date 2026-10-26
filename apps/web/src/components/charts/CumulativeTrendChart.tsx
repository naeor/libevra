import type { CumulativeBucketPoint } from "@libellum/shared";
import { useRef, useState } from "react";

import { bucketFullLabel, weekBucketLabel } from "../../lib/chart/format.js";
import { EXPENSE_COLOR } from "../../lib/chart/theme.js";
import { areaOf, buildCumulativeModel, lineOf } from "../../lib/chart/timeSeriesChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 累计趋势图（I20 / CF-B11）。
 *
 * 与“每日柱状图”的根本区别：**纵轴是从区间起点累加的真实累计值**，
 * 不是把每日金额连起来。累计语义必须由标题/说明写清楚（“从 X 月 X 日起累计”），
 * 否则读者会把它当成账户余额或账户余额曲线。
 *
 * 未知会向后传播：共享层的 `accumulateSeries` 已把后续累计值置空；这里在
 * 第一个未知桶之后**不再连线**，并用虚线标出“从这里起无法确认”。零变动的日子
 * 是真实的水平线段，不会被抹平。
 */
export interface CumulativeTrendChartProps {
  readonly points: readonly CumulativeBucketPoint[];
  readonly title: string;
  readonly valueText: (point: CumulativeBucketPoint) => string;
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
}

function labelOf(point: CumulativeBucketPoint): string {
  const { granularity, span, key } = point.bucket;
  if (granularity === "week") return weekBucketLabel(span);
  return bucketFullLabel(key, granularity === "month" ? "month" : "day");
}

function shortLabelOf(point: CumulativeBucketPoint): string {
  const { granularity, span, key } = point.bucket;
  if (granularity === "week") return weekBucketLabel(span);
  return bucketFullLabel(key, granularity === "month" ? "month" : "day");
}

export function CumulativeTrendChart({
  points,
  title,
  valueText,
  formatAxis,
  height = 200,
  notice = null,
}: CumulativeTrendChartProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const dragging = useRef(false);

  return (
    <ChartFrame height={height} title={title} notice={notice}>
      {(layout: ChartLayout) => {
        const model = buildCumulativeModel(points, layout);
        const active = selected === null ? null : (points[selected] ?? null);
        const activePoint = selected === null ? null : (model.points[selected] ?? null);
        const unknownX =
          model.firstUnknownKey === null
            ? null
            : (model.points.find((point) => point.key === model.firstUnknownKey)?.x ?? null);
        const tipWidth = active === null ? 0 : Math.max(152, Math.min(labelOf(active).length, 24) * 7 + 16);
        const tipLeft =
          activePoint === null
            ? 0
            : Math.min(Math.max(activePoint.x - tipWidth / 2, 2), Math.max(layout.width - tipWidth - 2, 2));

        return (
          <>
            <YAxis
              layout={layout}
              ticks={model.ticks}
              scale={model.scale}
              format={(value) => formatAxis(value)}
            />
            <Baseline layout={layout} y={model.zeroY} />

            {model.segments.map((segment, index) =>
              areaOf(segment, model.zeroY) === null ? null : (
                <path
                  key={`area-${String(index)}`}
                  d={areaOf(segment, model.zeroY) ?? ""}
                  fill={EXPENSE_COLOR}
                  fillOpacity={0.1}
                />
              ),
            )}

            {model.segments.map((segment, index) => (
              <path
                key={`line-${String(index)}`}
                d={lineOf(segment)}
                fill="none"
                stroke={EXPENSE_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {unknownX === null ? null : (
              <g aria-hidden="true" data-unknown-from={model.firstUnknownKey ?? ""}>
                <line
                  x1={unknownX}
                  x2={unknownX}
                  y1={layout.padding.top}
                  y2={layout.padding.top + layout.innerHeight}
                  stroke="var(--color-chart-rule)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              </g>
            )}

            {active !== null && activePoint !== null ? (
              <g pointerEvents="none">
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={layout.padding.top}
                  y2={layout.padding.top + layout.innerHeight}
                  stroke={EXPENSE_COLOR}
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
                <rect
                  x={tipLeft}
                  y={2}
                  width={tipWidth}
                  height={42}
                  rx={6}
                  fill="var(--color-surface)"
                  stroke="var(--color-line)"
                />
                <text x={tipLeft + 8} y={18} fontSize={10} fill="var(--color-accent-ink)">
                  {labelOf(active)}
                </text>
                <text x={tipLeft + 8} y={34} fontSize={11} fill={EXPENSE_COLOR}>
                  {valueText(active)}
                </text>
              </g>
            ) : null}

            <XAxis
              layout={layout}
              labels={points.map((point) => shortLabelOf(point))}
              slotWidth={model.slotWidth}
            />

            <rect
              x={layout.padding.left}
              y={layout.padding.top}
              width={layout.innerWidth}
              height={layout.innerHeight}
              fill="transparent"
              className="touch-pan-y"
              tabIndex={0}
              role="slider"
              aria-label={title}
              aria-valuemin={1}
              aria-valuemax={Math.max(points.length, 1)}
              aria-valuenow={selected === null ? 1 : selected + 1}
              onKeyDown={(event) => {
                if (points.length === 0) return;
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setSelected((current) => Math.min((current ?? -1) + 1, points.length - 1));
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setSelected((current) => Math.max((current ?? points.length) - 1, 0));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setSelected(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setSelected(points.length - 1);
                }
              }}
              onBlur={() => {
                setSelected(null);
              }}
              onPointerDown={(event) => {
                dragging.current = false;
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelected(indexAt(event.clientX, event.currentTarget.getBoundingClientRect(), layout, points.length));
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                dragging.current = true;
                setSelected(indexAt(event.clientX, event.currentTarget.getBoundingClientRect(), layout, points.length));
              }}
              onPointerUp={(event) => {
                dragging.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragging.current = false;
                setSelected(null);
              }}
              onPointerLeave={() => {
                if (!dragging.current) setSelected(null);
              }}
            />
          </>
        );
      }}
    </ChartFrame>
  );
}

function indexAt(
  clientX: number,
  bounds: DOMRect,
  layout: ChartLayout,
  count: number,
): number | null {
  if (count === 0 || bounds.width <= 0) return null;

  const scale = layout.width / bounds.width;
  const local = (clientX - bounds.left) * scale - layout.padding.left;
  const index = Math.floor(local / Math.max(layout.innerWidth / count, 1));

  return Math.min(Math.max(index, 0), count - 1);
}
