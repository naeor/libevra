import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  type Category,
  type PaymentMethod,
  type Tag,
  type Transaction,
} from "@libellum/shared";

import { detectDuplicateGroups } from "./duplicates.js";
import { buildTaxonomyMappingPlan } from "./mapping.js";
import type { ImportSource, ImportTarget } from "./types.js";

/**
 * S15-E2 · 账本导入重复检测的**固定样本**（前后对比用）。
 *
 * 这组样本刻意把“旧规则与新规则会给出不同答案”的三类情况放在一起：
 *  - 标签不同：旧规则要求标签集合完全相等；统一规则不比较标签。
 *  - 支付方式不同：旧规则完全不看；统一规则默认要求相同。
 *  - 分类不同、时间超过 60 秒、收支方向不同：两边都不命中（对照项）。
 *
 * 实测（2026-10-21，同一份样本、同一套 10 对记录）：
 *  - 迁移前（旧规则）：**3 组** → `s1/t1`、`s3/t3`、`s9/t9`
 *  - 迁移后（统一规则）：**5 组** → `s1/t1`、`s2/t2`、`s4/t4`、`s9/t9`、`s10/t10`
 *
 * 变化来自两处：标签不同的 3 对新增（s2/s4/s10），支付方式不同的 1 对移出（s3）。
 * 也就是说“组数 +2”不是净增，而是**成员发生了变化**；核对页必须逐组重新确认。
 */

function category(
  id: string,
  name: string,
  kind: "expense" | "income",
  options: { readonly isSystem?: boolean } = {},
): Category {
  return {
    id,
    name,
    kind,
    description: null,
    isSystem: options.isSystem ?? false,
    isArchived: false,
    sortOrder: 0,
  };
}

function payment(id: string, name: string): PaymentMethod {
  return { id, name, isArchived: false, sortOrder: 0 };
}

function tag(id: string, name: string, color: string): Tag {
  return { id, name, color };
}

const SOURCE_CATEGORIES = [
  category("s-sys-exp", "暂无分类", "expense", { isSystem: true }),
  category("s-sys-inc", "暂无分类", "income", { isSystem: true }),
  category("s-food", "餐饮", "expense"),
  category("s-shopping", "购物", "expense"),
];
const TARGET_CATEGORIES = [
  category("t-sys-exp", "暂无分类", "expense", { isSystem: true }),
  category("t-sys-inc", "暂无分类", "income", { isSystem: true }),
  category("t-food", "餐饮", "expense"),
  category("t-shopping", "购物", "expense"),
];
const SOURCE_PAYMENTS = [payment("s-wechat", "微信"), payment("s-alipay", "支付宝")];
const TARGET_PAYMENTS = [payment("t-wechat", "微信"), payment("t-alipay", "支付宝")];
const SOURCE_TAGS = [tag("s-trip", "出差", "#111111"), tag("s-reimb", "报销", "#222222")];
const TARGET_TAGS = [tag("t-trip", "出差", "#111111"), tag("t-reimb", "报销", "#222222")];

function transaction(
  id: string,
  overrides: Partial<Transaction> & Pick<Transaction, "occurredAt">,
): Transaction {
  return {
    id,
    kind: "expense",
    amountCents: 1_234,
    currency: "CNY",
    categoryId: "s-food",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: "s-wechat",
    paymentMethodName: "微信",
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
  return transaction(id, {
    categoryId: "t-food",
    categoryName: "餐饮",
    paymentMethodId: "t-wechat",
    paymentMethodName: "微信",
    ...overrides,
  });
}

function snapshots(
  sources: readonly Transaction[],
  targets: readonly Transaction[],
): { source: ImportSource; target: ImportTarget } {
  return {
    source: {
      kind: "book",
      bookId: "source-book",
      identity: { name: "来源账本", bookNumber: "20000002" },
      categories: SOURCE_CATEGORIES,
      paymentMethods: SOURCE_PAYMENTS,
      tags: SOURCE_TAGS,
      transactions: sources,
      hiddenDeletedCount: 0,
    },
    target: {
      bookId: "target-book",
      identity: { name: "目标账本", bookNumber: "10000001" },
      categories: TARGET_CATEGORIES,
      paymentMethods: TARGET_PAYMENTS,
      tags: TARGET_TAGS,
      transactions: targets,
      hiddenDeletedCount: 0,
    },
  };
}

function pair(
  index: number,
  sourceOverrides: Partial<Transaction>,
  targetOverrides: Partial<Transaction>,
): { source: Transaction; target: Transaction } {
  // 相邻样本至少相隔 3 分钟，避免不同组之间因为 60 秒窗口被“桥接”到一起。
  const minute = String(index * 3).padStart(2, "0");

  return {
    source: transaction(`s${String(index)}`, {
      occurredAt: `2026-10-18T10:${minute}:00+08:00`,
      ...sourceOverrides,
    }),
    target: targetTransaction(`t${String(index)}`, {
      occurredAt: `2026-10-18T10:${minute}:30+08:00`,
      ...targetOverrides,
    }),
  };
}

function samplePairs(): { readonly source: Transaction[]; readonly target: Transaction[] } {
  const pairs = [
    // 1. 完全一致：两套规则都命中。
    pair(1, {}, {}),
    // 2. 只有标签不同：旧规则不命中；统一规则忽略标签 → 命中。
    pair(2, { tags: [SOURCE_TAGS[0]!] }, { tags: [TARGET_TAGS[1]!] }),
    // 3. 只有支付方式不同：旧规则忽略 → 命中；统一规则默认要求相同 → 不命中。
    pair(3, { paymentMethodId: "s-wechat" }, { paymentMethodId: "t-alipay" }),
    // 4. 只有标签不同：统一规则新增的命中。
    pair(4, { tags: [SOURCE_TAGS[1]!] }, { tags: [] }),
    // 5. 分类映射后不同：两套规则都不命中。
    pair(5, {}, { categoryId: "t-shopping", categoryName: "购物" }),
    // 6. 相差 61 秒：两套规则都不命中。
    pair(6, {}, { occurredAt: "2026-10-18T10:19:01+08:00" }),
    // 7. 收支方向不同：两套规则都不命中。
    pair(7, {}, { kind: "income" }),
    // 8. 标签与支付方式都不同：旧规则因标签不命中，统一规则因支付方式不命中。
    pair(8, { tags: [SOURCE_TAGS[0]!] }, { paymentMethodId: "t-alipay", tags: [] }),
    // 9. 完全一致：两套规则都命中。
    pair(9, {}, {}),
    // 10. 只有标签不同：统一规则新增的命中。
    pair(10, { tags: [] }, { tags: [TARGET_TAGS[0]!] }),
  ];

  return {
    source: pairs.map((entry) => entry.source),
    target: pairs.map((entry) => entry.target),
  };
}

function detect(
  settings?: Parameters<typeof detectDuplicateGroups>[5],
): ReturnType<typeof detectDuplicateGroups> {
  const { source: sources, target: targets } = samplePairs();
  const { source, target } = snapshots(sources, targets);

  return detectDuplicateGroups(
    source,
    target,
    buildTaxonomyMappingPlan(source, target),
    new Set<string>(),
    new Set<string>(),
    settings,
  );
}

describe("账本导入重复检测 · 固定样本前后对比", () => {
  it("统一规则下是 5 组：标签不同的三对新增，支付方式不同的一对移出", () => {
    const summary = detect().groups.map((group) => ({
      id: group.id,
      sourceIds: group.records
        .filter((record) => record.side === "source")
        .map((record) => record.transaction.id),
      targetIds: group.records
        .filter((record) => record.side === "target")
        .map((record) => record.transaction.id),
    }));

    expect(summary.map((group) => group.id)).toEqual([
      "group:s1:t1",
      "group:s2:t2",
      "group:s4:t4",
      "group:s9:t9",
      "group:s10:t10",
    ]);
    expect(summary.every((group) => group.sourceIds.length === 1 && group.targetIds.length === 1)).toBe(
      true,
    );
  });

  it("用户设置生效：关闭提醒 0 组；关闭支付方式匹配后 s3/t3 重新出现", () => {
    expect(detect({ ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, enabled: false }).groups).toEqual([]);

    const paymentOff = detect({
      ...DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      matchPaymentMethod: false,
    });

    expect(paymentOff.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining(["group:s3:t3", "group:s8:t8"]),
    );
    // 基础 5 组 + 支付方式不同的 2 组（s3、s8）。
    expect(paymentOff.groups).toHaveLength(7);
  });
});
