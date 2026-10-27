import type {
  CategorySeriesResult,
  CategoryShareResult,
  ShareRatio,
  TimeBucket,
} from "@libellum/shared";

/**
 * **分类数据表（I15 / I16 的表格视图）**——权威金额与桶内占比的可访问后备。
 *
 * 这张表不是图表的“另一份数据”：金额来自 `CategorySeriesResult`，占比来自
 * `CategoryShareResult`，两者都已经过 shared 层校验。未知值显示调用方给的
 * “不可用”文本，绝不补零。
 */
export interface CategoryDataTableProps {
  readonly title: string;
  readonly result: CategorySeriesResult;
  /** Required for `mode: "share"`. */
  readonly shares?: CategoryShareResult;
  readonly mode?: "amount" | "share";
  readonly categoryLabel: (categoryId: string) => string;
  readonly labelFor: (bucket: TimeBucket) => string;
  /** `null` = unknown/future; caller supplies the “unavailable” text. */
  readonly formatAmount: (amountMinor: string | null) => string;
  readonly formatShare?: (share: ShareRatio | null) => string;
  readonly categoryHeader: string;
  readonly totalHeader: string;
  readonly caption?: string | null;
  readonly maxRows?: number;
  readonly testId?: string;
}

export function CategoryDataTable({
  title,
  result,
  shares,
  mode = "amount",
  categoryLabel,
  labelFor,
  formatAmount,
  formatShare,
  categoryHeader,
  totalHeader,
  caption = null,
  maxRows = 12,
  testId = "category-data-table",
}: CategoryDataTableProps): React.JSX.Element {
  const useShares = mode === "share" && shares !== undefined;
  const rows = result.categoryIds.slice(0, Math.max(0, maxRows));
  const showTotalColumn = true;

  return (
    <section
      className="rounded-field border border-line bg-surface px-4 py-3"
      aria-label={title}
      data-testid={testId}
    >
      <header>
        <h3 className="text-body font-medium text-ink">{title}</h3>
        {caption === null ? null : (
          <p className="mt-1 text-helper text-muted" data-testid={`${testId}-caption`}>
            {caption}
          </p>
        )}
      </header>
      <div className="mt-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <table className="w-full border-collapse text-helper tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                {categoryHeader}
              </th>
              {result.buckets.map((bucket) => (
                <th key={bucket.bucket.key} scope="col" className="py-1 pr-3 font-normal">
                  {labelFor(bucket.bucket)}
                </th>
              ))}
              {showTotalColumn ? (
                <th scope="col" className="py-1 font-normal">
                  {totalHeader}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((categoryId) => {
              const total = result.totals[categoryId] ?? null;
              const totalShare: ShareRatio | null =
                total === null || result.totalMinor === null || BigInt(result.totalMinor) === 0n
                  ? null
                  : { numeratorMinor: total, denominatorMinor: result.totalMinor };

              return (
                <tr key={categoryId} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">
                    {categoryLabel(categoryId)}
                  </th>
                  {result.buckets.map((bucket) => {
                    const point = bucket.points.find(
                      (candidate) => candidate.categoryId === categoryId,
                    );
                    const sharePoint = useShares
                      ? shares.buckets
                          .find((candidate) => candidate.bucket.key === bucket.bucket.key)
                          ?.points.find((candidate) => candidate.categoryId === categoryId)
                      : undefined;

                    const text =
                      useShares && formatShare !== undefined
                        ? formatShare(sharePoint?.share ?? null)
                        : formatAmount(point?.amountMinor ?? null);

                    return (
                      <td key={bucket.bucket.key} className="py-1 pr-3 text-ink">
                        {text}
                      </td>
                    );
                  })}
                  {showTotalColumn ? (
                    <td className="py-1 font-medium text-ink">
                      {useShares && formatShare !== undefined
                        ? formatShare(totalShare)
                        : formatAmount(total)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
