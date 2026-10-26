import type {
  TimeGranularity,
  TimeSeriesBucketPoint,
  TimeSeriesMetric,
} from "@libellum/shared";
import { useRef, useState } from "react";

import { bucketFullLabel, bucketLabel, weekBucketLabel } from "../../lib/chart/format.js";
import { categoricalColor, EXPENSE_COLOR, INCOME_COLOR } from "../../lib/chart/theme.js";
import {
  areaOf,
  buildTimeSeriesModel,
  lineOf,
  type SeriesChartKind,
} from "../../lib/chart/timeSeriesChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame, type ChartLayout } from "../chart/ChartFrame.js";

/**
 * 单序列时间图：支出/收入/笔数的日、周、月趋势（I06–I10、I19；CF-B01/B02/B03）。
 *
 * **只做画。** 每天的金额、缺口和“当前未结束”来自 `@libellum/shared` 的
 * `computeTimeSeries`；这里不重新分桶、不补零、不做汇率。
 *
 * 缺数据的规则（§6/§34/CF-B01）：
 *
 *  * 未知/未来桶的 `y` 是 `null`，折线与面积在它们处**断开**；
 *  * 柱状图不为它们画柱（不是画一根 0 高的柱）；
 *  * 选中提示框只显示桶自己的权威金额，精确到最后一位。
 */
export interface SeriesTrendChartProps {
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly metric: TimeSeriesMetric;
  readonly granularity: TimeGranularity;
  readonly chartKind: SeriesChartKind;
  readonly title: string;
  /** 提示框里的完整值（含单位），由调用方按币种/笔数格式化。 */
  readonly valueText: (point: TimeSeriesBucketPoint) => string;
  /** 纵轴刻度的短格式（可缩写，但必须是同一数量级）。 */
  readonly formatAxis: (value: number) => string;
  readonly color?: string;
  readonly height?: number;
  readonly notice?: string | null;
}

/** 支出/收入/笔数的默认颜色；笔数用分类色而不是“钱”的颜色。 */
export function defaultSeriesColor(metric: TimeSeriesMetric): string {
  if (metric === "income") return INCOME_COLOR;
  if (metric === "count") return categoricalColor(0);
  return EXPENSE_COLOR;
}

function shortLabel(point: TimeSeriesBucketPoint, granularity: TimeGranularity): string {
  if (granularity === "week") return weekBucketLabel(point.bucket.span);
  return bucketLabel(point.bucket.key, granularity === "month" ? "month" : "day");
}

function fullLabel(point: TimeSeriesBucketPoint, granularity: TimeGranularity): string {
  if (granularity === "week") return weekBucketLabel(point.bucket.span);
  return bucketFullLabel(point.bucket.key, granularity === "month" ? "month" : "day");
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

export function SeriesTrendChart({
  points,
  metric,
  granularity,
  chartKind,
  title,
  valueText,
  formatAxis,
  color,
  height = 200,
  notice = null,
}: SeriesTrendChartProps): React.JSX.Element {
  const [selected, setSelected] = useState<number | null>(null);
  const dragging = useRef(false);
  const stroke = color ?? defaultSeriesColor(metric);

  return (
    <ChartFrame height={height} title={title} notice={notice}>
      {(layout) => {
        const model = buildTimeSeriesModel(points, { box: layout, chartKind, metric });
        const active = selected === null ? null : (points[selected] ?? null);
        const activePoint = selected === null ? null : (model.points[selected] ?? null);

        return (
          <>
            <YAxis
              layout={layout}
              ticks={model.ticks}
              scale={model.scale}
              format={(value) => formatAxis(value)}
            />
            {chartKind === "bar" ? <Baseline layout={layout} y={model.zeroY} /> : null}

            {model.segments.map((segment, index) =>
              chartKind === "area" ? (
                <path
                  key={`area-${String(index)}`}
                  d={areaOf(segment, model.zeroY) ?? ""}
                  fill={stroke}
                  fillOpacity={0.12}
                />
              ) : null,
            )}

            {chartKind !== "bar"
              ? model.segments.map((segment, index) => (
                  <path
                    key={`line-${String(index)}`}
                    d={lineOf(segment)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))
              : null}

            {model.bars.map((bar) => (
              <rect
                key={bar.key}
                data-state={bar.state}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={1.5}
                fill={stroke}
                fillOpacity={bar.state === "in-progress" ? 0.55 : 0.85}
              />
            ))}

            {active !== null && activePoint !== null ? (
              <SeriesTooltip
                layout={layout}
                x={activePoint.x}
                label={fullLabel(active, granularity)}
                value={valueText(active)}
                color={stroke}
              />
            ) : null}

            <XAxis
              layout={layout}
              labels={points.map((point) => shortLabel(point, granularity))}
              slotWidth={model.slotWidth}
            />

            {/* 最后画：整个绘图区都是选中目标（含空白处）。 */}
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
                setSelected(
                  indexAt(
                    event.clientX,
                    event.currentTarget.getBoundingClientRect(),
                    layout,
                    points.length,
                  ),
                );
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                dragging.current = true;
                setSelected(
                  indexAt(
                    event.clientX,
                    event.currentTarget.getBoundingClientRect(),
                    layout,
                    points.length,
                  ),
                );
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

/** 选中桶的竖线与精确值。 */
function SeriesTooltip({
  layout,
  x,
  label,
  value,
  color,
}: {
  readonly layout: ChartLayout;
  readonly x: number;
  readonly label: string;
  readonly value: string;
  readonly color: string;
}): React.JSX.Element {
  const width = Math.min(Math.max(120, Math.max(label.length, value.length) * 7 + 20), 240);
  const height = 42;
  const left = Math.min(Math.max(x - width / 2, 2), layout.width - width - 2);
  const top = 2;

  return (
    <g pointerEvents="none">
      <line
        x1={x}
        x2={x}
        y1={layout.padding.top}
        y2={layout.padding.top + layout.innerHeight}
        stroke={color}
        strokeOpacity={0.45}
        strokeWidth={1}
      />
      <rect
        x={left}
        y={top}
        width={width}
        height={height}
        rx={6}
        fill="var(--color-surface)"
        stroke="var(--color-line)"
      />
      <text x={left + 8} y={top + 16} fontSize={10} fill="var(--color-accent-ink)">
        {label}
      </text>
      <text x={left + 8} y={top + 32} fontSize={11} fill={color}>
        {value}
      </text>
    </g>
  );
}
