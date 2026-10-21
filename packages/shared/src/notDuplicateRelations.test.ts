import { describe, expect, it } from "vitest";

import { duplicatePairKey } from "./duplicateDetection.js";
import {
  MAX_NOT_DUPLICATE_GROUP_SIZE,
  NOT_DUPLICATE_KEY_FIELDS,
  buildNotDuplicateBasis,
  createNotDuplicateRelationsSchema,
  expandNotDuplicatePairs,
  isNotDuplicateBasisStale,
  keyFieldsChanged,
  normalizeNotDuplicatePair,
  notDuplicatePairKey,
  notDuplicatePairKeySet,
  readNotDuplicateBasis,
  type NotDuplicateBasisTransaction,
  type NotDuplicateCurrentTransaction,
} from "./notDuplicateRelations.js";

/**
 * S15-E3 关系记忆的纯函数固定样本。
 *
 * 覆盖：配对规范化（A<B、顺序无关、拒绝同一笔）、C(n,2) 展开、配对键与 E2
 * `duplicatePairKey` 一致、basis 读写、关键字段失效、非关键字段不失效、
 * 请求 schema（显式 pairs / 整组 transactionIds / 拒绝空请求）。
 */

function basisTransaction(overrides: Partial<NotDuplicateBasisTransaction> = {}): NotDuplicateBasisTransaction {
  return {
    transactionId: "018f0000-0000-7000-8000-000000000001",
    seq: 12,
    version: 1,
    amountCents: "1234",
    currency: "CNY",
    kind: "expense",
    occurredAt: "2026-10-21T02:03:00.000Z",
    occurredLocalDate: "2026-10-21",
    occurredTz: "Asia/Shanghai",
    categoryId: "cat-food",
    paymentMethodId: "pay-wechat",
    ...overrides,
  };
}

function current(overrides: Partial<NotDuplicateCurrentTransaction> = {}): NotDuplicateCurrentTransaction {
  return {
    amountCents: "1234",
    currency: "CNY",
    kind: "expense",
    occurredAt: "2026-10-21T02:03:00.000Z",
    ...overrides,
  };
}

describe("配对规范化", () => {
  it("把较小的一方放在 A 位，且与传入顺序无关", () => {
    const forward = normalizeNotDuplicatePair("b-id", "a-id");
    const backward = normalizeNotDuplicatePair("a-id", "b-id");

    expect(forward).toEqual({ ok: true, pair: { transactionAId: "a-id", transactionBId: "b-id" } });
    expect(backward).toEqual(forward);
  });

  it("去掉首尾空白后再比较", () => {
    const result = normalizeNotDuplicatePair("  b  ", " a ");
    expect(result).toEqual({ ok: true, pair: { transactionAId: "a", transactionBId: "b" } });
  });

  it("拒绝同一笔交易", () => {
    const result = normalizeNotDuplicatePair("same", "same");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("same_transaction");
  });

  it("拒绝空的 id", () => {
    const result = normalizeNotDuplicatePair("", "b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_id");
  });

  it("配对键与 E2 duplicatePairKey 完全一致（适配层用它过滤）", () => {
    const left = "018f0000-0000-7000-8000-0000000000aa";
    const right = "018f0000-0000-7000-8000-0000000000bb";

    expect(notDuplicatePairKey(left, right)).toBe(duplicatePairKey(left, right));
    expect(notDuplicatePairKey(right, left)).toBe(duplicatePairKey(left, right));
  });

  it("batch 键集合按规范化后的对去重", () => {
    const set = notDuplicatePairKeySet([
      { transactionAId: "a", transactionBId: "b" },
      { transactionAId: "b", transactionBId: "a" },
      { transactionAId: "a", transactionBId: "c" },
    ]);

    expect(set.size).toBe(2);
    expect(set.has(notDuplicatePairKey("a", "b"))).toBe(true);
    expect(set.has(notDuplicatePairKey("a", "c"))).toBe(true);
  });
});

describe("整组确认展开", () => {
  it("A、B、C 明确互不重复 → A–B、A–C、B–C 三条，不多不少", () => {
    const pairs = expandNotDuplicatePairs(["c", "a", "b"]);

    expect(pairs).toEqual([
      { transactionAId: "a", transactionBId: "b" },
      { transactionAId: "a", transactionBId: "c" },
      { transactionAId: "b", transactionBId: "c" },
    ]);
  });

  it("不具传递性：展开结果只来自用户点名的那一组，不引入第三人", () => {
    const pairs = expandNotDuplicatePairs(["a", "b"]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toEqual({ transactionAId: "a", transactionBId: "b" });
  });

  it("重复 id 只算一笔；空 id 被忽略", () => {
    expect(expandNotDuplicatePairs(["a", "a", " b ", ""])).toEqual([
      { transactionAId: "a", transactionBId: "b" },
    ]);
    expect(expandNotDuplicatePairs(["a"])).toEqual([]);
  });

  it("组上限与配对上限是常量，不是散落的魔法数字", () => {
    expect(MAX_NOT_DUPLICATE_GROUP_SIZE).toBeGreaterThanOrEqual(3);
  });
});

describe("basis 读写", () => {
  const a = basisTransaction({ transactionId: "018f0000-0000-7000-8000-000000000001" });
  const b = basisTransaction({
    transactionId: "018f0000-0000-7000-8000-000000000002",
    seq: 13,
    amountCents: "999",
  });

  it("构造后能原样读回，金额保持字符串", () => {
    const basis = buildNotDuplicateBasis(a, b, "2026-10-21T03:00:00.000Z");
    const read = readNotDuplicateBasis(JSON.parse(JSON.stringify(basis)));

    expect(read).toEqual(basis);
    expect(read?.a.amountCents).toBe("1234");
  });

  it("版本不认识 / 缺字段 / 非对象 → null（不猜旧格式）", () => {
    expect(readNotDuplicateBasis(null)).toBeNull();
    expect(readNotDuplicateBasis({ version: 2 })).toBeNull();
    expect(readNotDuplicateBasis({ version: 1, capturedAt: "x", a: {}, b: {} })).toBeNull();
    expect(readNotDuplicateBasis("nope")).toBeNull();
  });
});

describe("失效规则", () => {
  const a = basisTransaction({ transactionId: "a" });
  const b = basisTransaction({ transactionId: "b" });
  const basis = buildNotDuplicateBasis(a, b, "2026-10-21T03:00:00.000Z");

  it("关键字段都没变 → 仍然生效", () => {
    expect(isNotDuplicateBasisStale(basis, { a: current(), b: current() })).toEqual({
      stale: false,
      changedFields: [],
      unreadable: false,
      missingSide: false,
    });
  });

  it("金额变化 → 失效，并指出字段", () => {
    const result = isNotDuplicateBasisStale(basis, {
      a: current({ amountCents: "999" }),
      b: current(),
    });
    expect(result.stale).toBe(true);
    expect(result.changedFields).toEqual(["amountCents"]);
  });

  it("币种大小写/空白差异不算变化（规范化后相同）", () => {
    const result = isNotDuplicateBasisStale(basis, {
      a: current({ currency: " cny " }),
      b: current(),
    });
    expect(result.stale).toBe(false);
  });

  it("方向变化 → 失效", () => {
    const result = isNotDuplicateBasisStale(basis, {
      a: current({ kind: "income" }),
      b: current(),
    });
    expect(result.changedFields).toEqual(["kind"]);
  });

  it("时间变化（同一时刻的不同写法不算）→ 失效", () => {
    const sameInstant = isNotDuplicateBasisStale(basis, {
      a: current({ occurredAt: "2026-10-21T10:03:00+08:00" }),
      b: current(),
    });
    expect(sameInstant.stale).toBe(false);

    const moved = isNotDuplicateBasisStale(basis, {
      a: current(),
      b: current({ occurredAt: "2026-10-22T02:03:00.000Z" }),
    });
    expect(moved.changedFields).toEqual(["occurredAt"]);
  });

  it("多个关键字段变化时按固定顺序报告", () => {
    const result = isNotDuplicateBasisStale(basis, {
      a: current({ occurredAt: "2026-10-22T02:03:00.000Z" }),
      b: current({ amountCents: "1" }),
    });
    expect(result.changedFields).toEqual(["amountCents", "occurredAt"]);
    expect(NOT_DUPLICATE_KEY_FIELDS).toEqual(["amountCents", "currency", "kind", "occurredAt"]);
  });

  it("读不出快照 → 按失效处理（宁可多问一次，也不永久压住）", () => {
    const result = isNotDuplicateBasisStale(null, { a: current(), b: current() });
    expect(result.stale).toBe(true);
    expect(result.unreadable).toBe(true);
  });

  it("一侧交易已被永久清理 → 不判定为 stale，但标记 missingSide", () => {
    const result = isNotDuplicateBasisStale(basis, { a: current(), b: null });
    expect(result).toEqual({
      stale: false,
      changedFields: [],
      unreadable: false,
      missingSide: true,
    });
  });

  it("写入时比较 before/after：只报关键字段", () => {
    expect(keyFieldsChanged(current(), current({ amountCents: "1235" }))).toEqual(["amountCents"]);
    expect(keyFieldsChanged(current(), current())).toEqual([]);
    expect(
      keyFieldsChanged(current(), current({ kind: "income", currency: "USD" })),
    ).toEqual(["currency", "kind"]);
  });
});

describe("创建请求 schema", () => {
  const idA = "018f0000-0000-7000-8000-000000000001";
  const idB = "018f0000-0000-7000-8000-000000000002";
  const idC = "018f0000-0000-7000-8000-000000000003";

  it("接受显式 pairs", () => {
    const result = createNotDuplicateRelationsSchema.parse({
      pairs: [{ transactionIdA: idA, transactionIdB: idB }],
    });
    expect(result.pairs).toHaveLength(1);
  });

  it("接受整组 transactionIds", () => {
    const result = createNotDuplicateRelationsSchema.parse({ transactionIds: [idA, idB, idC] });
    expect(result.transactionIds).toEqual([idA, idB, idC]);
  });

  it("拒绝空请求（必须来自一次明确动作）", () => {
    expect(() => createNotDuplicateRelationsSchema.parse({})).toThrow();
    expect(() => createNotDuplicateRelationsSchema.parse({ pairs: [], transactionIds: [] })).toThrow();
  });

  it("拒绝未知字段（避免拼错键却以为保存成功）", () => {
    expect(() =>
      createNotDuplicateRelationsSchema.parse({ transactionIds: [idA], autoInfer: true }),
    ).toThrow();
  });

  it("拒绝非 UUID 的 id", () => {
    expect(() =>
      createNotDuplicateRelationsSchema.parse({ pairs: [{ transactionIdA: "a", transactionIdB: idB }] }),
    ).toThrow();
  });
});
