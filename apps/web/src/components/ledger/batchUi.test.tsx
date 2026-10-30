import type { Category, PaymentMethod, Tag, Transaction } from "@libellum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../i18n/index.js";
import { BatchActionBar } from "./BatchActionBar.js";
import { BatchEditSheet } from "./BatchEditSheet.js";
import { DetailTools } from "./DetailTools.js";
import { LedgerEntryRow } from "./LedgerEntryRow.js";
import { SelectionBar } from "./SelectionBar.js";
import { EMPTY_BATCH_DRAFT, batchDeleteConfirmation, batchPermission, buildBatchEdit, summarizeBatch } from "./batch.js";

/**
 * What the batch screens actually render.
 *
 * ⚠️ **Static markup, because this workspace has no DOM** — and the attributes are the point: the
 * disabled state, the `aria-pressed` that says a row is ticked, and the exact words of "全选" are
 * all claims the screen makes to the reader, and all of them can be read here.
 */

function noop(): void {
  /* Every handler in these components is optional for the test. */
}

/** The whole start tag around the first occurrence of a marker, so `disabled` can be checked on it. */
function tagWith(html: string, marker: string): string {
  const index = html.indexOf(marker);
  if (index < 0) return "";

  const start = html.lastIndexOf("<", index);
  const end = html.indexOf(">", start);

  return html.slice(start, end + 1);
}

const ENTRY: Transaction = {
  id: "e1",
  kind: "expense",
  amountCents: 1234,
  currency: "CNY",
  categoryId: "c-food",
  categoryName: "吃饭",
  categoryIsSystem: false,
  paymentMethodId: "p-cash",
  paymentMethodName: "现金",
  occurredAt: "2026-10-10T09:12:00+08:00",
  occurredLocalDate: "2026-10-10",
  occurredTz: "Asia/Shanghai",
  note: "午饭",
  tags: [],
  version: 2,
};

const CATEGORIES: readonly Category[] = [
  {
    id: "c-food",
    name: "吃饭",
    kind: "expense",
    description: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 0,
  },
];

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  { id: "p-cash", name: "现金", isArchived: false, sortOrder: 0 },
];

const TAGS: readonly Tag[] = [{ id: "t-a", name: "朋友", color: "#123456" }];

describe("DetailTools", () => {
  it("offers 刷新 / 批量操作 / 更多, and no longer 导出", () => {
    const html = renderToStaticMarkup(
      <DetailTools
        refreshing={false}
        turnKey={0}
        guest={false}
        selecting={false}
        onRefresh={noop}
        onBatch={noop}
        onMore={noop}
        onExitSelection={noop}
      />,
    );

    expect(html).toContain("刷新，重新读取并同步账目");
    expect(html).toContain("批量操作，批量修改或删除账目");
    expect(html).toContain("更多，导出账目与数据维护");

    // ⚠️ The export button moved into 更多; a top-level 导出 tool reappearing would break that.
    expect(html).not.toContain("导出，");
  });

  it("keeps a guest on 刷新 alone, the same rule the old 导出/更多 pair used", () => {
    const html = renderToStaticMarkup(
      <DetailTools
        refreshing={false}
        turnKey={0}
        guest
        selecting={false}
        onRefresh={noop}
        onBatch={noop}
        onMore={noop}
        onExitSelection={noop}
      />,
    );

    expect(html).toContain("刷新，");
    expect(html).not.toContain("批量操作");
    expect(html).not.toContain("更多，");
  });

  it("replaces the tools with 取消 while selecting", () => {
    const html = renderToStaticMarkup(
      <DetailTools
        refreshing={false}
        turnKey={0}
        guest={false}
        selecting
        onRefresh={noop}
        onBatch={noop}
        onMore={noop}
        onExitSelection={noop}
      />,
    );

    expect(html).toContain("退出批量操作");
    expect(html).not.toContain("刷新，");
    expect(html).not.toContain("批量操作，");
  });
});

describe("SelectionBar", () => {
  it("names the loaded count in the select-all control", () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        selectedCount={3}
        loadedCount={12}
        allSelected={false}
        notice={null}
        onToggleAll={noop}
      />,
    );

    expect(html).toContain("选择账目");
    expect(html).toContain("已选 3 条");
    // 按钮名「全选已加载的 N 条」已经说明范围，1.17.23 起不再另加一句。
    expect(html).toContain("全选已加载的 12 条");
    expect(html).not.toContain("不会扩大到整本账");
  });

  it("turns into 取消全选 when everything loaded is selected", () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        selectedCount={12}
        loadedCount={12}
        allSelected
        notice={null}
        onToggleAll={noop}
      />,
    );

    expect(html).toContain("取消全选");
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows the notice when a filter change cleared the ticks", () => {
    const html = renderToStaticMarkup(
      <SelectionBar
        selectedCount={0}
        loadedCount={4}
        allSelected={false}
        notice="筛选条件变了，已清空选择。"
        onToggleAll={noop}
      />,
    );

    expect(html).toContain("筛选条件变了，已清空选择。");
    expect(html).toContain("已选 0 条");
  });
});

describe("BatchActionBar", () => {
  it("disables both actions with nothing selected", () => {
    const html = renderToStaticMarkup(
      <BatchActionBar
        selectedCount={0}
        blockedReason={null}
        busy={false}
        summary={null}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(html).toContain("已选 0 条");
    expect(html).toContain("先选中至少一笔账目。");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it("enables both actions once something is selected", () => {
    const html = renderToStaticMarkup(
      <BatchActionBar
        selectedCount={2}
        blockedReason={null}
        busy={false}
        summary={null}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(html).toContain("批量编辑");
    expect(html).toContain("批量删除");
    expect(html).not.toContain('disabled=""');
  });

  it("disables the actions and states the reason when writing is not allowed", () => {
    const html = renderToStaticMarkup(
      <BatchActionBar
        selectedCount={2}
        blockedReason="你在这本账里是「仅查看」，不能修改或删除账目。"
        busy={false}
        summary={null}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(html).toContain("仅查看");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it("reports a partial failure in the bar, with its reasons", () => {
    const summary = summarizeBatch(
      [
        { id: "e1", status: "ok", pending: true },
        { id: "e2", status: "failed", reason: "分类已归档" },
      ],
      "edit",
    );

    const html = renderToStaticMarkup(
      <BatchActionBar
        selectedCount={1}
        blockedReason={null}
        busy={false}
        summary={summary}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(html).toContain('role="status"');
    /**
     * ⚠️ The successful one is still only on this device (`pending: true`), so the sentence must say
     * so — "已在本机修改" and "联网后会自动投递", never a bare "已修改" that reads as delivered.
     */
    expect(html).toContain("已在本机修改 1 笔");
    expect(html).toContain("联网后会自动投递");
    expect(html).toContain("有 1 笔失败");
    expect(html).toContain("分类已归档");
    expect(html).not.toContain("已修改 1 笔。");
  });
});

describe("BatchEditSheet", () => {
  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <BatchEditSheet
        open={false}
        count={1}
        kinds={["expense"]}
        categories={CATEGORIES}
        paymentMethods={PAYMENT_METHODS}
        tags={TAGS}
        draft={EMPTY_BATCH_DRAFT}
        blockedReason={null}
        busy={false}
        onDraftChange={noop}
        onApply={noop}
        onClose={noop}
      />,
    );

    expect(html).toBe("");
  });

  it("offers only the three safe fields", () => {
    const html = renderToStaticMarkup(
      <BatchEditSheet
        open
        count={3}
        kinds={["expense"]}
        categories={CATEGORIES}
        paymentMethods={PAYMENT_METHODS}
        tags={TAGS}
        draft={EMPTY_BATCH_DRAFT}
        blockedReason={null}
        busy={false}
        onDraftChange={noop}
        onApply={noop}
        onClose={noop}
      />,
    );

    // 面板只列出三个可勾选的字段，1.17.23 起不再用一段话复述。
    expect(html).not.toContain("只改动你勾选的字段");
    expect(html).toContain("修改分类");
    expect(html).toContain("修改标签");
    expect(html).toContain("修改支付方式");
    expect(html).toContain("已选 3 笔");
  });

  it("disables the category field instead of guessing when directions are mixed", () => {
    const html = renderToStaticMarkup(
      <BatchEditSheet
        open
        count={2}
        kinds={["expense", "income"]}
        categories={CATEGORIES}
        paymentMethods={PAYMENT_METHODS}
        tags={TAGS}
        draft={EMPTY_BATCH_DRAFT}
        blockedReason={null}
        busy={false}
        onDraftChange={noop}
        onApply={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain("收支方向不同，不能统一改分类");
    expect(tagWith(html, 'aria-label="修改分类"')).toContain('disabled=""');
  });

  it("shows the permission reason and refuses to apply", () => {
    const html = renderToStaticMarkup(
      <BatchEditSheet
        open
        count={2}
        kinds={["expense"]}
        categories={CATEGORIES}
        paymentMethods={PAYMENT_METHODS}
        tags={TAGS}
        draft={{ ...EMPTY_BATCH_DRAFT, setPaymentMethod: true, paymentMethodId: "p-cash" }}
        blockedReason="当前离线，共享账本只能查看。联网后可以批量修改或删除。"
        busy={false}
        onDraftChange={noop}
        onApply={noop}
        onClose={noop}
      />,
    );

    expect(html).toContain("当前离线，共享账本只能查看");
    expect(html).toContain("应用到 2 笔");
    expect(tagWith(html, "应用到 2 笔")).toContain('disabled=""');
  });
});

describe("LedgerEntryRow", () => {
  function row(overrides: {
    readonly selecting?: boolean;
    readonly selected?: boolean;
    readonly pending?: boolean;
    readonly conflicted?: boolean;
    readonly deleted?: boolean;
  }): string {
    return renderToStaticMarkup(
      <ul>
        <LedgerEntryRow
          entry={ENTRY}
          selecting={overrides.selecting ?? false}
          selected={overrides.selected ?? false}
          pending={overrides.pending ?? false}
          conflicted={overrides.conflicted ?? false}
          deleted={overrides.deleted ?? false}
          onActivate={noop}
        />
      </ul>,
    );
  }

  it("draws no checkbox and no toggle semantics outside batch mode", () => {
    const html = row({});

    expect(html).not.toContain("data-selected");
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain("吃饭");
    expect(html).toContain("¥");
  });

  it("draws a tick in batch mode and reports the selection", () => {
    expect(row({ selecting: true, selected: true })).toContain('data-selected="true"');
    expect(row({ selecting: true, selected: true })).toContain('aria-pressed="true"');
    expect(row({ selecting: true, selected: false })).toContain('data-selected="false"');
    expect(row({ selecting: true, selected: false })).toContain('aria-pressed="false"');
  });

  it("keeps the three marker colours", () => {
    expect(row({ pending: true })).toContain("bg-brand-soft");
    expect(row({ conflicted: true })).toContain("bg-warn-soft");
    expect(row({ deleted: true })).toContain("bg-danger-soft");
    expect(row({})).not.toContain("bg-brand-soft");
  });
});

/**
 * **S16：英文界面下这几块不残留中文。**
 *
 * 只用预置分类 / 支付方式（它们有英文显示名）和英文备注，所以页面上不应出现任何中文；
 * 一旦出现，就是某句界面文字漏了翻译。用户自建的名字本来就原样显示，不在这里测。
 */
describe("batch screens in English", () => {
  const CJK = /[㐀-鿿]/;

  afterEach(() => {
    applyLocale("zh-CN");
  });

  const PRESET_ENTRY: Transaction = {
    ...ENTRY,
    categoryId: "c-preset",
    categoryName: "餐饮",
    paymentMethodName: "现金",
    note: "lunch",
  };

  const PRESET_CATEGORIES: readonly Category[] = [
    { ...CATEGORIES[0]!, id: "c-preset", name: "餐饮" },
    { ...CATEGORIES[0]!, id: "c-archived", name: "交通", isArchived: true },
  ];

  const PRESET_METHODS: readonly PaymentMethod[] = [{ id: "p-cash", name: "现金", isArchived: false, sortOrder: 0 }];

  it("renders the tools, the selection bar and the action bar without Chinese", () => {
    applyLocale("en-US");

    const tools = renderToStaticMarkup(
      <DetailTools
        refreshing={false}
        turnKey={0}
        guest={false}
        selecting={false}
        onRefresh={noop}
        onBatch={noop}
        onMore={noop}
        onExitSelection={noop}
      />,
    );
    const exit = renderToStaticMarkup(
      <DetailTools
        refreshing={false}
        turnKey={0}
        guest={false}
        selecting
        onRefresh={noop}
        onBatch={noop}
        onMore={noop}
        onExitSelection={noop}
      />,
    );
    const selection = renderToStaticMarkup(
      <SelectionBar selectedCount={1} loadedCount={12} allSelected={false} notice={null} onToggleAll={noop} />,
    );
    const failure = buildBatchEdit(
      PRESET_ENTRY,
      { ...EMPTY_BATCH_DRAFT, setCategory: true, categoryId: "c-archived" },
      { categories: PRESET_CATEGORIES, paymentMethods: PRESET_METHODS, tags: TAGS },
    );
    const summary = summarizeBatch(
      [
        { id: "e1", status: "ok", pending: false },
        { id: "e2", status: "ok", pending: true },
        { id: "e3", status: "failed", reason: failure.kind === "blocked" ? failure.reason : "" },
      ],
      "edit",
    );
    const bar = renderToStaticMarkup(
      <BatchActionBar
        selectedCount={3}
        blockedReason={
          batchPermission({ guest: false, shared: true, sharedOfflineReadOnly: false, role: { status: "loading" } }).reason
        }
        busy={false}
        summary={summary}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    for (const html of [tools, exit, selection, bar]) expect(html).not.toMatch(CJK);

    expect(tools).toContain("Refresh: Reload and sync entries");
    expect(exit).toContain("Cancel");
    expect(selection).toContain("Select all 12 loaded entries");
    expect(selection).toContain("1 selected");
    /** 预置分类名按英文显示，句子之间有空格。 */
    expect(summary.message).toBe(
      "Changed 2 entries. 1 of them is still queued on this device and will be sent once you’re online. 1 failed: “Transport” is archived and can’t be used.",
    );
    expect(bar).toContain("Checking your access to this ledger…");
  });

  it("renders the edit sheet, the row and the delete confirmation without Chinese", () => {
    applyLocale("en-US");

    const sheet = renderToStaticMarkup(
      <BatchEditSheet
        open
        count={2}
        kinds={["expense"]}
        categories={PRESET_CATEGORIES}
        paymentMethods={PRESET_METHODS}
        tags={[]}
        draft={EMPTY_BATCH_DRAFT}
        blockedReason={null}
        busy={false}
        onDraftChange={noop}
        onApply={noop}
        onClose={noop}
      />,
    );
    const row = renderToStaticMarkup(
      <ul>
        <LedgerEntryRow
          entry={PRESET_ENTRY}
          selecting
          selected
          pending={false}
          conflicted={false}
          deleted={false}
          onActivate={noop}
        />
      </ul>,
    );
    const confirmation = batchDeleteConfirmation(3);

    expect(sheet).not.toMatch(CJK);
    expect(row).not.toMatch(CJK);
    expect(JSON.stringify(confirmation)).not.toMatch(CJK);

    expect(sheet).toContain("Apply to 2");
    expect(sheet).toContain("Food &amp; drink");
    expect(row).toContain("Food &amp; drink");
    expect(row).toContain("Cash");
    expect(row).toContain('aria-label="Selected: Food &amp; drink, ¥12.34"');
    expect(confirmation.title).toBe("Delete 3 selected entries?");
  });
});
