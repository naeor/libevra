import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IMPORT_TOAST_MS,
  ImportToast,
  importToastFor,
  importToastReducer,
  type ImportToastState,
} from "./ImportToast.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";

/**
 * The toast is the one piece of feedback that appears at the exact moment the batch is
 * written, so its wording is a correctness question, not a styling one: queued entries must
 * not read as server-saved, a partial import must not read as a success, and a failure must
 * not contain the word 成功 at all.
 */

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
      label: "20.00 CNY · 便利店",
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

function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("importToastFor", () => {
  it("reports every entry as written when nothing is queued", () => {
    const message = importToastFor(outcomeOf({ succeeded: 3 }));

    expect(message).toMatchObject({ tone: "success", title: "账目已成功导入" });
    expect(message.detail).toContain("本批 3 笔已写入账本");
    expect(message.detail).not.toContain("排队");
  });

  it("counts the batch in a partial import and never says it all succeeded", () => {
    const message = importToastFor(outcomeOf({ succeeded: 8, failed: 2 }));

    expect(message.tone).toBe("warning");
    expect(message.title).toBe("导入完成：成功 8 笔，失败 2 笔");
    expect(message.detail).toContain("失败的 2 笔仍留在批次里");
    expect(message.title).not.toContain("账目已成功导入");
  });

  it("does not show the word 成功 when nothing was written", () => {
    const message = importToastFor(outcomeOf({ failed: 3 }));

    expect(message.tone).toBe("danger");
    expect(message.title).toBe("导入失败");
    expect(`${message.title}${message.detail}`).not.toContain("成功");
  });

  it("says queued entries are on this device, waiting for the network", () => {
    const message = importToastFor(outcomeOf({ succeeded: 3, pending: 3 }));

    expect(message.tone).toBe("success");
    expect(message.title).toBe("账目已在本机排队");
    expect(`${message.title}${message.detail}`).toContain("本机排队");
    expect(`${message.title}${message.detail}`).toContain("联网后自动同步");
    expect(`${message.title}${message.detail}`).not.toContain("已同步到服务器");
  });

  it("separates delivered entries from queued ones in a mixed batch", () => {
    const message = importToastFor(outcomeOf({ succeeded: 5, pending: 2 }));

    expect(message.title).toBe("账目已成功导入");
    expect(message.detail).toContain("3 笔已写入账本");
    expect(message.detail).toContain("2 笔在本机排队、联网后自动同步");
  });

  it("refuses to toast a batch that was blocked before it was written", () => {
    const message = importToastFor(outcomeOf({ blockers: 2 }));

    expect(message.tone).toBe("danger");
    expect(message.title).toBe("没有导入任何账目");
    expect(message.detail).toContain("2 笔还不能导入");
  });
});

describe("ImportToast", () => {
  it("announces itself and carries the message when shown", () => {
    const message = importToastFor(outcomeOf({ succeeded: 3 }));
    const html = renderToStaticMarkup(<ImportToast message={message} visible />);
    const text = textOf(html);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(text).toContain("账目已成功导入");
    expect(text).toContain("本批 3 笔已写入账本");
    // Brand green, and it never swallows taps on the page underneath.
    expect(html).toContain("bg-brand-soft");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("translate-y-0");
  });

  it("uses the warning and danger semantic colours for the other outcomes", () => {
    const warning = renderToStaticMarkup(
      <ImportToast message={importToastFor(outcomeOf({ succeeded: 8, failed: 2 }))} visible />,
    );
    const danger = renderToStaticMarkup(
      <ImportToast message={importToastFor(outcomeOf({ failed: 3 }))} visible />,
    );

    expect(warning).toContain("bg-warn-soft");
    expect(warning).toContain("text-warn-dark");
    expect(danger).toContain("bg-danger-soft");
    expect(danger).toContain("text-danger");
    expect(danger).not.toContain("账目已成功导入");
  });

  it("keeps the message off-screen while hidden", () => {
    const html = renderToStaticMarkup(
      <ImportToast message={importToastFor(outcomeOf({ succeeded: 1 }))} visible={false} />,
    );

    expect(html).toContain("-translate-y-[150%]");
    expect(html).not.toContain("translate-y-0");
    expect(html).toContain('role="status"');
  });

  it("renders an empty live region before any import completes", () => {
    const html = renderToStaticMarkup(<ImportToast message={null} visible={false} />);

    expect(html).toContain('role="status"');
    expect(textOf(html)).toBe("");
  });

  it("is on screen for about three seconds", () => {
    expect(IMPORT_TOAST_MS).toBe(3000);
  });
});

describe("importToastReducer", () => {
  const hidden: ImportToastState = { message: null, visible: false };
  const message = importToastFor(outcomeOf({ succeeded: 2 }));

  it("shows the message and marks it visible", () => {
    expect(importToastReducer(hidden, { type: "show", message })).toEqual({
      message,
      visible: true,
    });
  });

  it("hides on demand but keeps the message for the slide-out", () => {
    const shown = importToastReducer(hidden, { type: "show", message });

    expect(importToastReducer(shown, { type: "hide" })).toEqual({ message, visible: false });
  });

  it("does not re-render when hiding an already hidden toast", () => {
    expect(importToastReducer(hidden, { type: "hide" })).toBe(hidden);
  });
});
