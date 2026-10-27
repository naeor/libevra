import type { TimeSeriesBucketPoint, TimeSeriesMetric } from "@libellum/shared";

import { areaOf, buildTimeSeriesModel, lineOf } from "../../lib/chart/timeSeriesChart.js";
import { ChartFrame } from "../chart/ChartFrame.js";
import { defaultSeriesColor } from "./SeriesTrendChart.js";

/**
 * 迷你趋势线（CF-B07）。
 *
 * 只回答“最近在往哪个方向走”。没有坐标轴、没有刻度、不打印金额——
 * 一个 1×1 卡片里塞进读不清的标注，比不标注更糟。当前值/合计由卡片正文显示，
 * 图表只负责形状；形状也来自 shared 的权威结果，缺数据处断开。
 */
export function Sparkline({
  points,
  metric,
  title,
  height = 40,
  color,
  notice = null,
}: {
  readonly points: readonly TimeSeriesBucketPoint[];
  readonly metric: TimeSeriesMetric;
  readonly title: string;
  readonly height?: number;
  readonly color?: string;
  readonly notice?: string | null;
}): React.JSX.Element {
  const stroke = color ?? defaultSeriesColor(metric);

  return (
    <ChartFrame
      height={height}
      title={title}
      notice={notice}
      padding={{ top: 4, right: 4, bottom: 4, left: 4 }}
    >
      {(layout) => {
        const model = buildTimeSeriesModel(points, {
          box: layout,
          chartKind: "line",
          metric,
        });

        const last = [...model.points].reverse().find((point) => point.y !== null);

        return (
          <>
            {model.segments.map((segment, index) => (
              <g key={String(index)}>
                <path d={areaOf(segment, layout.padding.top + layout.innerHeight) ?? ""} fill={stroke} fillOpacity={0.1} />
                <path
                  d={lineOf(segment)}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}
            {last === undefined ? null : (
              <circle cx={last.x} cy={last.y ?? 0} r={2.5} fill={stroke} />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
