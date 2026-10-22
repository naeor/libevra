import { describe, expect, it } from "vitest";

import { parseTransactionText, type CategoryCandidate } from "@libellum/shared";

import { draftOf } from "./VoiceReviewPage.js";

/**
 * The spoken/pasted candidate → review-form mapping.
 *
 * This is the join where a correct parser result can still become a wrong form:
 * a date falling back to the server's day, a payment label matched to the wrong
 * card, an archived category surviving a sync. Pure, so it is tested here rather
 * than through a session.
 */
const NOW = new Date(2026, 9, 22, 10, 30, 0);

const CATEGORIES: readonly CategoryCandidate[] = [
  { id: "c-food", name: "餐饮", kind: "expense", isArchived: false },
  { id: "c-transport", name: "交通", kind: "expense", isArchived: false },
  { id: "c-old", name: "旧分类", kind: "expense", isArchived: true },
];

const METHODS = [
  { id: "m-alipay", name: "支付宝", isArchived: false },
  { id: "m-wechat", name: "微信", isArchived: false },
];

function parsedOf(text: string) {
  return parseTransactionText(text, { categories: CATEGORIES, now: NOW });
}

describe("draftOf", () => {
  it("carries amount, currency, direction, date, merchant category and payment method", () => {
    const { draft, categoryReason, heardCategoryId } = draftOf(
      parsedOf("昨天用支付宝在麦当劳花了二十八块五。"),
      "",
      CATEGORIES,
      METHODS,
      null,
      NOW,
    );

    expect(draft).toMatchObject({
      amount: "28.5",
      currency: "CNY",
      kind: "expense",
      date: "2026-10-21",
      categoryId: "c-food",
      paymentMethodId: "m-alipay",
    });
    expect(heardCategoryId).toBe("c-food");
    expect(categoryReason).toContain("麦当劳");
  });

  it("produces the same form values for spoken and pasted wording of one transaction", () => {
    const spoken = draftOf(parsedOf("昨天用支付宝在麦当劳花了二十八块五。"), "", CATEGORIES, METHODS, null, NOW);
    const pasted = draftOf(parsedOf("昨天用支付宝在麦当劳花了28.5元。"), "", CATEGORIES, METHODS, null, NOW);

    expect(pasted.draft).toEqual(spoken.draft);
  });

  it("matches a longer payment label when the ledger holds the shorter name", () => {
    const { draft } = draftOf(
      parsedOf("微信支付：交易成功，实付 ¥28.50。"),
      "",
      CATEGORIES,
      METHODS,
      null,
      NOW,
    );

    expect(draft.paymentMethodId).toBe("m-wechat");
  });

  it("leaves the payment method empty rather than guessing", () => {
    const { draft } = draftOf(parsedOf("买菜 20 元"), "", CATEGORIES, METHODS, null, NOW);

    expect(draft.paymentMethodId).toBeNull();
  });

  it("falls back to today only when the text carried no date", () => {
    const { draft } = draftOf(parsedOf("麦当劳 28 元"), "", CATEGORIES, METHODS, null, NOW);

    expect(draft.date).toBe("2026-10-22");
    expect(draft.time).toBe("");
  });

  it("never selects an archived or unknown category", () => {
    const parsed = { ...parsedOf("麦当劳 28 元"), categoryId: "c-old" };
    const { draft, heardCategoryId } = draftOf(parsed, "", CATEGORIES, METHODS, "c-missing", NOW);

    expect(heardCategoryId).toBeNull();
    expect(draft.categoryId).toBeNull();
  });

  it("keeps a missing amount empty and uses the original sentence as the note fallback", () => {
    const { draft } = draftOf(null, "昨天吃了拉面", CATEGORIES, METHODS, null, NOW);

    expect(draft.amount).toBe("");
    expect(draft.kind).toBe("expense");
    expect(draft.currency).toBe("CNY");
    expect(draft.note).toBe("昨天吃了拉面");
  });

  it("does not turn a pasted payment detail into a saved note", () => {
    const parsed = parsedOf(
      "微信支付：交易成功\n商户名称：麦当劳\n订单号：420000123456789\n实付：¥28.50",
    );
    const { draft } = draftOf(parsed, "", CATEGORIES, METHODS, null, NOW, false);

    expect(draft.note).toBe("麦当劳");
    expect(draft.note).not.toContain("订单号");
    expect(draft.note).not.toContain("交易成功");
  });
});
