import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { CARD_TYPES, cardType, resolveDisplay } from "./catalog.js";
import {
  bodyBox,
  CARD_TEMPLATES,
  cardSizing,
  checkSizes,
  compatibleTemplates,
  countSlots,
  hasComposition,
  isCustomCard,
  isMultiSlot,
  layoutComposition,
  readComposition,
  recommendSize,
  recommendTemplate,
  singlePresentation,
  slotCard,
  slotSpecs,
  templateFit,
  withComposition,
  type CompositionSlot,
  type GridMetrics,
} from "./composition.js";
import { buildCard, customCardsIn, draftProblem } from "./customCards.js";
import { legacyDefaultWorkbench, newCard } from "./defaults.js";
import { command, geometryOf, reconfigureCard, sessionDocuments, startSession } from "./session.js";
import { loadWorkbench, saveWorkbench } from "./storage.js";

/** 390 px 手机：内容宽 342、两列、行高 116、卡片外框 28 / 54。 */
const PHONE: GridMetrics = { columnWidth: 165, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };
/** 320 px 窄屏手机：内容宽 272。 */
const NARROW: GridMetrics = { columnWidth: 130, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };
/** 桌面（≥ 640 px）：三列，每列约 300 px。 */
const DESKTOP: GridMetrics = { columnWidth: 300, rowHeight: 116, gap: 12, columns: 3, chromeWidth: 32, chromeHeight: 58 };

const slot = (id: string, analysisId: string, family: string): CompositionSlot => ({ id, analysisId, family: family as CompositionSlot["family"] });

const INCOME = slot("s1", "AN-B02", "number");
const EXPENSE = slot("s2", "AN-B01", "number");
const NET = slot("s3", "AN-B03", "number");
const DAILY_AVG = slot("s4", "AN-B06", "number");
const DAILY_LINE = slot("s5", "AN-I06", "line");
const DONUT = slot("s6", "AN-I01", "donut");

describe("组合卡片：旧配置映射与安全降级", () => {
  it("旧单指标卡片读成单槽位，不需要迁移脚本，尺寸沿用目录", () => {
    const legacy = newCard("AN-I01", "legacy");
    const read = readComposition(legacy);
    expect(read).toEqual({ source: "plain", template: "single", slots: [{ id: "s1", analysisId: "AN-I01", family: "donut" }], adjusted: false });
    expect(hasComposition(legacy)).toBe(false);
    expect(isMultiSlot(legacy)).toBe(false);
    const type = cardType("AN-I01")!;
    expect(cardSizing(legacy)).toEqual({ defaultSize: type.defaultSize, minSize: type.minSize, sizes: type.sizes });
  });

  it("旧版自定义标题卡片仍列在「我的自定义」，目录卡片不列", () => {
    const custom: AnalysisCardNode = { ...newCard("AN-B01", "old-custom"), title: { kind: "custom", text: "开销" } };
    expect(customCardsIn([custom, newCard("AN-B02", "plain")])).toEqual([custom]);
    expect(isCustomCard(custom)).toBe(true);
  });

  it("组合配置镜像主槽位：旧版本读到的是第一项的单指标卡片", () => {
    const card = withComposition(newCard("AN-B02", "pair"), "T1", [INCOME, EXPENSE]);
    expect(card.analysis.analysisId).toBe("AN-B02");
    expect(card.chart.chartFamily).toBe("number");
    expect(readComposition(card)).toMatchObject({ source: "composite", template: "T1", slots: [INCOME, EXPENSE], adjusted: false });
    expect(JSON.stringify(card)).not.toMatch(/amount|bookId|ledgerId|transaction|rate/i);
  });

  it("旧版本改过主分析（与第一个槽位不一致）时，以卡片本身为准", () => {
    const card = withComposition(newCard("AN-B02", "pair"), "T1", [INCOME, EXPENSE]);
    const edited: AnalysisCardNode = { ...card, analysis: { analysisId: "AN-B05", params: {} }, chart: { ...card.chart, chartFamily: "number" } };
    const read = readComposition(edited);
    expect(read.slots[0]).toEqual({ id: "s1", analysisId: "AN-B05", family: "number" });
    expect(read.adjusted).toBe(true);
  });

  it("来自更新版本的组合只显示主槽位、标记只读；损坏结构退回主槽位，不抛错", () => {
    const base = newCard("AN-B01", "x");
    const future: AnalysisCardNode = { ...base, chart: { chartFamily: "number", options: { composition: { v: 2, template: "T9", slots: [], extra: true } } } };
    expect(readComposition(future)).toMatchObject({ source: "future", slots: [{ analysisId: "AN-B01" }] });
    for (const broken of [
      "nope",
      { v: 1, template: "T1", slots: "x" },
      { v: 1, template: "T1", slots: [] },
      { v: 1, template: "T1", slots: [{ id: "s1", analysisId: "AN-B01" }] },
      { v: 1, template: "T1", slots: [{ id: "s1", analysisId: "AN-B01", family: "number" }, { id: "s1", analysisId: "AN-B02", family: "number" }] },
      { v: 1, template: "T1", slots: Array.from({ length: 9 }, (_, index) => ({ id: `s${String(index)}`, analysisId: "AN-B01", family: "number" })) },
    ]) {
      const card: AnalysisCardNode = { ...base, chart: { chartFamily: "number", options: { composition: broken } } };
      expect(readComposition(card)).toMatchObject({ source: "invalid", template: "single", slots: [{ analysisId: "AN-B01" }] });
    }
  });

  it("不兼容的展示形式退回该分析允许的第一种；模板与内容不符时按推荐模板读", () => {
    const card = withComposition(newCard("AN-B02", "x"), "T5", [INCOME, slot("s2", "AN-I01", "line")]);
    const read = readComposition(card);
    expect(read.slots[1]!.family).toBe("donut");
    expect(read.template).toBe("T6");
    expect(read.adjusted).toBe(true);
  });
});

describe("模板推荐与兼容（任务 §3.3 / §6）", () => {
  it("按数字与图表个数给出确定的默认模板", () => {
    const cases: [number, number, string | null][] = [
      [1, 0, "single"], [0, 1, "single"], [2, 0, "T1"], [4, 0, "T2"], [3, 0, "T7"], [6, 0, "T7"],
      [1, 1, "T6"], [2, 1, "T3"], [3, 1, "T4"], [6, 1, "T4"], [0, 2, "T5"], [1, 2, "T8"], [0, 3, "T8"], [2, 4, "T8"],
      [7, 0, null], [0, 5, null], [0, 0, null],
    ];
    for (const [numbers, charts, expected] of cases) expect(recommendTemplate({ numbers, charts }), `${String(numbers)}n+${String(charts)}c`).toBe(expected);
  });

  it("推荐模板永远兼容当前内容；兼容列表推荐在前", () => {
    for (let numbers = 0; numbers <= 6; numbers += 1) {
      for (let charts = 0; charts <= 4; charts += 1) {
        const recommended = recommendTemplate({ numbers, charts });
        if (recommended === null) continue;
        const template = CARD_TEMPLATES.find((item) => item.id === recommended)!;
        expect(templateFit(template, { numbers, charts }).status).toBe("ok");
        expect(compatibleTemplates({ numbers, charts })[0]).toBe(recommended);
      }
    }
  });

  it("从双数字切到四数字：提示还差 2 个，内容不丢；放不下的模板不可选", () => {
    const counts = countSlots([INCOME, EXPENSE]);
    expect(templateFit(CARD_TEMPLATES.find((item) => item.id === "T2")!, counts)).toEqual({ status: "needs", numbers: 2, charts: 0 });
    expect(templateFit(CARD_TEMPLATES.find((item) => item.id === "T5")!, counts).status).toBe("excess");
    const draft = { template: "T2" as const, slots: [INCOME, EXPENSE], name: "" };
    expect(draftProblem(draft)).toBe("template");
    const filled = { ...draft, slots: [INCOME, EXPENSE, NET, DAILY_AVG] };
    expect(draftProblem(filled)).toBeNull();
    const card = buildCard(filled, undefined, "quad")!;
    expect(readComposition(card).slots.map((item) => item.analysisId)).toEqual(["AN-B02", "AN-B01", "AN-B03", "AN-B06"]);
  });

  it("同一指标可以用不同展示形式加入多次（同一趋势：折线 + 表格）", () => {
    const draft = { template: "T5" as const, slots: [DAILY_LINE, slot("s7", "AN-I06", "table")], name: "趋势两看" };
    expect(draftProblem(draft)).toBeNull();
    const card = buildCard(draft, undefined, "twice")!;
    expect(readComposition(card).slots.map((item) => `${item.analysisId}:${item.family}`)).toEqual(["AN-I06:line", "AN-I06:table"]);
  });
});

describe("放不下就不画（预览与卡片同一判断，1.17.10 浏览器全量测量后的回归保护）", () => {
  const s = (id: string, analysisId: string, family: string): CompositionSlot => ({ id, analysisId, family: family as CompositionSlot["family"] });

  it("单项卡片：时间趋势在矮卡片里画迷你趋势；其它图形写「空间不足」；数字与 S17-A 列表照常完整显示", () => {
    const [line] = slotSpecs([s("s1", "AN-I06", "line")]);
    const [table] = slotSpecs([s("s1", "AN-I06", "table")]);
    const [weekday] = slotSpecs([s("s1", "AN-I13", "bar")]);
    const [ranking] = slotSpecs([s("s1", "AN-I03", "ranking")]);
    const [boxplot] = slotSpecs([s("s1", "AN-A10", "boxplot")]);
    const [number] = slotSpecs([s("s1", "AN-B01", "number")]);
    // 手机 2×1 正文约 312 × 62
    expect(singlePresentation(line!, 312, 62)).toBe("spark");
    expect(singlePresentation(table!, 312, 62)).toBe("too-small");
    expect(singlePresentation(weekday!, 312, 62)).toBe("too-small");
    expect(singlePresentation(ranking!, 312, 62)).toBe("full");
    expect(singlePresentation(boxplot!, 312, 58)).toBe("full");
    expect(singlePresentation(number!, 150, 40)).toBe("full");
    // 手机 2×2 正文约 312 × 190：日历热力（卡片里格子 16px）放得下
    const [heatmap] = slotSpecs([s("s1", "AN-I12", "heatmap")]);
    expect(singlePresentation(heatmap!, 312, 190)).toBe("full");
    expect(singlePresentation(heatmap!, 312, 120)).toBe("too-small");
  });

  it("迷你趋势只对线 / 面积 / 柱：表格、累计曲线不会被塞进迷你格", () => {
    expect(slotSpecs([s("s1", "AN-I06", "line")])[0]!.spark).toBe(true);
    expect(slotSpecs([s("s1", "AN-I06", "table")])[0]!.spark).toBe(false);
    expect(slotSpecs([s("s1", "AN-B01", "cumulative")])[0]!.spark).toBe(false);
  });

  it("需要更高绘图区的图形：格子不够高时不放（写「另有 N 项」），编辑器据此推荐更大的尺寸", () => {
    const pair = [s("s1", "AN-A01", "comparison"), s("s2", "AN-B01", "number")];
    const specs = slotSpecs(pair);
    expect(specs[0]!.minHeight).toBe(196);
    const tight = layoutComposition("T6", specs, 312, 150);
    expect(tight.hidden).toEqual(["s1"]);
    const roomy = layoutComposition("T6", specs, 312, 318);
    expect(roomy.fits).toBe(true);
    expect(recommendSize("T6", pair, PHONE)).toEqual({ colSpan: 2, rowSpan: 3 });
  });
});

describe("卡片内部排布与尺寸推荐（按真实像素，不靠缩小字号）", () => {
  it("双数字在手机 1×1 单行放下；四数字在 2×1 放下", () => {
    const box11 = bodyBox({ colSpan: 1, rowSpan: 1 }, PHONE);
    const pair = layoutComposition("T1", slotSpecs([INCOME, EXPENSE]), box11.width, box11.height);
    expect(pair.fits).toBe(true);
    expect(pair.placements.map((item) => item.mode)).toEqual(["inline", "inline"]);
    const box21 = bodyBox({ colSpan: 2, rowSpan: 1 }, PHONE);
    const quad = layoutComposition("T2", slotSpecs([INCOME, EXPENSE, NET, DAILY_AVG]), box21.width, box21.height);
    expect(quad.fits).toBe(true);
    expect(recommendSize("T1", [INCOME, EXPENSE], PHONE)).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(recommendSize("T2", [INCOME, EXPENSE, NET, DAILY_AVG], PHONE)).toEqual({ colSpan: 2, rowSpan: 1 });
  });

  it("320 px 窄屏 1×1 放不下单行双数字时，推荐更大的尺寸而不是缩小", () => {
    const box = bodyBox({ colSpan: 1, rowSpan: 1 }, NARROW);
    expect(layoutComposition("T1", slotSpecs([INCOME, EXPENSE]), box.width, box.height).fits).toBe(false);
    const size = recommendSize("T1", [INCOME, EXPENSE], NARROW);
    expect(size.colSpan * size.rowSpan).toBeGreaterThan(1);
    const box2 = bodyBox(size, NARROW);
    expect(layoutComposition("T1", slotSpecs([INCOME, EXPENSE]), box2.width, box2.height).fits).toBe(true);
  });

  it("六个数字：2×1 放不下（显示另有 N 项），推荐能完整放下的竖长 1×2（六行单行）", () => {
    const six = [INCOME, EXPENSE, NET, DAILY_AVG, slot("s8", "AN-B04", "number"), slot("s9", "AN-B05", "number")];
    const box = bodyBox({ colSpan: 2, rowSpan: 1 }, PHONE);
    const tight = layoutComposition("T7", slotSpecs(six), box.width, box.height);
    expect(tight.fits).toBe(false);
    expect(tight.hidden.length).toBeGreaterThan(0);
    expect(tight.placements.length + tight.hidden.length).toBe(6);
    const recommended = recommendSize("T7", six, PHONE);
    expect(recommended).toEqual({ colSpan: 1, rowSpan: 2 });
    const box12 = bodyBox(recommended, PHONE);
    expect(layoutComposition("T7", slotSpecs(six), box12.width, box12.height).fits).toBe(true);
    // 2×2 也能放下，而且是两行大字（宽格）。
    const box22 = bodyBox({ colSpan: 2, rowSpan: 2 }, PHONE);
    expect(layoutComposition("T7", slotSpecs(six), box22.width, box22.height).placements.every((item) => item.mode === "stacked")).toBe(true);
  });

  it("图表 + 双数字：时间趋势在 1×2 可画迷你趋势；环形图需要 2×2", () => {
    const withLine = [DAILY_LINE, EXPENSE, DAILY_AVG];
    const box12 = bodyBox({ colSpan: 1, rowSpan: 2 }, PHONE);
    const line = layoutComposition("T3", slotSpecs(withLine), box12.width, box12.height);
    expect(line.fits).toBe(true);
    expect(recommendSize("T3", withLine, PHONE)).toEqual({ colSpan: 1, rowSpan: 2 });
    const withDonut = [DONUT, EXPENSE, DAILY_AVG];
    expect(layoutComposition("T3", slotSpecs(withDonut), box12.width, box12.height).fits).toBe(false);
    expect(recommendSize("T3", withDonut, PHONE)).toEqual({ colSpan: 2, rowSpan: 2 });
    const box22 = bodyBox({ colSpan: 2, rowSpan: 2 }, PHONE);
    const placed = layoutComposition("T3", slotSpecs(withDonut), box22.width, box22.height);
    const chart = placed.placements.find((item) => item.slotId === DONUT.id)!;
    const numberCells = placed.placements.filter((item) => item.slotId !== DONUT.id);
    // 图表获得主要视觉空间。
    for (const cell of numberCells) expect(chart.width * chart.height).toBeGreaterThan(cell.width * cell.height * 2);
  });

  it("双图表：每张都达到可读下限；宽卡左右、窄卡上下", () => {
    const two = [DAILY_LINE, DONUT];
    const phone = bodyBox({ colSpan: 2, rowSpan: 2 }, PHONE);
    const stacked = layoutComposition("T5", slotSpecs(two), phone.width, phone.height);
    expect(stacked.fits).toBe(true);
    for (const cell of stacked.placements) {
      expect(cell.width).toBeGreaterThanOrEqual(140);
      expect(cell.height).toBeGreaterThanOrEqual(96);
    }
    const wide = layoutComposition("T5", slotSpecs(two), 900, 260);
    expect(new Set(wide.placements.map((item) => item.y)).size).toBe(1);
  });

  it("排布不重叠、不越界，输出顺序等于用户顺序", () => {
    const mixed = [EXPENSE, DAILY_LINE, INCOME, DONUT, NET];
    for (const [width, height] of [[314, 188], [314, 310], [612, 310], [137, 432]] as const) {
      const layout = layoutComposition("T8", slotSpecs(mixed), width, height);
      const shown = layout.placements;
      expect(shown.map((item) => item.slotId)).toEqual(mixed.map((item) => item.id).filter((id) => !layout.hidden.includes(id)));
      for (const cell of shown) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.x + cell.width).toBeLessThanOrEqual(width + 0.5);
        expect(cell.y + cell.height).toBeLessThanOrEqual(height + 0.5);
      }
      for (let i = 0; i < shown.length; i += 1) {
        for (let j = i + 1; j < shown.length; j += 1) {
          const a = shown[i]!;
          const b = shown[j]!;
          const overlap = a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
          expect(overlap, `${a.slotId}/${b.slotId} @${String(width)}×${String(height)}`).toBe(false);
        }
      }
    }
  });

  it("超出当前列数的尺寸标记为不可用；桌面三列时优先 2 列宽的尺寸", () => {
    const single = { ...PHONE, columns: 1 };
    const checks = checkSizes("T2", [INCOME, EXPENSE, NET, DAILY_AVG], single);
    expect(checks.find((check) => check.size.colSpan === 2)?.tooWide).toBe(true);
    expect(recommendSize("T2", [INCOME, EXPENSE, NET, DAILY_AVG], single).colSpan).toBe(1);
    expect(recommendSize("T5", [DAILY_LINE, DONUT], DESKTOP)).toEqual({ colSpan: 2, rowSpan: 2 });
  });
});

describe("槽位共享卡片范围；展示别名不另算", () => {
  it("槽位虚拟卡片继承卡片的固定区间与时间策略", () => {
    const card: AnalysisCardNode = { ...withComposition(newCard("AN-B02", "c"), "T1", [INCOME, EXPENSE]), rangePolicy: "pinned", pinnedRange: { from: "2026-10-01", to: "2026-10-27" } };
    const virtual = slotCard(card, EXPENSE);
    expect(virtual).toMatchObject({ objectId: "c#s2", analysis: { analysisId: "AN-B01" }, chart: { chartFamily: "number" }, rangePolicy: "pinned", pinnedRange: { from: "2026-10-01", to: "2026-10-27" } });
  });

  it("「总支出」选成趋势时交给每日支出趋势画（同一口径），其它组合不变", () => {
    expect(resolveDisplay("AN-B01", "line")).toEqual({ analysisId: "AN-I06", family: "line" });
    expect(resolveDisplay("AN-B01", "number")).toEqual({ analysisId: "AN-B01", family: "number" });
    expect(resolveDisplay("AN-B15", "ranking")).toEqual({ analysisId: "AN-I03", family: "ranking" });
    // 每个别名目标都是已登记的分析，且目标支持这种展示形式。
    for (const type of CARD_TYPES) {
      for (const family of type.families) {
        const shown = resolveDisplay(type.id, family);
        expect(cardType(shown.analysisId)?.families, `${type.id}:${family}`).toContain(shown.family);
      }
    }
  });
});

describe("保存、重新加载与编辑（D 命令 + 本机存储）", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    Object.assign(globalThis, { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } });
  });
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

  it("组合卡片插入、保存、刷新（重新读取）后内容、顺序、展示形式、模板不变", () => {
    const card = buildCard({ template: "T3", slots: [DAILY_LINE, EXPENSE, DAILY_AVG], name: "" }, undefined, "combo")!;
    const inserted = command(startSession(legacyDefaultWorkbench()), { type: "insert-card", card, size: { colSpan: 2, rowSpan: 2 }, collisionPolicy: "reflow" });
    expect(inserted.ok).toBe(true);
    expect(saveWorkbench("user:a", sessionDocuments(inserted.state), 0)).toBe(1);
    const loaded = loadWorkbench("user:a");
    expect(loaded.status).toBe("ok");
    const reloaded = loaded.status === "ok" ? loaded.documents.content.cards.find((item) => item.objectId === "combo") : undefined;
    expect(reloaded).toEqual(card);
    expect(readComposition(reloaded!)).toMatchObject({ source: "composite", template: "T3", slots: [DAILY_LINE, EXPENSE, DAILY_AVG] });
    expect(customCardsIn(loaded.status === "ok" ? loaded.documents.content.cards : [])).toEqual([card]);
  });

  it("编辑已有组合卡片：换内容 + 换尺寸是一步撤销；外部移动布局不清空内部配置", () => {
    const card = buildCard({ template: "T1", slots: [INCOME, EXPENSE], name: "收支" }, undefined, "pair")!;
    const start = startSession(legacyDefaultWorkbench());
    const inserted = command(start, { type: "insert-card", card, size: { colSpan: 1, rowSpan: 1 }, collisionPolicy: "reflow" });
    expect(inserted.ok).toBe(true);
    const moved = command(inserted.state, { type: "move", objectId: "pair", anchor: 1, collisionPolicy: "reflow" });
    expect(moved.ok).toBe(true);
    expect(readComposition(moved.state.content.cards.find((item) => item.objectId === "pair")!).slots).toEqual([INCOME, EXPENSE]);

    const edited = buildCard({ template: "T2", slots: [INCOME, EXPENSE, NET, DAILY_AVG], name: "收支" }, moved.state.content.cards.find((item) => item.objectId === "pair"))!;
    expect(edited.objectId).toBe("pair");
    const result = reconfigureCard(moved.state, edited, { colSpan: 2, rowSpan: 1 });
    expect(result.ok).toBe(true);
    expect(geometryOf(result.state, "pair")).toMatchObject({ colSpan: 2, rowSpan: 1 });
    expect(readComposition(result.state.content.cards.find((item) => item.objectId === "pair")!).template).toBe("T2");
    expect(result.state.history.past.length).toBe(moved.state.history.past.length + 1);
    const undone = command(result.state, { type: "undo" });
    expect(undone.state.content).toBe(moved.state.content);
    expect(undone.state.layout).toBe(moved.state.layout);
  });

  it("右列的 1×1 组合卡片加内容后变成 2×1：放到同一行行首并重排，保存成功（1.17.10 浏览器验收发现的回归）", () => {
    const card = buildCard({ template: "T1", slots: [INCOME, EXPENSE], name: "" }, undefined, "pair")!;
    const start = startSession(legacyDefaultWorkbench());
    const baseCols = start.layout.main.baseCols;
    const inserted = command(start, { type: "insert-card", card, size: { colSpan: 1, rowSpan: 1 }, collisionPolicy: "reflow" });
    // 放到第二列（右列）
    const moved = command(inserted.state, { type: "move", objectId: "pair", anchor: 2, collisionPolicy: "reflow" });
    expect(moved.ok).toBe(true);
    expect((geometryOf(moved.state, "pair")!.anchor - 1) % baseCols).toBe(1);
    const edited = buildCard({ template: "T7", slots: [INCOME, EXPENSE, DAILY_AVG], name: "" }, moved.state.content.cards.find((item) => item.objectId === "pair"))!;
    const result = reconfigureCard(moved.state, edited, { colSpan: 2, rowSpan: 1 });
    expect(result.ok).toBe(true);
    const placed = geometryOf(result.state, "pair")!;
    expect(placed).toMatchObject({ colSpan: 2, rowSpan: 1 });
    expect((placed.anchor - 1) % baseCols).toBe(0);
    // 仍在原来那一行（不是被挪到工作区末尾）；原来左边的邻居顺延到它后面
    const before = geometryOf(moved.state, "pair")!;
    expect(Math.ceil(placed.anchor / baseCols)).toBe(Math.ceil(before.anchor / baseCols));
    const neighbour = moved.state.layout.main.objects.find((object) => object.anchor === before.anchor - 1);
    if (neighbour !== undefined) expect(geometryOf(result.state, neighbour.objectId)!.anchor).toBeGreaterThan(placed.anchor);
    expect(readComposition(result.state.content.cards.find((item) => item.objectId === "pair")!).slots).toEqual([INCOME, EXPENSE, DAILY_AVG]);
    // 一步撤销回到编辑前
    const undone = command(result.state, { type: "undo" });
    expect(undone.state.layout).toBe(moved.state.layout);
  });

  it("编辑普通目录卡片且仍是单项时不写组合配置（不把目录卡片变成自定义卡片）", () => {
    const plain = newCard("AN-I06", "plain");
    const edited = buildCard({ template: "single", slots: [slot("s1", "AN-I06", "table")], name: "" }, plain)!;
    expect(hasComposition(edited)).toBe(false);
    expect(edited.chart.chartFamily).toBe("table");
    const grown = buildCard({ template: "T6", slots: [slot("s1", "AN-I06", "line"), EXPENSE], name: "" }, plain)!;
    expect(hasComposition(grown)).toBe(true);
    expect(isCustomCard(grown)).toBe(true);
  });
});
