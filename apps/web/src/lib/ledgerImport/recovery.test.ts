import { describe, expect, it } from "vitest";

import type { Category, Transaction } from "@libellum/shared";

import { presetDecision } from "./decisions.js";
import { buildImportPreview } from "./preview.js";
import {
  recoverGroupDecisions,
  recoverTaxonomyResolutions,
} from "./recovery.js";
import { taxonomyResolutionKey } from "./mapping.js";
import type { ImportSource, ImportTarget } from "./types.js";

function category(id: string, name: string, isArchived = false): Category {
  return {
    id,
    name,
    kind: "expense",
    description: null,
    isSystem: false,
    isArchived,
    sortOrder: 0,
  };
}

function transaction(input: {
  id: string;
  amountCents: number;
  occurredAt: string;
  categoryId: string;
  categoryName: string;
  note: string;
  version?: number;
}): Transaction {
  return {
    id: input.id,
    version: input.version ?? 1,
    kind: "expense",
    amountCents: input.amountCents,
    currency: "CNY",
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    categoryIsSystem: false,
    paymentMethodId: null,
    paymentMethodName: null,
    occurredAt: input.occurredAt,
    occurredLocalDate: "2026-10-18",
    occurredTz: "Asia/Shanghai",
    note: input.note,
    tags: [],
  };
}

function source(input: {
  category: Category;
  transactions: Transaction[];
}): ImportSource {
  return {
    kind: "book",
    bookId: "00000000-0000-4000-8000-000000000001",
    identity: { name: "来源 B", bookNumber: null },
    categories: [input.category],
    paymentMethods: [],
    tags: [],
    transactions: input.transactions,
    hiddenDeletedCount: 0,
  };
}

function target(input: {
  category: Category;
  transactions: Transaction[];
}): ImportTarget {
  return {
    bookId: "00000000-0000-4000-8000-000000000002",
    identity: { name: "目标 A", bookNumber: null },
    categories: [input.category],
    paymentMethods: [],
    tags: [],
    transactions: input.transactions,
    hiddenDeletedCount: 0,
  };
}

describe("D4 draft recovery", () => {
  it("restores unchanged groups and clears a group whose target A record changed", () => {
    const sourceCategory = category("00000000-0000-4000-8000-000000000010", "餐饮");
    const targetCategory = category("00000000-0000-4000-8000-000000000011", "餐饮");
    const sourceTx = [
      transaction({
        id: "00000000-0000-4000-8000-000000000021",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:00+08:00",
        categoryId: sourceCategory.id,
        categoryName: sourceCategory.name,
        note: "来源一",
      }),
      transaction({
        id: "00000000-0000-4000-8000-000000000022",
        amountCents: 2000,
        occurredAt: "2026-10-18T13:00:00+08:00",
        categoryId: sourceCategory.id,
        categoryName: sourceCategory.name,
        note: "来源二",
      }),
    ];
    const targetTx = [
      transaction({
        id: "00000000-0000-4000-8000-000000000031",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:10+08:00",
        categoryId: targetCategory.id,
        categoryName: targetCategory.name,
        note: "目标一",
      }),
      transaction({
        id: "00000000-0000-4000-8000-000000000032",
        amountCents: 2000,
        occurredAt: "2026-10-18T13:00:10+08:00",
        categoryId: targetCategory.id,
        categoryName: targetCategory.name,
        note: "目标二",
      }),
    ];

    const previous = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: targetTx }),
      new Map(),
    );
    expect(previous.duplicateGroups).toHaveLength(2);
    const [firstGroup, secondGroup] = previous.duplicateGroups;
    const decisions = new Map([
      [firstGroup!.id, presetDecision(firstGroup!, "keep_both")],
      [secondGroup!.id, presetDecision(secondGroup!, "keep_b")],
    ]);

    const changedTarget = targetTx.map((item, index) =>
      index === 1 ? { ...item, note: "目标二被编辑", version: 2 } : item,
    );
    const next = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: changedTarget }),
      new Map(),
    );

    const recovery = recoverGroupDecisions(previous, next, decisions);
    expect(recovery.restoredGroupIds).toHaveLength(1);
    expect(recovery.changedGroupIds).toHaveLength(1);
    // The changed group must not be silently applied to any other target row.
    expect(recovery.decisions.size).toBe(1);
    const restoredDecision = [...recovery.decisions.values()][0]!;
    expect(restoredDecision.action).toBe("keep_both");
  });

  it("does not restore by amount/date similarity when the target record id changes", () => {
    const sourceCategory = category("00000000-0000-4000-8000-000000000110", "餐饮");
    const targetCategory = category("00000000-0000-4000-8000-000000000111", "餐饮");
    const sourceTx = [
      transaction({
        id: "00000000-0000-4000-8000-000000000121",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:00+08:00",
        categoryId: sourceCategory.id,
        categoryName: sourceCategory.name,
        note: "来源",
      }),
    ];
    const oldTarget = [
      transaction({
        id: "00000000-0000-4000-8000-000000000131",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:10+08:00",
        categoryId: targetCategory.id,
        categoryName: targetCategory.name,
        note: "旧目标",
      }),
    ];
    const previous = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: oldTarget }),
      new Map(),
    );
    const previousGroup = previous.duplicateGroups[0]!;
    const decisions = new Map([[previousGroup.id, presetDecision(previousGroup, "keep_b")]]);

    const newTarget = [
      transaction({
        id: "00000000-0000-4000-8000-000000000132",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:10+08:00",
        categoryId: targetCategory.id,
        categoryName: targetCategory.name,
        note: "同金额同时间的新目标",
      }),
    ];
    const next = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: newTarget }),
      new Map(),
    );
    const recovery = recoverGroupDecisions(previous, next, decisions);
    expect(recovery.decisions.size).toBe(0);
    expect(recovery.changedGroupIds).toEqual([next.duplicateGroups[0]!.id]);
  });

  it("drops a taxonomy resolution when the target conflict object changed", () => {
    const sourceCategory = category("00000000-0000-4000-8000-000000000210", "餐饮");
    const targetCategory = category("00000000-0000-4000-8000-000000000211", "餐饮", true);
    const sourceTx = [
      transaction({
        id: "00000000-0000-4000-8000-000000000221",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:00+08:00",
        categoryId: sourceCategory.id,
        categoryName: sourceCategory.name,
        note: "来源",
      }),
    ];
    const targetTx = [
      transaction({
        id: "00000000-0000-4000-8000-000000000231",
        amountCents: 1000,
        occurredAt: "2026-10-18T12:00:10+08:00",
        categoryId: targetCategory.id,
        categoryName: targetCategory.name,
        note: "目标",
      }),
    ];
    const previous = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: targetTx }),
      new Map(),
    );
    expect(previous.mapping.conflicts).toHaveLength(1);
    const key = taxonomyResolutionKey("category", sourceCategory.id);
    const resolutions = new Map<string, "reuse" | "create">([[key, "create"]]);

    const unchanged = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      target({ category: targetCategory, transactions: targetTx }),
      new Map(),
    );
    expect(recoverTaxonomyResolutions(previous, unchanged, resolutions).get(key)).toBe("create");

    const targetChanged = target({ category: category(targetCategory.id, "餐饮", false), transactions: targetTx });
    const changed = buildImportPreview(
      source({ category: sourceCategory, transactions: sourceTx }),
      targetChanged,
      new Map(),
    );
    expect(recoverTaxonomyResolutions(previous, changed, resolutions).size).toBe(0);
  });
});
