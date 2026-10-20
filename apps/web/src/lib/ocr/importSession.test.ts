import { describe, expect, it } from "vitest";

import { memoryStorage } from "./testFixtures.js";
import {
  clearImportSession,
  IMPORT_SESSION_STORAGE_KEY,
  importSessionTotals,
  loadImportSession,
  MAX_SESSION_BATCHES,
  recordImportBatch,
  saveImportSession,
  type OcrImportSession,
} from "./importSession.js";

/**
 * The session is the only place the completion screen counts across batches, so the
 * arithmetic is tested without a browser: a retry must not become a second batch, and
 * another ledger's numbers must never be added to this one's.
 */

function record(
  batchId: string,
  overrides: Partial<{
    bookId: string | null;
    importedAt: string;
    succeeded: number;
    failed: number;
    pending: number;
  }> = {},
): Parameters<typeof recordImportBatch>[1] {
  return {
    batchId,
    bookId: "book-1",
    importedAt: "2026-10-21T10:00:00.000Z",
    succeeded: 0,
    failed: 0,
    pending: 0,
    ...overrides,
  };
}

describe("recordImportBatch", () => {
  it("starts a session with the first batch", () => {
    const session = recordImportBatch(null, record("batch-1", { succeeded: 10 }));

    expect(session.bookId).toBe("book-1");
    expect(session.batches).toHaveLength(1);
    expect(session.batches[0]).toMatchObject({ batchId: "batch-1", sequence: 1, succeeded: 10 });
  });

  it("appends a second batch and shows the newest first", () => {
    const first = recordImportBatch(null, record("batch-1", { succeeded: 10 }));
    const session = recordImportBatch(
      first,
      record("batch-2", { importedAt: "2026-10-21T10:05:00.000Z", succeeded: 5, failed: 1 }),
    );

    expect(session.batches.map((batch) => batch.batchId)).toEqual(["batch-2", "batch-1"]);
    expect(session.batches.map((batch) => batch.sequence)).toEqual([2, 1]);
    expect(importSessionTotals(session)).toMatchObject({ imported: 15, batches: 2 });
  });

  it("updates the same batch on a retry instead of counting it twice", () => {
    const first = recordImportBatch(
      null,
      record("batch-1", { succeeded: 8, failed: 2, pending: 1 }),
    );
    const retried = recordImportBatch(first, record("batch-1", { succeeded: 2, failed: 0 }));

    expect(retried.batches).toHaveLength(1);
    expect(retried.batches[0]).toMatchObject({
      batchId: "batch-1",
      sequence: 1,
      succeeded: 10,
      failed: 0,
      // The first attempt queued one entry; retrying does not un-queue it.
      pending: 1,
    });
    expect(importSessionTotals(retried).imported).toBe(10);
  });

  it("keeps the sequence when a batch introduced earlier is retried", () => {
    const one = recordImportBatch(null, record("batch-1", { succeeded: 5, failed: 2 }));
    const two = recordImportBatch(one, record("batch-2", { succeeded: 3 }));
    const retried = recordImportBatch(two, record("batch-1", { succeeded: 2, failed: 0 }));

    expect(retried.batches.map((batch) => batch.batchId)).toEqual(["batch-2", "batch-1"]);
    expect(retried.batches.find((batch) => batch.batchId === "batch-1")?.sequence).toBe(1);
    expect(importSessionTotals(retried)).toMatchObject({ imported: 10, batches: 2 });
  });

  it("starts a new session rather than mixing another ledger's counts", () => {
    const first = recordImportBatch(null, record("batch-1", { bookId: "book-a", succeeded: 7 }));
    const switched = recordImportBatch(
      first,
      record("batch-9", { bookId: "book-b", succeeded: 3 }),
    );

    expect(switched.bookId).toBe("book-b");
    expect(switched.batches).toHaveLength(1);
    expect(switched.batches[0]?.batchId).toBe("batch-9");
    expect(importSessionTotals(switched).imported).toBe(3);
  });

  it("caps the number of batches it stores", () => {
    let session: OcrImportSession | null = null;
    for (let index = 0; index < MAX_SESSION_BATCHES + 5; index += 1) {
      session = recordImportBatch(session, record(`batch-${String(index)}`, { succeeded: 1 }));
    }

    expect(session?.batches).toHaveLength(MAX_SESSION_BATCHES);
    // The newest batch is the one that survives, not the oldest.
    expect(session?.batches[0]?.batchId).toBe(`batch-${String(MAX_SESSION_BATCHES + 4)}`);
  });
});

describe("import session storage", () => {
  it("round-trips through sessionStorage", () => {
    const storage = memoryStorage();
    const session = recordImportBatch(null, record("batch-1", { succeeded: 4, failed: 1 }));

    expect(saveImportSession(session, storage)).toBe(true);
    expect(loadImportSession(storage)).toEqual(session);
    expect(storage.values.get(IMPORT_SESSION_STORAGE_KEY)).toContain("batch-1");
  });

  it("clears the stored session", () => {
    const storage = memoryStorage();
    saveImportSession(recordImportBatch(null, record("batch-1", { succeeded: 4 })), storage);

    clearImportSession(storage);

    expect(loadImportSession(storage)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("treats unreadable or unknown versions as no session", () => {
    const storage = memoryStorage();
    storage.setItem(IMPORT_SESSION_STORAGE_KEY, "{not json");
    expect(loadImportSession(storage)).toBeNull();

    storage.setItem(IMPORT_SESSION_STORAGE_KEY, JSON.stringify({ version: 2, batches: [] }));
    expect(loadImportSession(storage)).toBeNull();
  });

  it("drops malformed batches but keeps the valid ones", () => {
    const storage = memoryStorage();
    storage.setItem(
      IMPORT_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        bookId: "book-1",
        batches: [
          { batchId: "batch-1", sequence: 1, importedAt: "2026-10-21T10:00:00.000Z", succeeded: 2, failed: 0, pending: 0 },
          { batchId: "", sequence: 2, importedAt: "2026-10-21T10:05:00.000Z", succeeded: 9 },
          { batchId: "batch-3", sequence: 3, importedAt: "2026-10-21T10:06:00.000Z", succeeded: -2, failed: "x" },
        ],
      }),
    );

    const session = loadImportSession(storage);
    expect(session?.batches.map((batch) => batch.batchId)).toEqual(["batch-3", "batch-1"]);
    expect(session?.batches[0]).toMatchObject({ succeeded: 0, failed: 0, pending: 0 });
  });

  it("numbers totals without a batch context", () => {
    expect(importSessionTotals(null)).toEqual({ imported: 0, batches: 0, pending: 0 });
  });
});
