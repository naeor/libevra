import { describe, expect, it } from "vitest";

import { buildImportPlan, candidateLabel, composeNote } from "./import.js";
import type { OcrBatch, OcrBatchCandidate } from "./types.js";
import { batchCandidate } from "./testFixtures.js";

function batchOf(
  items: OcrBatchCandidate[],
  importIds: Record<string, string> = {},
): OcrBatch {
  return {
    version: 1,
    batchId: "batch-1",
    createdAt: "2026-10-20T00:00:00.000Z",
    bookId: "book-1",
    pages: [],
    items,
    importIds,
  };
}

describe("buildImportPlan", () => {
  it("translates one candidate into the existing create input", () => {
    const item = batchCandidate({
      isTransfer: true,
      categoryId: "c-transfer",
      paymentMethodId: "m-wechat",
      tagIds: ["tag-1"],
    });
    const plan = buildImportPlan(batchOf([item], { "img0-1": "id-1" }));

    expect(plan.blockers).toEqual([]);
    expect(plan.ready).toHaveLength(1);
    expect(plan.ready[0]?.input).toMatchObject({
      id: "id-1",
      idempotencyKey: "id-1",
      kind: "expense",
      amountCents: 2000,
      currency: "CNY",
      categoryId: "c-transfer",
      paymentMethodId: "m-wechat",
      occurredLocalDate: "2026-10-09",
      note: "老王便利店 · 账户：零钱 · 转账",
      tagIds: ["tag-1"],
    });
    expect(plan.ready[0]?.input.occurredAt).toMatch(
      /^2026-10-09T12:34:00(\.\d{3})?[+-]\d{2}:\d{2}$/,
    );
    expect(plan.ready[0]?.input.occurredTz.length).toBeGreaterThan(0);
  });

  it("uses noon when the screenshot printed no time, like the single-entry flow", () => {
    const plan = buildImportPlan(
      batchOf([batchCandidate({ occurredTime: null })], { "img0-1": "id-1" }),
    );

    expect(plan.ready[0]?.input.occurredAt).toMatch(/^2026-10-09T12:00:00/);
  });

  it("keeps an income as income", () => {
    const plan = buildImportPlan(
      batchOf(
        [batchCandidate({ direction: "income", merchant: "工资" })],
        { "img0-1": "id-1" },
      ),
    );

    expect(plan.ready[0]?.input.kind).toBe("income");
  });

  it("refuses every item it cannot honestly translate, with a reason", () => {
    const items = [
      batchCandidate({ candidateId: "no-amount", amount: null }),
      batchCandidate({ candidateId: "bad-currency", currency: "CAD" }),
      batchCandidate({ candidateId: "no-currency", currency: null }),
      batchCandidate({ candidateId: "no-direction", direction: "unknown" }),
      batchCandidate({ candidateId: "no-date", occurredLocalDate: null }),
      batchCandidate({ candidateId: "bad-time", occurredTime: "25:99" }),
      batchCandidate({ candidateId: "zero", amount: "0.00" }),
      batchCandidate({ candidateId: "long-note", merchant: "长".repeat(201) }),
    ];
    const importIds = Object.fromEntries(
      items.map((item) => [item.candidateId, `id-${item.candidateId}`]),
    );
    const plan = buildImportPlan(batchOf(items, importIds));

    expect(plan.ready).toEqual([]);
    expect(plan.blockers.map((blocker) => [blocker.candidateId, blocker.reason])).toEqual([
      ["no-amount", "金额缺失"],
      ["bad-currency", "账本不支持币种 CAD"],
      ["no-currency", "币种待确认"],
      ["no-direction", "收支方向待确认"],
      ["no-date", "日期待确认"],
      ["bad-time", "时间格式不正确"],
      ["zero", "金额需要大于 0"],
      ["long-note", "备注超过 200 字，请精简"],
    ]);
  });

  it("treats a missing fixed id as a bug rather than minting one here", () => {
    const plan = buildImportPlan(batchOf([batchCandidate()]));

    expect(plan.ready).toEqual([]);
    expect(plan.blockers[0]?.reason).toContain("幂等 id");
  });

  it("leaves invalid items out of both lists", () => {
    const plan = buildImportPlan(
      batchOf(
        [
          batchCandidate({ candidateId: "kept" }),
          batchCandidate({ candidateId: "excluded", invalid: true }),
        ],
        { kept: "id-kept", excluded: "id-excluded" },
      ),
    );

    expect(plan.ready.map((entry) => entry.candidateId)).toEqual(["kept"]);
    expect(plan.blockers).toEqual([]);
  });

  it("does not mutate the batch (nothing is written before confirmation)", () => {
    const item = batchCandidate();
    const batch = batchOf([item], { "img0-1": "id-1" });
    const before = JSON.stringify(batch);

    buildImportPlan(batch);

    expect(JSON.stringify(batch)).toBe(before);
    expect(batch.items[0]).toBe(item);
  });
});

describe("note and label", () => {
  it("separates merchant, note, account and the transfer marker", () => {
    expect(
      composeNote(
        batchCandidate({
          merchant: "张三",
          note: "房租",
          account: "零钱",
          isTransfer: true,
        }),
      ),
    ).toBe("张三 · 房租 · 账户：零钱 · 转账");
  });

  it("keeps an empty note empty instead of inventing text", () => {
    expect(
      composeNote(batchCandidate({ merchant: null, note: null, account: null })),
    ).toBeNull();
  });

  it("labels an item for the failure summary without dumping the screenshot text", () => {
    expect(candidateLabel(batchCandidate())).toBe("20.00 CNY · 老王便利店");
    expect(
      candidateLabel(batchCandidate({ amount: null, merchant: null })),
    ).toBe("金额待确认 · 商户待确认");
  });
});
