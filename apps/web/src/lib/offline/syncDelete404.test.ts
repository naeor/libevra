import type { Transaction } from "@libellum/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, apiFetch } from "../api.js";
import { readMarks, setMark, upsertEntry } from "./localLedger.js";
import { retryAbandonedWrites, syncAll } from "./sync.js";
import { setOfflineScope } from "./scope.js";

/**
 * The two halves of "为什么删掉的行一直是红色的" (owner, 2026-10-20, localhost, network up).
 *
 * ⚠️ **His API log is the evidence, and it is unambiguous**: `DELETE /api/v1/transactions/01a129f8-…`
 * answered **204**, and a later attempt for another row answered **404 `transaction_missing`** — which is
 * the server saying "there is nothing left to delete". So the server did its part; the red rows were the
 * *client* treating that 404 as a failure and then refusing to try again for the rest of the session.
 *
 * ⚠️ **A 404 on a delete is the goal state, and a 404 on an edit is not.** Both are pinned here, because
 * the second half is the regression that would follow from fixing the first one too broadly.
 */
vi.mock("../api.js", async (original) => ({ ...await original<typeof import("../api.js")>(), apiFetch: vi.fn() }));
vi.mock("./diagnostics.js", () => ({ logOffline: vi.fn(async () => undefined) }));
vi.mock("./storage.js", () => {
  const data = new Map<string, unknown>();
  return {
    readSnapshot: (key: string) => data.get(key) ?? null,
    readValue: async (key: string) => data.get(key) ?? null,
    writeValue: async (key: string, value: unknown) => { data.set(key, value); return true; },
    removeValue: async (key: string) => { data.delete(key); return true; },
  };
});

const id = "01a159b5-0000-4000-8000-000000000001";

function entry(): Transaction {
  return { id, kind: "expense", amountCents: 2000, currency: "CNY", categoryId: "cat", categoryName: "餐饮",
    categoryIsSystem: false, paymentMethodId: null, paymentMethodName: null,
    occurredAt: "2026-10-20T12:00:00.000Z", occurredLocalDate: "2026-10-20", occurredTz: "Asia/Shanghai",
    note: null, tags: [], version: 2 };
}

beforeEach(async () => {
  setOfflineScope("test-user", "test-book");
  vi.mocked(apiFetch).mockReset();
  /** ⚠️ The failure book is module state by design (it is a session, not a document), so each test starts from a clean session. */
  await retryAbandonedWrites();
  await setMark(id, null);
  await upsertEntry(entry());
});

describe("deleting something the server has already deleted", () => {
  it("acknowledges the deletion instead of turning the row permanently red", async () => {
    await setMark(id, { pending: true, deleted: true });
    vi.mocked(apiFetch).mockRejectedValue(new ApiRequestError(404, "transaction_missing", "找不到这笔记账。"));

    const report = await syncAll();

    /** ⚠️ Counted as delivered: the entry is off the server, which is the whole of what was asked. */
    expect(report.delivered).toBe(1);
    expect(report.refused).toBe(0);
    expect(report.waiting).toBe(0);

    /** ⚠️ The acknowledged tombstone, exactly as the 204 path leaves it — so nothing comes back to reclaim the row. */
    expect((await readMarks())[id]).toEqual({ deleted: true, pending: false, synced: true });

    /** ⚠️ And there is no work left: a second run must not ask the server again. */
    vi.mocked(apiFetch).mockClear();
    await syncAll();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not overwrite a mark the user changed while the request was in flight", async () => {
    await setMark(id, { pending: true, deleted: true });
    const changed = { pending: true, synced: true, chain: { amountCents: [2000, 8000] } } as const;

    vi.mocked(apiFetch).mockImplementation(async () => {
      await setMark(id, changed);
      throw new ApiRequestError(404, "transaction_missing", "找不到这笔记账。");
    });

    const report = await syncAll();

    expect(report.delivered).toBe(1);
    expect((await readMarks())[id]).toEqual(changed);
  });
});

describe("a 404 that is not a completed deletion", () => {
  it("keeps an edit pending and reports it, rather than acknowledging a row the server does not have", async () => {
    await setMark(id, { pending: true, synced: true, chain: { amountCents: [2000, 8000] } });
    vi.mocked(apiFetch).mockRejectedValue(new ApiRequestError(404, "transaction_missing", "找不到这笔记账。"));

    const report = await syncAll();

    expect(report.delivered).toBe(0);
    /** ⚠️ Still a refusal: the user's edit is not on the server, and saying "delivered" would hide that. */
    expect(report.refused).toBe(1);
    expect((await readMarks())[id]).toEqual({ pending: true, synced: true, chain: { amountCents: [2000, 8000] } });
  });
});

describe("trying again after the program gave up", () => {
  it("retries an entry abandoned at the attempt limit only when the user asks", async () => {
    await setMark(id, { pending: true, synced: true, chain: { amountCents: [2000, 8000] } });
    vi.mocked(apiFetch).mockRejectedValue(new ApiRequestError(500, "unexpected_error", "服务暂时不可用"));

    for (let attempt = 0; attempt < 5; attempt += 1) await syncAll();

    expect(apiFetch).toHaveBeenCalledTimes(5);

    /** ⚠️ The automatic path keeps its silence: this is the behaviour an accumulating queue needs. */
    const abandoned = await syncAll();
    expect(abandoned.refused).toBe(1);
    expect(apiFetch).toHaveBeenCalledTimes(5);

    /** ⚠️ The manual path clears only the memory — the mark is untouched and is judged again. */
    expect(await retryAbandonedWrites()).toBe(1);
    expect((await readMarks())[id]?.pending).toBe(true);

    vi.mocked(apiFetch).mockResolvedValue(entry() as never);
    await syncAll();

    expect(apiFetch).toHaveBeenCalledTimes(6);
    expect((await readMarks())[id]).toBeUndefined();
  });
});
