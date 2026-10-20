import { CURRENCIES, categoriesFor, type Tag } from "@libellum/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { EntryMoreOptions } from "../components/entry/EntryMoreOptions.js";
import { keyboardOffset } from "../components/entry/keyboardInset.js";
import { AddEntryPage, nextEntryFields } from "./AddEntryPage.js";

/**
 * The rule restated by the project owner on 2026-10-10: **the date is never
 * carried over from the previous entry, in any circumstance.**
 *
 * The screen is checked in two halves, because the two halves fail differently.
 * What it shows when it is opened is a fact about the rendered component, and
 * is asserted through a render. What "再记一笔" resets lives in
 * `nextEntryFields`, a free function on purpose: pressing that button needs a
 * DOM, which this workspace has no test environment for (no jsdom, no
 * testing-library, and dependencies are not ours to add), and the reset is the
 * part that used to be wrong.
 */
function renderPage(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/add"]}>
        <AddEntryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The value of the 时间 field, which is the only `datetime-local` on screen. */
function shownMoment(html: string): Date {
  const match = /type="datetime-local"[^>]*value="([^"]*)"/.exec(html);

  expect(match?.[1]).toBeTruthy();

  return new Date(match?.[1] ?? "");
}

describe("AddEntryPage", () => {
  it("opens a new entry at the present moment", () => {
    // "Reopening the tab", "the first entry of the day" and "a new entry" are
    // all this one case: there is no earlier entry in the form to inherit from,
    // and there must never be a stale date left in the field either.
    const before = Date.now();
    const shown = shownMoment(renderPage());
    const after = Date.now();

    expect(Number.isNaN(shown.getTime())).toBe(false);
    expect(shown.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(shown.getTime()).toBeLessThanOrEqual(after + 1_000);
  });

  it("renders the entry form, so the assertion above reads the real screen", () => {
    // Without this, `shownMoment` could be matching nothing at all and the date
    // test would still pass on an empty string.
    expect(renderPage()).toContain('aria-label="金额"');
  });
});

describe("nextEntryFields", () => {
  const now = new Date("2026-10-10T09:12:00+08:00");

  it("starts the next entry from the clock it is given, and from nothing else", () => {
    // The moment of the entry just saved is not an input here, so a carried-over
    // date has nowhere to come from. The second line is what makes that a
    // statement rather than a hope: an implementation that read the clock
    // itself, or kept the last moment in module state, would not hand back an
    // arbitrary older time unchanged.
    const earlier = new Date("2026-10-09T16:55:00+08:00");

    expect(nextEntryFields(now).occurredAt.getTime()).toBe(now.getTime());
    expect(nextEntryFields(earlier).occurredAt.getTime()).toBe(earlier.getTime());
  });

  it("clears the amount, the note and the tags", () => {
    const next = nextEntryFields(now);

    expect(next.amountText).toBe("");
    expect(next.note).toBe("");
    expect(next.tagIds).toEqual([]);
  });
});

/**
 * ⚠️ **这里没有 jsdom，也没有 testing-library**（见 `vitest.config.ts`）：交互没法点击，
 * 所以「收起/展开」「保存条粘住」这些要求全部用**渲染出来的结构**断言——class、ARIA 属性、
 * 以及元素在 HTML 里的先后顺序。展示型组件（`EntryMoreOptions`）用受控 prop 分别渲染
 * 收起与展开两种状态，等价于点击后的结果；页面本身只断言默认收起。
 */
describe("AddEntryPage 移动端布局（S15-C）", () => {
  it("金额仍是可直接输入、可修改的输入框，并有一句可见提示", () => {
    const html = renderPage();
    const amount = /<input[^>]*aria-label="金额"[^>]*>/.exec(html)?.[0] ?? "";

    expect(amount).not.toBe("");
    // react-dom/server 19 按 React 属性名输出，HTML 属性名本身大小写不敏感。
    expect(amount.toLowerCase()).toContain('inputmode="decimal"');
    expect(amount.toLowerCase()).not.toContain("readonly");
    expect(html).toContain("点按即可修改");
  });

  it("顶层只有 支出/收入 两个切换，转账留在分类体系里", () => {
    const html = renderPage();
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    const kindSwitch =
      /<div data-entry-kind-switch[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";

    expect((kindSwitch.match(/<button/g) ?? []).length).toBe(2);
    expect(kindSwitch).toContain("支出");
    expect(kindSwitch).toContain("收入");
    expect(kindSwitch).toContain('aria-pressed="true"');
    expect(header).not.toContain("转账");

    // 转账不是顶层收支类型，而是支出/收入各自的一项分类预设：
    // 页面把它和别的分类一样渲染在分类选择器里，保存的 kind 始终只有 expense/income。
    expect(categoriesFor("expense").map((category) => category.name)).toContain("转账");
    expect(categoriesFor("income").map((category) => category.name)).toContain("转账");
  });

  it("保存按钮在表单内的 sticky 行动条里，且排在低频字段之后", () => {
    const html = renderPage();
    const barTag = /<div[^>]*data-entry-actions="sticky"[^>]*>/.exec(html)?.[0] ?? "";
    const barStart = html.indexOf('data-entry-actions="sticky"');

    expect(barTag).toContain("sticky");
    expect(barTag).toContain("bottom-0");
    expect(barStart).toBeGreaterThan(html.indexOf("更多选项"));
    expect(barStart).toBeLessThan(html.indexOf("</form>"));
    expect(html.slice(barStart, html.indexOf("</form>"))).toContain('type="submit"');
  });

  it("备注与标签默认收在「更多选项」里，入口明确", () => {
    const html = renderPage();
    const toggle =
      /<button[^>]*aria-controls="entry-more-options"[^>]*>/.exec(html)?.[0] ?? "";

    expect(html).toContain("更多选项");
    expect(toggle).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="备注"');
    expect(html).not.toContain("标签（最多");
  });

  it("币种与时间压成紧凑两行后仍可编辑", () => {
    const html = renderPage();

    expect(html).toMatch(/<select[^>]*aria-label="币种"[^>]*>/);
    expect((html.match(/<option/g) ?? []).length).toBe(CURRENCIES.length);
    expect(html).toMatch(/<input[^>]*type="datetime-local"/);
    expect(html).not.toMatch(/<select[^>]*aria-label="币种"[^>]*disabled/);
  });

  it("高频字段在 DOM 里全部排在低频字段之前", () => {
    const html = renderPage();
    const order = [
      'aria-label="金额"',
      ">分类<",
      ">支付方式<",
      ">时间<",
      "更多选项",
      'data-entry-actions="sticky"',
    ].map((needle) => html.indexOf(needle));

    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });
});

describe("EntryMoreOptions", () => {
  const tags: readonly Tag[] = [
    { id: "tag-breakfast", name: "早餐", color: "#55997a" },
    { id: "tag-commute", name: "通勤", color: "#b07d2b" },
  ];

  function renderPanel(open: boolean): string {
    return renderToStaticMarkup(
      <EntryMoreOptions
        open={open}
        onToggle={() => undefined}
        note="午饭"
        onNoteChange={() => undefined}
        tags={tags}
        selectedTagIds={["tag-breakfast"]}
        onToggleTag={() => undefined}
      />,
    );
  }

  it("收起时不渲染字段，展开后备注与标签控件齐全", () => {
    const closed = renderPanel(false);
    const open = renderPanel(true);

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("已填写");
    expect(closed).not.toContain('aria-label="备注"');
    expect(closed).not.toContain("早餐");

    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/<input[^>]*aria-label="备注"/);
    expect(open).toContain("标签（最多 10 个，已选 1 个）");
    expect(open).toContain("早餐");
    expect(open).toContain("通勤");
    expect(open).toContain('id="entry-more-options"');
  });
});

describe("keyboardOffset", () => {
  it("没有软键盘时不抬起", () => {
    expect(keyboardOffset(575, 0, 640)).toBe(0);
    expect(keyboardOffset(575, 0, 575)).toBe(0);
  });

  it("把行动条抬到键盘上沿", () => {
    // 575 是滚动区底边（底部导航上沿），340 是可视区底边在布局视口里的位置。
    expect(keyboardOffset(575, 0, 340)).toBe(227);
    expect(keyboardOffset(575, 40, 340)).toBe(187);
  });

  it("永远不返回负数", () => {
    expect(keyboardOffset(300, 0, 340)).toBe(0);
  });
});
