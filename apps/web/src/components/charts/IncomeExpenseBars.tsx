import type { FlowSeriesBucketPoint, TimeBucket } from "@libellum/shared";

import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";
import { Legend } from "../chart/Legend.js";
import { buildFlowBarModel } from "../../lib/chart/categoryChart.js";
import { EXPENSE_COLOR, INCOME_COLOR } from "../../lib/chart/theme.js";

/**
 * **收入/支出成对柱（CF-B04，I11）**。
 *
 * 两根柱共用一条零点基线：收入在左、支出在右，任何一侧未知就不画。
 * 图例、标题与日期文字都由调用方按当前语言传入，组件本身不产出中文。
 */
export function IncomeExpenseBars({
  buckets,
  title,
  incomeLabel,
  expenseLabel,
  formatAxis,
  labelFor,
  height = 200,
  notice,
}: {
  readonly buckets: readonly FlowSeriesBucketPoint[];
  readonly title: string;
  readonly incomeLabel: string;
  readonly expenseLabel: string;
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
          const model = buildFlowBarModel(buckets, layout);

          return (
            <>
              <YAxis layout={layout} ticks={model.ticks} scale={(value) => model.scale(value)} format={formatAxis} />
              <Baseline layout={layout} y={model.zeroY} />
              {model.bars.map((bar) => (
                <rect
                  key={bar.key}
                  data-series={bar.kind}
                  data-state={bar.state}
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={1}
                  fill={bar.kind === "income" ? INCOME_COLOR : EXPENSE_COLOR}
                  fillOpacity={bar.state === "in-progress" ? 0.55 : 0.85}
                >
                  <title>{formatAxis(Number(bar.amountMinor))}</title>
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
        items={[
          { label: incomeLabel, color: INCOME_COLOR, shape: "square" },
          { label: expenseLabel, color: EXPENSE_COLOR, shape: "square" },
        ]}
      />
    </div>
  );
}
