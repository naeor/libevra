import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImportDoneScreen } from "./ImportDoneScreen.js";
import { ToastProvider } from "../toast/ToastProvider.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import { recordImportBatch, type OcrImportSession } from "../../lib/ocr/importSession.js";

/**
 * The completion state is its own screen shell: it must not render `InnerPage`'s back control
 * or its 「重新识别」 action, because both now have an explicit replacement (「返回明细」 and
 * 「再识别一批」). Since 1.19.66 the completion notice goes through the unified toast queue; that it is
 * queued on mount and taken down on every exit is checked at the source level because effects do not run
 * in a DOM-free test (the wording and options are covered by `ImportToast.test.ts`).
 */

const noop = (): void => undefined;

const SCREEN_SOURCE = readFileSync(
  fileURLToPath(new URL("./ImportDoneScreen.tsx", import.meta.url)),
  "utf8",
);

function outcomeOf(succeeded: number, pending: number = 0): OcrImportOutcome {
  return {
    attempted: succeeded,
    succeeded: Array.from({ length: succeeded }, (_, index) => ({
      candidateId: `ok-${String(index)}`,
      label: "20.00 CNY · 便利店",
      pending: index < pending,
    })),
    failed: [],
    blockers: [],
  };
}

function sessionOf(succeeded: number, pending: number = 0): OcrImportSession {
  return recordImportBatch(null, {
    batchId: "batch-1",
    bookId: "book-1",
    importedAt: "2026-10-21T10:00:00.000Z",
    succeeded,
    failed: 0,
    pending,
  });
}

function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function render(): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <ImportDoneScreen
        outcome={outcomeOf(4, 1)}
        session={sessionOf(4, 1)}
        onBackToDetail={noop}
        onAgain={noop}
        onRetry={noop}
      />
    </ToastProvider>,
  );
}

describe("ImportDoneScreen", () => {
  it("renders the result without InnerPage's back or re-recognise controls", () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain("全部导入成功");
    expect(text).toContain("返回明细");
    expect(text).toContain("再识别一批");
    expect(html).not.toContain("data-back-control");
    expect(text).not.toContain("重新识别");
  });

  it("no longer renders its own toast: the page itself keeps the result on screen", () => {
    const html = render();
    const text = textOf(html);

    // The page still states the result in full; the notice is an echo handed to the toast queue.
    expect(text).toContain("全部导入成功");
    expect(html).not.toContain("-translate-y-[150%]");
    expect(html).not.toContain("pointer-events-none fixed inset-x-0 top-0");
  });

  it("queues the notice on mount and takes it down on every exit", () => {
    // Effects cannot run here, so the rules are asserted on the source that owns them.
    expect(SCREEN_SOURCE).toContain("toast.show(importDoneToast(outcome))");
    expect(SCREEN_SOURCE).toContain("toast.dismiss(id)");
    expect(SCREEN_SOURCE).toContain("if (shown.current !== null) toast.dismiss(shown.current);");
    expect(SCREEN_SOURCE).toContain("leave(onBackToDetail)");
    expect(SCREEN_SOURCE).toContain("leave(onAgain)");
    expect(SCREEN_SOURCE).toContain("leave(onRetry)");
  });
});
