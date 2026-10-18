import { describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag, Transaction } from "@libellum/shared";

import { detectDuplicateGroups } from "./duplicates.js";
import { buildTaxonomyMappingPlan } from "./mapping.js";
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

function tag(id: string, name: string): Tag {
  return { id, name, color: "#111111" };
}

const TARGET_CATEGORIES = [
  category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
  category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
  category("t-food", "餐饮", "expense"),
  category("t-shop", "购物", "expense"),
  category("t-salary", "工资", "income"),
];
const SOURCE_CATEGORIES = [
  category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
  category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
  category("s-food", "餐饮", "expense"),
  category("s-shop", "购物", "expense"),
  category("s-salary", "工资", "income"),
];
const TARGET_TAGS = [tag("t-trip", "出差"), tag("t-reimb", "报销")];
const SOURCE_TAGS = [tag("s-trip", "出差"), tag("s-reimb", "报销")];
const PAYMENTS = [payment("t-wechat", "微信"), payment("s-wechat", "微信")];

function sourceSnapshot(transactions: readonly Transaction[]): ImportSource {
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

function targetSnapshot(transactions: readonly Transaction[]): ImportTarget {
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

function targetTransaction(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, "occurredAt">,
): Transaction {
  return transaction(id, { categoryId: "t-food", categoryName: "餐饮", ...overrides });
}

function run(transactionsInSource: readonly Transaction[], transactionsInTarget: readonly Transaction[]) {
  const source = sourceSnapshot(transactionsInSource);
  const target = targetSnapshot(transactionsInTarget);
  return detectDuplicateGroups(source, target, buildTaxonomyMappingPlan(source, target));
}

describe("detectDuplicateGroups", () => {
  it("时间相差 60 秒、收支/金额/币种/映射分类/标签集合一致时命中", () => {
    const result = run(
      [
        transaction("s1", {
          occurredAt: "2026-10-18T10:00:00+08:00",
          tags: [SOURCE_TAGS[0]!, SOURCE_TAGS[1]!],
        }),
      ],
      [
        targetTransaction("t1", {
          occurredAt: "2026-10-18T10:01:00+08:00",
          tags: [TARGET_TAGS[1]!, TARGET_TAGS[0]!],
        }),
      ],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.records.map((record) => record.transaction.id)).toEqual(["s1", "t1"]);
    expect(result.duplicateSourceIds.has("s1")).toBe(true);
    expect(result.duplicateTargetIds.has("t1")).toBe(true);
  });

  it("超过 60 秒不命中", () => {
    const result = run(
      [transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" })],
      [targetTransaction("t1", { occurredAt: "2026-10-18T10:01:01+08:00" })],
    );
    expect(result.groups).toEqual([]);
  });

  it("收支类型、金额或币种任一不同都不命中", () => {
    const base = { occurredAt: "2026-10-18T10:00:00+08:00" };
    for (const target of [
      targetTransaction("t-kind", { ...base, kind: "income" }),
      targetTransaction("t-amount", { ...base, amountCents: 1235 }),
      targetTransaction("t-currency", { ...base, currency: "USD" }),
    ]) {
      expect(run([transaction("s1", base)], [target])).toMatchObject({ groups: [] });
    }
  });

  it("分类按映射后语义比较：来源与目标的内部 id 不同仍能命中", () => {
    const result = run(
      [transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00", categoryId: "s-shop" })],
      [
        targetTransaction("t1", {
          occurredAt: "2026-10-18T10:00:30+08:00",
          categoryId: "t-shop",
        }),
      ],
    );
    expect(result.groups).toHaveLength(1);
  });

  it("标签集合相同且顺序无关；标签集合不同则不命中", () => {
    const base = { occurredAt: "2026-10-18T10:00:00+08:00" };
    const same = run(
      [transaction("s1", { ...base, tags: [SOURCE_TAGS[0]!, SOURCE_TAGS[1]!] })],
      [
        targetTransaction("t1", {
          ...base,
          occurredAt: "2026-10-18T10:00:30+08:00",
          tags: [TARGET_TAGS[1]!, TARGET_TAGS[0]!],
        }),
      ],
    );
    expect(same.groups).toHaveLength(1);

    const different = run(
      [transaction("s1", { ...base, tags: [SOURCE_TAGS[0]!] })],
      [
        targetTransaction("t1", {
          ...base,
          occurredAt: "2026-10-18T10:00:30+08:00",
          tags: [TARGET_TAGS[0]!, TARGET_TAGS[1]!],
        }),
      ],
    );
    expect(different.groups).toEqual([]);
  });

  it("支付方式与备注不同不影响命中", () => {
    const result = run(
      [transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00", note: "A", paymentMethodId: "s-wechat" })],
      [
        targetTransaction("t1", {
          occurredAt: "2026-10-18T10:00:30+08:00",
          note: "B",
          paymentMethodId: "t-wechat",
        }),
      ],
    );
    expect(result.groups).toHaveLength(1);
  });

  it("目标账本内部两条相同账目不构成冲突", () => {
    const result = run(
      [],
      [
        targetTransaction("t1", { occurredAt: "2026-10-18T10:00:00+08:00" }),
        targetTransaction("t2", { occurredAt: "2026-10-18T10:00:10+08:00" }),
      ],
    );
    expect(result.groups).toEqual([]);
  });

  it("来源账本内部两条相同账目不构成冲突", () => {
    const result = run(
      [
        transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" }),
        transaction("s2", { occurredAt: "2026-10-18T10:00:10+08:00" }),
      ],
      [],
    );
    expect(result.groups).toEqual([]);
  });

  it("一笔来源匹配两笔目标时合并为一个冲突组，而不是拆成多组", () => {
    const result = run(
      [transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" })],
      [
        targetTransaction("t1", { occurredAt: "2026-10-18T10:00:20+08:00" }),
        targetTransaction("t2", { occurredAt: "2026-10-18T10:00:40+08:00" }),
      ],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.sourceCount).toBe(1);
    expect(result.groups[0]?.targetCount).toBe(2);
    expect(result.groups[0]?.records).toHaveLength(3);
  });

  it("两笔来源匹配同一笔目标时合并为一个冲突组", () => {
    const result = run(
      [
        transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" }),
        transaction("s2", { occurredAt: "2026-10-18T10:00:20+08:00" }),
      ],
      [targetTransaction("t1", { occurredAt: "2026-10-18T10:00:40+08:00" })],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.sourceCount).toBe(2);
    expect(result.groups[0]?.targetCount).toBe(1);
  });

  it("桥接的匹配关系合并成同一个连通分量，保持每条记录只属于一组", () => {
    const result = run(
      [
        transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00" }),
        transaction("s2", { occurredAt: "2026-10-18T10:00:20+08:00" }),
      ],
      [
        targetTransaction("t1", { occurredAt: "2026-10-18T10:00:30+08:00" }),
        targetTransaction("t2", { occurredAt: "2026-10-18T10:00:50+08:00" }),
      ],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.records).toHaveLength(4);
    const ids = result.groups[0]?.records.map((record) => record.transaction.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("同一分类名称但映射到新建对象时不与目标已有分类混淆", () => {
    // 来源「交通」在目标不存在；目标账本的交通分类 id 与来源 id 不同且名称相同也无从对应。
    const customSource = {
      ...sourceSnapshot([transaction("s1", { occurredAt: "2026-10-18T10:00:00+08:00", categoryId: "missing" })]),
      categories: [...SOURCE_CATEGORIES],
    };
    const customTarget = targetSnapshot([
      targetTransaction("t1", { occurredAt: "2026-10-18T10:00:30+08:00" }),
    ]);
    const result = detectDuplicateGroups(
      customSource,
      customTarget,
      buildTaxonomyMappingPlan(customSource, customTarget),
    );
    // 来源记录引用了不存在的分类，不能安全地参与重复检测。
    expect(result.groups).toEqual([]);
  });

  it("多组按来源时间稳定排序", () => {
    const result = run(
      [
        transaction("s-late", { occurredAt: "2026-10-18T12:00:00+08:00" }),
        transaction("s-early", { occurredAt: "2026-10-18T09:00:00+08:00" }),
      ],
      [
        targetTransaction("t-late", { occurredAt: "2026-10-18T12:00:20+08:00" }),
        targetTransaction("t-early", { occurredAt: "2026-10-18T09:00:20+08:00" }),
      ],
    );
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.records[0]?.transaction.id).toBe("s-early");
    expect(result.groups[1]?.records[0]?.transaction.id).toBe("s-late");
  });
});
