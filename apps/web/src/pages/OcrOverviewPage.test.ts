import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { OcrImportBlocker } from "../lib/ocr/import.js";
import type { OcrBatch } from "../lib/ocr/types.js";
import { batchCandidate } from "../lib/ocr/testFixtures.js";
import { importDisabledReason } from "./OcrOverviewPage.js";

/**
 * The confirm button's safety rule.
 *
 * Every branch here is a decision the user must be able to read: permission
 * (viewer / shared-ledger offline), wrong ledger, nothing valid, and fields that
 * would fail the write. An enabled button over a guaranteed server refusal is
 * the failure this covers.
 */

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./OcrOverviewPage.tsx", import.meta.url)),
  "utf8",
);

function batchOf(bookId: string | null = "book-1"): OcrBatch {
  return {
    version: 1,
    batchId: "batch-1",
    createdAt: "2026-10-20T00:00:00.000Z",
    bookId,
    pages: [],
    items: [batchCandidate()],
    importIds: {},
  };
}

const NO_BLOCKERS: readonly OcrImportBlocker[] = [];

describe("importDisabledReason", () => {
  it("allows the import when every check passes", () => {
    expect(
      importDisabledReason({
        batch: batchOf(),
        validCount: 1,
        blockers: NO_BLOCKERS,
        wrongBook: false,
        readOnly: false,
        isViewer: false,
      }),
    ).toBeNull();
  });

  it("explains that there is no batch", () => {
    expect(
      importDisabledReason({
        batch: null,
        validCount: 0,
        blockers: NO_BLOCKERS,
        wrongBook: false,
        readOnly: false,
        isViewer: false,
      }),
    ).toContain("没有待导入");
  });

  it("refuses another ledger's batch instead of writing into the current one", () => {
    expect(
      importDisabledReason({
        batch: batchOf("book-a"),
        validCount: 1,
        blockers: NO_BLOCKERS,
        wrongBook: true,
        readOnly: false,
        isViewer: false,
      }),
    ).toContain("另一本账本");
  });

  it("refuses a shared ledger while offline", () => {
    expect(
      importDisabledReason({
        batch: batchOf(),
        validCount: 1,
        blockers: NO_BLOCKERS,
        wrongBook: false,
        readOnly: true,
        isViewer: false,
      }),
    ).toContain("共享账本");
  });

  it("refuses a viewer and says why", () => {
    expect(
      importDisabledReason({
        batch: batchOf(),
        validCount: 1,
        blockers: NO_BLOCKERS,
        wrongBook: false,
        readOnly: false,
        isViewer: true,
      }),
    ).toContain("只读成员");
  });

  it("refuses when everything is marked invalid", () => {
    expect(
      importDisabledReason({
        batch: batchOf(),
        validCount: 0,
        blockers: NO_BLOCKERS,
        wrongBook: false,
        readOnly: false,
        isViewer: false,
      }),
    ).toContain("没有可导入");
  });

  it("names the first blocker so the user knows where to start", () => {
    expect(
      importDisabledReason({
        batch: batchOf(),
        validCount: 2,
        blockers: [
          { candidateId: "a", label: "20.00 CNY · 早餐店", reason: "金额缺失" },
          { candidateId: "b", label: "18.00 CNY · 午餐店", reason: "日期待确认" },
        ],
        wrongBook: false,
        readOnly: false,
        isViewer: false,
      }),
    ).toBe("还有 2 笔不能导入（金额缺失），请先核对或标记无效。");
  });
});

/**
 * The bottom bar is a *view* of the page's existing import flow, so these are
 * source assertions: without a DOM the thing that must be proven is that the
 * screen did not grow a second writer or a second confirmation step.
 */
describe("bottom import bar wiring", () => {
  it("renders the bar from real counts and the same disabled reason", () => {
    expect(PAGE_SOURCE).toContain("const importableCount = countImportableItems(items);");
    expect(PAGE_SOURCE).toContain("<OcrImportBar");
    expect(PAGE_SOURCE).toContain("importableCount={importableCount}");
    expect(PAGE_SOURCE).toContain("blockedReason={disabledReason}");
    expect(PAGE_SOURCE).toContain("blockers={blockers}");
    expect(PAGE_SOURCE).toContain("busy={importing}");
  });

  it("still confirms through the existing executeImport/createEntry path", () => {
    expect(PAGE_SOURCE).toContain("executeImport(");
    expect(PAGE_SOURCE).toContain("createLocally(");
    expect(PAGE_SOURCE).toContain('import { createEntry as createLocally, localEntry } from "../lib/offline/write.js";');
    // No second write protocol, no direct network write, no new batch endpoint.
    expect(PAGE_SOURCE).not.toContain("fetch(");
    expect(PAGE_SOURCE).not.toContain("POST");
    expect(PAGE_SOURCE).not.toContain("bulk");
  });

  it("leaves room below the list so the last card is not covered", () => {
    expect(PAGE_SOURCE).toContain('const BOTTOM_BAR_CLEARANCE = "h-44";');
    expect(PAGE_SOURCE).toContain("className={BOTTOM_BAR_CLEARANCE}");
  });

  it("keeps the explanatory text to one short line", () => {
    expect(PAGE_SOURCE).toContain('subtitle="只核对有疑问的；确认前不写账本。"');
  });

  it("reads the batch's own ledger categories and applies the shared matcher", () => {
    expect(PAGE_SOURCE).toContain("const bookMeta = useLedgerMeta(batchBookId);");
    expect(PAGE_SOURCE).toContain("applyCategorySuggestions(batch.items, categories)");
  });
});
