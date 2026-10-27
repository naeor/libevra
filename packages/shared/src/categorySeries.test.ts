import { describe, expect, it } from "vitest";

import { spanFromInclusiveDates } from "./timeCalendar.js";
import {
  CATEGORY_SERIES_VERSION,
  OTHER_CATEGORY_KEY,
  computeCategorySeries,
  computeCategoryShares,
  isCompositionComplete,
  topCategoriesByTotal,
  type CategorySeriesEntry,
  type CategorySeriesOptions,
} from "./categorySeries.js";

const FOOD = "cat-food";
const RENT = "cat-rent";
const OTHER = OTHER_CATEGORY_KEY;

const JULY: CategorySeriesOptions = {
  kind: "expense",
  categoryIds: [FOOD, RENT],
  granularity: "month",
  span: spanFromInclusiveDates("2026-07-01", "2026-07-31"),
  today: "2026-07-31",
  coverageEnd: "2026-07-31",
};

function spend(
  occurredLocalDate: string,
  categoryId: string,
  amountMinor: bigint | number,
): CategorySeriesEntry {
  return { occurredLocalDate, categoryId, kind: "expense", amountMinor };
}

describe("category series (I14/I15)", () => {
  it("keeps the authoritative bucket total independent of the selected categories", () => {
    const result = computeCategorySeries(
      [spend("2026-07-03", FOOD, 3_000), spend("2026-07-04", "cat-other", 1_000)],
      JULY,
    );

    expect(result.buckets[0]?.totalMinor).toBe("4000");
    expect(result.buckets[0]?.points[0]?.amountMinor).toBe("3000");
    expect(result.buckets[0]?.points[1]?.amountMinor).toBe("0");
    // Unselected categories still count towards the bucket total (I16 denominator).
    expect(result.totalMinor).toBe("4000");
  });

  it("separates two categories with the same name but different stable ids", () => {
    const result = computeCategorySeries(
      [spend("2026-07-03", "cat-a", 1_000), spend("2026-07-03", "cat-b", 2_000)],
      { ...JULY, categoryIds: ["cat-a", "cat-b"] },
    );

    expect(result.buckets[0]?.points.map((point) => point.amountMinor)).toEqual(["1000", "2000"]);
  });

  it("always counts every entry towards the total, including uncategorised ones", () => {
    const result = computeCategorySeries(
      [spend("2026-07-03", FOOD, 500), spend("2026-07-04", "uncategorised", 700)],
      JULY,
    );

    expect(result.totalMinor).toBe("1200");
    expect(result.totals[FOOD]).toBe("500");
    expect(result.totals[RENT]).toBe("0");
  });

  it("appends an 'other' series for Top N without hiding the remaining amount", () => {
    const result = computeCategorySeries(
      [
        spend("2026-07-03", FOOD, 3_000),
        spend("2026-07-04", RENT, 2_000),
        spend("2026-07-05", "cat-small", 500),
      ],
      { ...JULY, categoryIds: [FOOD], includeOther: true },
    );

    expect(result.categoryIds).toEqual([FOOD, OTHER]);
    const points = result.buckets[0]?.points ?? [];
    expect(points.find((point) => point.categoryId === FOOD)?.amountMinor).toBe("3000");
    expect(points.find((point) => point.categoryId === OTHER)?.amountMinor).toBe("2500");
  });

  it("reports unknown coverage instead of a zero-filled series", () => {
    const result = computeCategorySeries(
      [spend("2026-07-03", FOOD, 500)],
      { ...JULY, coverageEnd: "2026-06-30", today: "2026-08-05" },
    );

    expect(result.buckets[0]?.unknownReason).toBe("coverage-missing");
    expect(result.buckets[0]?.points[0]?.amountMinor).toBeNull();
    expect(result.totalMinor).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("orders Top N by exact total and drops unknown totals to the end", () => {
    const result = computeCategorySeries(
      [
        spend("2026-07-03", FOOD, 3_000),
        spend("2026-07-04", RENT, 9_000),
        spend("2026-07-05", "cat-small", 500),
      ],
      { ...JULY, categoryIds: [FOOD, RENT, "cat-small", "cat-empty"] },
    );

    expect(topCategoriesByTotal(result, 3)).toEqual([RENT, FOOD, "cat-small"]);
  });
});

describe("category shares (I16)", () => {
  it("computes exact shares over the authoritative bucket total", () => {
    const series = computeCategorySeries(
      [
        spend("2026-07-03", FOOD, 1_500),
        spend("2026-07-04", RENT, 2_500),
        spend("2026-07-05", "cat-small", 1_000),
      ],
      { ...JULY, categoryIds: [FOOD, RENT], includeOther: true, today: "2026-08-05" },
    );
    const shares = computeCategoryShares(series);

    expect(shares.version).toBe(CATEGORY_SERIES_VERSION);
    expect(shares.buckets[0]?.state).toBe("ok");
    expect(shares.buckets[0]?.points[0]?.share).toEqual({
      numeratorMinor: "1500",
      denominatorMinor: "5000",
    });
    // Food + rent + other add up to exactly the denominator, no renormalisation.
    const numerators = (shares.buckets[0]?.points ?? []).map((point) =>
      BigInt(point.share?.numeratorMinor ?? "0"),
    );
    expect(numerators.reduce((sum, value) => sum + value, 0n)).toBe(5_000n);
    expect(isCompositionComplete(shares)).toBe(true);
  });

  it("does not fabricate a composition when the bucket total is zero", () => {
    const series = computeCategorySeries([], JULY);
    const shares = computeCategoryShares(series);

    expect(shares.buckets[0]?.state).toBe("zero-total");
    expect(shares.buckets[0]?.points[0]?.share).toBeNull();
    expect(shares.zeroTotalBucketCount).toBe(1);
    expect(isCompositionComplete(shares)).toBe(false);
  });

  it("marks the current period as partial instead of pretending it is final", () => {
    const series = computeCategorySeries(
      [spend("2026-07-03", FOOD, 1_000)],
      { ...JULY, today: "2026-07-15", coverageEnd: "2026-07-31" },
    );
    const shares = computeCategoryShares(series);

    expect(shares.buckets[0]?.state).toBe("in-progress");
    expect(shares.buckets[0]?.partial).toBe(true);
    expect(shares.buckets[0]?.points[0]?.share).not.toBeNull();
  });

  it("reports unknown buckets without shares", () => {
    const series = computeCategorySeries(
      [spend("2026-07-03", FOOD, 1_000)],
      { ...JULY, coverageEnd: null, today: "2026-08-05" },
    );
    const shares = computeCategoryShares(series);

    expect(shares.buckets[0]?.state).toBe("unknown");
    expect(shares.buckets[0]?.points[0]?.share).toBeNull();
    expect(shares.unknownBucketCount).toBe(1);
  });
});
