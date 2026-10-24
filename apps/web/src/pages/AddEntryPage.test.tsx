import {
  CURRENCIES,
  categoriesFor,
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  evaluateDuplicatePair,
  type Currency,
  type DuplicateCandidateFields,
  type DuplicatePairResult,
  type LedgerMetaResponse,
  type PaymentMethod,
  type Tag,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyLocale } from "../i18n/index.js";
import { AmountField } from "../components/entry/AmountField.js";
import { CurrencySheet } from "../components/entry/CurrencySheet.js";
import { EntryMoreOptions, moreOptionsSummary } from "../components/entry/EntryMoreOptions.js";
import { EntryQuickActions } from "../components/entry/EntryQuickActions.js";
import { inheritFromLastEntry, type InheritedFields } from "../components/entry/inheritLast.js";
import { keyboardOffset } from "../components/entry/keyboardInset.js";
import { AddEntryPage, entryMoment, manualDuplicateChoices, manualDuplicateDescription, nextEntryFields } from "./AddEntryPage.js";

/**
 * 这一页要读“当前身份的重复检测设置”，而设置 hook 依赖 AuthProvider。
 * 这里只渲染静态标记、不登录，所以给出一个固定的已登录身份即可；
 * 设置本身仍走真实的 localStorage 读取路径（没有存储时回落到默认值）。
 */
vi.mock("../auth/AuthProvider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthProvider.js")>();

  return {
    ...actual,
    useAuth: () => ({ status: "ready", user: { id: "test-user", username: "tester" } }),
  };
});

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

/** 金额框右侧的币种入口（`aria-haspopup="dialog"` 的那个按钮）整段 HTML。 */
function currencyTrigger(html: string): string {
  const anchor = html.indexOf('aria-haspopup="dialog"');

  if (anchor < 0) return "";

  return html.slice(html.lastIndexOf("<button", anchor), html.indexOf("</button>", anchor) + 9);
}

/** 含某段文字的 `<button>` 开标签（用于断言选中态 / 禁用态）。 */
function optionTag(html: string, label: string): string {
  const index = html.indexOf(label);

  if (index < 0) return "";

  const open = html.lastIndexOf("<button", index);

  return html.slice(open, html.indexOf(">", open) + 1);
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

describe("entryMoment", () => {
  const submittedAt = new Date("2026-10-20T22:40:00+08:00");
  const chosen = new Date("2026-10-19T08:15:00+08:00");

  it("未编辑时间时，保存用提交那一刻的时钟", () => {
    // The mount-time value would be stale after the screen sits in the background;
    // `now` is passed in so this rule is asserted, not the clock.
    expect(entryMoment(chosen, false, submittedAt).getTime()).toBe(submittedAt.getTime());
  });

  it("编辑过时间后，保存用读者选的那一个", () => {
    // The bug this replaces (S15-C follow-up, 2026-10-20): the field was editable
    // but the submit path ignored it and always wrote `new Date()`.
    expect(entryMoment(chosen, true, submittedAt).getTime()).toBe(chosen.getTime());
    expect(entryMoment(chosen, true, submittedAt).getTime()).not.toBe(submittedAt.getTime());
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
    // A fresh entry must not inherit "the previous entry's time was edited".
    expect(nextEntryFields(now).occurredAtTouched).toBe(false);
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
 * 以及元素在 HTML 里的先后顺序。展示型组件（`EntryMoreOptions`、`EntryQuickActions`）用受控 prop
 * 分别渲染收起与展开两种状态，等价于点击后的结果；页面本身只断言默认收起。
 */
describe("AddEntryPage 移动端布局（S15-C）", () => {
  it("金额仍是可直接输入、可修改的输入框，右侧另有独立的币种按钮", () => {
    const html = renderPage();
    const amount = /<input[^>]*aria-label="金额"[^>]*>/.exec(html)?.[0] ?? "";
    const trigger = currencyTrigger(html);

    expect(amount).not.toBe("");
    // react-dom/server 19 按 React 属性名输出，HTML 属性名本身大小写不敏感。
    expect(amount.toLowerCase()).toContain('inputmode="decimal"');
    expect(amount.toLowerCase()).not.toContain("readonly");

    // ⚠️ label 不再包裹金额行：点金额是编辑金额，点 CNY 是打开币种面板，两个点击区域独立。
    expect(html).not.toMatch(/<label[^>]*>[\s\S]*?aria-label="金额"/);
    expect(trigger).not.toBe("");
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain("CNY");
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
    // 第四轮起保存条贴住底部导航（bottom-0），不再用 bottom-5 在条外留缝。
    expect(barTag).toContain("bottom-0");
    expect(barStart).toBeGreaterThan(html.indexOf("更多选项"));
    expect(barStart).toBeLessThan(html.indexOf("</form>"));
    expect(html.slice(barStart, html.indexOf("</form>"))).toContain('type="submit"');
  });

  it("支付方式、备注与标签默认收在「更多选项」里，入口明确", () => {
    const html = renderPage();
    const toggle =
      /<button[^>]*aria-controls="entry-more-options"[^>]*>/.exec(html)?.[0] ?? "";

    expect(html).toContain("更多选项");
    expect(toggle).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="备注"');
    expect(html).not.toContain("标签（最多");
    // 支付方式不再是独立一段：收起时那一整段（含 h3）不在 DOM 里，只有摘要那一行。
    expect(html).not.toContain(">支付方式</h3>");
    // 三项都为空时，摘要用三个字段名提示"这里还有这些可选项"（全部 muted）。
    expect(html).toContain("data-entry-more-summary");
    expect(html).toContain('<span class="text-muted">支付方式</span>');
    expect(html).toContain('<span class="text-muted">备注</span>');
    expect(html).toContain('<span class="text-muted">标签</span>');
    expect(html).not.toContain("支付方式、备注、标签");
  });

  it("币种在金额框右侧，时间仍是一行可编辑输入", () => {
    const html = renderPage();

    // 币种不再是金额下方的一行、也不再是原生 select；时间保持原控件。
    expect(html).not.toMatch(/<select[^>]*aria-label="币种"/);
    expect(html).not.toContain(">币种<");
    expect(html).toMatch(/<input[^>]*type="datetime-local"/);
    expect(html).not.toMatch(/<input[^>]*type="datetime-local"[^>]*disabled/);
    // 金额卡与时间卡之间没有第三张"币种与时间"卡片：币种入口就在金额卡里。
    expect(html).toContain('data-entry-amount="card"');
    expect(currencyTrigger(html)).toContain("CNY");
  });

  it("「点按即可修改」与「不选也可以保存」两句冗余说明已删除", () => {
    const html = renderPage();

    expect(html).not.toContain("点按即可修改");
    expect(html).not.toContain("不选也可以保存");
    // 文案删掉，默认分类行为不变：分类入口仍显示「暂无分类」。
    expect(html).toContain(">暂无分类<");
  });

  it("高频字段在 DOM 里全部排在低频字段之前", () => {
    const html = renderPage();
    const order = [
      'aria-label="金额"',
      "沿用上一笔",
      ">分类<",
      ">时间<",
      "更多选项",
      'data-entry-actions="sticky"',
    ].map((needle) => html.indexOf(needle));

    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });
});

/**
 * 第二轮的四块（S15-C 第二轮）：快捷金额收起、沿用上一笔、支付方式进「更多选项」、
 * 页面顺序。仍然只有渲染断言与纯函数断言——点击本身在这里测不了，测的是点击会读到的那份结构。
 */
describe("AddEntryPage 第二轮（S15-C 第二轮）", () => {
  it("快捷金额默认收起，金额下方只有一行两个入口", () => {
    const html = renderPage();
    const quickToggle =
      /<button[^>]*aria-controls="entry-quick-amounts"[^>]*>/.exec(html)?.[0] ?? "";
    const amountCard = html.indexOf('data-entry-amount="card"');

    expect(quickToggle).toContain('aria-expanded="false"');
    expect(html).toContain("快捷金额");
    expect(html).toContain("沿用上一笔");
    // 收起 = 五个金额按钮不在 DOM 里；展开后的结构由 EntryQuickActions 的用例覆盖。
    expect(html).not.toContain('id="entry-quick-amounts"');
    // 这一行在金额卡之后、分类之前。
    expect(amountCard).toBeGreaterThan(-1);
    expect(html.indexOf("沿用上一笔")).toBeGreaterThan(amountCard);
    expect(html.indexOf("沿用上一笔")).toBeLessThan(html.indexOf(">分类<"));
  });

  it("沿用提示默认不出现，不会在首屏多出一行字", () => {
    const html = renderPage();

    expect(html).not.toContain("已沿用上一笔");
    expect(html).not.toContain("这个账本还没有可沿用的记录。");
  });
});

/**
 * 第三轮（S15-C）：币种入口 / 选择弹层、冗余说明删除、更多选项摘要、保存条与中央 + 的留白。
 * 仍然没有 DOM：点击之后的"打开、选中、关闭"用受控组件的两种渲染状态代替。
 */
describe("AddEntryPage 第三轮（S15-C 第三轮）", () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL("./AddEntryPage.tsx", import.meta.url)),
    "utf8",
  );
  const bottomNavSource = readFileSync(
    fileURLToPath(new URL("../components/BottomNav.tsx", import.meta.url)),
    "utf8",
  );

  it("币种按钮与金额输入并列在金额卡里，不在任何 label 的点击范围中", () => {
    const html = renderPage();
    const cardStart = html.indexOf('data-entry-amount="card"');
    const card = html.slice(cardStart, html.indexOf("</div>", cardStart));

    expect(cardStart).toBeGreaterThan(-1);
    expect(card).toContain('aria-label="金额"');
    expect(card).toContain('aria-haspopup="dialog"');
    expect(card).not.toContain("<label");

    // 页面结构里金额行是 div，不是把币种按钮吞进去的 label。
    expect(pageSource).not.toContain('cursor-text');
    expect(pageSource).not.toContain("点按即可修改");
    expect(pageSource).not.toContain("不选也可以保存");
    // 页面上不再有任何原生 select（币种是唯一一处）。
    expect(pageSource).not.toContain("<select");
  });

  it("金额的解析与精度规则仍是原来那两处，没有被本轮改掉", () => {
    expect(pageSource).toContain("parseAmountInput(amountText, currency)");
    expect(pageSource).toContain("decimalsFor(currency)");
    expect(pageSource).toContain("setAmountText(minorToInput(cents, currency))");
    // 币种切换只写回 currency，金额文本一个字不动。
    expect(pageSource).toMatch(/setCurrency\(next\)/);
  });

  it("内容短于一屏时保存条也停在底部：表单撑满滚动区，尾部弹性空白推开它", () => {
    const html = renderPage();

    // `TabPage` 原有的 pb-24 是第一轮给 + 预留的尾部空白；现在保存条贴住导航（bottom-0），
    // 尾部那段不再需要，所以本页用既有的 className 入口覆盖掉（未改 Layouts.tsx）。
    expect(html).toContain("min-h-full pb-0!");
    // 表单纵向撑满，多余高度由保存条前面的弹性空白吸收。
    expect(html).toContain('class="flex flex-1 flex-col"');
    expect(html).toContain('<div aria-hidden="true" class="flex-1"></div>');
  });

  it("没有靠提高 + 的层级硬修，BottomNav 的公共语义未改", () => {
    expect(bottomNavSource).toContain(
      'className="relative z-10 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"',
    );
    expect(bottomNavSource).toContain(
      'className="mx-auto -mt-8 mb-2 flex size-16 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg ring-4 ring-surface transition hover:bg-brand-dark"',
    );
    // 中央 + 仍是导航 z-10 内部的一个按钮，没有改成 fixed/z-30 之类。
    expect(bottomNavSource).not.toContain("z-30");
    expect(bottomNavSource).not.toContain("z-40");
  });
});

/**
 * 第四轮（S15-C）：金额对齐、保存栏与底部 Tab 无缝、统一 Chevron、摘要混排。
 *
 * ⚠️ **仍然没有 DOM**：这里断言的是渲染出来的结构与源码约定；"真的对齐/真的无缝"
 * 由本轮的真实渲染验收（headless Chrome 的 `getBoundingClientRect`/`elementFromPoint`）
 * 证明，两者缺一不可——结构对但层叠错，截图里才看得见。
 */
describe("AddEntryPage 第四轮（S15-C 第四轮）", () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL("./AddEntryPage.tsx", import.meta.url)),
    "utf8",
  );
  const saveBarSource = readFileSync(
    fileURLToPath(new URL("../components/entry/EntrySaveBar.tsx", import.meta.url)),
    "utf8",
  );
  const bottomNavSource = readFileSync(
    fileURLToPath(new URL("../components/BottomNav.tsx", import.meta.url)),
    "utf8",
  );
  const layoutsSource = readFileSync(
    fileURLToPath(new URL("../components/Layouts.tsx", import.meta.url)),
    "utf8",
  );
  const amountSource = readFileSync(
    fileURLToPath(new URL("../components/entry/AmountField.tsx", import.meta.url)),
    "utf8",
  );
  const moreOptionsSource = readFileSync(
    fileURLToPath(new URL("../components/entry/EntryMoreOptions.tsx", import.meta.url)),
    "utf8",
  );
  const quickActionsSource = readFileSync(
    fileURLToPath(new URL("../components/entry/EntryQuickActions.tsx", import.meta.url)),
    "utf8",
  );
  const iconsSource = readFileSync(
    fileURLToPath(new URL("../components/Icons.tsx", import.meta.url)),
    "utf8",
  );

  it("保存条贴住底部导航：条的下边缘就是导航上沿，不再用 bottom-5 留缝", () => {
    const html = renderPage();
    const barTag = /<div[^>]*data-entry-actions="sticky"[^>]*>/.exec(html)?.[0] ?? "";

    expect(barTag).toContain("sticky");
    expect(barTag).toContain("bottom-0");
    expect(barTag).not.toContain("bottom-5");
    // 条内保留 20px 不透明底垫：+ 压在这块留白上，保存按钮的下缘仍在它上面。
    expect(saveBarSource).toContain('className="border-t border-line px-6 pt-3 pb-5"');
    expect(saveBarSource).toContain("bg-canvas");
    // 软键盘抬起时贴键盘上沿，不再额外叠加 20px。
    expect(saveBarSource).toContain("keyboardInset > 0 ? { bottom: keyboardInset } : undefined");
  });

  it("+ 画在保存条之上靠层叠顺序：保存条 z-0 低于导航 z-10", () => {
    expect(saveBarSource).toContain("sticky bottom-0 z-0");
    expect(saveBarSource).not.toContain("z-20");
    expect(bottomNavSource).toContain(
      'className="relative z-10 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"',
    );
    // 没有把 + 抬到 z-30/z-40 来压过保存条。
    expect(bottomNavSource).not.toContain("z-30");
    expect(bottomNavSource).not.toContain("z-40");

    // 公共层没被改：TabPage 仍保留 pb-24，页面用既有 className 覆盖；没有保存条的定位补丁。
    expect(layoutsSource).toContain("mx-auto flex w-full max-w-md flex-col pb-24");
    expect(layoutsSource).not.toContain("data-entry-actions");
    expect(layoutsSource).not.toContain("bottom-5");
    expect(pageSource).toContain('className="min-h-full pb-0!"');
  });

  it("金额 30px 真的生效：用 important 工具类越过全局 input 16px 规则", () => {
    const html = renderPage();
    const cardTag = /<div[^>]*data-entry-amount="card"[^>]*>/.exec(html)?.[0] ?? "";
    const amountInput = /<input[^>]*aria-label="金额"[^>]*>/.exec(html)?.[0] ?? "";

    // 根因：index.css 未分层的 `input{font-size:16px}` 会胜过 @layer utilities 里的 text-3xl，
    // 金额曾经实际按 16px 渲染（比 ¥ 小、与 CNY 同大）。修复只在金额输入框这一处。
    expect(amountInput).toContain("text-3xl!");
    expect((amountInput.match(/text-3xl/g) ?? []).length).toBe(1);
    // 所有者 2026-10-21：36px 太大，金额保持 30px（`text-3xl`）；不得回退到 text-4xl。
    expect(amountInput).not.toContain("text-4xl");
    // 四种字号仍并存，但整行按中线对齐，不再用基线把小的挂在大的脚下。
    expect(cardTag).toContain("items-center");
    expect(cardTag).not.toContain("items-baseline");
    expect(amountSource).toContain('className="text-2xl text-brand-dark"');
    expect(amountSource).toContain("min-h-11");

    // 焦点态：只认金额输入框（`:has(input:focus-visible)`），ring 画在卡上且用 brand-soft；
    // 不能用 focus-within——点右侧 CNY 按钮也会亮整张卡，看起来像误触发了金额焦点。
    expect(cardTag).toContain("has-[input:focus-visible]:ring-4");
    expect(cardTag).toContain("has-[input:focus-visible]:ring-focus-ring");
    expect(cardTag).not.toContain("focus-within:ring");
    // ring 是 box-shadow，不参与布局；不允许为了焦点态改边框宽度（会跳）。
    expect(cardTag).toContain("border-2 border-brand");
  });

  it("四处展开箭头是同一个 Chevron，页面上不再有 ⌄/⌃ 字符", () => {
    const html = renderPage();

    expect(html).not.toContain("⌄");
    expect(html).not.toContain("⌃");

    const chevrons = html.match(/<svg[^>]*data-chevron="down"[^>]*>/g) ?? [];
    // 币种按钮 / 快捷金额 / 分类 / 更多选项。
    expect(chevrons.length).toBe(4);
    for (const tag of chevrons) {
      expect(tag).toContain('viewBox="0 0 24 24"');
      expect(tag).toContain('width="14"');
      expect(tag).toContain('height="14"');
      expect(tag).toContain('stroke-width="1.8"');
    }

    for (const source of [pageSource, amountSource, moreOptionsSource, quickActionsSource]) {
      expect(source).not.toContain("⌄");
      expect(source).not.toContain("⌃");
    }

    // 只有一个组件画它，且只有一条 path。
    expect(iconsSource).toContain("export function ChevronIcon");
    expect((iconsSource.match(/data-chevron=/g) ?? []).length).toBe(1);
    expect((iconsSource.match(/m6 9 6 6 6-6/g) ?? []).length).toBe(1);
  });

  it("展开/收起只有方向类不同：同一个 SVG、同一个布局盒", () => {
    function renderAmount(currencyOpen: boolean): string {
      return renderToStaticMarkup(
        <AmountField
          amountText=""
          currency="CNY"
          currencyOpen={currencyOpen}
          inputRef={{ current: null }}
          onAmountChange={() => undefined}
          onOpenCurrency={() => undefined}
        />,
      );
    }

    const closed = /<svg[^>]*data-chevron="down"[^>]*>/.exec(renderAmount(false))?.[0] ?? "";
    const open = /<svg[^>]*data-chevron="up"[^>]*>/.exec(renderAmount(true))?.[0] ?? "";

    expect(closed).not.toBe("");
    expect(open).not.toBe("");
    // 去掉方向（class 里的旋转 + data-chevron）后属性完全一样：
    // 尺寸/画布/线条都不随方向变，布局盒因此一样。
    const normalize = (tag: string): string =>
      tag.replace(/ class="[^"]*"/, "").replace(/ data-chevron="(up|down)"/, "");
    expect(normalize(open)).toBe(normalize(closed));
    expect(closed).not.toContain("-rotate-180");
    expect(open).toContain("-rotate-180");
    expect(open).toContain('width="14"');
    expect(open).toContain('height="14"');
  });
});

describe("AmountField", () => {
  function renderAmount(currency: Currency): string {
    return renderToStaticMarkup(
      <AmountField
        amountText="12.50"
        currency={currency}
        currencyOpen={false}
        inputRef={{ current: null }}
        onAmountChange={() => undefined}
        onOpenCurrency={() => undefined}
      />,
    );
  }

  it("切换币种后左侧符号与右侧代码同步", () => {
    const cny = renderAmount("CNY");

    expect(cny).toContain("¥");
    expect(cny).toContain(">CNY<");

    const usd = renderAmount("USD");

    expect(usd).toContain("$");
    expect(usd).toContain(">USD<");
    expect(usd).not.toContain(">CNY<");

    // 日元/港币这类多字符符号同样来自同一张表。
    expect(renderAmount("JPY")).toContain("JP¥");
  });

  it("金额输入框仍可编辑，币种按钮有对话框语义", () => {
    const html = renderAmount("CNY");

    expect(html).toContain('aria-label="金额"');
    expect(html.toLowerCase()).toContain('inputmode="decimal"');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-haspopup="dialog"/);
    expect(html).toContain('aria-expanded="false"');
  });
});

describe("CurrencySheet", () => {
  function renderSheet(open: boolean, currency: Currency = "CNY"): string {
    return renderToStaticMarkup(
      <CurrencySheet
        open={open}
        currency={currency}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
  }

  it("关闭时什么都不渲染；打开后列出全部币种", () => {
    expect(renderSheet(false)).toBe("");

    const html = renderSheet(true);

    expect(html).toContain("选择币种");
    expect((html.match(/role="option"/g) ?? []).length).toBe(CURRENCIES.length);
    for (const code of CURRENCIES) {
      expect(html).toContain(`>${code}<`);
    }
  });

  it("当前项是选中态，其余不是", () => {
    const html = renderSheet(true);

    expect(optionTag(html, "人民币")).toContain('aria-selected="true"');
    expect(optionTag(html, "美元")).toContain('aria-selected="false"');
  });

  it("是固定定位、带上限高度与滚动的 dialog/listbox，不会被父容器裁切", () => {
    const html = renderSheet(true);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("fixed inset-0 z-40");
    expect(html).toContain("fixed inset-x-0 bottom-0 z-50");
    expect(html).toContain("max-h-[calc(100dvh-24px)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("pb-[env(safe-area-inset-bottom,0px)]");
  });
});

/**
 * 「沿用上一笔」的纯函数。⚠️ 之所以把它做成自由函数：本仓库没有 DOM，
 * 「点一下按钮会带出什么」只能这样断言（见文件顶部与 `vitest.config.ts`）。
 */
const lunchTag: Tag = { id: "tag-lunch", name: "午饭", color: "#55997a" };

/** 当前账本的一份账本元数据：两个可用分类、一个已归档分类、一个系统分类、一个可用支付方式。 */
const ledgerFixture: LedgerMetaResponse = {
  book: { id: "book-current", name: "当前账本", bookNumber: null, memberCount: 1 },
  categories: [
    {
      id: "cat-food",
      name: "餐饮",
      kind: "expense",
      description: null,
      isSystem: false,
      isArchived: false,
      sortOrder: 0,
    },
    {
      id: "cat-salary",
      name: "工资",
      kind: "income",
      description: null,
      isSystem: false,
      isArchived: false,
      sortOrder: 1,
    },
    {
      id: "cat-archived",
      name: "搬家前的分类",
      kind: "expense",
      description: null,
      isSystem: false,
      isArchived: true,
      sortOrder: 2,
    },
    {
      id: "cat-system",
      name: "暂无分类",
      kind: "expense",
      description: null,
      isSystem: true,
      isArchived: false,
      sortOrder: 3,
    },
  ],
  paymentMethods: [
    { id: "pm-wechat", name: "微信", isArchived: false, sortOrder: 0 },
    { id: "pm-archived", name: "旧支付方式", isArchived: true, sortOrder: 1 },
  ],
  tags: [lunchTag],
};

/** 用户已经填到一半的当前草稿——沿用绝不能把它上面的字段冲掉。 */
const currentDraft: InheritedFields = {
  categoryId: "cat-current",
  paymentMethodId: "pm-current",
  currency: "CNY",
  tagIds: ["tag-current"],
};

function historyEntry({
  id,
  kind,
  categoryId,
  paymentMethodId = null,
  currency = "CNY",
  tags = [],
  note = null,
  occurredAt = "2026-10-19T12:00:00+08:00",
}: {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly categoryId: string;
  readonly paymentMethodId?: string | null;
  readonly currency?: Currency;
  readonly tags?: readonly Tag[];
  readonly note?: string | null;
  readonly occurredAt?: string;
}): Transaction {
  return {
    id,
    kind,
    amountCents: 2_500,
    currency,
    categoryId,
    categoryName: "来自历史",
    categoryIsSystem: false,
    paymentMethodId,
    paymentMethodName: null,
    occurredAt,
    occurredLocalDate: occurredAt.slice(0, 10),
    occurredTz: "Asia/Shanghai",
    note,
    tags: [...tags],
    version: 4,
  };
}

function inherited(outcome: ReturnType<typeof inheritFromLastEntry>): InheritedFields {
  if (outcome.status !== "inherited") {
    throw new Error(`expected an inherited outcome, got ${outcome.reason}`);
  }

  return outcome.fields;
}

describe("inheritFromLastEntry", () => {
  it("空账本：不修改表单，只给出原因", () => {
    // 没有记录时返回值里连 `fields` 都没有——没有可以拿的字段，就不存在「部分沿用」。
    expect(inheritFromLastEntry([], ledgerFixture, "expense", currentDraft)).toEqual({
      status: "nothing",
      reason: "no-record",
    });
  });

  it("只使用传入的这段记录，不会自己去别处找", () => {
    // 同一份账本元数据，传入空数组就是「这个账本没有记录」：数据只能来自参数。
    const outcome = inheritFromLastEntry([], ledgerFixture, "expense", currentDraft);

    expect(outcome.status).toBe("nothing");
    expect(outcome).not.toHaveProperty("fields");
  });

  it("方向不兼容的最近一笔被跳过，取更早的同方向记录", () => {
    const recent = [
      historyEntry({
        id: "entry-income",
        kind: "income",
        categoryId: "cat-salary",
        paymentMethodId: "pm-wechat",
        currency: "USD",
        tags: [lunchTag],
      }),
      historyEntry({
        id: "entry-expense",
        kind: "expense",
        categoryId: "cat-food",
        paymentMethodId: "pm-wechat",
        currency: "HKD",
      }),
    ];

    const fields = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));

    // 支出方向不能拿到收入分类，也不能拿到那笔收入的币种与标签。
    expect(fields.categoryId).toBe("cat-food");
    expect(fields.currency).toBe("HKD");
    // 那笔支出自己没有标签，所以标签这项没用收入那条的「午饭」，也没被清空。
    expect(fields.tagIds).toEqual(["tag-current"]);
    expect(fields.tagIds).not.toContain("tag-lunch");
  });

  it("整个记录里都没有同方向的一笔：不修改，说明方向不兼容", () => {
    const recent = [
      historyEntry({ id: "entry-income", kind: "income", categoryId: "cat-salary" }),
    ];

    expect(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft)).toEqual({
      status: "nothing",
      reason: "no-compatible",
    });
  });

  it("账本元数据还没到：不沿用，避免半套结果", () => {
    const recent = [historyEntry({ id: "entry-1", kind: "expense", categoryId: "cat-food" })];

    expect(inheritFromLastEntry(recent, undefined, "expense", currentDraft)).toEqual({
      status: "nothing",
      reason: "ledger-unavailable",
    });
  });

  it("已归档的分类/支付方式与已不存在的标签：逐个跳过并保持当前值", () => {
    const recent = [
      historyEntry({
        id: "entry-1",
        kind: "expense",
        categoryId: "cat-archived",
        paymentMethodId: "pm-archived",
        currency: "EUR",
        tags: [{ id: "tag-deleted", name: "已删除", color: "#a33" }],
      }),
    ];

    const fields = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));

    // 三个失效字段都保持用户自己的值，没有被替换成「其他」「暂无分类」之类。
    expect(fields.categoryId).toBe("cat-current");
    expect(fields.paymentMethodId).toBe("pm-current");
    expect(fields.tagIds).toEqual(["tag-current"]);
    // 币种永远可用，所以这一项照常沿用。
    expect(fields.currency).toBe("EUR");
  });

  it("系统分类「暂无分类」不是可选分类，同样跳过", () => {
    const recent = [
      historyEntry({ id: "entry-1", kind: "expense", categoryId: "cat-system" }),
    ];

    const fields = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));

    expect(fields.categoryId).toBe("cat-current");
  });

  it("只保留仍然存在的那个标签，不丢也不补", () => {
    const recent = [
      historyEntry({
        id: "entry-1",
        kind: "expense",
        categoryId: "cat-food",
        tags: [lunchTag, { id: "tag-deleted", name: "已删除", color: "#a33" }],
      }),
    ];

    const fields = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));

    expect(fields.tagIds).toEqual(["tag-lunch"]);
  });

  it("有效字段齐全时四个字段一起沿用", () => {
    const recent = [
      historyEntry({
        id: "entry-1",
        kind: "expense",
        categoryId: "cat-food",
        paymentMethodId: "pm-wechat",
        currency: "USD",
        tags: [lunchTag],
      }),
    ];

    expect(inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft))).toEqual(
      { categoryId: "cat-food", paymentMethodId: "pm-wechat", currency: "USD", tagIds: ["tag-lunch"] },
    );
  });

  it("不复制金额、备注、时间与 id/版本等内部字段", () => {
    const recent = [
      historyEntry({
        id: "entry-1",
        kind: "expense",
        categoryId: "cat-food",
        note: "上一笔的备注",
        occurredAt: "2026-10-18T08:00:00+08:00",
      }),
    ];

    const fields = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));

    // 返回对象只有这四个键：金额、备注、时间、id、version、seq 都没有位置可放。
    expect(Object.keys(fields).sort()).toEqual([
      "categoryId",
      "currency",
      "paymentMethodId",
      "tagIds",
    ]);
    expect(JSON.stringify(fields)).not.toContain("上一笔的备注");
    expect(JSON.stringify(fields)).not.toContain("entry-1");
  });

  it("连续点击与点一次等价：第二次沿用不再改变任何字段", () => {
    const recent = [
      historyEntry({
        id: "entry-1",
        kind: "expense",
        categoryId: "cat-food",
        paymentMethodId: "pm-wechat",
        currency: "JPY",
        tags: [lunchTag],
      }),
    ];

    const first = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", currentDraft));
    const second = inherited(inheritFromLastEntry(recent, ledgerFixture, "expense", first));

    expect(second).toEqual(first);
  });
});

/**
 * ⚠️ **账本隔离与「绝不写库」这两条只有源码能证明**：这里没有 DOM、没有网络，
 * 页面的数据来源与调用路径只能读源码来断言（与 `backNavigation.test.ts` 同一种做法）。
 */
describe("「沿用上一笔」的数据来源与写入边界（源码断言）", () => {
  const pageSource = readFileSync(
    fileURLToPath(new URL("./AddEntryPage.tsx", import.meta.url)),
    "utf8",
  );

  it("沿用读的是 useTransactions 的当前账本查询，按方向过滤", () => {
    // `useTransactions` 自带账本作用域：请求走当前账本，离线回退也只读当前账本的存储。
    expect(pageSource).toMatch(/const recentOfKind = useTransactions\(\{ kind \}\)/);
    // 自动默认值仍是原来那条不限方向的查询，两件事没有被合并。
    expect(pageSource).toContain("useTransactions({})");
  });

  it("页面不自己拼交易请求：没有 apiFetch、没有 /transactions", () => {
    expect(pageSource).not.toContain("apiFetch");
    expect(pageSource).not.toContain("/transactions");
    expect(pageSource).not.toContain("useQuery(");
  });

  it("沿用路径不写库、不建账：写入只有保存那两处", () => {
    const inheritBody = pageSource.slice(
      pageSource.indexOf("function inheritLast"),
      pageSource.indexOf("async function save"),
    );

    expect(inheritBody.length).toBeGreaterThan(0);
    expect(inheritBody).not.toContain("createLocally");
    expect(inheritBody).not.toContain("createEntry");
    // 整个页面仍然只有 save() 里的那两次本地写入（一次直写、一次失败回退）。
    expect((pageSource.match(/createLocally\(/g) ?? []).length).toBe(2);
  });

  it("快捷金额点击仍写回金额输入框", () => {
    expect(pageSource).toContain("setAmountText(minorToInput(cents, currency))");
  });
});

describe("EntryQuickActions", () => {
  const amounts = [1_000, 2_000, 10_000, 500, 100] as const;

  function renderBar(open: boolean, notice: string | null = null): string {
    return renderToStaticMarkup(
      <EntryQuickActions
        amounts={amounts}
        currency="CNY"
        open={open}
        onToggle={() => undefined}
        onPickAmount={() => undefined}
        onInherit={() => undefined}
        notice={notice}
      />,
    );
  }

  it("收起时只有两个入口，五个金额按钮不在", () => {
    const closed = renderBar(false);

    expect(closed).toContain("沿用上一笔");
    expect(closed).toContain("快捷金额");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('id="entry-quick-amounts"');
    expect(closed).not.toContain("10.00");
    expect((closed.match(/<button/g) ?? []).length).toBe(2);
  });

  it("展开后是原来那五个金额，再点收起即消失", () => {
    const open = renderBar(true);
    const amountsArea = /<div id="entry-quick-amounts"[\s\S]*?<\/div>/.exec(open)?.[0] ?? "";

    expect(open).toContain('aria-expanded="true"');
    expect((amountsArea.match(/<button/g) ?? []).length).toBe(amounts.length);
    // 标签仍是 minorToInput 的结果，取值与点击逻辑没有重写。
    for (const label of ["10.00", "20.00", "100.00", "5.00", "1.00"]) {
      expect(amountsArea).toContain(`>${label}<`);
    }

    // 收起就是同一个 `open` 的另一个值——没有内部状态，所以再点一定回到收起。
    expect(renderBar(false)).not.toContain('id="entry-quick-amounts"');
  });

  it("提示只在传进来时出现", () => {
    expect(renderBar(false)).not.toContain('role="status"');
    expect(renderBar(false, "这个账本还没有可沿用的记录。")).toContain(
      "这个账本还没有可沿用的记录。",
    );
  });
});

describe("EntryMoreOptions", () => {
  const tags: readonly Tag[] = [
    { id: "tag-breakfast", name: "早餐", color: "#55997a" },
    { id: "tag-commute", name: "通勤", color: "#b07d2b" },
  ];
  const paymentMethods: readonly PaymentMethod[] = [
    { id: "pm-wechat", name: "微信", isArchived: false, sortOrder: 0 },
    { id: "pm-cash", name: "现金", isArchived: false, sortOrder: 1 },
    // 页面在没有历史交易时默认选中的那一项（`DEFAULT_PAYMENT_METHOD_NAME`）。
    { id: "pm-other", name: "其他", isArchived: false, sortOrder: 2 },
  ];

  function renderPanel(
    open: boolean,
    {
      paymentMethodId = "pm-wechat",
      note = "午饭",
      selectedTagIds = ["tag-breakfast"],
    }: {
      readonly paymentMethodId?: string | null;
      readonly note?: string;
      readonly selectedTagIds?: readonly string[];
    } = {},
  ): string {
    return renderToStaticMarkup(
      <EntryMoreOptions
        open={open}
        onToggle={() => undefined}
        paymentMethods={paymentMethods}
        paymentMethodId={paymentMethodId}
        onPaymentMethodChange={() => undefined}
        note={note}
        onNoteChange={() => undefined}
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={() => undefined}
      />,
    );
  }

  it("收起时不渲染字段，只给一行摘要：已填值是正文色", () => {
    const closed = renderPanel(false);

    expect(closed).toContain('aria-expanded="false"');
    // 摘要是「已填值 · 未填提示」混排：三项都有值时三段都是正文色。
    expect(closed).toContain('<span class="text-ink">微信</span>');
    expect(closed).toContain('<span class="text-ink">有备注</span>');
    expect(closed).toContain('<span class="text-ink">1 个标签</span>');
    expect(closed).toContain('<span class="text-muted"> · </span>');
    expect((closed.match(/<button/g) ?? []).length).toBe(1);
    expect(closed).not.toContain('aria-label="备注"');
    expect(closed).not.toContain("早餐");
  });

  it("只填支付方式时，未填的两项以灰色字段名留在句子里", () => {
    const closed = renderPanel(false, {
      paymentMethodId: "pm-wechat",
      note: "",
      selectedTagIds: [],
    });

    expect(closed).toContain('<span class="text-ink">微信</span>');
    expect(closed).toContain('<span class="text-muted">备注</span>');
    expect(closed).toContain('<span class="text-muted">标签</span>');
    // 既不是第三轮那种只剩「微信」，也不是更早的「微信、备注、标签」。
    expect(closed).not.toContain("支付方式、备注、标签");
  });

  it("什么都没填时三个字段名都在，且都是 muted", () => {
    const closed = renderPanel(false, { paymentMethodId: null, note: "", selectedTagIds: [] });

    expect(closed).toContain('<span class="text-muted">支付方式</span>');
    expect(closed).toContain('<span class="text-muted">备注</span>');
    expect(closed).toContain('<span class="text-muted">标签</span>');
    expect(closed).not.toContain('<span class="text-ink">');
    expect(closed).not.toContain("可选");
  });

  it("默认选中的支付方式也算有效值，显示实际名称而不是字段名", () => {
    // 「其他」是页面在默认值里选中的那一项；摘要必须显示它，而不是把三项都当空。
    const byDefault = renderPanel(false, {
      paymentMethodId: "pm-other",
      note: "",
      selectedTagIds: [],
    });

    expect(byDefault).toContain('<span class="text-ink">其他</span>');
    expect(byDefault).not.toContain('<span class="text-muted">支付方式</span>');
  });

  it("摘要窄屏可收缩：min-w-0 + truncate，支付方式排在最前", () => {
    const closed = renderPanel(false);
    const summaryTag = /<span[^>]*data-entry-more-summary[^>]*>/.exec(closed)?.[0] ?? "";

    expect(summaryTag).toContain("min-w-0");
    expect(summaryTag).toContain("truncate");
    // 顺序固定：支付方式在最前，窄屏先丢的是后面的提示。
    expect(closed.indexOf(">微信<")).toBeGreaterThan(-1);
    expect(closed.indexOf(">微信<")).toBeLessThan(closed.indexOf(">有备注<"));
  });

  it("展开/收起是同一个 SVG：只有方向类不同，布局盒一样", () => {
    const closedChevron = /<svg[^>]*data-chevron="down"[^>]*>/.exec(renderPanel(false))?.[0] ?? "";
    const openChevron = /<svg[^>]*data-chevron="up"[^>]*>/.exec(renderPanel(true))?.[0] ?? "";

    expect(closedChevron).not.toBe("");
    expect(openChevron).not.toBe("");
    const normalize = (tag: string): string =>
      tag.replace(/ class="[^"]*"/, "").replace(/ data-chevron="(up|down)"/, "");
    expect(normalize(openChevron)).toBe(normalize(closedChevron));
    expect(openChevron).toContain("-rotate-180");
  });

  it("展开后支付方式、备注与标签都能编辑，上限不变", () => {
    const open = renderPanel(true);

    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('id="entry-more-options"');
    expect(open).toContain(">支付方式<");
    // 归档过滤由页面负责；传进来几个就渲染几个，选中态仍是原来的绿底。
    expect(open).toContain("微信");
    expect(open).toContain("现金");
    expect(open).toMatch(/<input[^>]*aria-label="备注"/);
    expect(open).toContain("标签（最多 10 个，已选 1 个）");
    expect(open).toContain("早餐");
    expect(open).toContain("通勤");
  });
});

describe("moreOptionsSummary", () => {
  const texts = (parts: ReturnType<typeof moreOptionsSummary>): string[] =>
    parts.map((part) => part.text);
  const filled = (parts: ReturnType<typeof moreOptionsSummary>): boolean[] =>
    parts.map((part) => part.filled);

  it("所有者给的四条规则：已填值 + 未填提示混排，顺序固定", () => {
    // 只选支付宝。
    const onlyPayment = moreOptionsSummary({
      paymentMethodName: "支付宝",
      note: "",
      tagCount: 0,
    });
    expect(texts(onlyPayment)).toEqual(["支付宝", "备注", "标签"]);
    expect(filled(onlyPayment)).toEqual([true, false, false]);

    // 支付宝 + 备注。
    const withNote = moreOptionsSummary({
      paymentMethodName: "支付宝",
      note: "午饭",
      tagCount: 0,
    });
    expect(texts(withNote)).toEqual(["支付宝", "有备注", "标签"]);
    expect(filled(withNote)).toEqual([true, true, false]);

    // 支付宝 + 2 个标签。
    const withTags = moreOptionsSummary({
      paymentMethodName: "支付宝",
      note: "",
      tagCount: 2,
    });
    expect(texts(withTags)).toEqual(["支付宝", "备注", "2 个标签"]);
    expect(filled(withTags)).toEqual([true, false, true]);

    // 三项都有。
    const all = moreOptionsSummary({ paymentMethodName: "支付宝", note: "午饭", tagCount: 2 });
    expect(texts(all)).toEqual(["支付宝", "有备注", "2 个标签"]);
    expect(filled(all)).toEqual([true, true, true]);
  });

  it("槽位顺序与 key 固定为 支付方式 → 备注 → 标签", () => {
    expect(
      moreOptionsSummary({ paymentMethodName: null, note: "", tagCount: 0 }).map(
        (part) => part.slot,
      ),
    ).toEqual(["payment", "note", "tags"]);
  });

  it("没有支付方式时用字段名占位，不是空白", () => {
    const parts = moreOptionsSummary({ paymentMethodName: null, note: "午饭", tagCount: 2 });

    expect(texts(parts)).toEqual(["支付方式", "有备注", "2 个标签"]);
    expect(filled(parts)).toEqual([false, true, true]);
  });

  it("默认支付方式「其他」按已填处理，显示实际名称", () => {
    const parts = moreOptionsSummary({ paymentMethodName: "其他", note: "", tagCount: 0 });

    expect(texts(parts)).toEqual(["其他", "备注", "标签"]);
    expect(filled(parts)).toEqual([true, false, false]);
  });

  it("空备注（含纯空白）不算填了，0 个标签显示提示", () => {
    const parts = moreOptionsSummary({ paymentMethodName: "支付宝", note: "   ", tagCount: 0 });

    expect(texts(parts)).toEqual(["支付宝", "备注", "标签"]);
    expect(filled(parts)).toEqual([true, false, false]);
  });

  it("标签用数量表达，单项标签也是「1 个标签」", () => {
    expect(texts(moreOptionsSummary({ paymentMethodName: null, note: "", tagCount: 1 }))[2]).toBe(
      "1 个标签",
    );
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

function candidateFor(id: string, overrides: Partial<DuplicateCandidateFields> = {}): DuplicateCandidateFields {
  return {
    id,
    bookId: "book-1",
    kind: "expense",
    amountCents: 2_000,
    currency: "CNY",
    occurredAt: "2026-10-21T10:03:00+08:00",
    occurredLocalDate: "2026-10-21",
    categoryId: "cat-1",
    paymentMethodId: "pm-1",
    ...overrides,
  };
}

function matchedPair(left: string, right: string): DuplicatePairResult {
  return evaluateDuplicatePair(
    candidateFor(left),
    candidateFor(right),
    DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  );
}

/** 手动记账只用 `existing.length` 计数，所以只造出这个长度需要的对象。 */
function existingEntries(count: number): Transaction[] {
  return Array.from({ length: count }, (_, index) => ({ id: `existing-${String(index)}` }) as Transaction);
}

/**
 * 提醒正文必须来自统一核心：同一组命中在手动、语音、拍照里不能各说一句。
 * 这里直接测那个纯函数，因为对话框是否弹出取决于一次异步检测（本工作区没有 DOM 测试环境）。
 */
describe("manualDuplicateDescription", () => {
  it("用统一核心的依据文案，而不是写死「日期、时间、金额都相同」", () => {
    const description = manualDuplicateDescription({
      existing: existingEntries(1),
      pairs: [matchedPair("new", "old")],
      scope: "server",
    });

    expect(description).toBe("收支方向、金额、币种、时间、分类、支付方式均相同。");
    expect(description).not.toContain("日期");
  });

  it("多笔相似记录时说清楚一共几笔", () => {
    const description = manualDuplicateDescription({
      existing: existingEntries(3),
      pairs: [matchedPair("new", "old-1")],
      scope: "server",
    });

    expect(description).toContain("共找到 3 笔相似记录");
  });

  it("只查了本机数据时明确说出来，不暗示服务器账本没有重复", () => {
    const description = manualDuplicateDescription({
      existing: existingEntries(1),
      pairs: [matchedPair("new", "old")],
      scope: "local",
    });

    expect(description).toContain("本次只比对了本机已知数据");
  });

  it("提供「确认不是同一笔」这个选项，但不提供「删掉旧的」", () => {
    // S16：选项做成函数（文案在调用时按当前语言取），默认语言下仍是这三句中文。
    expect(manualDuplicateChoices().map((choice) => choice.label)).toEqual([
      "仍然保存",
      "确认不是同一笔",
      "取消，我再看看",
    ]);
  });
});

/**
 * **S16：英文界面下记账表单不残留中文。**
 *
 * 只检查本页自己的 `<form>`：外层的 `TabPage`（底栏等）由别的模块负责翻译，不在这里断言。
 * 表单里没有任何用户数据（测试里账本没有加载），所以出现中文就是漏翻。
 */
describe("AddEntryPage in English", () => {
  const CJK = /[㐀-鿿]/;

  afterEach(() => {
    applyLocale("zh-CN");
  });

  it("renders the entry form without Chinese", () => {
    applyLocale("en-US");
    const html = renderPage();
    const form = html.slice(html.indexOf("<form"), html.indexOf("</form>") + 7);

    expect(form.length).toBeGreaterThan(100);
    expect(form).not.toMatch(CJK);
    expect(form).toContain("Expense");
    expect(form).toContain('aria-label="Amount"');
    expect(form).toContain("Uncategorized");
    expect(form).toContain("Same as last");
    expect(form).toContain("Quick amounts");
    expect(form).toContain("More options");
    expect(form).toContain(">Save<");
  });

  it("translates the summary, the choices and the duplicate note, but never a custom name", () => {
    applyLocale("en-US");

    expect(
      moreOptionsSummary({ paymentMethodName: "微信", note: "x", tagCount: 2 }).map((part) => part.text),
    ).toEqual(["WeChat Pay", "Note added", "2 tags"]);
    /** 自建的支付方式名是用户数据，英文界面也原样显示。 */
    expect(moreOptionsSummary({ paymentMethodName: "招行信用卡", note: "", tagCount: 0 })[0]?.text).toBe("招行信用卡");
    expect(manualDuplicateChoices().map((choice) => choice.label)).toEqual([
      "Save anyway",
      "Not a duplicate",
      "Cancel, let me check",
    ]);
    expect(
      manualDuplicateDescription({ existing: existingEntries(3), pairs: [], scope: "local" }),
    ).toBe(
      "The amount, type and time match an existing entry. Found 3 similar entries. Only data on this device was checked this time.",
    );
  });
});
