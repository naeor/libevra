import type { CategoryShareResult, TimeBucket } from "@libellum/shared";

import { CategoryShareBands } from "./CategoryShareBands.js";

/**
 * **分类占比卡（I16，CF-B06）**——100% 堆叠带。
 *
 * 分母是每桶的权威总额，卡片只展示 shared `computeCategoryShares` 的占比；
 * 未知桶、零总额桶在带上断开，绝不把已知部分重新归一化成 100%。
 * 与 I15 的绝对金额卡区分：这张卡回答“构成占比如何变化”。
 */
export interface CategoryShareCardProps {
  readonly title: string;
  readonly shares: CategoryShareResult;
  readonly categoryLabel: (categoryId: string) => string;
  /** Fraction (0–1) → display text; the card never formats money itself. */
  readonly formatShare: (fraction: number) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  readonly totalText: string | null;
  readonly caption: string | null;
  readonly notice?: string | null;
  readonly height?: number;
  readonly testId?: string;
}

export function CategoryShareCard({
  title,
  shares,
  categoryLabel,
  formatShare,
  labelFor,
  totalText,
  caption,
  notice = null,
  height = 200,
  testId = "category-share-card",
}: CategoryShareCardProps): React.JSX.Element {
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
      <CategoryShareBands
        shares={shares}
        title={title}
        categoryLabel={categoryLabel}
        formatShare={formatShare}
        labelFor={labelFor}
        height={height}
        notice={notice}
      />
    </section>
  );
}
