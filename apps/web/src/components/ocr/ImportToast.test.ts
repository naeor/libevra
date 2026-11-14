import { describe, expect, it } from "vitest";

import { importDoneToast, importToastFor } from "./ImportToast.js";
import { dwellMs } from "../../lib/toast/timing.js";
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

/**
 * 1.19.66：提示本身走统一提示条（原顶部滑入视图、reducer 与 3 秒计时已删除）。这里守住交给提示条的选项：
 * 类型映射（全失败 = 错误）、页面作用域（离开完成页即撤下）、回声（页面常驻显示结果，错误也自动消失、只用 polite 播报）。
 */
describe("importDoneToast", () => {
  it("maps the three outcomes to success / warning / error and keeps the wording", () => {
    const success = importDoneToast(outcomeOf({ succeeded: 3 }));
    expect(success).toMatchObject({ tone: "success", text: "账目已成功导入", scope: "page", echo: true });
    expect(success.detail).toContain("本批 3 笔已写入账本");
    expect(importDoneToast(outcomeOf({ succeeded: 8, failed: 2 })).tone).toBe("warning");
    const failed = importDoneToast(outcomeOf({ failed: 3 }));
    expect(failed.tone).toBe("error");
    expect(failed.text).not.toContain("成功");
  });

  it("is an echo of the page: even a total failure leaves after 8 seconds instead of staying", () => {
    const failed = importDoneToast(outcomeOf({ failed: 3 }));
    expect(dwellMs({ tone: failed.tone ?? "info", text: failed.text, detail: failed.detail, hasAction: false, echo: failed.echo === true })).toBe(8_000);
    const success = importDoneToast(outcomeOf({ succeeded: 3 }));
    // 标题 + 说明约 15–40 字：4–6.3 秒（原 3 秒）。
    const ms = dwellMs({ tone: "success", text: success.text, detail: success.detail, hasAction: false, echo: true }) ?? 0;
    expect(ms).toBeGreaterThanOrEqual(4_000);
    expect(ms).toBeLessThanOrEqual(8_000);
  });
});
