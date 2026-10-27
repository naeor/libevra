import type { MultiMonthComparisonResult } from "@libellum/shared";

import type { MonthBar } from "../../lib/chart/comparisonChart.js";
import { MonthComparisonChart } from "./MonthComparisonChart.js";

/**
 * **多个月份比较卡（A04，CF-B04 的月份比较用法）**。
 *
 * 卡片只做框架：标题、权威总额、完整性说明与结果附带的提示；柱图与逐月数据由
 * `MonthComparisonChart` 从 `MultiMonthComparisonResult` 直接画出。金额、完整性、
 * 可比性、排行全部来自 `@libellum/shared` 的 `computeMultiMonthComparison`，卡片不
 * 重新聚合、不补月份、不把进行中的月份当作完整月。
 *
 * 总额规则：只要有一个被选月份不是完整自然月（进行中/未知），整段总额就是
 * “未确认”，`totalText` 必须为 `null`——不显示只覆盖完整月的小计。
 */
export interface MonthComparisonCardProps {
  readonly result: MultiMonthComparisonResult;
  readonly title: string;
  /** 提示框/无障碍值：含币种与精确小数位。 */
  readonly valueText: (bar: MonthBar) => string;
  /** 纵轴刻度短格式（可缩写，但必须同数量级）。 */
  readonly formatAxis: (value: number) => string;
  /** Confirmed total of the selected months; `null` when any month is not complete. */
  readonly totalText: string | null;
  /** 完整性/覆盖说明（例如“3 个完整月，1 个进行中”）。 */
  readonly caption: string | null;
  /** 结果附带的提示（跨年、含未完成月等），已按语言本地化。 */
  readonly notesText?: readonly string[];
  readonly notice?: string | null;
  readonly height?: number;
  readonly testId?: string;
}

export function MonthComparisonCard({
  result,
  title,
  valueText,
  formatAxis,
  totalText,
  caption,
  notesText,
  notice = null,
  height = 220,
  testId = "month-comparison-card",
}: MonthComparisonCardProps): React.JSX.Element {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid={testId}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {totalText === null ? null : (
          <p
            className="text-base font-semibold tabular-nums text-ink"
            data-testid={`${testId}-total`}
          >
            {totalText}
          </p>
        )}
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid={`${testId}-caption`}>
          {caption}
        </p>
      )}
      {notesText === undefined || notesText.length === 0 ? null : (
        <ul className="mt-1 list-disc pl-4 text-helper text-muted" data-testid={`${testId}-notes`}>
          {notesText.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <MonthComparisonChart
        result={result}
        title={title}
        valueText={valueText}
        formatAxis={formatAxis}
        height={height}
        notice={notice}
      />
    </section>
  );
}
