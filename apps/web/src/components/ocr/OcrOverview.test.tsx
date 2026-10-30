import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Category, PaymentMethod, Tag } from "@libellum/shared";

import type { OcrDuplicateGroup } from "../../lib/ocr/duplicates.js";
import type { OcrImportBlocker } from "../../lib/ocr/import.js";
import { countImportableItems } from "../../lib/ocr/import.js";
import { batchCandidate } from "../../lib/ocr/testFixtures.js";
import { countBatchItems, type OcrBatchCandidate } from "../../lib/ocr/types.js";
import { OcrImportBar, OcrOverview } from "./OcrOverview.js";

/**
 * Static-render tests for the real overview, not the old demo.
 *
 * The owner's S15-B 优化 asked for a shorter top, a two-level card, and a bottom bar;
 * the tests pin what the screen **claims**: the summary numbers are the real counts,
 * a quiet record shows no warning, a questionable one shows the specific warning,
 * and nothing says it was saved before the user confirms.
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

const CLEAN: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-1",
  merchant: "老王便利店",
  amount: "20.00",
  currency: "CNY",
  direction: "expense",
  occurredLocalDate: "2026-10-09",
  occurredTime: "12:34",
  account: "零钱",
  categoryId: "c-food",
  categorySource: "user",
  paymentMethodId: "m-wechat",
  tagIds: ["t-work"],
});

const QUESTIONABLE: OcrBatchCandidate = batchCandidate({
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
});

const DUPLICATE: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-3",
  merchant: "小李烧烤",
  amount: "30.00",
  occurredTime: "18:00",
  sourcePlatform: "ALIPAY",
  categoryId: null,
  duplicateSuspected: true,
  duplicateGroupIds: ["dup-cross-1"],
});

const REVIEWED: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-4",
  merchant: "早餐店",
  amount: "8.00",
  occurredTime: "07:40",
  reviewed: true,
});

const INVALID: OcrBatchCandidate = batchCandidate({
  candidateId: "img0-5",
  merchant: "已排除的店",
  invalid: true,
});

const ITEMS: readonly OcrBatchCandidate[] = [
  CLEAN,
  QUESTIONABLE,
  DUPLICATE,
  REVIEWED,
  INVALID,
];

const DUPLICATE_GROUPS: readonly OcrDuplicateGroup[] = [
  {
    groupId: "dup-cross-1",
    kind: "cross-image",
    candidateIds: ["img0-1", "img0-3"],
    reason: "金额、币种、方向、日期、时间都相同",
    message: "这些交易可能来自截图重叠或重复上传。",
  },
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
      importableCount={overrides.importableCount ?? countImportableItems(items)}
      filter={overrides.filter ?? "all"}
      onFilterChange={overrides.onFilterChange ?? noop}
      source={overrides.source ?? "all"}
      onSourceChange={overrides.onSourceChange ?? noop}
      direction={overrides.direction ?? "all"}
      onDirectionChange={overrides.onDirectionChange ?? noop}
      filtersOpen={overrides.filtersOpen ?? false}
      onToggleFilters={overrides.onToggleFilters ?? noop}
      sources={overrides.sources ?? ["WECHAT", "ALIPAY"]}
      duplicateGroups={overrides.duplicateGroups ?? []}
      categories={CATEGORIES}
      paymentMethods={METHODS}
      tags={TAGS}
      onOpenDetail={overrides.onOpenDetail ?? noop}
      {...(overrides.warnings === undefined ? {} : { warnings: overrides.warnings })}
      {...(overrides.note === undefined ? {} : { note: overrides.note })}
    />,
  );
}

/** The rendered value of a `<dt>label</dt><dd>N</dd>` pair. */
function summaryNumber(html: string, label: string): string {
  const match = new RegExp(`${label}</dt><dd[^>]*>(\\d+)</dd>`).exec(html);
  return match?.[1] ?? "";
}

describe("OcrOverview summary", () => {
  it("shows the first line from the real counts, not a hand-written number", () => {
    const counts = countBatchItems(ITEMS);
    const importable = countImportableItems(ITEMS);
    const html = render();

    expect(counts).toMatchObject({
      total: 5,
      valid: 4,
      pending: 2,
      confirmed: 2,
      duplicates: 1,
      invalid: 1,
      reviewed: 1,
    });
    expect(importable).toBe(3);

    expect(summaryNumber(html, "本次识别")).toBe(String(counts.total));
    expect(summaryNumber(html, "待核对")).toBe(String(counts.pending));
    expect(summaryNumber(html, "疑似重复")).toBe(String(counts.duplicates));
    expect(summaryNumber(html, "可导入")).toBe(String(importable));
  });

  it("keeps the secondary figures in the expandable 详情 with their exact meaning", () => {
    const counts = countBatchItems(ITEMS);
    const html = render();

    expect(html).toContain("数量说明");
    expect(summaryNumber(html, "未标记无效")).toBe(String(counts.valid));
    expect(summaryNumber(html, "已确认")).toBe(String(counts.confirmed));
    expect(summaryNumber(html, "已标记无效")).toBe(String(counts.invalid));
    expect(html).toContain("你已核对过");
    expect(summaryNumber(html, "你已核对过")).toBe(String(counts.reviewed));
    expect(html).toContain("与自动检查的「已确认」不同");
  });

  it("does not inflate 可导入 when a candidate still has an import blocker", () => {
    // CAD is a Currency the ledger supports only in theory: every candidate that
    // cannot be translated must stay out of the importable number.
    const blocked = batchCandidate({ candidateId: "cad", currency: "CAD" });
    const html = render({ items: [CLEAN, blocked], counts: countBatchItems([CLEAN, blocked]) });

    expect(countImportableItems([CLEAN, blocked])).toBe(1);
    expect(summaryNumber(html, "可导入")).toBe("1");
    expect(summaryNumber(html, "未标记无效")).toBe("2");
  });

  it("keeps the compact filter chips carrying the same totals", () => {
    const counts = countBatchItems(ITEMS);
    const html = render();

    expect(html).toContain(`全部 ${String(counts.total)}`);
    expect(html).toContain(`待核对 ${String(counts.pending)}`);
    expect(html).toContain(`疑似重复 ${String(counts.duplicates)}`);
    expect(html).toContain(`已确认 ${String(counts.confirmed)}`);
  });
});

describe("OcrOverview filters", () => {
  it("keeps source and direction filters behind a collapsed panel", () => {
    const closed = render();
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("全部来源");
    expect(closed).not.toContain("全部收支");

    const open = render({ filtersOpen: true });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("全部来源");
    expect(open).toContain("微信");
    expect(open).toContain("支付宝");
    expect(open).toContain("全部收支");
    expect(open).toContain("支出");
    expect(open).toContain("收入");
  });

  it("shows the order platforms as sources and filters by them", () => {
    const open = render({
      sources: ["MEITUAN", "JD", "TAOBAO"],
      filtersOpen: true,
    });

    expect(open).toContain("美团");
    expect(open).toContain("京东");
    expect(open).toContain("淘宝");
    expect(render({ source: "TAOBAO" })).toContain("已筛选：来源 淘宝");
  });

  it("summarises active secondary filters when the panel is closed", () => {
    const html = render({ source: "ALIPAY", direction: "expense" });

    expect(html).toContain("筛选 · 2");
    expect(html).toContain("已筛选：来源 支付宝 · 只看支出");
    expect(html).toContain("清除");
  });

  it("explains an empty list instead of showing nothing", () => {
    const html = render({
      items: [],
      counts: countBatchItems(ITEMS),
      filter: "duplicates",
      source: "ALIPAY",
    });

    expect(html).toContain("当前筛选下没有交易。");
    // 1.17.23：不再重复列出筛选条件（上方的筛选标签与「已筛选：」一行已经显示）。
    expect(html).not.toContain("当前筛选：");
    expect(html).toContain("显示全部交易");
  });

  it("keeps the batch-level warnings visible above the list", () => {
    const html = render({ warnings: ["有 1 张截图无法判断页面类型，没有生成候选。"] });

    expect(html).toContain("无法判断页面类型");
  });
});

describe("OcrOverview cards", () => {
  it("shows a quiet record without any warning, with amount, currency and direction once", () => {
    const html = render({ items: [CLEAN], counts: countBatchItems([CLEAN]) });

    expect(html).toContain("20.00");
    expect(html).toContain("CNY");
    expect(html).toContain("支出");
    expect(html).toContain("老王便利店");
    expect(html).toContain("2026-10-09 12:34");
    expect(html).toContain("微信");
    expect(html).toContain("分类：餐饮");
    expect(html).toContain("支付方式：微信");
    expect(html).toContain("标签：工作");
    expect(html).toContain("账户：零钱");
    expect(html).toContain("已识别");
    expect(html).not.toContain("⚠");
    // 看得见的文字里金额只出现一次（按钮的读屏名称里另有一次，用来区分各张卡片）。
    const visible = html.replace(/aria-label="[^"]*"/g, "");
    expect(visible.split("20.00").length - 1).toBe(1);
    expect(html.split("查看详情").length - 1).toBe(1);
  });

  it("整张卡片是进入详情的点击区：唯一的按钮铺满卡片，读屏名称带上金额与商户", () => {
    const html = render({ items: [CLEAN], counts: countBatchItems([CLEAN]) });
    const article = /<article class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(article.split(" ")).toContain("relative");
    const buttons = html.match(/<button[^>]*data-card-open[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain("after:absolute");
    expect(buttons[0]).toContain("after:inset-0");
    expect(buttons[0]).toMatch(/aria-label="查看详情：[^"]*20\.00[^"]*老王便利店"/);
    // 卡片里没有别的可交互控件会被这层点击区盖住。
    const inside = /<article[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(inside.match(/<(button|input|select|a)\b/g)).toEqual(["<button"]);
  });

  it("labels an order platform as its Chinese source, not a raw enum", () => {
    const order = batchCandidate({ candidateId: "img0-mt", sourcePlatform: "MEITUAN" });
    const html = render({ items: [order], counts: countBatchItems([order]) });

    expect(html).toContain("美团");
    expect(html).not.toContain("来源待确认");
    expect(html).not.toContain("MEITUAN");
  });

  it("shows the specific warning only on the questionable record", () => {
    const html = render({ items: [QUESTIONABLE], counts: countBatchItems([QUESTIONABLE]) });

    expect(html).toContain("待核对");
    expect(html).toContain("没有读出金额，请填写。");
    expect(html).toContain("没有读出商户，请填写。");
    expect(html).toContain("对象/商户待确认");
    expect(html).toContain("日期待确认");
  });

  it("says a recognized-looking record still cannot be imported", () => {
    const unsupported = batchCandidate({
      candidateId: "img9-1",
      currency: "CAD",
      categoryId: null,
    });
    const html = render({ items: [unsupported], counts: countBatchItems([unsupported]) });

    expect(html).toContain("已识别");
    expect(html).toContain("还不能导入：账本不支持币种 CAD");
  });

  it("marks an inferred category as 系统建议 instead of the user's own choice", () => {
    const inferred = batchCandidate({
      candidateId: "img9-2",
      categoryId: "c-food",
      categorySource: "inferred",
    });
    const html = render({ items: [inferred], counts: countBatchItems([inferred]) });

    expect(html).toContain("分类：餐饮（系统建议）");

    const chosen = batchCandidate({
      candidateId: "img9-3",
      categoryId: "c-food",
      categorySource: "user",
    });
    expect(render({ items: [chosen], counts: countBatchItems([chosen]) })).not.toContain(
      "系统建议",
    );
  });

  it("does not render a category twice when it is inferred", () => {
    const inferred = batchCandidate({
      candidateId: "img9-4",
      categoryId: "c-food",
      categorySource: "inferred",
    });
    const html = render({ items: [inferred], counts: countBatchItems([inferred]) });

    expect(html.split("餐饮").length - 1).toBe(1);
  });

  it("shows duplicate groups without merging or deleting them", () => {
    const html = render({
      items: [DUPLICATE],
      counts: countBatchItems([DUPLICATE]),
      duplicateGroups: DUPLICATE_GROUPS,
    });

    expect(html).toContain("疑似重复");
    expect(html).toContain("可能重复：金额、币种、方向、日期、时间都相同");
    expect(html).toContain("查看详情");
  });

  it("marks invalid items as excluded instead of hiding them", () => {
    const html = render({ items: [INVALID], counts: countBatchItems([INVALID]) });

    expect(html).toContain("已排除的店");
    // 1.17.23：状态标签「无效」与整张卡片变淡已经说明，不再另写一行。
    expect(html).toContain("opacity-70");
    expect(html).not.toContain("已标记无效，确认导入时不会计入。");
  });

  it("marks the reviewed record without calling it imported", () => {
    const html = render({ items: [REVIEWED], counts: countBatchItems([REVIEWED]) });

    expect(html).toContain("已核对");
    expect(html).not.toContain("已导入");
    expect(html).not.toContain("已保存");
  });

  it("shows an empty state instead of an empty list", () => {
    expect(render({ items: [], counts: countBatchItems([]) })).toContain(
      "这次识别没有切分出任何交易",
    );
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
      onToggleFilters: counting,
      onOpenDetail: counting,
    });

    expect(calls).toBe(0);
  });
});

describe("OcrImportBar", () => {
  const noBlockers: readonly OcrImportBlocker[] = [];

  function renderBar(overrides: Partial<Parameters<typeof OcrImportBar>[0]> = {}): string {
    return renderToStaticMarkup(
      <OcrImportBar
        importableCount={overrides.importableCount ?? 3}
        blockedReason={overrides.blockedReason ?? null}
        blockers={overrides.blockers ?? noBlockers}
        busy={overrides.busy ?? false}
        onConfirm={overrides.onConfirm ?? noop}
        onCancel={overrides.onCancel ?? noop}
      />,
    );
  }

  it("offers the confirm entry with the real importable count", () => {
    const html = renderBar({ importableCount: 3 });

    expect(html).toContain("可导入");
    expect(html).toContain(">3<");
    expect(html).toContain("确认导入 3 笔");
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain("确认前不会写入账本。");
  });

  it("cannot be submitted with nothing importable", () => {
    const html = renderBar({ importableCount: 0, blockedReason: "没有可导入的笔数（可能都已标记无效）。" });

    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain("没有可导入的笔数");
  });

  it("cannot be submitted while a blocker stands, and lists the reasons", () => {
    const blockers: readonly OcrImportBlocker[] = [
      { candidateId: "a", label: "20.00 CNY · 早餐店", reason: "金额缺失" },
    ];
    const html = renderBar({
      importableCount: 2,
      blockedReason: "还有 1 笔不能导入（金额缺失），请先核对或标记无效。",
      blockers,
    });

    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toContain("还有 1 笔不能导入（金额缺失）");
    expect(html).toContain("查看 1 笔不能导入的原因");
    expect(html).toContain("20.00 CNY · 早餐店：金额缺失");
  });

  it("stays disabled while importing", () => {
    const html = renderBar({ busy: true });

    expect(html).toContain("正在导入…");
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("keeps the safe area and introduces no write path of its own", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./OcrOverview.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("pb-[env(safe-area-inset-bottom,0px)]");
    // The component may *talk* about the page's import call in comments; what must
    // not exist is an import of a write module, which is what a second write path
    // would need.
    expect(source).not.toMatch(/from "[^"]*offline\/write/);
    expect(source).not.toMatch(/from "[^"]*importExecution/);
    expect(source).not.toMatch(/from "[^"]*lib\/api/);
  });
});
