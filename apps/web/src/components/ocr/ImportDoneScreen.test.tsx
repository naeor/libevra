import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImportDoneScreen } from "./ImportDoneScreen.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import { recordImportBatch, type OcrImportSession } from "../../lib/ocr/importSession.js";

/**
 * The completion state is its own screen shell: it must not render `InnerPage`'s back control
 * or its 「重新识别」 action, because both now have an explicit replacement (「返回明细」 and
 * 「再识别一批」). It also owns the toast's lifecycle, which is checked at the source level
 * because the timer cannot run in a DOM-free test.
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
    <ImportDoneScreen
      outcome={outcomeOf(4, 1)}
      session={sessionOf(4, 1)}
      onBackToDetail={noop}
      onAgain={noop}
      onRetry={noop}
    />,
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

  it("mounts the live-region toast with the queued wording from the real outcome", () => {
    const html = render();
    const text = textOf(html);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(text).toContain("账目已成功导入");
    expect(text).toContain("3 笔已写入账本，1 笔在本机排队、联网后自动同步");
    expect(text).not.toContain("已同步到服务器");
  });

  it("starts the toast off-screen so it can slide in", () => {
    expect(render()).toContain("-translate-y-[150%]");
  });

  it("clears its timer and hides the toast on every exit", () => {
    // The effect cannot run here, so the rules are asserted on the source that owns them.
    expect(SCREEN_SOURCE).toContain("clearTimeout(timer)");
    expect(SCREEN_SOURCE).toContain("cancelAnimationFrame(frame)");
    expect(SCREEN_SOURCE).toContain("IMPORT_TOAST_MS");
    expect(SCREEN_SOURCE).toContain('dispatchToast({ type: "hide" })');
    expect(SCREEN_SOURCE).toContain("leave(onBackToDetail)");
    expect(SCREEN_SOURCE).toContain("leave(onAgain)");
    expect(SCREEN_SOURCE).toContain("leave(onRetry)");
  });
});
