import { describe, expect, it } from "vitest";

import { deriveIssues, isItemComplete } from "../lib/ocr/types.js";
import { batchCandidate } from "../lib/ocr/testFixtures.js";
import { initialForm, previewCandidate } from "./OcrReviewDetailPage.js";

/**
 * The detail screen's data mapping, without a DOM.
 *
 * The screen edits a temporary batch item; these tests pin two things that are
 * easy to get wrong: clearing a field must become “待确认” rather than an empty
 * string, and a field the user filled must stop being reported as unread.
 */

describe("initialForm", () => {
  it("opens on the candidate's own values", () => {
    const form = initialForm(batchCandidate());

    expect(form).toMatchObject({
      amount: "20.00",
      kind: "expense",
      currency: "CNY",
      date: "2026-10-09",
      time: "12:34",
      merchant: "老王便利店",
      account: "零钱",
    });
    expect(form.categoryId).toBe("");
    expect(form.paymentMethodId).toBe("");
    expect(form.tagIds).toEqual([]);
  });

  it("keeps an unsupported currency visible rather than silently replacing it", () => {
    // The ledger supports six currencies; OCR can read CAD. The select shows it
    // as unsupported so the user has to make a choice.
    expect(initialForm(batchCandidate({ currency: "CAD" })).currency).toBe("CAD");
  });

  it("turns an income candidate into the income kind", () => {
    expect(initialForm(batchCandidate({ direction: "income" })).kind).toBe("income");
  });

  it("does not quietly turn an unknown direction into expense", () => {
    // The form has to offer a radio, but until the user chooses, the candidate
    // stays `unknown` and the issue stays visible; the import preflight refuses it.
    const item = batchCandidate({
      direction: "unknown",
      issues: [
        { code: "direction_unclear", message: "没有读出收支方向，请确认。", field: "direction" },
      ],
    });
    const form = initialForm(item);

    expect(form.directionConfirmed).toBe(false);
    expect(previewCandidate(item, form).direction).toBe("unknown");
    expect(deriveIssues(previewCandidate(item, form)).map((issue) => issue.code)).toContain(
      "direction_unclear",
    );
  });
});

describe("previewCandidate", () => {
  it("clears missing-field issues once the user fills the fields", () => {
    const item = batchCandidate({
      amount: null,
      merchant: null,
      occurredLocalDate: null,
      issues: [
        { code: "missing_amount", message: "没有读出金额", field: "amount" },
        { code: "missing_merchant", message: "没有读出商户", field: "merchant" },
        { code: "missing_date", message: "没有读出日期", field: "date" },
      ],
    });
    const form = {
      ...initialForm(item),
      amount: "18.50",
      merchant: "小杨生煎",
      date: "2026-10-20",
    };

    expect(deriveIssues(previewCandidate(item, form))).toEqual([]);
    expect(isItemComplete(previewCandidate(item, form))).toBe(true);
  });

  it("keeps a blank field blank instead of writing an empty string", () => {
    const preview = previewCandidate(batchCandidate(), {
      ...initialForm(batchCandidate()),
      amount: "   ",
      merchant: "",
      note: "",
      account: "",
    });

    expect(preview.amount).toBeNull();
    expect(preview.merchant).toBeNull();
    expect(preview.note).toBeNull();
    expect(preview.account).toBeNull();
  });

  it("keeps the transfer flag when the type is edited", () => {
    const item = batchCandidate({ isTransfer: true, direction: "income" });
    const preview = previewCandidate(item, { ...initialForm(item), kind: "expense" });

    expect(preview.direction).toBe("expense");
    expect(preview.isTransfer).toBe(true);
  });
});
