import { describe, expect, it } from "vitest";

import type { CreateTransactionInput } from "@libellum/shared";

import { candidateFromInput } from "./duplicateReview.js";

/**
 * OCR 批量/导入预览在**写入之前**就检测，候选人必须与写入后账本里的那一笔一致。
 *
 * 这里钉住两件事：字段映射不丢项；`id` 用写入时真正会用的 id——否则用户在这里
 * 确认过的「不是同一笔」关系，会因为 id 不同而在写入后失效。
 */
describe("candidateFromInput", () => {
  const input: CreateTransactionInput = {
    id: "0198f3a0-0000-7000-8000-000000000001",
    idempotencyKey: "0198f3a0-0000-7000-8000-000000000001",
    kind: "expense",
    amountCents: 2_000,
    currency: "CNY",
    categoryId: "0198f3a0-0000-7000-8000-0000000000c1",
    paymentMethodId: null,
    occurredAt: "2026-10-09T12:34:00+08:00",
    occurredLocalDate: "2026-10-09",
    occurredTz: "Asia/Shanghai",
    note: "午饭",
    tagIds: ["0198f3a0-0000-7000-8000-0000000000t1"],
  };

  it("把待写入的记录映射成统一的候选字段", () => {
    const candidate = candidateFromInput(input, "book-1");

    expect(candidate).toEqual({
      id: input.id,
      bookId: "book-1",
      kind: "expense",
      amountCents: 2_000,
      currency: "CNY",
      occurredAt: "2026-10-09T12:34:00+08:00",
      occurredLocalDate: "2026-10-09",
      categoryId: input.categoryId,
      paymentMethodId: null,
      note: "午饭",
      tagIds: input.tagIds,
    });
  });

  it("缺省的可选字段是 null，不是空字符串", () => {
    const candidate = candidateFromInput(
      { ...input, categoryId: null, paymentMethodId: null, note: null },
      "book-1",
    );

    // 核心把 null 当作“缺失”，空字符串会被 trim 成空、同样缺失；但显式 null 更稳定。
    expect(candidate.categoryId).toBeNull();
    expect(candidate.paymentMethodId).toBeNull();
    expect(candidate.note).toBeNull();
  });
});
