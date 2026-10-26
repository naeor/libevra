import type { MultiMonthComparisonResult } from "@libellum/shared";

import { bucketLabel } from "../../lib/chart/format.js";
import { EXPENSE_COLOR, INCOME_COLOR } from "../../lib/chart/theme.js";
import {
  buildMonthComparisonModel,
  COMPARISON_DEFAULT_PADDING,
  monthBarRect,
  type MonthBar,
} from "../../lib/chart/comparisonChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";

/**
 * 多个月份比较的柱图（A04；CF-B04 的月份比较用法）。
 *
 * **只做画。** 每个自然月的金额、完整性与可比性来自 `@libellum/shared` 的
 * `computeMultiMonthComparison`；这里不合并月份、不假设 30 天、不补零。
 *
 * 图形约定（§22、§32、§34、CF-B04）：
 *
 *  * 每个被选中的自然月**单独一根柱**，保持调用方给的顺序（通常按时间）；
 *  * 跨年时标签保留年份（`YYYY-MM` 的本地化短标签）；
 *  * 未完成/不可比的月份用低透明度画出，而不是当作完整月份填满；
 *  * 未知月份没有柱（不是 0 高柱）。
 */
export interface MonthComparisonChartProps {
  readonly result: MultiMonthComparisonResult;
  readonly title: string;
  /** 提示框/无障碍值：含币种与精确小数位。 */
  readonly valueText: (bar: MonthBar) => string;
  /** 纵轴刻度短格式（可缩写，但必须同数量级）。 */
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
  /** 所有选中月都无数据时显示的文字；为 `null` 时保持空图框。 */
  readonly emptyLabel?: string | null;
}

export function MonthComparisonChart({
  result,
  title,
  valueText,
  formatAxis,
  height = 220,
  notice = null,
  emptyLabel = null,
}: MonthComparisonChartProps): React.JSX.Element {
  const nothing = result.months.every((month) => month.amountMinor === null);

  return (
    <ChartFrame
      height={height}
      title={title}
      notice={notice ?? (nothing ? emptyLabel : null)}
      padding={COMPARISON_DEFAULT_PADDING}
    >
      {(layout) => {
        const model = buildMonthComparisonModel(result, layout);
        const color =
          result.metric === "income" ? INCOME_COLOR : EXPENSE_COLOR;
        return (
          <g>
            <Baseline layout={layout} y={model.zeroY} />
            {model.bars.map((bar, index) => {
              const rect = monthBarRect(model, index);
              if (rect === null) return null;
              return (
                <rect
                  key={bar.monthKey}
                  data-month={bar.monthKey}
                  data-state={bar.state}
                  data-comparable={bar.comparable ? "true" : "false"}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  rx={2}
                  fill={color}
                  fillOpacity={bar.comparable ? 0.85 : 0.3}
                >
                  <title>{valueText(bar)}</title>
                </rect>
              );
            })}
            <XAxis
              layout={layout}
              labels={model.bars.map((bar) => bucketLabel(bar.monthKey, "month"))}
              slotWidth={model.slotWidth}
            />
            <YAxis layout={layout} ticks={model.ticks} scale={model.scale} format={formatAxis} />
          </g>
        );
      }}
    </ChartFrame>
  );
}
