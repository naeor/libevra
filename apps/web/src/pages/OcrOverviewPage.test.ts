import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { zhCN } from "../i18n/resources/index.js";
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

  it("没有页面副标题：「确认前不写账本」只在底部操作条说一次（1.17.23 文案精简）", () => {
    expect(PAGE_SOURCE).not.toContain("subtitle=");
    expect("subtitle" in zhCN.ocr.overview).toBe(false);
    expect(zhCN.ocr.bar.nothingWritten).toBe("确认前不会写入账本。");
  });

  it("reads the batch's own ledger categories and applies the shared matcher", () => {
    expect(PAGE_SOURCE).toContain("const bookMeta = useLedgerMeta(batchBookId);");
    expect(PAGE_SOURCE).toContain("applyCategorySuggestions(batch.items, categories)");
  });
});

/**
 * Completion is a session boundary, and the two exits differ in exactly one respect:
 * 「返回明细」clears the session, 「再识别一批」keeps it. A screen without a DOM cannot press
 * them, so the wiring is asserted where it is written — and the completion branch is checked
 * for the thing it must not contain, `InnerPage`'s back and 「重新识别」 controls.
 */
describe("completion screen wiring", () => {
  function between(start: string, end: string): string {
    const from = PAGE_SOURCE.indexOf(start);
    const to = PAGE_SOURCE.indexOf(end, from + start.length);

    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);

    return PAGE_SOURCE.slice(from, to);
  }

  it("renders its own completion shell instead of InnerPage", () => {
    const completion = between("if (done !== null) {", "<InnerPage");

    expect(completion).toContain("<ImportDoneScreen");
    expect(completion).toContain("outcome={done.outcome}");
    expect(completion).toContain("session={done.session}");
    expect(completion).not.toContain("backTo=");
    expect(completion).not.toContain("data-back-control");
  });

  it("ends and clears the session before going to the ledger", () => {
    const finish = between("function finishSession", "function importAgain");

    expect(finish).toContain("clearImportSession();");
    expect(finish).toContain('navigate("/")');
  });

  it("starts the next batch without clearing the session", () => {
    const again = between("function importAgain", "function retryFailed");

    expect(again).toContain('navigate("/scan")');
    expect(again).not.toContain("clearImportSession");
  });

  it("goes back to the batch for failed items, without touching the batch", () => {
    const retry = between("function retryFailed", "function cancelBatch");

    expect(retry).toContain("setDone(null)");
    expect(retry).not.toContain("clearBatch");
    expect(retry).not.toContain("withoutBatchItems");
  });

  it("records the batch with the id captured before the batch was cleared", () => {
    expect(PAGE_SOURCE).toContain("recordImportBatch(session, {");
    expect(PAGE_SOURCE).toContain("batchId: assigned.batchId");
    expect(PAGE_SOURCE).toContain("pending: result.succeeded.filter((entry) => entry.pending).length");
  });

  it("drops a session that belongs to another ledger", () => {
    const bookCheck = between(
      "if (session === null || currentBookId === null) return;",
      "const counts = countBatchItems(items);",
    );

    expect(bookCheck).toContain("if (session.bookId === currentBookId) return;");
    expect(bookCheck).toContain("clearImportSession();");
    expect(bookCheck).toContain("setSession(null);");
  });

  it("shows the session total after a refresh instead of the empty state", () => {
    expect(PAGE_SOURCE).toContain("const resumeSession =");
    expect(PAGE_SOURCE).toContain('i18nKey="ocr.overview.resumeTitle"');
    expect(zhCN.ocr.overview.resumeTitle_other).toContain("本次会话已导入");
    expect(PAGE_SOURCE).toContain("resumeTotals.imported");
  });
});
