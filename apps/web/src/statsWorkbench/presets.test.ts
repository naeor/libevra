import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { t } from "../i18n/index.js";

const translate = (key: string): string => t(key as never);
import { bodyBox, isMultiSlot, layoutComposition, readComposition, singlePresentation, slotSpecs, type GridMetrics } from "./composition.js";
import { lastRow, replaceDocuments, startSession } from "./session.js";
import { cardWindow } from "./timeWindows.js";
import { defaultWorkbench } from "./defaults.js";
import { documentsProblems, saveWorkbench, loadWorkbench, type WorkbenchDocuments } from "./storage.js";
import {
  buildSystemPreset,
  createPreset,
  deletePreset,
  loadPresets,
  MAX_USER_PRESETS,
  presetStorageKey,
  reidentify,
  renamePreset,
  SYSTEM_PRESET_IDS,
  SYSTEM_PRESETS,
  updatePresetDocuments,
} from "./presets.js";

// 卡片外框：内边距 + 标题一行 + 间距；有相对窗口的卡片多一行副标题（18px）。
const SUBTITLE = 16;
const PHONE: GridMetrics = { columnWidth: 165, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };
// 360 宽（常见安卓窄屏）与 320 宽（最窄的 iPhone SE 一代）：页面左右各 16px 内边距、两列间距 12px。
const NARROW: GridMetrics = { columnWidth: 158, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };
const SMALLEST: GridMetrics = { columnWidth: 130, rowHeight: 116, gap: 12, columns: 2, chromeWidth: 28, chromeHeight: 54 };

function withSubtitle(metrics: GridMetrics): GridMetrics {
  return { ...metrics, chromeHeight: metrics.chromeHeight + SUBTITLE };
}

/** 一张卡片在给定占格下能否完整显示（组合卡片没有隐藏槽位；单项图表不是「空间不足」）。 */
function fits(card: AnalysisCardNode, size: { colSpan: number; rowSpan: number }, metrics: GridMetrics): boolean {
  const box = bodyBox(size, metrics);
  const read = readComposition(card);
  const specs = slotSpecs(read.slots);
  if (isMultiSlot(card)) return layoutComposition(read.template, specs, box.width, box.height).hidden.length === 0;
  return singlePresentation(specs[0]!, box.width, box.height) === "full";
}

describe("系统预设：按所有者模块表搭建、文档合法", () => {
  for (const id of SYSTEM_PRESET_IDS) {
    it(`${id}：D 正式管线校验通过；行数与模块表一致；每个模块都有相对时间窗口`, () => {
      const documents = buildSystemPreset(id, translate);
      expect(documentsProblems(documents)).toEqual([]);
      const spec = SYSTEM_PRESETS.find((preset) => preset.id === id)!;
      expect(lastRow(documents.layout)).toBe(spec.rows);
      for (const card of documents.content.cards) expect(cardWindow(card)).not.toBeNull();
      // 每套预设都有一个横向滑动抽屉，里面 3 张卡片。
      const carousels = documents.content.containers.filter((container) => container.type === "carousel");
      expect(carousels).toHaveLength(1);
      expect(carousels[0]!.children).toHaveLength(3);
    });
  }

  it("新手：4×13 的位置与尺寸（2 列主网格：整行 = 2 列、半行 = 1 列）", () => {
    const { layout } = buildSystemPreset("beginner", translate);
    const geometry = (key: string) => layout.main.objects.find((object) => object.objectId === `preset-beginner-${key}`);
    // 1.17.23：「支出分类」（原「钱主要花在哪里」）移到第一位，概览移到第 3–4 行；其余位置不变。
    expect(geometry("where")).toMatchObject({ anchor: 1, colSpan: 2, rowSpan: 2 });
    expect(geometry("overview")).toMatchObject({ anchor: 5, colSpan: 2, rowSpan: 2 });
    expect(geometry("daily")).toMatchObject({ anchor: 9, colSpan: 2, rowSpan: 2 });
    expect(geometry("rise")).toMatchObject({ anchor: 13, colSpan: 1, rowSpan: 1 });
    expect(geometry("fall")).toMatchObject({ anchor: 14, colSpan: 1, rowSpan: 1 });
    expect(geometry("details")).toMatchObject({ anchor: 15, colSpan: 2, rowSpan: 2, objectType: "carousel" });
    expect(geometry("weeks")).toMatchObject({ anchor: 23, colSpan: 2, rowSpan: 2 });
  });

  it("时间口径：新手最近 7 天 + 本月至今；进阶本月至今 + 6 个月；专业 12 个完整月", () => {
    const windows = (id: (typeof SYSTEM_PRESET_IDS)[number]) => new Set(buildSystemPreset(id, translate).content.cards.map(cardWindow));
    expect(windows("beginner")).toEqual(new Set(["last-7-days", "month-to-date", "last-4-weeks"]));
    expect(windows("advanced")).toEqual(new Set(["month-to-date", "last-6-months"]));
    expect(windows("professional")).toEqual(new Set(["last-12-months", "previous-month"]));
  });

  it("标题按当前语言写入（组合卡片用模块名），之后不随语言变化", () => {
    const { content } = buildSystemPreset("beginner", translate);
    const overview = content.cards.find((card) => card.objectId === "preset-beginner-overview")!;
    expect(overview.title).toEqual({ kind: "custom", text: "近 7 天概览" });
    // 第一张「支出分类」用分析自身名称，不写死模块名（随界面语言变化）。
    expect(content.cards[0]!.objectId).toBe("preset-beginner-where");
    expect(content.cards[0]!.title).toEqual({ kind: "preset" });
    const rise = content.cards.find((card) => card.objectId === "preset-beginner-rise")!;
    expect(rise.title).toEqual({ kind: "preset" });
  });

  /** 放不下的卡片（组合卡片有隐藏槽位、单项图表「空间不足」）。 */
  function failingAt(metrics: GridMetrics): string[] {
      const failing: string[] = [];
      for (const id of SYSTEM_PRESET_IDS) {
        const { content, layout } = buildSystemPreset(id, translate);
        for (const object of layout.main.objects) {
          const size = { colSpan: object.colSpan, rowSpan: object.rowSpan };
          if (object.objectType === "analysis-card") {
            const card = content.cards.find((item) => item.objectId === object.objectId)!;
            if (!fits(card, size, withSubtitle(metrics))) failing.push(object.objectId);
          }
          if (object.objectType === "carousel") {
            const container = content.containers.find((item) => item.objectId === object.objectId)!;
            // 抽屉里的卡片：外框 1px、顶部 12px 内边距、标题与副标题、间距 8px、底部 8px。
            const carousel: GridMetrics = { ...metrics, chromeWidth: 30, chromeHeight: 2 + 12 + 18 + SUBTITLE + 8 + 8 };
            for (const childId of container.children) {
              const card = content.cards.find((item) => item.objectId === childId)!;
              if (!fits(card, size, carousel)) failing.push(childId);
            }
          }
        }
      }
      return failing;
  }

  it("375–390 宽手机与 360 宽窄屏：每张卡片都能完整显示（组合卡片不隐藏槽位，图表不是「空间不足」）", () => {
    expect(failingAt(PHONE)).toEqual([]);
    expect(failingAt(NARROW)).toEqual([]);
  });

  it("320 宽：只有两张卡片各收起一项（卡片上显示「另有 1 项」，详情页完整）；「图表 + 数字」先收数字、保留图表", () => {
    expect(failingAt(SMALLEST)).toEqual(["preset-beginner-month", "preset-professional-trend"]);
    const { content } = buildSystemPreset("beginner", translate);
    const month = content.cards.find((card) => card.objectId === "preset-beginner-month")!;
    const read = readComposition(month);
    const box = bodyBox({ colSpan: 2, rowSpan: 2 }, withSubtitle(SMALLEST));
    const layout = layoutComposition(read.template, slotSpecs(read.slots), box.width, box.height);
    // 收起的是最后一个数字（收支差额），收支趋势图仍然画出来。
    expect(layout.hidden).toEqual(["s4"]);
    expect(layout.placements.find((placement) => placement.slotId === "s1")?.mode).toBe("chart");
  });
});

describe("应用：整份换新 ID，一步撤销，不改动原工作台", () => {
  it("reidentify 换掉全部对象 ID，引用关系同步，配置不变", () => {
    const documents = buildSystemPreset("advanced", translate);
    let n = 0;
    const fresh = reidentify(documents, (prefix) => `${prefix}-${String((n += 1))}`);
    expect(documentsProblems(fresh)).toEqual([]);
    const oldIds = new Set([...documents.content.cards, ...documents.content.containers].map((node) => node.objectId));
    for (const node of [...fresh.content.cards, ...fresh.content.containers]) expect(oldIds.has(node.objectId)).toBe(false);
    expect(fresh.content.cards.map((card) => card.chart)).toEqual(documents.content.cards.map((card) => card.chart));
  });

  it("replaceDocuments 是一步撤销；不合法的文档不动编辑会话", () => {
    const start = startSession(defaultWorkbench());
    const preset = reidentify(buildSystemPreset("professional", translate));
    const applied = replaceDocuments(start, preset);
    expect(applied.ok).toBe(true);
    expect(applied.state.content).toBe(preset.content);
    expect(applied.state.history.past).toHaveLength(1);
    expect(applied.state.history.past[0]!.content).toBe(start.content);
    // 布局引用了内容文档里没有的卡片：交叉引用错误。
    const broken = { ...preset, content: { ...preset.content, cards: [] } };
    const refused = replaceDocuments(start, broken);
    expect(refused.ok).toBe(false);
    expect(refused.state).toBe(start);
  });
});

describe("我的预设：本机按账号保存，只存结构不存数据", () => {
  const scope = "user-1";
  // 测试环境是 node：用一个内存版 localStorage。
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, String(value)),
        removeItem: (key: string) => void data.delete(key),
        clear: () => data.clear(),
        key: (index: number) => [...data.keys()][index] ?? null,
        get length() {
          return data.size;
        },
      },
    });
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("新建 → 读回 → 改名 → 更新 → 删除；工作台存储不受影响", () => {
    const workbench = defaultWorkbench();
    expect(saveWorkbench(scope, workbench, 0)).toBe(1);
    const created = createPreset(scope, { name: "  我的月度  ", description: "看本月", documents: workbench, filters: "range=month" }, new Date("2026-10-28T08:00:00Z"));
    if (typeof created === "string") throw new Error(created);
    expect(created.name).toBe("我的月度");
    expect(loadPresets(scope).presets.map((preset) => preset.name)).toEqual(["我的月度"]);

    // 保存的是副本：之后修改原对象不会改到预设。
    expect(loadPresets(scope).presets[0]!.documents).toEqual(workbench);

    expect(renamePreset(scope, created.id, { name: "月度视图", description: "" })).toBeNull();
    const advanced = buildSystemPreset("advanced", translate);
    expect(updatePresetDocuments(scope, created.id, advanced, "")).toBeNull();
    const updated = loadPresets(scope).presets[0]!;
    expect(updated.name).toBe("月度视图");
    expect(updated.documents).toEqual(advanced);
    expect(updated.filters).toBe("");

    expect(deletePreset(scope, created.id)).toBeNull();
    expect(loadPresets(scope).presets).toEqual([]);
    const reloaded = loadWorkbench(scope);
    expect(reloaded.status).toBe("ok");
  });

  it("存的只有结构：没有金额、账目或计算结果", () => {
    const created = createPreset(scope, { name: "专业", description: "", documents: buildSystemPreset("professional", translate), filters: "" });
    expect(typeof created).not.toBe("string");
    const raw = localStorage.getItem(presetStorageKey(scope))!;
    expect(raw).not.toMatch(/amountMinor|entries|records|result/);
  });

  it("名称必填且有长度上限；最多 10 个；不合法文档不保存", () => {
    const documents = defaultWorkbench();
    expect(createPreset(scope, { name: "   ", description: "", documents, filters: "" })).toBe("name");
    expect(createPreset(scope, { name: "一二三四五六七八九十一二三四五六七八九十一", description: "", documents, filters: "" })).toBe("name");
    for (let index = 0; index < MAX_USER_PRESETS; index += 1) expect(typeof createPreset(scope, { name: `预设 ${String(index)}`, description: "", documents, filters: "" })).toBe("object");
    expect(createPreset(scope, { name: "再多一个", description: "", documents, filters: "" })).toBe("full");
    localStorage.clear();
    const broken: WorkbenchDocuments = { ...documents, content: { ...documents.content, cards: [] } };
    expect(createPreset(scope, { name: "坏的", description: "", documents: broken, filters: "" })).toBe("invalid");
  });

  it("按账号隔离；损坏或来自更新版本的存储只读，不覆盖", () => {
    createPreset(scope, { name: "A", description: "", documents: defaultWorkbench(), filters: "" });
    expect(loadPresets("user-2").presets).toEqual([]);
    localStorage.setItem(presetStorageKey(scope), JSON.stringify({ v: 2, userId: scope, items: [] }));
    expect(loadPresets(scope).locked).toBe(true);
    expect(createPreset(scope, { name: "B", description: "", documents: defaultWorkbench(), filters: "" })).toBe("locked");
    expect(JSON.parse(localStorage.getItem(presetStorageKey(scope))!)).toMatchObject({ v: 2 });
  });

  it("单条损坏的预设只读保留（可以删除），不影响其它预设", () => {
    createPreset(scope, { name: "好的", description: "", documents: defaultWorkbench(), filters: "" });
    const raw = JSON.parse(localStorage.getItem(presetStorageKey(scope))!) as { items: unknown[] };
    raw.items.push({ id: "preset-broken", name: "坏的", documents: { content: {}, layout: {} } });
    localStorage.setItem(presetStorageKey(scope), JSON.stringify(raw));
    const store = loadPresets(scope);
    expect(store.presets.map((preset) => preset.name)).toEqual(["好的"]);
    expect(store.unreadable).toEqual([{ id: "preset-broken", name: "坏的", unreadable: true }]);
    expect(deletePreset(scope, "preset-broken")).toBeNull();
    expect(loadPresets(scope).unreadable).toEqual([]);
  });
});
