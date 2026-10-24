import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  describeDuplicateMatch,
  evaluateDuplicatePair,
  type CreateTransactionInput,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
} from "@libellum/shared";

import { applyLocale } from "../i18n/index.js";
import { candidateFromInput, describeDuplicateMatchText, duplicateScopeLabel } from "./duplicateReview.js";

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

/**
 * S16：依据说明按规则结果在 Web 端重新拼句（`describeDuplicateMatchText`）。
 *
 * 中文必须与 shared 的 `describeDuplicateMatch` **逐字一致**——拍照、语音、OCR、全账本检查都用这一句，
 * 换一种说法就会重新出现“同一判定六种说法”；英文界面里不能残留中文。
 */
describe("describeDuplicateMatchText", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  const base: DuplicateCandidateFields = {
    id: "a",
    bookId: "book-1",
    kind: "expense",
    amountCents: 2_000,
    currency: "CNY",
    occurredAt: "2026-10-09T12:34:00+08:00",
    occurredLocalDate: "2026-10-09",
    categoryId: "c1",
    paymentMethodId: "m1",
  };

  function pair(
    right: Partial<DuplicateCandidateFields>,
    settings: DuplicateDetectionSettings = DEFAULT_DUPLICATE_DETECTION_SETTINGS,
    left: Partial<DuplicateCandidateFields> = {},
  ) {
    return evaluateDuplicatePair({ ...base, ...left }, { ...base, id: "b", ...right }, settings);
  }

  const cases = {
    allSame: pair({ occurredAt: "2026-10-09T12:34:30+08:00" }),
    missingCategory: pair({ categoryId: null }),
    noTime: pair({ occurredAt: null }, DEFAULT_DUPLICATE_DETECTION_SETTINGS, { occurredAt: null }),
    rulesOff: pair({}, { ...DEFAULT_DUPLICATE_DETECTION_SETTINGS, matchCategory: false, matchPaymentMethod: false }),
    suppressed: { ...pair({}), suppressed: true },
  };

  it("中文与 shared 原文逐字一致", () => {
    for (const result of Object.values(cases)) {
      expect(describeDuplicateMatchText(result)).toBe(describeDuplicateMatch(result));
    }
  });

  it("英文按规则拼句，不残留中文", () => {
    applyLocale("en-US");

    expect(describeDuplicateMatchText(cases.allSame)).toBe(
      "Same type, amount, currency, time, category, and payment method.",
    );
    expect(describeDuplicateMatchText(cases.missingCategory)).toContain("category missing");
    for (const result of Object.values(cases)) {
      expect(describeDuplicateMatchText(result)).not.toMatch(/[㐀-鿿]/);
    }
    expect(duplicateScopeLabel("local")).toBe("data on this device");
  });
});
