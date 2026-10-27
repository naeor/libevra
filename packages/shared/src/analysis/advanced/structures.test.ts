import { describe, expect, it } from "vitest";

import {
  buildMatrix,
  contributionBetween,
  deltaSharesSumToOne,
  matrixCell,
  matrixIsConserved,
  normaliseCategoryAmounts,
  paretoIsMonotonic,
  paretoOf,
  rankRecords,
  shareChangeOf,
  contributionCompleteness,
  type CategoryAmountInput,
  type DraftRankedRecord,
  type MatrixDatum,
} from "./index.js";

function category(categoryId: string, minor: bigint, label = categoryId): CategoryAmountInput {
  return { categoryId, categoryLabel: label, minor };
}

function expenseRecord(
  id: string,
  amountMinor: bigint,
  occurredLocalDate = "2026-10-01",
): DraftRankedRecord {
  return {
    id,
    amountMinor,
    kind: "expense",
    occurredLocalDate,
    categoryId: "food",
    categoryLabel: "餐饮",
    paymentMethodId: null,
    paymentMethodLabel: null,
  };
}

describe("contribution（分类变化贡献）", () => {
  it("两期变化逐分类拆解且总和守恒", () => {
    const result = contributionBetween(
      [category("A", 100n), category("B", 50n)],
      [category("A", 80n), category("B", 50n), category("C", 20n)],
    );

    expect(result.previousTotalMinor).toBe(150n);
    expect(result.currentTotalMinor).toBe(150n);
    expect(result.totalDeltaMinor).toBe(0n);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.categoryId)).toEqual(["A", "C", "B"]);
    expect(result.conservation.rowsDeltaMinor).toBe(0n);
    expect(result.conservation.matchesTotal).toBe(true);

    const rowA = result.rows[0];
    expect(rowA?.deltaMinor).toBe(-20n);
    expect(rowA?.growth).toEqual({ numerator: -1n, denominator: 5n });
    expect(rowA?.deltaShare).toBeNull();

    const rowC = result.rows[1];
    expect(rowC?.isNew).toBe(true);
    expect(rowC?.growth).toBeNull();
    expect(rowC?.growthUnavailableReason).toBe("previous-zero");
  });

  it("变化份额在总差额非 0 时合计为 1", () => {
    const result = contributionBetween([category("A", 100n)], [category("A", 150n)]);

    expect(result.totalDeltaMinor).toBe(50n);
    expect(result.rows[0]?.deltaShare).toEqual({ numerator: 1n, denominator: 1n });
    expect(result.rows[0]?.growth).toEqual({ numerator: 1n, denominator: 2n });
    expect(deltaSharesSumToOne(result)).toBe(true);
  });

  it("新增与移除分类参与守恒", () => {
    const result = contributionBetween(
      [category("old", 70n)],
      [category("new", 30n)],
    );

    expect(result.totalDeltaMinor).toBe(-40n);
    expect(result.rows.find((row) => row.categoryId === "old")?.isRemoved).toBe(true);
    expect(result.rows.find((row) => row.categoryId === "new")?.isNew).toBe(true);
    expect(result.conservation.rowsDeltaMinor).toBe(-40n);
    expect(result.conservation.matchesTotal).toBe(true);
  });

  it("分类 id 重复时报错（口径错误不能静默）", () => {
    expect(() =>
      contributionBetween([category("A", 1n)], [category("A", 2n), category("A", 3n)]),
    ).toThrow(RangeError);
  });

  it("归一化与份额变化的辅助函数", () => {
    const normalised = normaliseCategoryAmounts([category("", 20n)]);
    expect(normalised[0]?.categoryId).toBe("unclassified");
    expect(normalised[0]?.categoryLabel).toBe("未分类");

    const row = {
      categoryId: "A",
      categoryLabel: "A",
      previousMinor: 1n,
      currentMinor: 2n,
      deltaMinor: 1n,
      deltaShare: null,
      growth: null,
      growthUnavailableReason: null,
      isNew: false,
      isRemoved: false,
    } as const;

    expect(shareChangeOf(row, 10n, 10n)).toEqual({ numerator: 1n, denominator: 10n });
    expect(shareChangeOf(row, 0n, 10n)).toBeNull();
    expect(contributionCompleteness(0, 0)).toBe("no-transactions");
    expect(contributionCompleteness(0, 1)).toBe("complete");
  });
});

describe("matrix（二维矩阵）", () => {
  const data: readonly MatrixDatum[] = [
    { rowId: "c1", colId: "2026-01", amountMinor: 100n, count: 2 },
    { rowId: "c1", colId: "2026-02", amountMinor: 50n, count: 1 },
    { rowId: "c2", colId: "2026-01", amountMinor: 30n, count: 1 },
  ];

  it("构建稀疏矩阵且合计守恒", () => {
    const matrix = buildMatrix(data);

    expect(matrix.rowIds).toEqual(["c1", "c2"]);
    expect(matrix.colIds).toEqual(["2026-01", "2026-02"]);
    expect(matrix.grandTotalMinor).toBe(180n);
    expect(matrix.grandTotalCount).toBe(4);
    expect(matrix.rowTotals.get("c1")).toBe(150n);
    expect(matrix.colTotals.get("2026-01")).toBe(130n);
    expect(matrix.filledCellCount).toBe(3);
    expect(matrixIsConserved(matrix)).toBe(true);
  });

  it("空单元格是「没有发生」而不是 0 金额", () => {
    const matrix = buildMatrix(data);

    expect(matrixCell(matrix, "c1", "2026-02")?.amountMinor).toBe(50n);
    expect(matrixCell(matrix, "c1", "2026-03")).toBeNull();
    expect(matrix.cells).toHaveLength(3);
  });

  it("显式维度顺序与重复 id 校验", () => {
    const matrix = buildMatrix(data, { rowOrder: ["c2", "c1"], colOrder: ["2026-02", "2026-01"] });
    expect(matrix.rowIds).toEqual(["c2", "c1"]);
    expect(matrix.colIds).toEqual(["2026-02", "2026-01"]);
    expect(matrixIsConserved(matrix)).toBe(true);

    expect(() => buildMatrix(data, { rowOrder: ["c1", "c1"] })).toThrow(RangeError);
  });
});

describe("ranking（记录级排行）", () => {
  it("按金额降序、并列名次为 1,1,3，截断不改名次", () => {
    const result = rankRecords(
      [
        expenseRecord("r1", 500n),
        expenseRecord("r2", 500n),
        expenseRecord("r3", 300n),
        expenseRecord("r4", 200n),
        expenseRecord("r5", 100n),
      ],
      { totalMinor: 1600n, limit: 4 },
    );

    expect(result.items.map((item) => item.rank)).toEqual([1, 1, 3, 4]);
    expect(result.items[0]?.tieCount).toBe(2);
    expect(result.items[1]?.tieCount).toBe(2);
    expect(result.items[0]?.share).toEqual({ numerator: 5n, denominator: 16n });
    expect(result.truncated).toBe(true);
    expect(result.sampleComplete).toBe(false);
    expect(result.tiePolicy).toBe("amount-desc-date-asc-id-asc");
  });

  it("同金额按业务日期与 id 决定顺序", () => {
    const result = rankRecords(
      [
        expenseRecord("b", 100n, "2026-10-02"),
        expenseRecord("a", 100n, "2026-10-01"),
        expenseRecord("c", 100n, "2026-10-02"),
      ],
      { limit: 3 },
    );

    expect(result.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("分母未知或为 0 时份额为 null，不写 0", () => {
    expect(rankRecords([expenseRecord("r1", 100n)]).items[0]?.share).toBeNull();
    expect(
      rankRecords([expenseRecord("r1", 100n)], { totalMinor: 0n }).items[0]?.share,
    ).toBeNull();
  });

  it("非法输入报错", () => {
    expect(() => rankRecords([expenseRecord("r1", 100n), expenseRecord("r1", 50n)])).toThrow(
      RangeError,
    );
    expect(() => rankRecords([expenseRecord("r1", -1n)])).toThrow(RangeError);
    expect(() => rankRecords([expenseRecord("r1", 100n)], { limit: 0 })).toThrow(RangeError);
  });

  it("全量时不截断", () => {
    const result = rankRecords([expenseRecord("r1", 100n)], { totalMinor: 100n, limit: 10 });
    expect(result.truncated).toBe(false);
    expect(result.sampleComplete).toBe(true);
  });
});

describe("concentration（帕累托 / TopN 集中度）", () => {
  it("累计占比单调递增且终值为 1", () => {
    const result = paretoOf([
      { id: "A", label: "A", minor: 100n },
      { id: "B", label: "B", minor: 50n },
      { id: "C", label: "C", minor: 25n },
      { id: "D", label: "D", minor: 25n },
    ]);

    expect(result.totalMinor).toBe(200n);
    expect(result.rows.map((row) => row.id)).toEqual(["A", "B", "C", "D"]);
    expect(result.rows[0]?.cumulativeShare).toEqual({ numerator: 1n, denominator: 2n });
    expect(result.rows[2]?.cumulativeShare).toEqual({ numerator: 7n, denominator: 8n });
    expect(result.rows[3]?.cumulativeShare).toEqual({ numerator: 1n, denominator: 1n });
    expect(paretoIsMonotonic(result)).toBe(true);

    const top1 = result.ratios.find((ratio) => ratio.topN === 1);
    const top3 = result.ratios.find((ratio) => ratio.topN === 3);
    const top10 = result.ratios.find((ratio) => ratio.topN === 10);

    expect(top1?.share).toEqual({ numerator: 1n, denominator: 2n });
    expect(top3?.share).toEqual({ numerator: 7n, denominator: 8n });
    expect(top10?.share).toEqual({ numerator: 1n, denominator: 1n });
  });

  it("全为 0 金额时无占比（不得 0/0），负金额直接报错", () => {
    const empty = paretoOf([{ id: "A", label: "A", minor: 0n }]);
    expect(empty.rows).toEqual([]);
    expect(empty.ratios).toEqual([]);
    expect(empty.totalMinor).toBe(0n);

    expect(() => paretoOf([{ id: "A", label: "A", minor: -1n }])).toThrow(RangeError);
    expect(() =>
      paretoOf([
        { id: "A", label: "A", minor: 1n },
        { id: "A", label: "A", minor: 2n },
      ]),
    ).toThrow(RangeError);
  });
});
