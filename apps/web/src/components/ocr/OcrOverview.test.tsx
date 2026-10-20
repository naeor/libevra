import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag } from "@libellum/shared";

import type { OcrDuplicateGroup } from "../../lib/ocr/duplicates.js";
import { batchCandidate } from "../../lib/ocr/testFixtures.js";
import { countBatchItems, type OcrBatchCandidate } from "../../lib/ocr/types.js";
import { OcrOverview } from "./OcrOverview.js";

/**
 * Static-render tests for the real overview, not the old demo.
 *
 * The component is presentational: state, data and callbacks come from the page.
 * What is worth checking is what the screen claims: the summary matches the
 * list, missing fields say 待确认, invalid items are visible but marked, and
 * nothing says it was saved before the user confirms.
 */

const CATEGORIES: readonly Category[] = [
  {
    id: "c-food",
    name: "餐饮",
    kind: "expense",
    description: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 1,
  },
  {
    id: "c-transfer",
    name: "转账",
    kind: "expense",
    description: null,
    isSystem: false,
    isArchived: false,
    sortOrder: 2,
  },
];

const METHODS: readonly PaymentMethod[] = [
  { id: "m-wechat", name: "微信", isArchived: false, sortOrder: 1 },
  { id: "m-card", name: "银行卡", isArchived: false, sortOrder: 2 },
];

const TAGS: readonly Tag[] = [{ id: "t-work", name: "工作", color: "#888888" }];

const ITEMS: readonly OcrBatchCandidate[] = [
  batchCandidate({
    candidateId: "img0-1",
    merchant: "老王便利店",
    categoryId: "c-food",
    paymentMethodId: "m-wechat",
    tagIds: ["t-work"],
  }),
  batchCandidate({
    candidateId: "img0-2",
    merchant: null,
    amount: null,
    currency: null,
    occurredLocalDate: null,
    occurredTime: null,
    issues: [
      { code: "missing_amount", message: "没有读出金额，请填写。", field: "amount" },
      { code: "missing_merchant", message: "没有读出商户，请填写。", field: "merchant" },
    ],
  }),
  batchCandidate({ candidateId: "img0-3", invalid: true, merchant: "已排除的店" }),
];

type Props = Parameters<typeof OcrOverview>[0];

const noop = (): void => undefined;

function render(overrides: Partial<Props> = {}): string {
  const items = overrides.items ?? ITEMS;
  const counts = overrides.counts ?? countBatchItems(ITEMS);

  return renderToStaticMarkup(
    <OcrOverview
      items={items}
      counts={counts}
      filter={overrides.filter ?? "all"}
      onFilterChange={overrides.onFilterChange ?? noop}
      source={overrides.source ?? "all"}
      onSourceChange={overrides.onSourceChange ?? noop}
      direction={overrides.direction ?? "all"}
      onDirectionChange={overrides.onDirectionChange ?? noop}
      sources={overrides.sources ?? ["WECHAT"]}
      duplicateGroups={overrides.duplicateGroups ?? []}
      categories={CATEGORIES}
      paymentMethods={METHODS}
      tags={TAGS}
      onOpenDetail={overrides.onOpenDetail ?? noop}
      {...(overrides.note === undefined ? {} : { note: overrides.note })}
    />,
  );
}

function around(html: string, label: string, length = 240): string {
  const index = html.indexOf(label);
  return index === -1 ? "" : html.slice(index, index + length);
}

describe("OcrOverview", () => {
  it("shows the batch summary matching the list", () => {
    const counts = countBatchItems(ITEMS);
    const html = render();

    expect(around(html, "本次识别")).toContain(`>${String(counts.total)}<`);
    expect(around(html, "待核对")).toContain(`>${String(counts.pending)}<`);
    expect(around(html, "可直接导入")).toContain(`>${String(counts.confirmed)}<`);
    expect(around(html, "已标记无效")).toContain(`>${String(counts.invalid)}<`);
    expect(around(html, "可导入")).toContain(`>${String(counts.valid)}<`);
  });

  it("renders one card per transaction with amount, merchant and status", () => {
    const html = render();

    expect(html.split("查看详情").length - 1).toBe(3);
    expect(html).toContain("老王便利店");
    expect(html).toContain("20.00");
    expect(html).toContain("已识别");
    expect(html).toContain("待核对");
    expect(html).toContain("无效");
  });

  it("says 待确认 for fields the screenshot did not carry", () => {
    const html = render();

    expect(html).toContain("待确认");
    expect(html).toContain("日期待确认");
    expect(html).toContain("对象/商户待确认");
  });

  it("shows the category, payment method and tags the user chose", () => {
    const html = render();

    expect(html).toContain("分类：餐饮");
    expect(html).toContain("支付方式：微信");
    expect(html).toContain("标签：工作");
    // An unmapped candidate says so instead of inventing a category.
    expect(html).toContain("分类：未分类");
    expect(html).toContain("支付方式待确认");
  });

  it("renders the issue messages rather than a bare warning icon", () => {
    const html = render();

    expect(html).toContain("没有读出金额");
    expect(html).toContain("没有读出商户");
  });

  it("shows duplicate groups without merging or deleting them", () => {
    const duplicateGroups: readonly OcrDuplicateGroup[] = [
      {
        groupId: "dup-cross-1",
        kind: "cross-image",
        candidateIds: ["img0-1", "img0-3"],
        reason: "金额、币种、方向、日期、时间都相同",
        message: "这些交易可能来自截图重叠或重复上传。",
      },
    ];
    const html = render({ duplicateGroups });

    expect(html).toContain("可能重复");
    expect(html).toContain("金额、币种、方向、日期、时间都相同");
    expect(html.split("查看详情").length - 1).toBe(3);
  });

  it("marks invalid items as excluded instead of hiding them", () => {
    const html = render();

    expect(html).toContain("已排除的店");
    expect(html).toContain("已标记无效，确认导入时不会计入。");
  });

  it("marks the active filter for assistive technology", () => {
    expect(render()).toContain('aria-pressed="true"');
    expect(render({ filter: "pending" })).toContain("待核对 1");
    expect(render({ source: "WECHAT" })).toContain("微信");
    expect(render({ direction: "expense" })).toContain("支出");
  });

  it("does not claim anything was saved before confirmation", () => {
    const html = render({ note: "批次只保存在当前标签页；确认前不会写入账本。" });

    expect(html).toContain("确认前不会写入账本");
    expect(html).not.toContain("已保存");
    expect(html).not.toContain("保存成功");
  });

  it("shows an empty state instead of an empty list", () => {
    expect(render({ items: [], counts: countBatchItems([]) })).toContain(
      "这次识别没有切分出任何交易",
    );
    expect(render({ items: [], counts: countBatchItems(ITEMS) })).toContain("当前筛选下没有交易");
  });

  it("does not call any callback just by rendering", () => {
    let calls = 0;
    const counting = (): void => {
      calls += 1;
    };

    render({
      onFilterChange: counting,
      onSourceChange: counting,
      onDirectionChange: counting,
      onOpenDetail: counting,
    });

    expect(calls).toBe(0);
  });
});
