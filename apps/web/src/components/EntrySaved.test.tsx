import type { Transaction } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { EntrySaved } from "./EntrySaved.js";

/**
 * The screen that replaced "a line of green text above a still-filled form".
 *
 * What is worth asserting is exactly what people were unsure about before: that
 * the entry was recorded, and *what* was recorded.
 */
function entry(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "01920000-0000-7000-8000-000000000000",
    kind: "expense",
    amountCents: 2000,
    currency: "CNY",
    categoryId: "c1",
    categoryName: "餐饮",
    categoryIsSystem: false,
    paymentMethodId: "p1",
    paymentMethodName: "微信",
    occurredAt: "2026-10-09T04:00:00.000Z",
    occurredLocalDate: "2026-10-09",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [],
    version: 1,
    ...overrides,
  } as Transaction;
}

function render(props: Partial<Parameters<typeof EntrySaved>[0]> = {}): string {
  return renderToStaticMarkup(
    <EntrySaved
      entry={entry()}
      categoryName="餐饮"
      paymentName="微信"
      remaining={0}
      onHome={() => undefined}
      onAgain={() => undefined}
      {...props}
    />,
  );
}

describe("EntrySaved", () => {
  it("says the entry was recorded", () => {
    expect(render()).toContain("已记账");
  });

  it("shows the amount, not just that something happened", () => {
    // A confirmation is only reassuring if it says what was confirmed.
    expect(render()).toContain("20.00");
  });

  it("shows what it was filed under", () => {
    const html = render();

    expect(html).toContain("餐饮");
    expect(html).toContain("微信");
  });

  it("offers both ways onward when nothing is left", () => {
    const html = render();

    expect(html).toContain("再记一笔");
    expect(html).toContain("返回主页");
  });

  it("puts the repeat action before the exit", () => {
    // This screen appears after every save, and recording a day's spending
    // means several in a row.
    const html = render();

    expect(html.indexOf("再记一笔")).toBeLessThan(html.indexOf("返回主页"));
  });

  it("offers no way home in the middle of a batch", () => {
    /**
     * The owner's correction: going home mid-batch abandons the screenshots
     * still waiting, and those are the reason the person is on this screen.
     */
    const html = render({ remaining: 2 });

    expect(html).toContain("继续记账");
    expect(html).not.toContain("返回主页");
  });

  it("says how many are left, counting only what is ahead", () => {
    // He read "还需两次" as "two more after this one" while the screen meant
    // "two including this one", so the two readings differed by one. The count
    // is now stated as what remains rather than as a total.
    expect(render({ remaining: 2 })).toContain("还有 2 张");
    expect(render({ remaining: 1 })).toContain("还有 1 张");
  });

  it("brings the way home back on the last entry of a batch", () => {
    const html = render({ remaining: 0 });

    expect(html).toContain("返回主页");
    expect(html).not.toContain("继续记账");
  });

  it("offers to take the entry back when it is told how", () => {
    // The owner's arithmetic: fixing a wrong amount used to mean finding the row
    // in the list and editing it, where the moment after saving is exactly when
    // the mistake is noticed.
    const html = render({ onUndo: () => undefined });

    expect(html).toContain("撤销这次记账");
  });

  it("offers no undo when the caller does not provide one", () => {
    // The manual form keeps its fields behind this screen, so an undo there
    // would be a second way to do what the back button already does.
    expect(render()).not.toContain("撤销这次记账");
  });

  it("puts the undo last and quiet", () => {
    // A screen that shouts "undo" invites the doubt it exists to remove, and the
    // eye should reach "record the next one" first.
    const html = render({ onUndo: () => undefined });

    expect(html.indexOf("返回主页")).toBeLessThan(html.indexOf("撤销这次记账"));
    /**
      * ⚠️ **The token, not the literal classes it replaced.** This used to assert `text-xs text-muted
      * underline`; the typography rollout moved the size onto the semantic token, so **the assertion
      * follows the spec's current spelling rather than its old wording.** What it guards is unchanged:
      * the undo is the quiet one.
      */
    expect(html).toContain("text-helper text-muted underline");
  });

  it("offers the shortcut quote only when the caller provides it", () => {
    /**
     * ⚠️ **A personal ledger passes nothing, and the screen is exactly what it was** — telling your
     * only self about the entry you just wrote is noise, and the owner asked for the entry to be
     * *absent* there rather than hidden.
     */
    const html = render({ onQuote: () => undefined });

    expect(html).toContain("就这笔留言");
    expect(render()).not.toContain("就这笔留言");
  });

  it("puts the shortcut inside the success info, above the primary actions", () => {
    /**
     * m06693：所有者要求把入口从「返回主页」下方移到金额/分类下方的成功信息区，「与「再记一笔」
     * 「返回主页」两个主操作区分开」。所以它必须在金额之后、主按钮之前——而不是第三个操作。
     */
    const html = render({ onQuote: () => undefined });
    const shortcut = html.indexOf("就这笔留言");

    expect(html.indexOf("20.00")).toBeLessThan(shortcut);
    expect(shortcut).toBeLessThan(html.indexOf("再记一笔"));
    expect(shortcut).toBeLessThan(html.indexOf("返回主页"));
  });

  it("swaps the shortcut for a quiet confirmation after the message is sent", () => {
    // 发完之后同一屏不再提供第二次入口；账目仍然原样保存。
    const html = render({ onQuote: () => undefined, quoteSent: true });

    expect(html).toContain("留言已发送");
    expect(html).not.toContain("就这笔留言");
  });

  it("announces itself to a screen reader", () => {
    // Otherwise the interface silently becomes a different screen.
    expect(render()).toContain('role="status"');
  });

  it("copes with an entry that has no category or payment method", () => {
    const html = render({ categoryName: "", paymentName: null });

    expect(html).toContain("已记账");
    expect(html).not.toContain(" · ");
  });

  it("formats a currency without decimals correctly", () => {
    const html = render({ entry: entry({ amountCents: 1000, currency: "JPY" }) });

    // ¥1000, not ¥10.00 — the per-currency precision rule reaches the
    // confirmation screen too.
    expect(html).toContain("1,000");
    expect(html).not.toContain("10.00");
  });
});

/** S16：英文界面下没有中文；预置分类与支付方式按英文显示（传入的仍是存储的中文原名）。 */
describe("EntrySaved in English", () => {
  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("speaks English and shows preset names in English", () => {
    applyLocale("en-US");
    const html = render({ onUndo: () => undefined });

    expect(html).not.toMatch(/[㐀-鿿]/);
    expect(html).toContain("Saved");
    expect(html).toContain("Food &amp; drink · WeChat Pay");
    expect(html).toContain("Add another");
    expect(html).toContain("Back to home");
    expect(html).toContain("Undo this entry");
  });

  it("counts what is left in a batch", () => {
    applyLocale("en-US");

    expect(render({ remaining: 3 })).toContain("Continue (3 left)");
  });

  it("offers the shortcut quote in English too", () => {
    applyLocale("en-US");

    expect(render({ onQuote: () => undefined })).toContain("Message about this");
    expect(render({ onQuote: () => undefined, quoteSent: true })).toContain("Message sent");
  });
});
