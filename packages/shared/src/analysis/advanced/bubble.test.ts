import { describe, expect, it } from "vitest";

import { bubblesOf } from "./bubble.js";

describe("bubblesOf（P11 分类气泡）", () => {
  it("金额、笔数、均值与份额", () => {
    const result = bubblesOf([
      { categoryId: "food", categoryLabel: "餐饮", count: 3, sumMinor: 900n },
      { categoryId: "transport", categoryLabel: "交通", count: 1, sumMinor: 300n },
      { categoryId: "shopping", categoryLabel: "购物", count: 0, sumMinor: 0n },
    ]);

    expect(result.totalMinor).toBe(1200n);
    expect(result.totalCount).toBe(4);
    expect(result.completeness).toBe("complete");
    // 金额降序
    expect(result.bubbles.map((bubble) => bubble.categoryId)).toEqual([
      "food",
      "transport",
      "shopping",
    ]);

    const food = result.bubbles[0];
    expect(food?.meanMinor).toEqual({ numerator: 300n, denominator: 1n });
    expect(food?.shareOfTotal).toEqual({ numerator: 3n, denominator: 4n });

    const shopping = result.bubbles[2];
    // count = 0 时均值为 null，不写 0
    expect(shopping?.meanMinor).toBeNull();
    expect(shopping?.shareOfTotal).toEqual({ numerator: 0n, denominator: 1n });
  });

  it("空输入是空态，total 为 0", () => {
    const result = bubblesOf([]);
    expect(result.bubbles).toEqual([]);
    expect(result.totalMinor).toBe(0n);
    expect(result.totalCount).toBe(0);
    expect(result.completeness).toBe("no-transactions");
  });

  it("重复 id / 负金额 / 非法 count 报错", () => {
    expect(() =>
      bubblesOf([
        { categoryId: "a", categoryLabel: "A", count: 1, sumMinor: 1n },
        { categoryId: "a", categoryLabel: "A2", count: 1, sumMinor: 1n },
      ]),
    ).toThrow(RangeError);

    expect(() =>
      bubblesOf([{ categoryId: "a", categoryLabel: "A", count: 1, sumMinor: -1n }]),
    ).toThrow(RangeError);

    expect(() =>
      bubblesOf([{ categoryId: "a", categoryLabel: "A", count: 1.5, sumMinor: 1n }]),
    ).toThrow(RangeError);
  });
});
