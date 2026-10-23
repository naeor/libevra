import type { Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import {
  batchRemovalNeedsConfirmation,
  batchTotalCents,
  buildBatchInput,
  emptyBatchDraft,
  hasBatchContent,
  initialBatchDraft,
  validateBatchDraft,
  type BatchEntryDraft,
} from "./BatchAddSheet.js";

function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "e1",
    kind: "expense",
    amountCents: 1234,
    currency: "CNY",
    categoryId: "c-food",
    categoryName: "吃饭",
    categoryIsSystem: false,
    paymentMethodId: "p-cash",
    paymentMethodName: "现金",
    occurredAt: "2026-10-10T09:12:00+08:00",
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    note: "午饭",
    tags: [{ id: "t-a", name: "工作日", color: "#123456" }],
    version: 1,
    ...overrides,
  };
}

describe("batch-add drafts", () => {
  it("copies the selected entry into the first card without changing the original", () => {
    const source = entry();
    const draft = initialBatchDraft(source, "p-card");

    expect(draft.kind).toBe("expense");
    expect(draft.amountText).toBe("12.34");
    expect(draft.categoryId).toBe("c-food");
    expect(draft.paymentMethodId).toBe("p-cash");
    expect(draft.note).toBe("午饭");
    expect(draft.tagIds).toEqual(["t-a"]);
    expect(draft.id).not.toBe(source.id);
    expect(source.amountCents).toBe(1234);
  });

  it("starts an extra card empty and uses the ledger's fallback payment method", () => {
    const draft = emptyBatchDraft("p-card", new Date("2026-10-23T10:00:00+08:00"));

    expect(draft.amountText).toBe("");
    expect(draft.categoryId).toBeNull();
    expect(draft.paymentMethodId).toBe("p-card");
    expect(draft.tagIds).toEqual([]);
    expect(draft.currency).toBe("CNY");
    expect(hasBatchContent(draft)).toBe(false);
  });

  it("lets the caller keep the first card's currency for the next card", () => {
    const draft = emptyBatchDraft(null, new Date("2026-10-23T10:00:00+08:00"), "JPY");

    expect(draft.currency).toBe("JPY");
  });

  it("keeps one card's edits out of another card", () => {
    const first: BatchEntryDraft = {
      ...emptyBatchDraft(null, new Date("2026-10-23T10:00:00+08:00")),
      amountText: "10",
    };
    const second: BatchEntryDraft = { ...first, id: "second", amountText: "20" };

    expect(first.amountText).toBe("10");
    expect(second.amountText).toBe("20");
    expect(first.id).not.toBe(second.id);
  });

  it("sums only parsable positive cards", () => {
    const base = emptyBatchDraft(null, new Date("2026-10-23T10:00:00+08:00"));
    const drafts = [
      { ...base, id: "a", amountText: "10" },
      { ...base, id: "b", amountText: "2.50" },
      { ...base, id: "c", amountText: "" },
    ];
    expect(batchTotalCents(drafts)).toBe(1250);
  });

  it("validates amount, currency precision and time with the same rules as a single entry", () => {
    const draft = { ...emptyBatchDraft(null, new Date()), amountText: "12.345" };
    expect(validateBatchDraft(draft)).toContain("最多两位小数");

    const jpy = { ...draft, currency: "JPY" as const, amountText: "12.5" };
    expect(validateBatchDraft(jpy)).toContain("不支持小数");

    expect(validateBatchDraft({ ...draft, amountText: "" })).toBe("请填写金额。");
    expect(validateBatchDraft({ ...draft, amountText: "0" })).toBe("金额需要大于 0。");
    expect(validateBatchDraft({ ...draft, amountText: "10", occurredAt: new Date(Number.NaN) })).toBe(
      "请选择有效的时间。",
    );
  });

  it("builds an idempotent create input from the card id", () => {
    const draft = {
      ...emptyBatchDraft(null, new Date("2026-10-23T10:00:00+08:00")),
      amountText: "12.34",
    };
    const input = buildBatchInput(draft);

    expect(input.id).toBe(draft.id);
    expect(input.idempotencyKey).toBe(draft.id);
    expect(input.amountCents).toBe(1234);
    expect(input.occurredLocalDate).toBe("2026-10-23");
  });

  it("asks before removing a filled card, but not an empty one", () => {
    const empty = emptyBatchDraft(null, new Date());
    const filled = { ...emptyBatchDraft(null, new Date()), id: "filled", amountText: "8" };

    expect(batchRemovalNeedsConfirmation([empty, filled], "filled")).toBe(true);
    expect(batchRemovalNeedsConfirmation([empty, filled], empty.id)).toBe(false);
    expect(batchRemovalNeedsConfirmation([filled], filled.id)).toBe(false);
  });
});
