import type { ComparisonResult } from "@libellum/shared";

import { EXPENSE_COLOR, INCOME_COLOR } from "../../lib/chart/theme.js";
import {
  buildComparisonBarsModel,
  comparisonBarRect,
  type ComparisonBarGroup,
  type ComparisonSide,
  COMPARISON_DEFAULT_PADDING,
} from "../../lib/chart/comparisonChart.js";
import { Baseline, XAxis, YAxis } from "../chart/Axis.js";
import { ChartFrame } from "../chart/ChartFrame.js";

/**
 * 上期收支比较的双柱图（A01–A03、A05；CF-B04 分组柱的对比用法）。
 *
 * **只做画。** 两侧金额、可比区间和完整性来自 `@libellum/shared` 的
 * `computePeriodComparison`；这里不重算差额、不做汇率、不补零。
 *
 * 图形约定（§19–§23、§33、CF-B04）：
 *
 *  * **同一 y 轴**画本期与上期，否则柱高不可比；
 *  * 未知/覆盖不足的一侧**不画柱**（不是 0 高柱）；
 *  * 不把“支出增长”渲染成绿色或“支出下降”渲染成红色——涨跌不等于好坏；
 *  * 精确金额走 `valueText` 回调，组件不自己格式化货币。
 */
export interface PeriodComparisonBarsProps {
  readonly result: ComparisonResult;
  readonly title: string;
  /** 两组指标的图例文字（支出、收入），由调用方按语言给出。 */
  readonly metricLabels: { readonly expense: string; readonly income: string };
  /** 提示框/无障碍值：含币种与精确小数位。 */
  readonly valueText: (group: ComparisonBarGroup, side: ComparisonSide) => string;
  /** 纵轴刻度短格式（可缩写，但必须同数量级）。 */
  readonly formatAxis: (value: number) => string;
  readonly height?: number;
  readonly notice?: string | null;
  /** 两组都无数据时显示的文字；为 `null` 时保持空图框。 */
  readonly emptyLabel?: string | null;
}

export function PeriodComparisonBars({
  result,
  title,
  metricLabels,
  valueText,
  formatAxis,
  height = 200,
  notice = null,
  emptyLabel = null,
}: PeriodComparisonBarsProps): React.JSX.Element {
  const nothing =
    result.expense.currentMinor === null &&
    result.expense.previousMinor === null &&
    result.income.currentMinor === null &&
    result.income.previousMinor === null;

  return (
    <ChartFrame
      height={height}
      title={title}
      notice={notice ?? (nothing ? emptyLabel : null)}
      padding={COMPARISON_DEFAULT_PADDING}
    >
      {(layout) => {
        const model = buildComparisonBarsModel(result, layout);
        return (
          <g>
            <Baseline layout={layout} y={model.zeroY} />
            {model.groups.map((group, groupIndex) => {
              const color = group.metric === "expense" ? EXPENSE_COLOR : INCOME_COLOR;
              const current = comparisonBarRect(model, groupIndex, "current");
              const previous = comparisonBarRect(model, groupIndex, "previous");
              return (
                <g key={group.metric} data-group={group.metric}>
                  {previous === null ? null : (
                    <rect
                      data-bar-side="previous"
                      data-metric={group.metric}
                      x={previous.x}
                      y={previous.y}
                      width={previous.width}
                      height={previous.height}
                      rx={2}
                      fill={color}
                      fillOpacity={0.35}
                    >
                      <title>{valueText(group, "previous")}</title>
                    </rect>
                  )}
                  {current === null ? null : (
                    <rect
                      data-bar-side="current"
                      data-metric={group.metric}
                      x={current.x}
                      y={current.y}
                      width={current.width}
                      height={current.height}
                      rx={2}
                      fill={color}
                      fillOpacity={0.85}
                    >
                      <title>{valueText(group, "current")}</title>
                    </rect>
                  )}
                </g>
              );
            })}
            <XAxis
              layout={layout}
              labels={[metricLabels.expense, metricLabels.income]}
              slotWidth={model.groupWidth}
            />
            <YAxis layout={layout} ticks={model.ticks} scale={model.scale} format={formatAxis} />
          </g>
        );
      }}
    </ChartFrame>
  );
}
