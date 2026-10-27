import type { CategorySeriesResult, TimeBucket } from "@libellum/shared";

import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";
import { Legend } from "../chart/Legend.js";
import {
  buildCategorySeriesModel,
  type CategorySeriesChartKind,
} from "../../lib/chart/categoryChart.js";
import { areaPath, linePath } from "../../lib/chart/geometry.js";
import { categoricalColor } from "../../lib/chart/theme.js";

/**
 * **多分类金额对比（CF-B03 / I15）**——多折线、多序列面积、分组柱共用一张图。
 *
 * 只画 `computeCategorySeries` 的结果：未知桶没有点、没有柱，也不跨未知区间连线。
 * 折线与分组柱是两种表达（独立金额 vs 同桶横向比较），切换图型不改变任何数字；
 * 占比变化（I16）请用 `CategoryShareBands`，不要在这里归一化。
 */
export function CategorySeriesChart({
  series,
  title,
  categoryLabel,
  formatAxis,
  labelFor,
  kind = "lines",
  height = 220,
  notice,
  formatValue,
}: {
  readonly series: CategorySeriesResult;
  readonly title: string;
  readonly categoryLabel: (categoryId: string) => string;
  readonly formatAxis: (value: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly kind?: CategorySeriesChartKind;
  readonly height?: number;
  readonly notice?: string | null;
  /** Exact per-point text for the `<title>` readout; defaults to `formatAxis`. */
  readonly formatValue?: (amountMinor: string) => string;
}): React.JSX.Element {
  const exact = formatValue ?? ((amountMinor: string) => formatAxis(Number(amountMinor)));

  return (
    <div>
      <ChartFrame
        height={height}
        padding={{ top: 12, right: 8, bottom: 24, left: 44 }}
        title={title}
        notice={notice ?? null}
      >
        {(layout) => {
          const model = buildCategorySeriesModel(series, { box: layout, kind });

          return (
            <>
              <YAxis
                layout={layout}
                ticks={model.ticks}
                scale={(value) => model.scale(value)}
                format={formatAxis}
              />
              {kind === "grouped-bars" ? <Baseline layout={layout} y={model.zeroY} /> : null}
              {model.lines.map((line) =>
                line.segments.map((segment, segmentIndex) => {
                  const color = categoricalColor(line.colorIndex);
                  const points = segment.map((point) => ({ x: point.x, y: point.y }));

                  return (
                    <g key={`${line.categoryId}:${String(segmentIndex)}`} data-category={line.categoryId}>
                      {kind === "area" && segment.length >= 2 ? (
                        <path
                          d={areaPath(points, model.zeroY)}
                          fill={color}
                          fillOpacity={0.08}
                          stroke="none"
                        />
                      ) : null}
                      {segment.length >= 2 ? (
                        <path
                          d={linePath(points)}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      ) : null}
                      {segment.map((point) => (
                        <circle
                          key={point.bucketKey}
                          cx={point.x}
                          cy={point.y}
                          r={2}
                          fill={color}
                        >
                          <title>{exact(point.amountMinor)}</title>
                        </circle>
                      ))}
                    </g>
                  );
                }),
              )}
              {model.bars.map((bar) => (
                <rect
                  key={bar.key}
                  data-category={bar.categoryId}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  fill={categoricalColor(bar.colorIndex)}
                  fillOpacity={0.85}
                >
                  <title>{exact(bar.amountMinor)}</title>
                </rect>
              ))}
              <XAxis
                layout={layout}
                labels={series.buckets.map((bucket) => labelFor(bucket.bucket))}
                slotWidth={model.slotWidth}
              />
            </>
          );
        }}
      </ChartFrame>
      <Legend
        items={series.categoryIds.map((categoryId, index) => ({
          label: categoryLabel(categoryId),
          color: categoricalColor(index),
        }))}
      />
    </div>
  );
}
