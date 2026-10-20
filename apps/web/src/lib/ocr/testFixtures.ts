/**
 * Test-only factories for the OCR batch layer.
 *
 * Kept out of `*.test.ts` so several suites can share them without one test file
 * importing another. Nothing in the application imports this module.
 */

import type { OcrCandidate, OcrItemResult } from "@libellum/shared";

import type { OcrBatchCandidate } from "./types.js";

export function candidate(overrides: Partial<OcrCandidate> = {}): OcrCandidate {
  return {
    candidateId: "img0-1",
    imageIndex: 0,
    amount: "20.00",
    currency: "CNY",
    direction: "expense",
    occurredLocalDate: "2026-10-09",
    occurredTime: "12:34",
    merchant: "老王便利店",
    sourcePlatform: "WECHAT",
    account: "零钱",
    note: null,
    status: "posted",
    isRefund: false,
    isTransfer: false,
    serial: null,
    issues: [],
    duplicateSuspected: false,
    duplicateGroupIds: [],
    isComplete: true,
    isQuestionable: false,
    rawText: "老王便利店\n-20.00",
    ...overrides,
  };
}

export function item(overrides: Partial<OcrItemResult> = {}): OcrItemResult {
  return {
    index: 0,
    ok: true,
    draft: {
      amount: "20.00",
      currency: "CNY",
      occurredLocalDate: "2026-10-09",
      occurredTime: "12:34",
      kind: "expense",
      channel: "WECHAT",
      counterparty: "老王便利店",
      note: null,
      serial: null,
      isRefund: false,
      warnings: [],
    },
    error: null,
    message: null,
    lineCount: 10,
    averageConfidence: 0.98,
    seconds: 1.2,
    pageType: "single-detail",
    layoutLabel: "微信支付详情",
    requiresUserChoice: false,
    candidates: [candidate()],
    warnings: [],
    ...overrides,
  };
}

/** A local (batch) candidate, which carries the user's decisions as well. */
export function batchCandidate(
  overrides: Partial<OcrBatchCandidate> = {},
): OcrBatchCandidate {
  return {
    candidateId: "img0-1",
    imageIndex: 0,
    amount: "20.00",
    currency: "CNY",
    direction: "expense",
    occurredLocalDate: "2026-10-09",
    occurredTime: "12:34",
    merchant: "老王便利店",
    sourcePlatform: "WECHAT",
    account: "零钱",
    note: null,
    status: "posted",
    isRefund: false,
    isTransfer: false,
    serial: null,
    issues: [],
    rawText: "",
    invalid: false,
    reviewed: false,
    categoryId: null,
    paymentMethodId: null,
    tagIds: [],
    duplicateSuspected: false,
    duplicateGroupIds: [],
    ...overrides,
  };
}

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly values: Map<string, string>;
}

export function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();

  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
