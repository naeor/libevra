import { describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag, Transaction } from "@libellum/shared";
import { notDuplicatePairKey } from "@libellum/shared";

import { buildImportPreview } from "./preview.js";
import type { ImportSource, ImportTarget } from "./types.js";

function category(
  id: string,
  name: string,
  kind: "expense" | "income",
  options: { readonly isSystem?: boolean; readonly isArchived?: boolean } = {},
): Category {
  return {
    id,
    name,
    kind,
    description: null,
    isSystem: options.isSystem ?? false,
    isArchived: options.isArchived ?? false,
    sortOrder: 0,
  };
}

function payment(id: string, name: string): PaymentMethod {
  return { id, name, isArchived: false, sortOrder: 0 };
}

function tag(id: string, name: string, color = "#111111"): Tag {
  return { id, name, color };
}

function transaction(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, "occurredAt">,
): Transaction {
  return {
    id,
    kind: "expense",
    amountCents: 1000,
    currency: "CNY",
    categoryId: "s-food",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredLocalDate: "2026-10-18",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  };
}

const CATEGORIES = {
  target: [
    category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
    category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
    category("t-food", "餐饮", "expense"),
    category("t-shop-arch", "购物", "expense", { isArchived: true }),
  ],
  source: [
    category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
    category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
    category("s-food", "餐饮", "expense"),
    category("s-shop", "购物", "expense"),
    category("s-traffic", "交通", "expense"),
  ],
};
const PAYMENTS = {
  target: [payment("t-wechat", "微信")],
  source: [payment("s-wechat", "微信")],
};
const TAGS = {
  target: [tag("t-trip", "出差")],
  source: [tag("s-trip", "出差"), tag("s-new", "项目", "#333333")],
};

function source(transactions: readonly Transaction[], hiddenDeletedCount = 0): ImportSource {
  return {
    kind: "guest",
    bookId: "guest-book-1",
    identity: { name: "我的本地账本", bookNumber: null },
    categories: CATEGORIES.source,
    paymentMethods: PAYMENTS.source,
    tags: TAGS.source,
    transactions,
    hiddenDeletedCount,
  };
}

function target(transactions: readonly Transaction[]): ImportTarget {
  return {
    bookId: "target-book",
    identity: { name: "旅行账本", bookNumber: "10000008" },
    categories: CATEGORIES.target,
    paymentMethods: PAYMENTS.target,
    tags: TAGS.target,
    transactions,
    hiddenDeletedCount: 0,
  };
}

describe("buildImportPreview", () => {
  it("汇总币种/收支金额、日期范围与目标已有数量", () => {
    const preview = buildImportPreview(
      source([
        transaction("s1", {
          occurredAt: "2026-10-18T10:00:00+08:00",
          amountCents: 1234,
          currency: "CNY",
        }),
        transaction("s2", {
          occurredAt: "2026-10-17T09:00:00+08:00",
          kind: "income",
          amountCents: 5000,
          currency: "CNY",
        }),
        transaction("s3", {
          occurredAt: "2026-10-18T11:00:00+08:00",
          amountCents: 555,
          currency: "USD",
        }),
      ]),
      target([
        transaction("t1", { occurredAt: "2026-10-01T10:00:00+08:00", categoryId: "t-food" }),
      ]),
    );

    expect(preview.counts.sourceTransactions).toBe(3);
    expect(preview.counts.targetTransactions).toBe(1);
    expect(preview.totals).toEqual([
      { currency: "CNY", expenseCents: 1234, incomeCents: 5000, count: 2 },
      { currency: "USD", expenseCents: 555, incomeCents: 0, count: 1 },
    ]);
    expect(preview.dateRange).toEqual({
      from: "2026-10-17T09:00:00+08:00",
      to: "2026-10-18T11:00:00+08:00",
    });
    expect(preview.warnings.some((warning) => warning.includes("目标账本已有 1 条"))).toBe(true);
  });

  it("没有命中的来源记录进入默认待导入数量，命中项进入冲突统计", () => {
    const preview = buildImportPreview(
      source([
        transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" }),
        transaction("s2", { occurredAt: "2026-10-18T12:00:00+08:00" }),
      ]),
      target([
        transaction("t1", {
          occurredAt: "2026-10-18T10:00:30+08:00",
          categoryId: "t-food",
        }),
      ]),
    );

    expect(preview.duplicateGroups).toHaveLength(1);
    expect(preview.counts.duplicateSourceRecords).toBe(1);
    expect(preview.counts.duplicateTargetRecords).toBe(1);
    expect(preview.counts.importableWithoutConflict).toBe(1);
    expect(preview.counts.duplicateGroups).toBe(1);
    expect(preview.warnings.some((warning) => warning.includes("可能重复"))).toBe(true);
  });

  it("已确认「不是同一笔」的配对不再进入重复组，但两笔都还在", () => {
    const sourceEntry = transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" });
    const targetEntry = transaction("t1", {
      occurredAt: "2026-10-18T10:00:30+08:00",
      categoryId: "t-food",
    });

    const withSuppression = buildImportPreview(source([sourceEntry]), target([targetEntry]), undefined, {
      suppressedPairKeys: new Set([notDuplicatePairKey("s1", "t1")]),
    });
    const withoutSuppression = buildImportPreview(source([sourceEntry]), target([targetEntry]));

    expect(withoutSuppression.duplicateGroups).toHaveLength(1);
    // 抑制只影响“提示”，不影响任何一笔的去留：导入数、目标记录数都不变。
    expect(withSuppression.duplicateGroups).toHaveLength(0);
    expect(withSuppression.counts.duplicateSourceRecords).toBe(0);
    expect(withSuppression.counts.importableWithoutConflict).toBe(1);
    expect(withSuppression.counts.targetTransactions).toBe(1);
  });

  it("来源墓碑只进入跳过统计与说明，不进入待导入", () => {
    const preview = buildImportPreview(
      source([transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" })], 2),
      target([]),
    );
    expect(preview.counts.sourceSkippedDeleted).toBe(2);
    expect(preview.counts.sourceTransactions).toBe(1);
    expect(preview.counts.importableWithoutConflict).toBe(1);
    expect(preview.warnings.some((warning) => warning.includes("2 条已删除"))).toBe(true);
  });

  it("taxonomy 冲突单独提示，不静默丢失属性", () => {
    const preview = buildImportPreview(
      source([transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00", categoryId: "s-shop" })]),
      target([transaction("t1", { occurredAt: "2026-10-18T11:00:00+08:00" })]),
    );
    const categoryConflict = preview.mapping.conflicts.find((item) => item.type === "category");
    expect(categoryConflict?.reason).toBe("category_archive_mismatch");
    expect(preview.mapping.counts.categories.create).toBeGreaterThan(0);
    expect(preview.warnings.some((warning) => warning.includes("同名但属性不同"))).toBe(true);
  });

  it("游客来源明确说明不会自动删除游客数据", () => {
    const preview = buildImportPreview(
      source([transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" })]),
      target([]),
    );
    expect(preview.warnings.some((warning) => warning.includes("清理仍是单独操作"))).toBe(true);
    expect(preview.source.kind).toBe("guest");
  });

  it("空来源不会产生冲突或错误", () => {
    const preview = buildImportPreview(source([]), target([]));
    expect(preview.counts.sourceTransactions).toBe(0);
    expect(preview.duplicateGroups).toEqual([]);
    expect(preview.dateRange).toEqual({ from: null, to: null });
    expect(preview.totals).toEqual([]);
  });
});
