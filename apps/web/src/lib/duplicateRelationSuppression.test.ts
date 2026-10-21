import { notDuplicatePairKey, type Category, type PaymentMethod, type Tag, type Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import { detectDuplicateGroups } from "./ledgerImport/duplicates.js";
import { buildTaxonomyMappingPlan } from "./ledgerImport/mapping.js";
import type { ImportSource, ImportTarget } from "./ledgerImport/types.js";
import { duplicateReason } from "./ocr/duplicates.js";
import { batchCandidate } from "./ocr/testFixtures.js";

/**
 * S15-E3 · 关系过滤只发生在 E2 适配层。
 *
 * 两条要求：
 *  1. 命中已确认「不是同一笔」的那一对 → 不提示；
 *  2. **只**跳过这一对，不推导任何传递关系；其它对与设置语义完全不变。
 *
 * 这里不改 E2 核心规则，也不碰用户设置（窗口/分类/支付方式开关仍由核心负责）。
 */

function suppressionSet(...pairs: readonly (readonly [string, string])[]): ReadonlySet<string> {
  return new Set(pairs.map(([left, right]) => notDuplicatePairKey(left, right)));
}

describe("OCR 适配层的关系过滤", () => {
  const left = batchCandidate({ candidateId: "img0-1", imageIndex: 0 });
  const right = batchCandidate({ candidateId: "img1-1", imageIndex: 1 });
  const third = batchCandidate({ candidateId: "img2-1", imageIndex: 2 });

  it("未确认时照常提示", () => {
    expect(duplicateReason(left, right)).not.toBeNull();
  });

  it("确认过的那一对不再提示", () => {
    expect(
      duplicateReason(left, right, { suppressedPairKeys: suppressionSet([left.candidateId, right.candidateId]) }),
    ).toBeNull();
  });

  it("只跳过这一对：其它组合仍会提示（无传递性）", () => {
    const suppressed = suppressionSet([left.candidateId, right.candidateId]);

    expect(duplicateReason(left, right, { suppressedPairKeys: suppressed })).toBeNull();
    expect(duplicateReason(left, third, { suppressedPairKeys: suppressed })).not.toBeNull();
    expect(duplicateReason(right, third, { suppressedPairKeys: suppressed })).not.toBeNull();
  });

  it("过滤不影响关闭提醒的设置语义", () => {
    // 关闭提醒时本来就不提示；打开提醒但给了抑制集合时只抑制那一对。
    expect(
      duplicateReason(left, right, {
        settings: { enabled: false, timeWindowSeconds: 60, matchCategory: true, matchPaymentMethod: true },
        suppressedPairKeys: suppressionSet([left.candidateId, right.candidateId]),
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 账本导入适配层
// ---------------------------------------------------------------------------

function category(id: string, name: string, kind: "expense" | "income"): Category {
  return { id, name, kind, description: null, isSystem: false, isArchived: false, sortOrder: 0 };
}

function payment(id: string, name: string): PaymentMethod {
  return { id, name, isArchived: false, sortOrder: 0 };
}

function tag(id: string, name: string): Tag {
  return { id, name, color: "#111111" };
}

const SOURCE_CATEGORIES = [category("s-food", "餐饮", "expense")];
const TARGET_CATEGORIES = [category("t-food", "餐饮", "expense")];
const PAYMENTS = [payment("t-wechat", "微信"), payment("s-wechat", "微信")];
const SOURCE_TAGS = [tag("s-trip", "出差")];
const TARGET_TAGS = [tag("t-trip", "出差")];

function transaction(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, "occurredAt">,
): Transaction {
  return {
    id,
    kind: "expense",
    amountCents: 1234,
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

function source(transactions: readonly Transaction[]): ImportSource {
  return {
    kind: "book",
    bookId: "source-book",
    identity: { name: "来源账本", bookNumber: "20000002" },
    categories: SOURCE_CATEGORIES,
    paymentMethods: PAYMENTS,
    tags: SOURCE_TAGS,
    transactions,
    hiddenDeletedCount: 0,
  };
}

function target(transactions: readonly Transaction[]): ImportTarget {
  return {
    bookId: "target-book",
    identity: { name: "目标账本", bookNumber: "10000001" },
    categories: TARGET_CATEGORIES,
    paymentMethods: PAYMENTS,
    tags: TARGET_TAGS,
    transactions,
    hiddenDeletedCount: 0,
  };
}

function run(
  sourceTransactions: readonly Transaction[],
  targetTransactions: readonly Transaction[],
  suppressed?: ReadonlySet<string>,
) {
  const left = source(sourceTransactions);
  const right = target(targetTransactions);
  return detectDuplicateGroups(
    left,
    right,
    buildTaxonomyMappingPlan(left, right),
    new Set<string>(),
    new Set<string>(),
    undefined,
    suppressed,
  );
}

describe("账本导入适配层的关系过滤", () => {
  const sourceRow = transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" });
  const targetRow = transaction("t1", {
    occurredAt: "2026-10-18T10:01:00+08:00",
    categoryId: "t-food",
  });

  it("未确认时产生重复组", () => {
    expect(run([sourceRow], [targetRow]).groups).toHaveLength(1);
  });

  it("已确认的那一对被跳过，其余检测不变", () => {
    const suppressed = suppressionSet(["s1", "t1"]);
    const result = run([sourceRow], [targetRow], suppressed);

    expect(result.groups).toHaveLength(0);
    expect(result.duplicateSourceIds.size).toBe(0);
  });

  it("抑制集合里的其它键不会误伤这一对（只按精确配对键过滤）", () => {
    const suppressed = suppressionSet(["s1", "t2"], ["s9", "t9"]);
    expect(run([sourceRow], [targetRow], suppressed).groups).toHaveLength(1);
  });
});
