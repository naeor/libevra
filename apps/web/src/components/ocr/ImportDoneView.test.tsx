import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImportDoneView, importDoneStatus } from "./ImportDoneView.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import {
  recordImportBatch,
  type OcrImportRecord,
  type OcrImportSession,
} from "../../lib/ocr/importSession.js";

/**
 * The completion screen is a view over two pure inputs: the import outcome and the session.
 * Rendering it to static markup is enough to check the things that must never be wrong —
 * which words appear, which numbers appear, and which controls do **not**.
 */

const noop = (): void => undefined;

function outcomeOf({
  succeeded = 0,
  pending = 0,
  failed = 0,
  blockers = 0,
}: {
  readonly succeeded?: number;
  readonly pending?: number;
  readonly failed?: number;
  readonly blockers?: number;
} = {}): OcrImportOutcome {
  return {
    attempted: succeeded + failed,
    succeeded: Array.from({ length: succeeded }, (_, index) => ({
      candidateId: `ok-${String(index)}`,
      label: `${String(20 + index)}.00 CNY · 便利店`,
      pending: index < pending,
    })),
    failed: Array.from({ length: failed }, (_, index) => ({
      candidateId: `bad-${String(index)}`,
      label: "金额待确认 · 商户待确认",
      reason: "金额缺失",
    })),
    blockers: Array.from({ length: blockers }, (_, index) => ({
      candidateId: `blocked-${String(index)}`,
      label: "商户待确认",
      reason: "日期待确认",
    })),
  };
}

function sessionOf(records: readonly OcrImportRecord[]): OcrImportSession {
  const session = records.reduce<OcrImportSession | null>(
    (current, record) => recordImportBatch(current, record),
    null,
  );

  if (session === null) throw new Error("session fixtures need at least one batch");

  return session;
}

function recordOverrides(overrides: Partial<OcrImportRecord> = {}): OcrImportRecord {
  return {
    batchId: "batch-1",
    bookId: "book-1",
    importedAt: "2026-10-21T10:00:00.000Z",
    succeeded: 0,
    failed: 0,
    pending: 0,
    ...overrides,
  };
}

function render({
  outcome = outcomeOf({ succeeded: 1 }),
  session = sessionOf([recordOverrides({ succeeded: 1 })]),
  onBackToDetail = noop,
  onAgain = noop,
  onRetry = noop,
}: {
  readonly outcome?: OcrImportOutcome;
  readonly session?: OcrImportSession;
  readonly onBackToDetail?: () => void;
  readonly onAgain?: () => void;
  readonly onRetry?: () => void;
} = {}): string {
  return renderToStaticMarkup(
    <ImportDoneView
      outcome={outcome}
      session={session}
      onBackToDetail={onBackToDetail}
      onAgain={onAgain}
      onRetry={onRetry}
    />,
  );
}

/** Visible text, with tags and React's text separators removed. */
function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("importDoneStatus", () => {
  it("calls it a failure only when nothing at all was written", () => {
    expect(importDoneStatus(outcomeOf({ failed: 3 }))).toBe("failed");
    expect(importDoneStatus(outcomeOf({ succeeded: 8, failed: 2 }))).toBe("partial");
    expect(importDoneStatus(outcomeOf({ succeeded: 8 }))).toBe("success");
  });
});

describe("ImportDoneView", () => {
  it("states the success, the session totals and this batch, with the two exits", () => {
    const html = render({
      outcome: outcomeOf({ succeeded: 10 }),
      session: sessionOf([recordOverrides({ succeeded: 10 })]),
    });
    const text = textOf(html);

    expect(text).toContain("全部导入成功");
    expect(text).toContain("本次会话累计导入 10 笔 · 共 1 批");
    expect(text).toContain("第 1 批");
    expect(text).toContain("成功 10 · 失败 0");
    expect(text).toContain("返回明细");
    expect(text).toContain("再识别一批");
    expect(html).toContain('dateTime="2026-10-21T10:00:00.000Z"');

    // No back control, no second "recognise again" control: the exits above are the only ones.
    expect(html).not.toContain("data-back-control");
    expect(text).not.toContain("重新识别");
    // Nothing was queued, so the queue sentence must be absent.
    expect(text).not.toContain("本机排队");
  });

  it("says 部分导入成功 with both numbers, never the all-success sentence", () => {
    const text = textOf(
      render({
        outcome: outcomeOf({ succeeded: 8, failed: 2 }),
        session: sessionOf([recordOverrides({ succeeded: 8, failed: 2 })]),
      }),
    );

    expect(text).toContain("部分导入成功");
    expect(text).toContain("成功 8 · 失败 2");
    expect(text).toContain("失败的 2 笔仍留在批次里，可重试。");
    expect(text).toContain("返回批次处理 2 笔失败");
    expect(text).not.toContain("全部导入成功");
    expect(text).not.toContain("账目已成功导入");
  });

  it("does not present an all-failed import as a success", () => {
    const html = render({
      outcome: outcomeOf({ failed: 3 }),
      session: sessionOf([recordOverrides({ failed: 3 })]),
    });
    const text = textOf(html);

    expect(text).toContain("导入失败");
    expect(text).toContain("成功 0 · 失败 3");
    expect(text).not.toContain("导入成功");
    expect(text).not.toContain("账目已成功导入");
    // A quiet red, not a green tick.
    expect(html).toContain("text-danger");
  });

  it("keeps queued entries in the device queue, not on the server", () => {
    const text = textOf(
      render({
        outcome: outcomeOf({ succeeded: 3, pending: 3 }),
        session: sessionOf([recordOverrides({ succeeded: 3, pending: 3 })]),
      }),
    );

    expect(text).toContain("其中 3 笔已在本机排队，联网后自动同步");
    expect(text).not.toContain("已同步到服务器");
    expect(text).not.toContain("服务器已保存");
  });

  it("puts the newest batch first and counts the whole session", () => {
    const session = sessionOf([
      recordOverrides({ batchId: "batch-1", succeeded: 10 }),
      recordOverrides({
        batchId: "batch-2",
        importedAt: "2026-10-21T10:05:00.000Z",
        succeeded: 5,
        failed: 1,
      }),
    ]);
    const text = textOf(
      render({ outcome: outcomeOf({ succeeded: 5, failed: 1 }), session }),
    );

    expect(text).toContain("本次会话累计导入 15 笔 · 共 2 批");
    expect(text.indexOf("第 2 批")).toBeLessThan(text.indexOf("第 1 批"));
  });
});
