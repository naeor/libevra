import {
  CURRENCIES,
  categoriesFor,
  type Currency,
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
import { describe, expect, it } from "vitest";

import { EntryMoreOptions, moreOptionsSummary } from "../components/entry/EntryMoreOptions.js";
import { EntryQuickActions } from "../components/entry/EntryQuickActions.js";
import { inheritFromLastEntry, type InheritedFields } from "../components/entry/inheritLast.js";
import { keyboardOffset } from "../components/entry/keyboardInset.js";
import { AddEntryPage, entryMoment, nextEntryFields } from "./AddEntryPage.js";

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

  it("支付方式、备注与标签默认收在「更多选项」里，入口明确", () => {
    const html = renderPage();
    const toggle =
      /<button[^>]*aria-controls="entry-more-options"[^>]*>/.exec(html)?.[0] ?? "";

    expect(html).toContain("更多选项");
    expect(toggle).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="备注"');
    expect(html).not.toContain("标签（最多");
    // 支付方式不再是独立一段：收起时整段不在 DOM 里，只有摘要那一行。
    expect(html).not.toContain(">支付方式<");
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
    const amountEnd = html.indexOf('</label>');

    expect(quickToggle).toContain('aria-expanded="false"');
    expect(html).toContain("快捷金额");
    expect(html).toContain("沿用上一笔");
    // 收起 = 五个金额按钮不在 DOM 里；展开后的结构由 EntryQuickActions 的用例覆盖。
    expect(html).not.toContain('id="entry-quick-amounts"');
    // 这一行在金额输入框之后、分类之前。
    expect(html.indexOf("沿用上一笔")).toBeGreaterThan(amountEnd);
    expect(html.indexOf("沿用上一笔")).toBeLessThan(html.indexOf(">分类<"));
  });

  it("沿用提示默认不出现，不会在首屏多出一行字", () => {
    const html = renderPage();

    expect(html).not.toContain("已沿用上一笔");
    expect(html).not.toContain("这个账本还没有可沿用的记录。");
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

  it("收起时不渲染字段，只给一行摘要", () => {
    const closed = renderPanel(false);

    expect(closed).toContain('aria-expanded="false"');
    // 摘要是「实际选中的支付方式 · 有备注 · 有标签」。
    expect(closed).toContain("微信 · 备注 · 标签");
    expect((closed.match(/<button/g) ?? []).length).toBe(1);
    expect(closed).not.toContain('aria-label="备注"');
    expect(closed).not.toContain("早餐");
    expect(closed).not.toContain(">支付方式<");
  });

  it("什么都没填时摘要给一句兜底", () => {
    expect(
      renderPanel(false, { paymentMethodId: null, note: "", selectedTagIds: [] }),
    ).toContain("可选");
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
  it("按 支付方式 → 备注 → 标签 的顺序拼摘要", () => {
    expect(
      moreOptionsSummary({ paymentMethodName: "微信", note: "午饭", tagCount: 2 }),
    ).toBe("微信 · 备注 · 标签");
    expect(moreOptionsSummary({ paymentMethodName: "微信", note: "", tagCount: 0 })).toBe("微信");
    expect(moreOptionsSummary({ paymentMethodName: null, note: "午饭", tagCount: 1 })).toBe(
      "备注 · 标签",
    );
    expect(moreOptionsSummary({ paymentMethodName: null, note: "   ", tagCount: 0 })).toBe("可选");
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
