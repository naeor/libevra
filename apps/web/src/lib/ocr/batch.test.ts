import { describe, expect, it } from "vitest";

import {
  assignImportIds,
  batchBelongsToBook,
  batchItem,
  createBatch,
  refreshDuplicateMarks,
  updateBatchItem,
  withoutBatchItems,
} from "./batch.js";
import { countImportableItems, findImportBlockers } from "./import.js";
import type { OcrBatch } from "./types.js";
import {
  countBatchItems,
  deriveIssues,
  filterBatchItems,
  isItemComplete,
  itemStatus,
} from "./types.js";
import { batchCandidate, candidate as makeCandidate, item } from "./testFixtures.js";

const CATEGORIES = [
  { id: "c-food", name: "餐饮", kind: "expense", isArchived: false, isSystem: false },
  { id: "c-transfer", name: "转账", kind: "expense", isArchived: false, isSystem: false },
  { id: "c-transfer-in", name: "转账", kind: "income", isArchived: false, isSystem: false },
];

const METHODS = [
  { id: "m-wechat", name: "微信", isArchived: false },
  { id: "m-alipay", name: "支付宝", isArchived: false },
];

describe("createBatch", () => {
  it("puts every candidate from every page into one batch", () => {
    const batch = createBatch(
      [
        item(),
        item({
          index: 1,
          pageType: "transaction-list",
          layoutLabel: "微信交易列表",
          candidates: [
            makeCandidate({ candidateId: "img1-1", imageIndex: 1, amount: "32.00" }),
            makeCandidate({
              candidateId: "img1-2",
              imageIndex: 1,
              amount: "18.50",
              merchant: "小杨生煎",
              occurredTime: "09:12",
            }),
          ],
        }),
      ],
      {
        bookId: "book-1",
        categories: CATEGORIES,
        paymentMethods: METHODS,
        now: new Date("2026-10-20T10:00:00Z"),
        generateBatchId: () => "batch-1",
      },
    );

    expect(batch.batchId).toBe("batch-1");
    expect(batch.bookId).toBe("book-1");
    expect(batch.items).toHaveLength(3);
    expect(batch.items.map((entry) => entry.candidateId)).toEqual([
      "img0-1",
      "img1-1",
      "img1-2",
    ]);
    expect(batch.pages).toHaveLength(2);
    expect(batch.pages[1]?.layoutLabel).toBe("微信交易列表");
    // The WeChat detail's payment method is mapped by name, not invented.
    expect(batch.items[0]?.paymentMethodId).toBe("m-wechat");
  });

  it("turns a draft-only unknown page into one candidate marked for review", () => {
    const batch = createBatch(
      [
        item({
          index: 2,
          pageType: "unknown",
          layoutLabel: null,
          requiresUserChoice: true,
          candidates: [],
          warnings: ["无法判断这是什么页面，请选择按单笔还是按多笔处理。"],
        }),
      ],
      { bookId: null, categories: CATEGORIES, paymentMethods: METHODS },
    );

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      candidateId: "img2-draft",
      amount: "20.00",
      direction: "expense",
      invalid: false,
    });
    expect(batch.items[0]?.issues[0]?.code).toBe("extraction_incomplete");
    expect(itemStatus(batch.items[0]!)).toBe("review");
  });

  it("maps a transfer to the ledger's 转账 category but changes no kind", () => {
    const batch = createBatch(
      [item({ candidates: [makeCandidate({ isTransfer: true, direction: "expense" })] })],
      { bookId: "book-1", categories: CATEGORIES, paymentMethods: METHODS },
    );

    expect(batch.items[0]?.categoryId).toBe("c-transfer");
    expect(batch.items[0]?.categorySource).toBe("ocr");
    expect(batch.items[0]?.isTransfer).toBe(true);
    expect(batch.items[0]?.direction).toBe("expense");

    const income = createBatch(
      [
        item({
          candidates: [
            makeCandidate({ isTransfer: true, direction: "income", merchant: "张三" }),
          ],
        }),
      ],
      { bookId: "book-1", categories: CATEGORIES, paymentMethods: METHODS },
    );

    expect(income.items[0]?.categoryId).toBe("c-transfer-in");
  });

  it("marks duplicates while creating the batch", () => {
    const batch = createBatch(
      [
        item({ index: 0 }),
        item({
          index: 1,
          candidates: [makeCandidate({ candidateId: "img1-1", imageIndex: 1 })],
        }),
      ],
      { bookId: null, categories: CATEGORIES, paymentMethods: METHODS },
    );

    expect(batch.items.every((entry) => entry.duplicateSuspected)).toBe(true);
  });
});

describe("editing a candidate", () => {
  it("recomputes completeness and drops field issues that no longer apply", () => {
    const base = createBatch(
      [
        item({
          candidates: [
            makeCandidate({
              amount: null,
              occurredTime: null,
              issues: [
                { code: "missing_amount", message: "没有读出金额，请填写。", field: "amount" },
                { code: "missing_time", message: "没有读出时间。", field: "time" },
              ],
              isComplete: false,
              isQuestionable: true,
            }),
          ],
        }),
      ],
      { bookId: null, categories: CATEGORIES, paymentMethods: METHODS },
    );

    expect(deriveIssues(base.items[0]!).map((issue) => issue.code)).toEqual([
      "missing_amount",
      "missing_time",
    ]);
    expect(isItemComplete(base.items[0]!)).toBe(false);

    const edited = updateBatchItem(base, "img0-1", { amount: "25.00", reviewed: true });
    expect(edited.items[0]?.reviewed).toBe(true);
    expect(deriveIssues(edited.items[0]!).map((issue) => issue.code)).toEqual(["missing_time"]);
    expect(isItemComplete(edited.items[0]!)).toBe(true);
  });

  it("refreshes duplicate marks after an amount edit", () => {
    const batch = createBatch(
      [
        item(),
        item({
          index: 1,
          candidates: [makeCandidate({ candidateId: "img1-1", imageIndex: 1 })],
        }),
      ],
      { bookId: null, categories: CATEGORIES, paymentMethods: METHODS },
    );
    expect(batch.items[1]?.duplicateSuspected).toBe(true);

    const edited = updateBatchItem(batch, "img1-1", { amount: "21.00" });
    expect(edited.items[1]?.duplicateSuspected).toBe(false);
    expect(batchItem(edited, "img1-1")?.amount).toBe("21.00");
  });

  it("keeps unknown candidates unchanged and keeps the page list", () => {
    const batch = createBatch([item()], {
      bookId: null,
      categories: CATEGORIES,
      paymentMethods: METHODS,
    });
    const edited = updateBatchItem(batch, "missing", { amount: "1.00" });

    expect(edited.items).toEqual(batch.items);
    expect(edited.pages).toEqual(batch.pages);
    expect(edited.batchId).toBe(batch.batchId);
  });
});

describe("counts and filters", () => {
  const items = [
    batchCandidate({ candidateId: "a", merchant: "早餐店", occurredTime: "08:00" }),
    batchCandidate({
      candidateId: "b",
      amount: null,
      issues: [{ code: "missing_amount", message: "没有读出金额", field: "amount" }],
    }),
    batchCandidate({ candidateId: "c", imageIndex: 1 }),
    batchCandidate({ candidateId: "d", imageIndex: 2 }),
    batchCandidate({ candidateId: "e", invalid: true }),
  ];

  const marked = refreshDuplicateMarks({
    version: 1,
    batchId: "b",
    createdAt: "2026-10-20T00:00:00.000Z",
    bookId: null,
    pages: [],
    items,
    importIds: {},
  }).batch;

  it("shows every state rather than hiding the invalid ones", () => {
    expect(countBatchItems(marked.items)).toEqual({
      total: 5,
      valid: 4,
      pending: 3,
      confirmed: 1,
      duplicates: 2,
      invalid: 1,
      reviewed: 0,
    });
  });

  it("keeps recognized, questionable, reviewed and importable distinct", () => {
    const items = [
      batchCandidate({ candidateId: "ok" }),
      // Missing currency: still a valid candidate (the user did not exclude it),
      // but it cannot be written, so it must not count as importable.
      batchCandidate({ candidateId: "no-currency", currency: null }),
      batchCandidate({ candidateId: "reviewed", reviewed: true }),
      batchCandidate({ candidateId: "invalid", invalid: true }),
    ];
    const counts = countBatchItems(items);
    const blockers = findImportBlockers({
      version: 1,
      batchId: "b",
      createdAt: "2026-10-20T00:00:00.000Z",
      bookId: null,
      pages: [],
      items,
      importIds: {},
    });

    expect(counts).toMatchObject({
      total: 4,
      valid: 3,
      pending: 1,
      confirmed: 2,
      invalid: 1,
      reviewed: 1,
    });
    // "recognized" is about fields, not about the user having opened the detail.
    expect(itemStatus(items[2]!)).toBe("recognized");
    expect(filterBatchItems(items, "pending").map((entry) => entry.candidateId)).toEqual([
      "no-currency",
    ]);
    expect(blockers.map((entry) => entry.candidateId)).toEqual(["no-currency"]);
    expect(countImportableItems(items)).toBe(2);
  });

  it("filters by status, source and direction without losing the totals", () => {
    expect(filterBatchItems(marked.items, "pending").map((entry) => entry.candidateId)).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(filterBatchItems(marked.items, "duplicates")).toHaveLength(2);
    expect(filterBatchItems(marked.items, "confirmed").map((entry) => entry.candidateId)).toEqual([
      "a",
    ]);
    expect(filterBatchItems(marked.items, "all", "WECHAT")).toHaveLength(5);
    expect(filterBatchItems(marked.items, "all", "ALIPAY")).toEqual([]);
    expect(filterBatchItems(marked.items, "all", "all", "income")).toEqual([]);
    // The folded panel's filters still combine with the primary status filter.
    expect(
      filterBatchItems(marked.items, "pending", "WECHAT", "expense").map(
        (entry) => entry.candidateId,
      ),
    ).toEqual(["b", "c", "d"]);
    expect(filterBatchItems(marked.items, "confirmed", "WECHAT", "income")).toEqual([]);
    expect(filterBatchItems(marked.items, "pending", "ALIPAY")).toEqual([]);
  });

  it("marks an invalid item as invalid even if it is also complete", () => {
    expect(itemStatus(marked.items[4]!)).toBe("invalid");
  });
});

describe("import identity", () => {
  it("assigns one fixed id per importable candidate and reuses it on retry", () => {
    const batch = createBatch(
      [
        item(),
        item({
          index: 1,
          candidates: [makeCandidate({ candidateId: "img1-1", imageIndex: 1 })],
        }),
      ],
      { bookId: null, categories: CATEGORIES, paymentMethods: METHODS },
    );
    const withInvalid = updateBatchItem(batch, "img1-1", { invalid: true });

    let sequence = 0;
    const generate = (): string => `id-${String((sequence += 1))}`;
    const assigned = assignImportIds(withInvalid, generate);

    expect(assigned.importIds).toEqual({ "img0-1": "id-1" });
    expect(assignImportIds(assigned, generate)).toBe(assigned);
  });

  it("removes only the delivered items and keeps the rest retryable", () => {
    const batch = {
      version: 1 as const,
      batchId: "b",
      createdAt: "2026-10-20T00:00:00.000Z",
      bookId: null,
      pages: [],
      items: [
        batchCandidate({ candidateId: "a" }),
        batchCandidate({ candidateId: "b", occurredTime: "18:00" }),
      ],
      importIds: { a: "id-a", b: "id-b" },
    };

    const remaining = withoutBatchItems(batch, ["a"]);
    expect(remaining.items.map((entry) => entry.candidateId)).toEqual(["b"]);
    expect(remaining.importIds).toEqual({ b: "id-b" });
  });

  it("refuses to import a batch that belongs to another ledger", () => {
    const batch: OcrBatch = {
      version: 1,
      batchId: "b",
      createdAt: "2026-10-20T00:00:00.000Z",
      bookId: "book-a",
      pages: [],
      items: [],
      importIds: {},
    };

    expect(batchBelongsToBook(batch, "book-a")).toBe(true);
    expect(batchBelongsToBook(batch, "book-b")).toBe(false);
    expect(batchBelongsToBook({ ...batch, bookId: null }, "book-b")).toBe(true);
  });
});
