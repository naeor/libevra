import type { CategorySeriesResult, TimeBucket } from "@libellum/shared";

import { CategorySeriesChart } from "./CategorySeriesChart.js";
import type { CategorySeriesChartKind } from "../../lib/chart/categoryChart.js";

/**
 * **多分类金额对比卡（I15）**——多折线 / 多序列面积 / 分组柱。
 *
 * 三种图型读同一份 `computeCategorySeries` 结果：切换图型不改变金额与口径。
 * 图例顺序 = `result.categoryIds` 顺序（调用方决定 Top N 或手动选择）。
 */
export interface CategoryTrendsCardProps {
  readonly title: string;
  readonly result: CategorySeriesResult;
  readonly categoryLabel: (categoryId: string) => string;
  readonly formatAxis: (value: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly kind?: CategorySeriesChartKind;
  readonly totalText: string | null;
  readonly caption: string | null;
  readonly notice?: string | null;
  readonly height?: number;
  readonly formatValue?: (amountMinor: string) => string;
  readonly testId?: string;
}

export function CategoryTrendsCard({
  title,
  result,
  categoryLabel,
  formatAxis,
  labelFor,
  kind = "lines",
  totalText,
  caption,
  notice = null,
  height = 220,
  formatValue,
  testId = "category-trends-card",
}: CategoryTrendsCardProps): React.JSX.Element {
  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid={testId}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {totalText === null ? null : (
          <p className="text-base font-semibold tabular-nums text-ink" data-testid={`${testId}-total`}>
            {totalText}
          </p>
        )}
      </header>
      {caption === null ? null : (
        <p className="mt-1 text-helper text-muted" data-testid={`${testId}-caption`}>
          {caption}
        </p>
      )}
      <CategorySeriesChart
        series={result}
        title={title}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        kind={kind}
        height={height}
        notice={notice}
        {...(formatValue === undefined ? {} : { formatValue })}
      />
    </section>
  );
}
