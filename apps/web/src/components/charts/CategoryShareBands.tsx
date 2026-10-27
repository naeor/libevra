import type { CategoryShareResult, TimeBucket } from "@libellum/shared";

import { ChartFrame } from "../chart/ChartFrame.js";
import { Legend } from "../chart/Legend.js";
import { buildShareStackModel, type ShareBandPoint } from "../../lib/chart/categoryChart.js";
import { categoricalColor } from "../../lib/chart/theme.js";

/**
 * **分类占比 100% 堆叠带（CF-B06，I15）**。
 *
 * 只在按时间变化的占比有意义时使用；未知/零总额的桶在带上断开，
 * 不补 0 也不跨过去连线。占比刻度是显示刻度，权威值仍是区间总占比。
 */
export function CategoryShareBands({
  shares,
  title,
  categoryLabel,
  formatShare,
  labelFor,
  height = 200,
  notice,
}: {
  readonly shares: CategoryShareResult;
  readonly title: string;
  readonly categoryLabel: (categoryId: string) => string;
  readonly formatShare: (fraction: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly height?: number;
  readonly notice?: string | null;
}): React.JSX.Element {
  const legend = shareLegend(shares, categoryLabel);

  return (
    <div>
      <ChartFrame
        height={height}
        padding={{ top: 12, right: 8, bottom: 24, left: 44 }}
        title={title}
        notice={notice ?? null}
      >
        {(layout) => {
          const model = buildShareStackModel(shares, layout);
          const plotHeight = model.plotBottom - model.plotTop;

          return (
            <>
              {model.ticks.map((tick) => {
                const y = model.plotBottom - tick * plotHeight;
                return (
                  <g key={tick}>
                    <line
                      x1={layout.padding.left}
                      x2={layout.width - layout.padding.right}
                      y1={y}
                      y2={y}
                      stroke="var(--color-chart-rule)"
                      strokeDasharray={tick === 0 || tick === 1 ? undefined : "2 3"}
                    />
                    <text
                      x={layout.padding.left - 6}
                      y={y + 3}
                      textAnchor="end"
                      fontSize={9}
                      fill="var(--color-muted)"
                    >
                      {formatShare(tick)}
                    </text>
                  </g>
                );
              })}
              {model.bands.map((band) =>
                band.segments.map((segment, segmentIndex) => (
                  <path
                    key={`${band.categoryId}:${String(segmentIndex)}`}
                    data-category={band.categoryId}
                    d={bandPath(segment)}
                    fill={categoricalColor(band.colorIndex)}
                    fillOpacity={0.8}
                  />
                )),
              )}
              {shares.buckets.map((bucket, index) => (
                <text
                  key={bucket.bucket.key}
                  x={layout.padding.left + model.slotWidth * (index + 0.5)}
                  y={model.plotBottom + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-muted)"
                >
                  {labelFor(bucket.bucket)}
                </text>
              ))}
            </>
          );
        }}
      </ChartFrame>
      <Legend items={legend} />
    </div>
  );
}

/** 一段占比带的闭合路径：上沿→右→下沿反向→闭合。 */
function bandPath(segment: readonly ShareBandPoint[]): string {
  const first = segment[0];
  const last = segment[segment.length - 1];
  if (first === undefined || last === undefined || segment.length < 2) return "";

  const top = segment.map((point) => `${point.x.toFixed(2)},${point.top.toFixed(2)}`).join(" L ");
  const bottom = [...segment]
    .reverse()
    .map((point) => `${point.x.toFixed(2)},${point.bottom.toFixed(2)}`)
    .join(" L ");

  return `M ${top} L ${bottom} Z`;
}

function shareLegend(
  shares: CategoryShareResult,
  categoryLabel: (categoryId: string) => string,
): readonly { readonly label: string; readonly color: string }[] {
  const seen = new Set<string>();
  const items: { label: string; color: string }[] = [];

  for (const bucket of shares.buckets) {
    for (const point of bucket.points) {
      if (seen.has(point.categoryId)) continue;
      seen.add(point.categoryId);
      items.push({ label: categoryLabel(point.categoryId), color: categoricalColor(items.length) });
    }
  }

  return items;
}
