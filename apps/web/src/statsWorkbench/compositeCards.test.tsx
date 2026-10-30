/**
 * 组合卡片渲染（1.17.10）：多个槽位用**真实**的既有计算渲染、共享同一作用域；放不下的内容如实说明。
 * 金额的正确性由 A/B/C 引擎测试负责，这里核对「组合以后数字与单项卡片完全一致」。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { Transaction } from "@libellum/shared";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { applyLocale } from "../i18n/index.js";
import { CardBody, cardTitle } from "./cards.js";
import { CardEditor } from "./CardEditor.js";
import { CompositeBody, CompositeDetail } from "./CompositeCard.js";
import { buildCard } from "./customCards.js";
import type { CompositionSlot, TemplateId } from "./composition.js";
import { newCard } from "./defaults.js";
import { buildFxView, tx } from "./fxTestSupport.js";
import type { WorkbenchScope } from "./scope.js";

const RANGE = { from: "2026-10-01", to: "2026-10-27" } as const;

function entry(id: string, date: string, kind: "expense" | "income", amountCents: number, categoryId: string, categoryName: string, currency: Transaction["currency"] = "CNY"): Transaction {
  return tx(id, { occurredLocalDate: date, occurredAt: `${date}T04:00:00.000Z`, kind, amountCents, categoryId, categoryName, currency });
}

const ENTRIES: readonly Transaction[] = [
  entry("t01", "2026-10-02", "expense", 10000, "c-food", "餐饮"),
  entry("t02", "2026-10-03", "expense", 5000, "c-transport", "交通"),
  entry("t03", "2026-10-04", "expense", 8000, "c-food", "餐饮"),
  entry("t04", "2026-10-05", "income", 500000, "c-salary", "工资"),
  entry("t05", "2026-10-10", "expense", 12000, "c-food", "餐饮"),
  entry("t06", "2026-10-12", "expense", 6000, "c-transport", "交通"),
  entry("t07", "2026-10-15", "expense", 30000, "c-shopping", "购物"),
  entry("t08", "2026-10-18", "income", 20000, "c-freelance", "兼职"),
  entry("t09", "2026-10-20", "expense", 9000, "c-food", "餐饮"),
  entry("t10", "2026-10-25", "expense", 3000, "c-transport", "交通"),
];

function scope(entries: readonly Transaction[], over: Partial<WorkbenchScope> = {}): WorkbenchScope {
  return {
    today: "2026-10-27",
    filters: { time: { kind: "custom", from: RANGE.from, to: RANGE.to }, currency: null, combined: false },
    range: RANGE,
    bucket: "day",
    combined: false,
    fxAvailable: true,
    currency: "CNY",
    defaultCurrency: "CNY",
    entries,
    loaded: true,
    fx: null,
    coverageGap: null,
    repairing: false,
    accountScope: "user:fixture",
    rangeReadState: "complete",
    rangeSourceComplete: true,
    ...over,
  };
}

const s = (id: string, analysisId: string, family: string): CompositionSlot => ({ id, analysisId, family: family as CompositionSlot["family"] });

function composite(template: TemplateId, slots: readonly CompositionSlot[], over: Partial<AnalysisCardNode> = {}): AnalysisCardNode {
  const card = buildCard({ template, slots, name: "" }, undefined, `card-${template}`);
  if (card === null) throw new Error(`invalid draft ${template}`);
  return { ...card, ...over };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function wrap(node: React.ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  applyLocale("zh-CN");
});

describe("组合卡片：多个内容、一张卡片", () => {
  it("用例 B：双数字卡片里的两个数字与各自的单项卡片完全一致", () => {
    const view = scope(ENTRIES);
    const card = composite("T1", [s("s1", "AN-B02", "number"), s("s2", "AN-B01", "number")]);
    const html = text(wrap(<CompositeBody card={card} scope={view} width={137} height={62} />));
    const income = text(renderToStaticMarkup(<CardBody card={newCard("AN-B02")} scope={view} density="compact" />));
    const expense = text(renderToStaticMarkup(<CardBody card={newCard("AN-B01")} scope={view} density="compact" />));
    expect(income).toContain("¥5,200.00");
    expect(expense).toContain("¥830.00");
    expect(html).toContain("总收入");
    expect(html).toContain("¥5,200.00");
    expect(html).toContain("总支出");
    expect(html).toContain("¥830.00");
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(cardTitle(card, ((key: string, options?: Record<string, unknown>) => key + JSON.stringify(options ?? {})) as never)).toContain("AN-B02");
  });

  it("用例 C：四数字在 2×1 内全部显示，不出现「另有」", () => {
    const card = composite("T2", [s("s1", "AN-B02", "number"), s("s2", "AN-B01", "number"), s("s3", "AN-B03", "number"), s("s4", "AN-B06", "number")]);
    const html = text(wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={314} height={62} />));
    for (const label of ["总收入", "总支出", "收支差额", "日均支出"]) expect(html).toContain(label);
    expect(html).toContain("¥4,370.00");
    expect(html).not.toContain("另有");
  });

  it("用例 D：每日支出趋势（折线）+ 总支出 + 日均支出，三项都用真实结果渲染", () => {
    const card = composite("T3", [s("s1", "AN-I06", "line"), s("s2", "AN-B01", "number"), s("s3", "AN-B06", "number")]);
    for (const [width, height] of [[314, 190], [137, 190]] as const) {
      const html = wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={width} height={height} />);
      const plain = text(html);
      expect(plain).toContain("每日支出趋势");
      expect(plain).toContain("¥830.00");
      expect(plain).toContain("日均支出");
      expect(html).toContain("<svg");
      expect(plain).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it("用例 E：双图表（趋势 + 分类构成），两张图都有绘图区", () => {
    const card = composite("T5", [s("s1", "AN-I06", "bar"), s("s2", "AN-I01", "ranking")]);
    const html = wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={314} height={190} />);
    const plain = text(html);
    expect(plain).toContain("每日支出趋势");
    expect(plain).toContain("支出分类");
    expect(plain).toContain("餐饮");
    expect(html).toContain("<svg");
  });

  it("同一趋势同时以折线和表格出现；表格逐行列出桶金额", () => {
    const card = composite("T5", [s("s1", "AN-I06", "line"), s("s2", "AN-I06", "table")]);
    const plain = text(wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={314} height={310} />));
    // 表格最新的桶在上：10-25 的 ¥30.00 在卡片里可见，其余行写明「其余 N 项」，详情页全部列出。
    expect(plain).toContain("¥30.00");
    expect(plain).toMatch(/另有 \d+ 项，点开查看全部/);
    const detail = text(wrap(<CompositeDetail card={card} scope={scope(ENTRIES)} />));
    expect(detail).toContain("¥90.00");
    expect(detail).toContain("¥300.00");
  });

  it("放不下的内容不硬塞：显示「另有 N 项」，详情页完整列出", () => {
    const six = [s("s1", "AN-B02", "number"), s("s2", "AN-B01", "number"), s("s3", "AN-B03", "number"), s("s4", "AN-B06", "number"), s("s5", "AN-B04", "number"), s("s6", "AN-B05", "number")];
    const card = composite("T7", six);
    // 2×1 只放得下 4 个：留出「另有」一行会少放，所以改成右下角「+2」角标（读屏名称是完整说明）。
    const tightHtml = wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={314} height={62} />);
    expect(tightHtml).toContain('aria-label="另有 2 项 · 点开查看"');
    expect(text(tightHtml)).toContain("+2");
    // 留出一行仍能放下同样多的项时，照常写一行「另有 N 项」。
    const roomy = text(wrap(<CompositeBody card={card} scope={scope(ENTRIES)} width={314} height={80} />));
    expect(roomy).toMatch(/另有 \d 项/);
    const detail = text(wrap(<CompositeDetail card={card} scope={scope(ENTRIES)} />));
    for (const label of ["总收入", "总支出", "收支差额", "日均支出", "支出笔数", "收入笔数"]) expect(detail).toContain(label);
  });

  it("用例 H：空账本、筛选后无结果——每个槽位如实说明，不画 0 趋势", () => {
    const card = composite("T3", [s("s1", "AN-I06", "line"), s("s2", "AN-B01", "number"), s("s3", "AN-B07", "number")]);
    const html = wrap(<CompositeBody card={card} scope={scope([])} width={314} height={190} />);
    const plain = text(html);
    // 数字格的说明收成提示标记，完整文字在标记的读屏名称里；趋势格不画一条 0 线。
    expect(html).toContain('aria-label="这段时间没有记录"');
    expect(html).not.toContain("<svg");
    expect(plain).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("用例 H：综合折算缺汇率时，组合卡片里的合计只给小计并提示，不把缺汇率当 0", () => {
    const mixed = [...ENTRIES, entry("u1", "2026-10-11", "expense", 10000, "c-food", "餐饮", "USD")];
    const fx = buildFxView({ entries: mixed, missingDates: ["2026-10-11"] });
    const view = scope(mixed, { combined: true, fx, filters: { time: { kind: "custom", from: RANGE.from, to: RANGE.to }, currency: null, combined: true } });
    const card = composite("T1", [s("s1", "AN-B01", "number"), s("s2", "AN-B04", "number")]);
    const html = wrap(<CompositeBody card={card} scope={view} width={137} height={62} />);
    const plain = text(html);
    expect(plain).toContain("¥830.00");
    expect(html).toContain("sw-stat-mark-warn");
    expect(plain).toContain("9 笔");
  });

  it("单项卡片选了别名展示（总支出 → 柱状）时用每日支出趋势画，合计不变", () => {
    const card: AnalysisCardNode = { ...newCard("AN-B01"), chart: { chartFamily: "bar" } };
    const html = renderToStaticMarkup(<CardBody card={card} scope={scope(ENTRIES)} density="expanded" height={200} />);
    expect(text(html)).toContain("¥830.00");
    expect(html).toContain("<svg");
  });
});

describe("编辑器静态渲染", () => {
  it("新建：显示空状态、五个目录分类与可选指标，默认在「数字指标」", () => {
    const html = text(wrap(<CardEditor today="2026-10-27" scope={scope(ENTRIES)} metrics={null} onSave={() => true} onClose={() => undefined} />));
    expect(html).toContain("新建自定义卡片");
    for (const section of ["数字指标", "趋势与时间", "构成与排行", "分布与关系", "其他专业分析"]) expect(html).toContain(section);
    expect(html).toContain("总支出");
    expect(html).toContain("还没有选择指标");
  });

  it("精简：默认不显示长说明、指标总数、技术上限与每项的展示方式清单（按需在说明里看）", () => {
    const html = text(wrap(<CardEditor today="2026-10-27" scope={scope(ENTRIES)} metrics={null} onSave={() => true} onClose={() => undefined} />));
    for (const removed of ["系统会推荐合适的卡片模板与尺寸", "最多 6 个数字", "从下方目录点", "共 81 项指标", "可展示为", "所选时间内的支出合计", "请先从目录里选择", "结果是一个数值的统计"]) {
      expect(html, removed).not.toContain(removed);
    }
    // 每项都有「说明」按钮，定义与展示方式在那里按需展开。
    const raw = wrap(<CardEditor today="2026-10-27" scope={scope(ENTRIES)} metrics={null} onSave={() => true} onClose={() => undefined} />);
    expect(raw).toContain("「总支出」的说明");
    expect(raw).toContain("搜索指标");
  });

  it("编辑组合卡片：已选内容、推荐模板与预览都在同一面板", () => {
    const card = composite("T3", [s("s1", "AN-I06", "line"), s("s2", "AN-B01", "number"), s("s3", "AN-B06", "number")]);
    const metrics = { columnWidth: 165, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };
    const html = text(wrap(<CardEditor card={card} currentSize={{ colSpan: 1, rowSpan: 2 }} today="2026-10-27" scope={scope(ENTRIES)} metrics={metrics} onSave={() => true} onClose={() => undefined} />));
    expect(html).toContain("已选内容");
    expect(html).toContain("每日支出趋势");
    expect(html).toContain("图表 + 双数字");
    expect(html).toContain("推荐");
    expect(html).toContain("预览");
    expect(html).toContain("1×2");
  });
});
