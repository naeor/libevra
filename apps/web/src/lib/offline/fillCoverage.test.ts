import { describe, expect, it } from "vitest";

import {
  collectMonthPages,
  FILL_MONTH_ENTRY_LIMIT,
  FILL_PAGE_SIZE,
  MAX_FILL_PAGES,
  type PageOfEntries,
} from "./fillCoverage.js";

/**
 * ⚠️ **These tests exist because the old code could not tell "finished" from "cut off".**
 *
 * The old fill loop ran at most forty pages of a hundred entries and then wrote whatever it
 * had as the whole month: a month with 4,001 entries was silently short on the device, and
 * the next launch repeated the same forty pages for ever. Widening the ceiling is only half
 * the fix — the other half is that reaching the ceiling must be a different answer from
 * finishing, and these are the numbers where the two differ.
 */
describe("collecting one month's pages", () => {
  /** A server with `total` entries, paging at the same size the fill asks for. */
  function fakeApi(total: number): {
    readonly fetchPage: (cursor: string | undefined) => Promise<PageOfEntries<number>>;
    readonly calls: (string | undefined)[];
  } {
    const calls: (string | undefined)[] = [];

    return {
      calls,
      fetchPage: (cursor) => {
        calls.push(cursor);

        const start = cursor === undefined ? 0 : Number(cursor);
        const end = Math.min(total, start + FILL_PAGE_SIZE);
        const items = Array.from({ length: end - start }, (_, index) => start + index);

        return Promise.resolve({ items, nextCursor: end < total ? String(end) : null });
      },
    };
  }

  /**
   * The boundary numbers, chosen so that each one either stands exactly on a page boundary
   * or one entry past it. 4,001 is the number the owner's report was about: the old ceiling
   * (4,000) made it incomplete, the new one must not.
   */
  const cases = [
    { total: 3_999, pages: 40, complete: true },
    { total: 4_000, pages: 40, complete: true },
    { total: 4_001, pages: 41, complete: true },
    { total: 49_999, pages: 500, complete: true },
    { total: 50_000, pages: 500, complete: true },
    { total: 50_001, pages: 500, complete: false },
  ] as const;

  for (const { total, pages, complete } of cases) {
    it(`reads ${total.toLocaleString("en-US")} entries in ${String(pages)} pages, complete=${String(complete)}`, async () => {
      const api = fakeApi(total);
      const collected = await collectMonthPages(api.fetchPage);

      expect(api.calls).toHaveLength(pages);
      expect(collected.pages).toHaveLength(pages);
      expect(collected.entries).toBe(Math.min(total, FILL_MONTH_ENTRY_LIMIT));
      expect(collected.complete).toBe(complete);
    });
  }

  it("stops before the next request when the ledger switched", async () => {
    const api = fakeApi(10_000);
    let stop = false;

    const collected = await collectMonthPages(api.fetchPage, {
      onPage: () => {
        stop = true;
      },
      shouldStop: () => stop,
    });

    expect(api.calls).toHaveLength(1);
    expect(collected.complete).toBe(false);
    expect(collected.entries).toBe(FILL_PAGE_SIZE);
  });

  it("reports each page as it arrives, so an interrupted month keeps what it got", async () => {
    const api = fakeApi(250);
    const seen: number[] = [];

    await collectMonthPages(api.fetchPage, {
      onPage: (pages) => seen.push(pages.length),
    });

    expect(seen).toEqual([1, 2, 3]);
  });

  it("honours a smaller page budget and says it is incomplete", async () => {
    const api = fakeApi(1_000);
    const collected = await collectMonthPages(api.fetchPage, { maxPages: 2 });

    expect(collected.complete).toBe(false);
    expect(collected.entries).toBe(200);
  });

  it("derives the page budget from the entry limit instead of a second hand-written number", () => {
    expect(MAX_FILL_PAGES).toBe(Math.ceil(FILL_MONTH_ENTRY_LIMIT / FILL_PAGE_SIZE));
  });
});
