import { describe, expect, it } from "vitest";

import { rankMigration } from "./migration.js";

const previous = [
  { id: "A", label: "餐饮", minor: 100n },
  { id: "B", label: "交通", minor: 200n },
  { id: "C", label: "购物", minor: 50n },
];

const current = [
  { id: "A", label: "餐饮", minor: 300n },
  { id: "B", label: "交通", minor: 100n },
  { id: "D", label: "娱乐", minor: 80n },
];

describe("rankMigration（P09 排名迁移）", () => {
  it("名次变化、新分类、消失分类", () => {
    const result = rankMigration(previous, current);

    expect(result.previousEntryCount).toBe(3);
    expect(result.currentEntryCount).toBe(3);
    expect(result.rows.map((row) => row.id)).toEqual(["A", "B", "D", "C"]);
    expect(result.rankingPolicy).toBe("amount-desc-id-asc-ties-share-rank");

    const [a, b, d, c] = result.rows;
    // 上期 B1 A2 C3；本期 A1 B2 D3
    expect(a?.previousRank).toBe(2);
    expect(a?.currentRank).toBe(1);
    expect(a?.rankDelta).toBe(1);
    expect(a?.amountDeltaMinor).toBe(200n);
    expect(a?.isNew).toBe(false);

    expect(b?.rankDelta).toBe(-1);
    expect(b?.amountDeltaMinor).toBe(-100n);

    expect(d?.isNew).toBe(true);
    expect(d?.previousRank).toBeNull();
    expect(d?.rankDelta).toBeNull();
    expect(d?.previousMinor).toBe(0n);
    expect(d?.currentMinor).toBe(80n);

    expect(c?.isRemoved).toBe(true);
    expect(c?.currentRank).toBeNull();
    expect(c?.rankDelta).toBeNull();
    expect(c?.currentMinor).toBe(0n);
    expect(c?.amountDeltaMinor).toBe(-50n);

    expect(result.movedCount).toBe(2);
    expect(result.newCount).toBe(1);
    expect(result.removedCount).toBe(1);
  });

  it("同额共享名次（competition rank），名次差为 0 不计入 movedCount", () => {
    const result = rankMigration(
      [
        { id: "A", label: "A", minor: 100n },
        { id: "B", label: "B", minor: 100n },
        { id: "C", label: "C", minor: 50n },
      ],
      [
        { id: "A", label: "A", minor: 100n },
        { id: "B", label: "B", minor: 50n },
        { id: "C", label: "C", minor: 50n },
      ],
    );

    const byId = new Map(result.rows.map((row) => [row.id, row]));
    // 上期：A1 B1 C3；本期：A1 B2 C2
    expect(byId.get("A")?.rankDelta).toBe(0);
    expect(byId.get("B")?.previousRank).toBe(1);
    expect(byId.get("B")?.currentRank).toBe(2);
    expect(byId.get("C")?.previousRank).toBe(3);
    expect(byId.get("C")?.currentRank).toBe(2);
    expect(result.movedCount).toBe(2);
    expect(result.newCount).toBe(0);
    expect(result.removedCount).toBe(0);
  });

  it("两期都为空时给出空结果", () => {
    const result = rankMigration([], []);
    expect(result.rows).toEqual([]);
    expect(result.movedCount).toBe(0);
    expect(result.newCount).toBe(0);
    expect(result.removedCount).toBe(0);
  });

  it("重复 id 或负金额报错", () => {
    expect(() =>
      rankMigration(
        [
          { id: "A", label: "A", minor: 1n },
          { id: "A", label: "A2", minor: 2n },
        ],
        [],
      ),
    ).toThrow(RangeError);

    expect(() => rankMigration([{ id: "A", label: "A", minor: -1n }], [])).toThrow(RangeError);
    expect(() => rankMigration([], [{ id: "A", label: "A", minor: -1n }])).toThrow(RangeError);
  });
});
