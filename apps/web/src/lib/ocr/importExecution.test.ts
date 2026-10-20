import { describe, expect, it } from "vitest";

import type { CreateTransactionInput } from "@libellum/shared";

import { executeImport } from "./importExecution.js";
import type { OcrBatch } from "./types.js";
import { batchCandidate } from "./testFixtures.js";

function batchOf(items = [batchCandidate({ candidateId: "a" }), batchCandidate({ candidateId: "b", merchant: "午餐店", occurredTime: "18:00" })], ids: Record<string, string> = { a: "id-a", b: "id-b" }): OcrBatch {
  return {
    version: 1,
    batchId: "batch-1",
    createdAt: "2026-10-20T00:00:00.000Z",
    bookId: "book-1",
    pages: [],
    items,
    importIds: ids,
  };
}

describe("executeImport", () => {
  it("writes the ready items through the injected writer", async () => {
    const written: CreateTransactionInput[] = [];
    const outcome = await executeImport(batchOf(), async (input) => {
      written.push(input);
      return { pending: false };
    });

    expect(written).toHaveLength(2);
    expect(written[0]).toMatchObject({ id: "id-a", idempotencyKey: "id-a", kind: "expense" });
    expect(outcome).toMatchObject({
      attempted: 2,
      succeeded: [
        { candidateId: "a", pending: false },
        { candidateId: "b", pending: false },
      ],
      failed: [],
      blockers: [],
    });
  });

  it("keeps going after a failure and reports every reason", async () => {
    const outcome = await executeImport(batchOf(), async (input) => {
      if (input.id === "id-a") throw new Error("网络不可用");
      return { pending: true };
    });

    expect(outcome.attempted).toBe(2);
    expect(outcome.succeeded).toEqual([{ candidateId: "b", label: "20.00 CNY · 午餐店", pending: true }]);
    expect(outcome.failed).toEqual([{ candidateId: "a", label: "20.00 CNY · 老王便利店", reason: "网络不可用" }]);
  });

  it("writes nothing at all when a preflight blocker exists", async () => {
    let calls = 0;
    const outcome = await executeImport(
      batchOf([batchCandidate({ candidateId: "a" }), batchCandidate({ candidateId: "b", amount: null })], {
        a: "id-a",
        b: "id-b",
      }),
      async () => {
        calls += 1;
        return { pending: false };
      },
    );

    expect(calls).toBe(0);
    expect(outcome.attempted).toBe(0);
    expect(outcome.blockers.map((blocker) => blocker.candidateId)).toEqual(["b"]);
    expect(outcome.succeeded).toEqual([]);
    expect(outcome.failed).toEqual([]);
  });

  it("reports an offline write as pending rather than as a cloud save", async () => {
    const outcome = await executeImport(batchOf(), async () => ({ pending: true }));

    expect(outcome.succeeded.every((entry) => entry.pending)).toBe(true);
  });

  it("does not modify the batch it reads", async () => {
    const batch = batchOf();
    const before = JSON.stringify(batch);

    await executeImport(batch, async () => ({ pending: false }));

    expect(JSON.stringify(batch)).toBe(before);
  });
});
