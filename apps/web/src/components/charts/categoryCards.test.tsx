import type { CategorySeriesResult } from "@libellum/shared";
import {
  computeCategorySeries,
  computeCategoryShares,
  spanFromInclusiveDates,
} from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryCompositionCard } from "./CategoryCompositionCard.js";
import { CategoryDataTable } from "./CategoryDataTable.js";
import { CategoryShareCard } from "./CategoryShareCard.js";
import { CategoryTrendsCard } from "./CategoryTrendsCard.js";

/** S2 分类区卡片：只渲染权威结果；未知不画、不补零；英文渲染无 CJK。 */
const CJK = /[㐀-鿿]/;

const SPAN = spanFromInclusiveDates("2026-10-01", "2026-10-03");
const TODAY = "2026-10-04";

const LABELS: Record<string, string> = { food: "Food", rent: "Rent", other: "Other" };

function categoryLabel(categoryId: string): string {
  return LABELS[categoryId] ?? categoryId;
}

function labelFor(bucket: { readonly key: string }): string {
  return bucket.key;
}

const formatAxis = (value: number): string => `¥${String(Math.round(value))}`;
const formatValue = (minor: string): string => `¥${(Number(minor) / 100).toFixed(2)}`;
const formatShare = (fraction: number): string => `${String(Math.round(fraction * 100))}%`;

function series(overrides: {
  readonly coverageEnd?: string;
  readonly includeOther?: boolean;
  readonly categoryIds?: readonly string[];
} = {}): CategorySeriesResult {
  return computeCategorySeries(
    [
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 300, categoryId: "food" },
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 200, categoryId: "food" },
      { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 1_000, categoryId: "rent" },
      { occurredLocalDate: "2026-10-02", kind: "expense", amountMinor: 500, categoryId: "food" },
      { occurredLocalDate: "2026-10-03", kind: "expense", amountMinor: 1, categoryId: "food" },
    ],
    {
      kind: "expense",
      categoryIds: overrides.categoryIds ?? ["food", "rent"],
      granularity: "day",
      span: SPAN,
      today: TODAY,
      coverageEnd: overrides.coverageEnd ?? "2026-10-03",
      ...(overrides.includeOther === undefined ? {} : { includeOther: overrides.includeOther }),
    },
  );
}

describe("CategoryCompositionCard (I15 stacked / CF-B05)", () => {
  it("renders one segment per category per known bucket and the authoritative total", () => {
    const html = renderToStaticMarkup(
      <CategoryCompositionCard
        title="Expense composition"
        result={series()}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        totalText={formatValue("2001")}
        caption="Local ledger assumed complete through 2026-10-03."
      />,
    );

    expect(html).toContain('data-testid="category-composition-card"');
    expect(html).toContain('data-testid="category-composition-card-total"');
    expect(html).toContain("¥20.01");
    // food: three buckets, rent: one bucket → four segments.
    expect(html.match(/data-category="food"/g)).toHaveLength(3);
    expect(html.match(/data-category="rent"/g)).toHaveLength(1);
    expect(html).toContain("Food");
    expect(html).toContain("Rent");
    expect(html).not.toMatch(CJK);
  });

  it("renders no segment for a bucket whose total is unknown", () => {
    const html = renderToStaticMarkup(
      <CategoryCompositionCard
        title="Expense composition"
        result={series({ coverageEnd: "2026-10-01" })}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        totalText={null}
        caption="Some buckets are unknown."
      />,
    );

    // Only the covered day contributes segments; the unknown days contribute none.
    expect(html.match(/data-category="food"/g)).toHaveLength(1);
    expect(html).toContain("Some buckets are unknown.");
  });
});

describe("CategoryShareCard (I16 / CF-B06)", () => {
  it("draws 100% share bands from the authoritative in-bucket shares", () => {
    const shareResult = computeCategoryShares(series());
    const html = renderToStaticMarkup(
      <CategoryShareCard
        title="Share of expense"
        shares={shareResult}
        categoryLabel={categoryLabel}
        formatShare={formatShare}
        labelFor={labelFor}
        totalText={formatValue("2001")}
        caption="In-bucket shares use the authoritative bucket total."
      />,
    );

    expect(html).toContain('data-testid="category-share-card"');
    expect(html.match(/data-category="food"/g)).toHaveLength(1);
    expect(html.match(/data-category="rent"/g)).toHaveLength(1);
    expect(html).toContain("100%");
    expect(html).not.toMatch(CJK);
  });

  it("keeps the band broken for zero-total buckets instead of pretending 0%", () => {
    const shareResult = computeCategoryShares(
      computeCategorySeries(
        [
          { occurredLocalDate: "2026-10-01", kind: "expense", amountMinor: 700, categoryId: "food" },
        ],
        {
          kind: "expense",
          categoryIds: ["food"],
          granularity: "day",
          span: SPAN,
          today: TODAY,
          coverageEnd: "2026-10-03",
        },
      ),
    );

    expect(shareResult.zeroTotalBucketCount).toBe(2);
    expect(shareResult.buckets[1]?.state).toBe("zero-total");
    expect(shareResult.buckets[1]?.points[0]?.share).toBeNull();
  });
});

describe("CategoryTrendsCard (I15 lines / grouped bars)", () => {
  it("draws one point per known category bucket in line mode", () => {
    const html = renderToStaticMarkup(
      <CategoryTrendsCard
        title="Category trends"
        result={series()}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        totalText={formatValue("2001")}
        caption={null}
      />,
    );

    // 3 food points + 1 rent point.
    expect(html).toContain("Category trends");
    // One point circle per category per bucket (3 buckets × 2 categories), legend dots excluded.
    expect(html.match(/r="2"/g)).toHaveLength(6);
    expect(html).toContain("Food");
    expect(html).not.toMatch(CJK);
  });

  it("draws one bar per known category bucket in grouped-bar mode", () => {
    const html = renderToStaticMarkup(
      <CategoryTrendsCard
        title="Category trends"
        result={series()}
        categoryLabel={categoryLabel}
        formatAxis={formatAxis}
        labelFor={labelFor}
        kind="grouped-bars"
        totalText={formatValue("2001")}
        caption={null}
      />,
    );

    // Three buckets × two categories of bars, all on the shared zero baseline.
    expect(html.match(/<rect/g)).toHaveLength(6);
    expect(html).toContain('data-category="rent"');
  });
});

describe("CategoryDataTable (I15/I16 table view)", () => {
  it("shows exact amounts for every category/bucket pair, with an unknown marker", () => {
    const html = renderToStaticMarkup(
      <CategoryDataTable
        title="Category data"
        result={series({ coverageEnd: "2026-10-01" })}
        categoryLabel={categoryLabel}
        labelFor={labelFor}
        formatAmount={(minor) => (minor === null ? "—" : formatValue(minor))}
        categoryHeader="Category"
        totalHeader="Total"
      />,
    );

    expect(html).toContain("Category");
    expect(html).toContain("Food");
    expect(html).toContain("Rent");
    // Covered day: food 5.00, rent 10.00; unknown days show the unavailable marker, not 0.
    expect(html).toContain("¥5.00");
    expect(html).toContain("¥10.00");
    expect(html).toContain("—");
    expect(html).not.toMatch(CJK);
  });

  it("can render shares instead of amounts (I16 table)", () => {
    const result = series();
    const html = renderToStaticMarkup(
      <CategoryDataTable
        title="Share table"
        result={result}
        shares={computeCategoryShares(result)}
        mode="share"
        categoryLabel={categoryLabel}
        labelFor={labelFor}
        formatAmount={(minor) => (minor === null ? "—" : formatValue(minor))}
        formatShare={(share) =>
          share === null ? "—" : `${String(Math.round((Number(share.numeratorMinor) / Number(share.denominatorMinor)) * 100))}%`
        }
        categoryHeader="Category"
        totalHeader="Total"
      />,
    );

    expect(html).toContain("67%"); // food 1001 / 2001
    expect(html).not.toContain("¥10.01");
  });
});
