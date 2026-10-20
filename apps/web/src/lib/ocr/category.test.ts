import { describe, expect, it } from "vitest";

import {
  applyCategorySuggestions,
  inferCategory,
  usableCategories,
  type CategoryLike,
} from "./category.js";
import { batchCandidate } from "./testFixtures.js";
import { countBatchItems, deriveIssues, itemStatus } from "./types.js";

/**
 * OCR 分类联想的规则。
 *
 * 和语音的分类联想共用 `matchCategory`，但输入是识别出的**交易对象/备注文字**，而不是
 * 一句 spoken 句子；因此这里钉住的是“什么时候**不**建议”——已有分类、方向不明、转账/
 * 退款、跨 kind、归档/系统分类、两边文字互相矛盾——因为错误建议是这一层唯一真正的风险。
 */

const CATEGORIES: readonly CategoryLike[] = [
  { id: "c-food", name: "餐饮", kind: "expense", isArchived: false, isSystem: false },
  { id: "c-transport", name: "交通", kind: "expense", isArchived: false, isSystem: false },
  { id: "c-salary", name: "工资", kind: "income", isArchived: false, isSystem: false },
  { id: "c-old", name: "餐饮", kind: "expense", isArchived: true, isSystem: false },
  { id: "c-system", name: "暂无分类", kind: "expense", isArchived: false, isSystem: true },
];

describe("usableCategories", () => {
  it("keeps only same-kind, active, non-system categories", () => {
    expect(usableCategories(CATEGORIES, "expense").map((category) => category.id)).toEqual([
      "c-food",
      "c-transport",
    ]);
    expect(usableCategories(CATEGORIES, "income").map((category) => category.id)).toEqual([
      "c-salary",
    ]);
  });
});

describe("inferCategory", () => {
  it("suggests an existing category matched from the merchant text", () => {
    const suggestion = inferCategory(
      batchCandidate({ merchant: "美团外卖", categoryId: null }),
      CATEGORIES,
    );

    expect(suggestion?.categoryId).toBe("c-food");
    expect(suggestion?.matched).toContain("外卖");
  });

  it("uses the note when the merchant says nothing", () => {
    const suggestion = inferCategory(
      batchCandidate({ merchant: "张三", note: "午饭三十八", categoryId: null }),
      CATEGORIES,
    );

    expect(suggestion?.categoryId).toBe("c-food");
  });

  it("never returns a category that is not in the ledger list", () => {
    const suggestion = inferCategory(
      batchCandidate({ merchant: "打车回家", categoryId: null }),
      CATEGORIES,
    );

    expect(suggestion).not.toBeNull();
    expect(CATEGORIES.map((category) => category.id)).toContain(suggestion?.categoryId);
  });

  it("does not cross kinds", () => {
    // Income candidate, only expense categories in the ledger.
    expect(
      inferCategory(
        batchCandidate({ direction: "income", merchant: "美团外卖", categoryId: null }),
        CATEGORIES.filter((category) => category.id !== "c-salary"),
      ),
    ).toBeNull();
    // A salary word must not be offered to an expense candidate.
    expect(
      inferCategory(
        batchCandidate({ direction: "expense", merchant: "工资到账", categoryId: null }),
        CATEGORIES,
      ),
    ).toBeNull();
  });

  it("ignores archived and system categories", () => {
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null }),
        CATEGORIES.filter((category) => category.id === "c-old"),
      ),
    ).toBeNull();
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null }),
        CATEGORIES.filter((category) => category.id === "c-system"),
      ),
    ).toBeNull();
  });

  it("never overwrites a category that is already set", () => {
    expect(
      inferCategory(batchCandidate({ merchant: "美团外卖", categoryId: "c-transport" }), CATEGORIES),
    ).toBeNull();
  });

  it("does not re-infer after the user cleared the category", () => {
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null, categorySource: "user" }),
        CATEGORIES,
      ),
    ).toBeNull();
  });

  it("does not force a normal category onto a transfer or a refund", () => {
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null, isTransfer: true }),
        CATEGORIES,
      ),
    ).toBeNull();
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null, isRefund: true }),
        CATEGORIES,
      ),
    ).toBeNull();
  });

  it("does not guess when the direction is unknown", () => {
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", categoryId: null, direction: "unknown" }),
        CATEGORIES,
      ),
    ).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(
      inferCategory(batchCandidate({ merchant: "老王便利店", categoryId: null }), CATEGORIES),
    ).toBeNull();
    expect(inferCategory(batchCandidate({ categoryId: null }), [])).toBeNull();
  });

  it("refuses to pick when the merchant and the note point at different categories", () => {
    // 打车 = 交通, 午饭 = 餐饮: two different pieces of evidence. No confidence score
    // exists in `matchCategory`, so the honest answer is “ask the user”.
    expect(
      inferCategory(
        batchCandidate({ merchant: "滴滴打车", note: "午饭", categoryId: null }),
        CATEGORIES,
      ),
    ).toBeNull();
  });

  it("accepts the same category from both texts", () => {
    expect(
      inferCategory(
        batchCandidate({ merchant: "美团外卖", note: "午饭", categoryId: null }),
        CATEGORIES,
      )?.categoryId,
    ).toBe("c-food");
  });
});

describe("applyCategorySuggestions", () => {
  it("writes the suggestion with its source and changes nothing else", () => {
    const item = batchCandidate({
      merchant: "美团外卖",
      categoryId: null,
      paymentMethodId: "m-wechat",
      tagIds: ["t-work"],
      note: "加班",
    });
    const before = JSON.parse(JSON.stringify(item)) as unknown;
    const next = applyCategorySuggestions([item], CATEGORIES);

    expect(next).not.toBeNull();
    const updated = next?.[0];
    expect(updated?.categoryId).toBe("c-food");
    expect(updated?.categorySource).toBe("inferred");
    expect({ ...updated, categoryId: null, categorySource: undefined }).toEqual({
      ...item,
      categorySource: undefined,
    });
    // The input is untouched, so a later render still sees the stored batch.
    expect(JSON.parse(JSON.stringify(item)) as unknown).toEqual(before);
  });

  it("returns null when there is nothing to change, so callers can stay idle", () => {
    expect(
      applyCategorySuggestions([batchCandidate({ merchant: "老王便利店" })], CATEGORIES),
    ).toBeNull();
    expect(
      applyCategorySuggestions(
        [batchCandidate({ merchant: "美团外卖", categoryId: "c-transport" })],
        CATEGORIES,
      ),
    ).toBeNull();
    // Idempotent: after applying once, the second pass has no work to do.
    const first = applyCategorySuggestions(
      [batchCandidate({ merchant: "美团外卖", categoryId: null })],
      CATEGORIES,
    );
    expect(first).not.toBeNull();
    expect(applyCategorySuggestions(first ?? [], CATEGORIES)).toBeNull();
  });

  it("does not remove a record's unresolved state", () => {
    const item = batchCandidate({
      merchant: "美团外卖",
      categoryId: null,
      occurredLocalDate: null,
      issues: [{ code: "missing_date", message: "没有读出日期", field: "date" }],
    });
    const statusBefore = itemStatus(item);
    const issuesBefore = deriveIssues(item).map((issue) => issue.code);
    const countsBefore = countBatchItems([item]);

    const updated = applyCategorySuggestions([item], CATEGORIES)?.[0];
    expect(updated).toBeDefined();

    expect(itemStatus(updated!)).toBe(statusBefore);
    expect(deriveIssues(updated!).map((issue) => issue.code)).toEqual(issuesBefore);
    expect(countBatchItems([updated!])).toEqual(countsBefore);
    // The category is not part of “is this importable”, on purpose.
    expect(updated?.categoryId).toBe("c-food");
  });

  it("leaves invalid records alone", () => {
    expect(
      applyCategorySuggestions(
        [batchCandidate({ merchant: "美团外卖", categoryId: null, invalid: true })],
        CATEGORIES,
      ),
    ).toBeNull();
  });
});
