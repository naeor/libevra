import type { CategorySeriesResult, TimeBucket } from "@libellum/shared";

import { CategoryStackedBars } from "./CategoryStackedBars.js";

/**
 * **分类构成卡（I15，CF-B05）**——绝对金额的堆叠柱。
 *
 * 卡片只负责标题、权威总额与说明；堆叠几何由 `CategoryStackedBars` 从
 * `computeCategorySeries` 的结果直接生成，不在这里重新聚合。
 * 与 I16 的占比卡区分：这张卡回答“各分类绝对金额如何构成合计”。
 */
export interface CategoryCompositionCardProps {
  readonly title: string;
  readonly result: CategorySeriesResult;
  readonly categoryLabel: (categoryId: string) => string;
  readonly formatAxis: (value: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  /** Exact total of the composition in the analysed span; `null` = unknown. */
  readonly totalText: string | null;
  /** Unknown-coverage / all-zero explanation; `null` = none. */
  readonly caption: string | null;
  readonly notice?: string | null;
  readonly height?: number;
  readonly testId?: string;
}

export function CategoryCompositionCard({
  title,
  result,
  categoryLabel,
  formatAxis,
  labelFor,
  totalText,
  caption,
  notice = null,
  height = 220,
  testId = "category-composition-card",
}: CategoryCompositionCardProps): React.JSX.Element {
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
      <CategoryStackedBars
        buckets={result.buckets}
        title={title}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        height={height}
        notice={notice}
      />
    </section>
  );
}
