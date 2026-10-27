import type { CategorySeriesBucket, TimeBucket } from "@libellum/shared";

import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";
import { Legend } from "../chart/Legend.js";
import { buildStackedBarModel } from "../../lib/chart/categoryChart.js";
import { categoricalColor } from "../../lib/chart/theme.js";

/**
 * **分类堆叠柱（CF-B05，I14）**。
 *
 * 每根柱的分段直接来自 `computeCategorySeries`：段高只表达已确认金额，
 * 未确认桶不画柱；图例按分类聚合（不只是颜色，还有形状）。
 */
export function CategoryStackedBars({
  buckets,
  title,
  categoryLabel,
  formatAxis,
  labelFor,
  height = 220,
  notice,
}: {
  readonly buckets: readonly CategorySeriesBucket[];
  readonly title: string;
  readonly categoryLabel: (categoryId: string) => string;
  readonly formatAxis: (value: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly height?: number;
  readonly notice?: string | null;
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
          const model = buildStackedBarModel(buckets, layout);

          return (
            <>
              <YAxis layout={layout} ticks={model.ticks} scale={(value) => model.scale(value)} format={formatAxis} />
              <Baseline layout={layout} y={model.zeroY} />
              {model.segments.map((segment) => (
                <rect
                  key={segment.key}
                  data-category={segment.categoryId}
                  x={segment.x}
                  y={segment.y}
                  width={segment.width}
                  height={segment.height}
                  fill={categoricalColor(segment.colorIndex)}
                  fillOpacity={0.85}
                >
                  <title>{formatAxis(Number(segment.amountMinor))}</title>
                </rect>
              ))}
              <XAxis
                layout={layout}
                labels={buckets.map((bucket) => labelFor(bucket.bucket))}
                slotWidth={model.slotWidth}
              />
            </>
          );
        }}
      </ChartFrame>
      <Legend
        items={modelLegend(buckets, categoryLabel)}
      />
    </div>
  );
}

/** 图例按分类首次出现顺序（与模型里的 colorIndex 一致）。 */
function modelLegend(
  buckets: readonly CategorySeriesBucket[],
  categoryLabel: (categoryId: string) => string,
): readonly { readonly label: string; readonly color: string }[] {
  const seen = new Set<string>();
  const items: { label: string; color: string }[] = [];

  for (const bucket of buckets) {
    for (const point of bucket.points) {
      if (seen.has(point.categoryId)) continue;
      seen.add(point.categoryId);
      items.push({ label: categoryLabel(point.categoryId), color: categoricalColor(items.length) });
    }
  }

  return items;
}
