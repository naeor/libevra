/**
 * 工作台**布局预设**（1.17.12）：管理「整张工作台」，与管理「单张卡片内部」的卡片内容模板（T1–T8）是两回事。
 *
 * - **系统预设**：新手 / 进阶 / 专业三套，按所有者给出的模块表搭建（4 列逻辑网格按 2:1 映射到工作台的
 *   2 列主网格：C1–4 = 整行 2 列，C1–2 / C3–4 = 半行 1 列，行数不变）。每个模块都是**已有分析**的卡片
 *   （单项或组合卡片，复用现有计算、图表与 T1–T8），时间用卡片的相对窗口（`timeWindows.ts`），不含任何数字。
 * - **我的预设**：当前工作台（内容文档 + 布局文档）的快照，外加保存时的筛选条件（地址栏参数串）。
 *   只存结构与意图，不存账目与计算结果；应用后按当前账本重新计算。之后改工作台**不会**改动已保存的预设。
 * - **应用**：先预览；确认后整体替换编辑会话里的工作台（一步撤销），对象 ID 全部重新生成（布局对象 ID 永不复用）；
 *   仍要点「完成」才保存工作台。删除预设只删预设本身，不动工作台、卡片定义与账本。
 *
 * 保存位置：本机、按账号（与工作台同一作用域与前缀 `libevra.`，「清除本机全部数据」会一并清掉）；W6 在正式操作后排队同步完整快照集合。
 */
import {
  migrateContentDocument,
  migrateLayoutDocument,
  type AnalysisCardNode,
  type CarouselNode,
  type ContainerNode,
  type GridSize,
  type LayoutDocumentV1,
  type ObjectGeometry,
  type WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";

import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import { notifyWorkbenchChange } from "./configEvents.js";
import type { ChartFamily } from "./catalog.js";
import type { TemplateId } from "./composition.js";
import { buildCard, CUSTOM_NAME_MAX } from "./customCards.js";
import { newObjectId } from "./defaults.js";
import { documentsProblems, type WorkbenchDocuments } from "./storage.js";
import type { RelativeWindow } from "./timeWindows.js";

// ---------------------------------------------------------------------------
// 系统预设
// ---------------------------------------------------------------------------

export type SystemPresetId = "beginner" | "advanced" | "professional";

export const SYSTEM_PRESET_IDS: readonly SystemPresetId[] = ["beginner", "advanced", "professional"];

/** 动态文案键的翻译函数（调用方传 `(key) => t(key as never)`，与 `searchDirectory` 同一做法）。 */
export type Translate = (key: string) => string;

interface CardModule {
  readonly kind: "card";
  /** 模块键：标题文案 `statsWorkbench.presets.modules.<preset>.<key>`，也是对象 ID 的一部分。 */
  readonly key: string;
  readonly row: number;
  /** 4 列逻辑网格里的起始列（1 或 3）与跨列数（4 或 2）。 */
  readonly col: 1 | 3;
  readonly cols: 2 | 4;
  readonly rows: number;
  readonly template: TemplateId;
  readonly slots: readonly (readonly [analysisId: string, family: ChartFamily])[];
  readonly window: RelativeWindow;
  /** 用模块名做卡片标题（组合卡片与需要更口语名称的单项卡片）；`false` 时用分析自身名称。 */
  readonly titled: boolean;
}

interface DrawerChild {
  readonly key: string;
  readonly analysisId: string;
  readonly family: ChartFamily;
  readonly window: RelativeWindow;
  readonly titled: boolean;
}

interface DrawerModule {
  readonly kind: "drawer";
  readonly key: string;
  readonly row: number;
  readonly rows: number;
  readonly children: readonly DrawerChild[];
}

type Module = CardModule | DrawerModule;

export interface SystemPresetSpec {
  readonly id: SystemPresetId;
  /** 4 列逻辑网格的总行数（与所有者给出的表一致，测试守护）。 */
  readonly rows: number;
  readonly modules: readonly Module[];
}

const full = { col: 1, cols: 4 } as const;
const left = { col: 1, cols: 2 } as const;
const right = { col: 3, cols: 2 } as const;

/**
 * 三套系统预设的模块表（所有者 2026-10-28 规格 §6）。每个模块后的注释写明它在规格里的位置与内容。
 * 规格里个别模块在现有分析里没有一模一样的项，按「同一口径、真实计算」的最近读法实现，差异写在能力说明里。
 */
export const SYSTEM_PRESETS: readonly SystemPresetSpec[] = [
  {
    id: "beginner",
    rows: 13,
    modules: [
      // C1–4 / R1–2 支出分类（原「钱主要花在哪里」；1.17.23 起按所有者要求放在第一位，标题用分析自身名称）：
      // 支出分类环形图 + 前几名分类排行。整行 2×2 的环形图自带按金额排序的分类图例（前几名 + 「另有 N 项」），
      // 就是「环形 + 排行」；拆成两个半宽槽位时手机上环形图会退成列表、与排行重复（1.17.12 浏览器实测），
      // 所以用一张单项卡片。
      { kind: "card", key: "where", row: 1, ...full, rows: 2, template: "single", slots: [["AN-I01", "donut"]], window: "month-to-date", titled: false },
      // C1–4 / R3–4 近 7 天概览：总支出、较前期变化、日均支出、笔数（四数字）
      { kind: "card", key: "overview", row: 3, ...full, rows: 2, template: "T2", slots: [["AN-B01", "number"], ["AN-A01", "number"], ["AN-B06", "number"], ["AN-B04", "number"]], window: "last-7-days", titled: true },
      // C1–4 / R5–6 每日支出：七日柱状图 + 两项摘要数字
      { kind: "card", key: "daily", row: 5, ...full, rows: 2, template: "T3", slots: [["AN-I06", "bar"], ["AN-B01", "number"], ["AN-B11", "extreme"]], window: "last-7-days", titled: true },
      // C1–2 / R7 增加最多的分类；C3–4 / R7 减少最多的分类（本月至今对比上月同期）
      { kind: "card", key: "rise", row: 7, ...left, rows: 1, template: "single", slots: [["AN-A17", "top-rise"]], window: "month-to-date", titled: false },
      { kind: "card", key: "fall", row: 7, ...right, rows: 1, template: "single", slots: [["AN-A17", "top-fall"]], window: "month-to-date", titled: false },
      // C1–4 / R8–9 横向滑动抽屉：大额支出、分类变化、按星期支出
      {
        kind: "drawer", key: "details", row: 8, rows: 2, children: [
          { key: "large", analysisId: "AN-I18", family: "ranking", window: "month-to-date", titled: false },
          { key: "change", analysisId: "AN-A17", family: "diverging", window: "month-to-date", titled: true },
          { key: "weekday", analysisId: "AN-I13", family: "bar", window: "last-4-weeks", titled: false },
        ],
      },
      // C1–4 / R10–11 本月收支：趋势图 + 收入、支出、差额
      { kind: "card", key: "month", row: 10, ...full, rows: 2, template: "T4", slots: [["AN-I11", "flow-bars"], ["AN-B02", "number"], ["AN-B01", "number"], ["AN-B03", "number"]], window: "month-to-date", titled: true },
      // C1–4 / R12–13 每周支出：最近 4 周的周度对比柱状图
      { kind: "card", key: "weeks", row: 12, ...full, rows: 2, template: "single", slots: [["AN-I08", "bar"]], window: "last-4-weeks", titled: true },
    ],
  },
  {
    id: "advanced",
    rows: 14,
    modules: [
      // C1–4 / R1–2 月度收支概览：收入、支出、差额、收支比例（四数字）
      { kind: "card", key: "overview", row: 1, ...full, rows: 2, template: "T2", slots: [["AN-B02", "number"], ["AN-B01", "number"], ["AN-B03", "number"], ["AN-B18", "number"]], window: "month-to-date", titled: true },
      // C1–4 / R3–4 六个月收支趋势：多序列折线 + 双数字
      { kind: "card", key: "trend", row: 3, ...full, rows: 2, template: "T3", slots: [["AN-I11", "flow-lines"], ["AN-B03", "number"], ["AN-B19", "number"]], window: "last-6-months", titled: true },
      // C1–4 / R5–6 支出变化来源：分类变化排行 + 双数字
      { kind: "card", key: "sources", row: 5, ...full, rows: 2, template: "T3", slots: [["AN-A17", "diverging"], ["AN-A01", "number"], ["AN-B01", "number"]], window: "month-to-date", titled: true },
      // C1–2 / R7 最大单笔支出；C3–4 / R7 前三分类占比（A08；标题用分析自身名称）
      { kind: "card", key: "largest", row: 7, ...left, rows: 1, template: "single", slots: [["AN-B09", "extreme"]], window: "month-to-date", titled: false },
      { kind: "card", key: "concentration", row: 7, ...right, rows: 1, template: "single", slots: [["AN-A08", "number"]], window: "month-to-date", titled: false },
      // C1–4 / R8–9 消费规律（横向滑动抽屉）：消费日历热力图、星期规律、支付方式构成
      {
        kind: "drawer", key: "patterns", row: 8, rows: 2, children: [
          { key: "calendar", analysisId: "AN-I12", family: "heatmap", window: "month-to-date", titled: false },
          { key: "weekday", analysisId: "AN-I13", family: "bar", window: "last-6-months", titled: false },
          { key: "payment", analysisId: "AN-I17", family: "donut", window: "month-to-date", titled: false },
        ],
      },
      // C1–4 / R10–11 交易金额分布：直方图 + 中位数、P90
      { kind: "card", key: "distribution", row: 10, ...full, rows: 2, template: "T3", slots: [["AN-A09", "histogram"], ["AN-B08", "number"], ["AN-A10", "p90"]], window: "last-6-months", titled: true },
      // C1–4 / R12–13 月内累计支出比较：双趋势 + 摘要
      { kind: "card", key: "cumulative", row: 12, ...full, rows: 2, template: "T3", slots: [["AN-A01", "cumulative-compare"], ["AN-B01", "number"], ["AN-A01", "number"]], window: "month-to-date", titled: true },
      // C1–4 / R14 本期重点变化：两条简短分析观察
      { kind: "card", key: "highlights", row: 14, ...full, rows: 1, template: "single", slots: [["AN-A06", "insights"]], window: "month-to-date", titled: true },
    ],
  },
  {
    id: "professional",
    rows: 16,
    modules: [
      // C1–4 / R1–2 专业统计摘要：总收入、总支出、差额、P90（多数字）
      { kind: "card", key: "summary", row: 1, ...full, rows: 2, template: "T2", slots: [["AN-B02", "number"], ["AN-B01", "number"], ["AN-B03", "number"], ["AN-A10", "p90"]], window: "last-12-months", titled: true },
      // C1–4 / R3–4 十二个月趋势：多序列折线 + 移动平均
      { kind: "card", key: "trend", row: 3, ...full, rows: 2, template: "T5", slots: [["AN-I11", "flow-lines"], ["AN-A14", "line"]], window: "last-12-months", titled: true },
      // C1–4 / R5–6 分类变化贡献：瀑布图 + 摘要（上一个完整月对比再上一个月）
      { kind: "card", key: "contribution", row: 5, ...full, rows: 2, template: "T3", slots: [["AN-P22", "waterfall"], ["AN-A01", "number"], ["AN-B01", "number"]], window: "previous-month", titled: true },
      // C1–4 / R7–9 支出分布与离群分析：直方图 + 箱线图 + 多数字
      { kind: "card", key: "outliers", row: 7, ...full, rows: 3, template: "T8", slots: [["AN-A09", "histogram"], ["AN-A10", "boxplot"], ["AN-B08", "number"], ["AN-A10", "p90"]], window: "last-12-months", titled: true },
      // C1–4 / R10–11 时间与结构分析（横向滑动抽屉）：时间分布热力图、分类 × 月份矩阵、季节性比较
      {
        kind: "drawer", key: "structure", row: 10, rows: 2, children: [
          { key: "calendar", analysisId: "AN-P15", family: "calendar-year", window: "last-12-months", titled: false },
          { key: "matrix", analysisId: "AN-P01", family: "matrix", window: "last-12-months", titled: false },
          { key: "seasonal", analysisId: "AN-A18", family: "line", window: "last-12-months", titled: false },
        ],
      },
      // C1–4 / R12–13 支出结构流向：桑基（支出总额 → 分类）
      { kind: "card", key: "flow", row: 12, ...full, rows: 2, template: "single", slots: [["AN-P06", "sankey"]], window: "last-12-months", titled: true },
      // C1–4 / R14–15 交易频率与金额关系：气泡图 + 摘要
      { kind: "card", key: "frequency", row: 14, ...full, rows: 2, template: "T3", slots: [["AN-P11", "bubble"], ["AN-B04", "number"], ["AN-B07", "number"]], window: "last-12-months", titled: true },
      // C1–2 / R16 数据完整性；C3–4 / R16 汇率覆盖情况
      { kind: "card", key: "completeness", row: 16, ...left, rows: 1, template: "single", slots: [["AN-P16", "status"]], window: "last-12-months", titled: false },
      { kind: "card", key: "coverage", row: 16, ...right, rows: 1, template: "single", slots: [["AN-P19", "status"]], window: "last-12-months", titled: false },
    ],
  },
];

export function systemPresetSpec(id: SystemPresetId): SystemPresetSpec {
  return SYSTEM_PRESETS.find((preset) => preset.id === id)!;
}

/** 4 列逻辑网格 → 工作台 2 列主网格：列减半，行不变。 */
function geometryFor(row: number, col: 1 | 3, cols: 2 | 4, rows: number): { readonly anchor: number; readonly size: GridSize } {
  const baseCol = col === 1 ? 1 : 2;
  return { anchor: (row - 1) * 2 + baseCol, size: { colSpan: cols / 2, rowSpan: rows } };
}

/**
 * 生成系统预设的两份文档（标题按当前界面语言写入；之后切换语言不会改写已应用的卡片标题，与自定义卡片一致）。
 * 对象 ID 带预设前缀，仅用于预览；应用时 `reidentify` 一律换成新 ID。
 */
export function buildSystemPreset(id: SystemPresetId, t: Translate): WorkbenchDocuments {
  const spec = systemPresetSpec(id);
  const cards: AnalysisCardNode[] = [];
  const containers: ContainerNode[] = [];
  const objects: ObjectGeometry[] = [];
  // 卡片名称有长度上限（`CUSTOM_NAME_MAX`）；某种语言的译文偶然超长时截断，而不是让整个默认工作台生成失败。
  const titleOf = (key: string) => Array.from(t(`statsWorkbench.presets.modules.${id}.${key}`).trim()).slice(0, CUSTOM_NAME_MAX).join("");
  for (const module of spec.modules) {
    if (module.kind === "card") {
      const objectId = `preset-${id}-${module.key}`;
      const card = buildCard(
        {
          template: module.template,
          slots: module.slots.map(([analysisId, family], index) => ({ id: `s${String(index + 1)}`, analysisId, family })),
          name: module.titled ? titleOf(module.key) : "",
          window: module.window,
        },
        undefined,
        objectId,
      );
      if (card === null) throw new Error(`preset ${id}/${module.key} is not a valid card`);
      cards.push(card);
      const { anchor, size } = geometryFor(module.row, module.col, module.cols, module.rows);
      objects.push({ objectId, objectType: "analysis-card", anchor, colSpan: size.colSpan, rowSpan: size.rowSpan });
      continue;
    }
    const containerId = `preset-${id}-${module.key}`;
    const childIds: string[] = [];
    for (const child of module.children) {
      const objectId = `${containerId}-${child.key}`;
      const card = buildCard(
        { template: "single", slots: [{ id: "s1", analysisId: child.analysisId, family: child.family }], name: child.titled ? titleOf(`${module.key}.${child.key}`) : "", window: child.window },
        undefined,
        objectId,
      );
      if (card === null) throw new Error(`preset ${id}/${module.key}/${child.key} is not a valid card`);
      cards.push(card);
      childIds.push(objectId);
    }
    const carousel: CarouselNode = { objectId: containerId, type: "carousel", children: childIds };
    containers.push(carousel);
    const { anchor, size } = geometryFor(module.row, 1, 4, module.rows);
    objects.push({ objectId: containerId, objectType: "carousel", anchor, colSpan: size.colSpan, rowSpan: size.rowSpan });
  }
  const content: WorkbenchContentDocumentV1 = { schemaVersion: 1, cards, containers };
  const layout: LayoutDocumentV1 = { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 2, objects } };
  return { content, layout };
}

// ---------------------------------------------------------------------------
// 应用：整份文档换新 ID（布局对象 ID 永不复用）
// ---------------------------------------------------------------------------

/** 把文档里所有卡片、容器、留白的 ID 换成新 ID，引用关系同步更新。结构与配置原样保留。 */
export function reidentify(documents: WorkbenchDocuments, makeId: (prefix: "card" | "box" | "gap") => string = newObjectId): WorkbenchDocuments {
  const map = new Map<string, string>();
  for (const card of documents.content.cards) map.set(card.objectId, makeId("card"));
  for (const container of documents.content.containers) map.set(container.objectId, makeId("box"));
  for (const object of documents.layout.main.objects) if (!map.has(object.objectId)) map.set(object.objectId, makeId(object.objectType === "spacer" ? "gap" : object.objectType === "analysis-card" ? "card" : "box"));
  for (const geometry of [...(documents.layout.profiles ?? []).map(profile => profile.geometry), ...(documents.layout.previousMain ? [documents.layout.previousMain] : [])]) {
    for (const object of geometry.objects) if (!map.has(object.objectId)) map.set(object.objectId, makeId(object.objectType === "spacer" ? "gap" : object.objectType === "analysis-card" ? "card" : "box"));
  }
  const remap = (id: string) => map.get(id) ?? id;
  const remapGeometry = (geometry: LayoutDocumentV1["main"]): LayoutDocumentV1["main"] => ({ ...geometry, objects: geometry.objects.map(object => ({ ...object, objectId: remap(object.objectId) })) });
  return {
    content: {
      ...documents.content,
      cards: documents.content.cards.map((card) => ({ ...card, objectId: remap(card.objectId) })),
      containers: documents.content.containers.map((container) => ({ ...container, objectId: remap(container.objectId), children: container.children.map(remap) })),
    },
    layout: {
      ...documents.layout,
      main: { ...documents.layout.main, objects: documents.layout.main.objects.map((object) => ({ ...object, objectId: remap(object.objectId) })) },
      ...(documents.layout.profiles ? { profiles: documents.layout.profiles.map(profile => ({ ...profile, geometry: remapGeometry(profile.geometry) })) } : {}),
      ...(documents.layout.previousMain ? { previousMain: remapGeometry(documents.layout.previousMain) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// 我的预设：本机、按账号
// ---------------------------------------------------------------------------

export const MAX_USER_PRESETS = 10;
export const PRESET_NAME_MAX = 20;
export const PRESET_DESCRIPTION_MAX = 60;
const STORE_VERSION = 1;

export interface UserPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly documents: WorkbenchDocuments;
  /**
   * 保存时的筛选条件（地址栏参数串，与 `readFilters` / `writeFilters` 同一契约；默认筛选是空串）；应用时由用户
   * 选择是否一起使用。`null` = 保存时没有选择保存筛选（与「保存了默认筛选」不同）。
   */
  readonly filters: string | null;
}

/** 读出来但无法使用的记录（损坏或来自更新版本）：原样保留，界面只允许删除。 */
export interface UnreadablePreset {
  readonly id: string;
  readonly name: string;
  readonly unreadable: true;
}

export interface PresetStore {
  readonly presets: readonly UserPreset[];
  readonly unreadable: readonly UnreadablePreset[];
  /** 存储本身读不出来（例如来自更新版本）：此时不写，避免覆盖。 */
  readonly locked: boolean;
}

export function presetStorageKey(accountScope: string): string {
  return `${LIBEVRA_KEY_PREFIX}stats-workbench-presets:v1:${accountScope}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRaw(accountScope: string): { readonly items: readonly unknown[]; readonly locked: boolean } {
  const store = storage();
  if (store === null) return { items: [], locked: false };
  let raw: string | null;
  try {
    raw = store.getItem(presetStorageKey(accountScope));
  } catch {
    return { items: [], locked: true };
  }
  if (raw === null) return { items: [], locked: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed["v"] !== STORE_VERSION || parsed["userId"] !== accountScope || !Array.isArray(parsed["items"])) return { items: [], locked: true };
    return { items: parsed["items"], locked: false };
  } catch {
    return { items: [], locked: true };
  }
}

function asPreset(item: unknown): UserPreset | UnreadablePreset | null {
  if (!isRecord(item) || typeof item["id"] !== "string") return null;
  const name = typeof item["name"] === "string" ? item["name"] : "";
  const documents = item["documents"];
  if (!isRecord(documents) || !isRecord(documents["content"]) || !isRecord(documents["layout"])) return { id: item["id"], name, unreadable: true };
  // 与工作台同一套 D 正式迁移链与校验：不合法（损坏、来自更新版本）就只读保留，不拿去应用。
  let candidate: WorkbenchDocuments;
  try {
    const content = migrateContentDocument(documents["content"]);
    const layout = migrateLayoutDocument(documents["layout"]);
    if (!content.ok || content.status === "read-only-newer" || content.value === undefined || !layout.ok || layout.status === "read-only-newer" || layout.value === undefined) {
      return { id: item["id"], name, unreadable: true };
    }
    candidate = { content: content.value, layout: layout.value };
    if (documentsProblems(candidate).length > 0) return { id: item["id"], name, unreadable: true };
  } catch {
    return { id: item["id"], name, unreadable: true };
  }
  return {
    id: item["id"],
    name,
    description: typeof item["description"] === "string" ? item["description"] : "",
    createdAt: typeof item["createdAt"] === "string" ? item["createdAt"] : "",
    updatedAt: typeof item["updatedAt"] === "string" ? item["updatedAt"] : "",
    documents: candidate,
    filters: typeof item["filters"] === "string" ? item["filters"] : null,
  };
}

export function loadPresets(accountScope: string | null): PresetStore {
  if (accountScope === null) return { presets: [], unreadable: [], locked: true };
  const { items, locked } = readRaw(accountScope);
  const presets: UserPreset[] = [];
  const unreadable: UnreadablePreset[] = [];
  for (const item of items) {
    const preset = asPreset(item);
    if (preset === null) continue;
    if ("unreadable" in preset) unreadable.push(preset);
    else presets.push(preset);
  }
  return { presets, unreadable, locked };
}

export type PresetWriteProblem = "locked" | "full" | "name" | "invalid" | "storage" | "missing";

/** 改写整个列表（读出的原始项里认不出的保持原样），失败时不写入任何东西。 */
function writeItems(accountScope: string, update: (items: readonly unknown[]) => readonly unknown[] | PresetWriteProblem): PresetWriteProblem | null {
  const store = storage();
  if (store === null) return "storage";
  const { items, locked } = readRaw(accountScope);
  if (locked) return "locked";
  const next = update(items);
  if (typeof next === "string") return next;
  try {
    store.setItem(presetStorageKey(accountScope), JSON.stringify({ v: STORE_VERSION, userId: accountScope, items: next }));
    notifyWorkbenchChange(accountScope);
    return null;
  } catch {
    return "storage";
  }
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed === "" || trimmed.length > PRESET_NAME_MAX ? null : trimmed;
}

function newPresetId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `preset-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 新建（或另存为）：保存一份工作台快照与筛选条件。返回新预设，或失败原因。 */
export function createPreset(accountScope: string, input: { readonly name: string; readonly description: string; readonly documents: WorkbenchDocuments; readonly filters: string | null }, now = new Date()): UserPreset | PresetWriteProblem {
  const name = cleanName(input.name);
  if (name === null) return "name";
  if (documentsProblems(input.documents).length > 0) return "invalid";
  const stamp = now.toISOString();
  const preset: UserPreset = {
    id: newPresetId(),
    name,
    description: input.description.trim().slice(0, PRESET_DESCRIPTION_MAX),
    createdAt: stamp,
    updatedAt: stamp,
    documents: structuredClone(input.documents),
    filters: input.filters,
  };
  const problem = writeItems(accountScope, (items) => (items.length >= MAX_USER_PRESETS ? "full" : [...items, preset]));
  return problem ?? preset;
}

/** 重命名 / 改说明。 */
export function renamePreset(accountScope: string, id: string, input: { readonly name: string; readonly description: string }, now = new Date()): PresetWriteProblem | null {
  const name = cleanName(input.name);
  if (name === null) return "name";
  return writeItems(accountScope, (items) => {
    if (!items.some((item) => isRecord(item) && item["id"] === id)) return "missing";
    return items.map((item) => (isRecord(item) && item["id"] === id ? { ...item, name, description: input.description.trim().slice(0, PRESET_DESCRIPTION_MAX), updatedAt: now.toISOString() } : item));
  });
}

/** 明确用当前工作台更新已有预设（之前的工作台改动不会自动写进预设）。 */
export function updatePresetDocuments(accountScope: string, id: string, documents: WorkbenchDocuments, filters: string | null, now = new Date()): PresetWriteProblem | null {
  if (documentsProblems(documents).length > 0) return "invalid";
  return writeItems(accountScope, (items) => {
    if (!items.some((item) => isRecord(item) && item["id"] === id)) return "missing";
    return items.map((item) => (isRecord(item) && item["id"] === id ? { ...item, documents: structuredClone(documents), filters, updatedAt: now.toISOString() } : item));
  });
}

/** 删除预设：只删这一条，不动工作台、卡片定义与账本。 */
export function deletePreset(accountScope: string, id: string): PresetWriteProblem | null {
  return writeItems(accountScope, (items) => items.filter((item) => !(isRecord(item) && item["id"] === id)));
}
