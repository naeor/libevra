import { describe, expect, it } from "vitest";

import { scatterOf } from "./scatter.js";

describe("scatterOf（P10 记录级散点）", () => {
  it("按业务日期升序输出点，并保留来源键与原始金额", () => {
    const result = scatterOf([
      { id: "r1", occurredLocalDate: "2026-10-01", amountMinor: 100n, categoryId: "food" },
      { id: "r3", occurredLocalDate: "2026-10-02", amountMinor: 200n, categoryId: "transport" },
      { id: "r2", occurredLocalDate: "2026-10-03", amountMinor: 50n, categoryId: "food" },
    ]);

    expect(result.points.map((point) => point.id)).toEqual(["r1", "r3", "r2"]);
    expect(result.points[1]?.amountMinor).toBe(200n);
    expect(result.sampleCount).toBe(3);
    expect(result.plottedCount).toBe(3);
    expect(result.omittedCount).toBe(0);
    expect(result.strategy).toBe("none");
    expect(result.complete).toBe(true);
    expect(result.completeness).toBe("complete");
  });

  it("超过 maxPoints 时按金额取前 N 并显式给出 omittedCount", () => {
    const result = scatterOf(
      [
        { id: "r1", occurredLocalDate: "2026-10-01", amountMinor: 10n, categoryId: "a" },
        { id: "r2", occurredLocalDate: "2026-10-02", amountMinor: 500n, categoryId: "a" },
        { id: "r3", occurredLocalDate: "2026-10-03", amountMinor: 300n, categoryId: "a" },
        { id: "r4", occurredLocalDate: "2026-10-04", amountMinor: 50n, categoryId: "a" },
        { id: "r5", occurredLocalDate: "2026-10-05", amountMinor: 200n, categoryId: "a" },
      ],
      { maxPoints: 3 },
    );

    // 金额前三：r2(500)、r3(300)、r5(200)；再按日期排序
    expect(result.points.map((point) => point.id)).toEqual(["r2", "r3", "r5"]);
    expect(result.sampleCount).toBe(5);
    expect(result.plottedCount).toBe(3);
    expect(result.omittedCount).toBe(2);
    expect(result.strategy).toBe("top-amount");
    expect(result.complete).toBe(false);
  });

  it("相同输入产生相同抽样（确定性）", () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      id: `r${String(index)}`,
      occurredLocalDate: "2026-10-01",
      amountMinor: BigInt(index * 10),
      categoryId: "a",
    }));

    expect(scatterOf(records, { maxPoints: 4 })).toEqual(scatterOf(records, { maxPoints: 4 }));
  });

  it("空输入是空态；非法日期/负金额/重复 id/maxPoints 报错", () => {
    const empty = scatterOf([]);
    expect(empty.points).toEqual([]);
    expect(empty.completeness).toBe("no-transactions");
    expect(empty.complete).toBe(true);

    expect(() =>
      scatterOf([{ id: "r1", occurredLocalDate: "2026-10-1", amountMinor: 1n, categoryId: "a" }]),
    ).toThrow(RangeError);
    expect(() =>
      scatterOf([{ id: "r1", occurredLocalDate: "2026-10-01", amountMinor: -1n, categoryId: "a" }]),
    ).toThrow(RangeError);
    expect(() =>
      scatterOf([
        { id: "r1", occurredLocalDate: "2026-10-01", amountMinor: 1n, categoryId: "a" },
        { id: "r1", occurredLocalDate: "2026-10-01", amountMinor: 2n, categoryId: "a" },
      ]),
    ).toThrow(RangeError);
    expect(() => scatterOf([], { maxPoints: 0 })).toThrow(RangeError);
  });
});
