import { describe, expect, it } from "vitest";

import {
  BATCH_STORAGE_KEY,
  clearBatch,
  loadBatch,
  saveBatch,
} from "./batchStore.js";
import type { OcrBatch } from "./types.js";
import { memoryStorage } from "./testFixtures.js";

const BATCH: OcrBatch = {
  version: 1,
  batchId: "batch-1",
  createdAt: "2026-10-20T10:00:00.000Z",
  bookId: "book-1",
  pages: [
    {
      imageIndex: 0,
      pageType: "transaction-list",
      layoutLabel: "微信交易列表",
      requiresUserChoice: false,
      warnings: [],
    },
  ],
  items: [],
  importIds: { "img0-1": "id-1" },
};

describe("batch session storage", () => {
  it("round-trips a batch so a refresh can continue", () => {
    const storage = memoryStorage();
    expect(saveBatch(BATCH, storage)).toBe(true);
    expect(storage.values.has(BATCH_STORAGE_KEY)).toBe(true);
    expect(loadBatch(storage)).toEqual(BATCH);
  });

  it("clears on confirmation or cancellation", () => {
    const storage = memoryStorage();
    saveBatch(BATCH, storage);
    clearBatch(storage);

    expect(loadBatch(storage)).toBeNull();
  });

  it("ignores corrupted JSON instead of crashing the overview", () => {
    const storage = memoryStorage();
    storage.setItem(BATCH_STORAGE_KEY, "{not json");

    expect(loadBatch(storage)).toBeNull();
  });

  it("ignores an unknown batch version", () => {
    const storage = memoryStorage();
    storage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ ...BATCH, version: 2 }));

    expect(loadBatch(storage)).toBeNull();
  });

  it("requires a batch id and the two lists", () => {
    const storage = memoryStorage();
    storage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ ...BATCH, batchId: "" }));
    expect(loadBatch(storage)).toBeNull();

    storage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ ...BATCH, items: "no" }));
    expect(loadBatch(storage)).toBeNull();
  });

  it("tolerates a batch saved before import ids existed", () => {
    const storage = memoryStorage();
    storage.setItem(
      BATCH_STORAGE_KEY,
      JSON.stringify({ ...BATCH, importIds: undefined }),
    );

    expect(loadBatch(storage)?.importIds).toEqual({});
  });

  it("does nothing when the browser has no session storage", () => {
    expect(saveBatch(BATCH, null)).toBe(false);
    expect(loadBatch(null)).toBeNull();
    expect(() => {
      clearBatch(null);
    }).not.toThrow();
  });
});
