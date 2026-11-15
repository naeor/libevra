/**
 * **电脑版总览的保存**（1.19.100 起）：总览与分析工作台共用同一种工作台文档（内容 + 布局，由 D 的正式管线校验），
 * 卡片里既有分析卡片，也有总览卡片（`DB-` 编号，见 `statsWorkbench/nativeCards.ts`）。
 *
 * - 本机、按身份（`user:<id>` / `guest:<id>`）：`libevra.desktop.dashboard:v2:<身份>`。
 * - 记录里是「总览页」列表（本版只有一页）、保存时已知的账本，以及版本号（两个窗口同时编辑时，后保存的那个
 *   发现版本变了就不覆盖）。
 * - **账本变化不改写保存的布局**：读取时派生——新账本（保存时还没有的）自动在末尾补一张账本卡片；已经不在的
 *   账本（退出、归档、删除）的账本卡片不显示。用户在编辑里点「完成」时才把当时看到的样子存下来。
 * - 第一次读取时，把 1.18.12–1.19.99 的旧总览配置（`…:v1:<身份>`）转成新格式；旧记录原样保留，不删除。
 * - 没有保存过时显示默认总览（按当前账本生成，对象 id 固定）；「恢复默认」后没再改动就点「完成」，删除自己的
 *   记录，继续跟随默认（以后新账本照样出现）。
 */
import {
  findEarliestFreeAnchor,
  LAYOUT_SCHEMA_VERSION,
  placementCells,
  type AnalysisCardNode,
  type ContainerNode,
  type GridSize,
  type LayoutDocumentV1,
  type ObjectGeometry,
  type WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";
import { configurationFingerprint } from "@libellum/shared/workbench/configuration";
import { STATS_RANGES, type StatsRangeKey } from "@libellum/shared";

import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import { cardSizing } from "../statsWorkbench/composition.js";
import { newObjectId } from "../statsWorkbench/defaults.js";
import { cardSourceBook, isNativeCard, nativeKindOf, nativeOptions, nativeSizing, nativeSpec, newNativeCard, withCardSource, withNativeOptions, type NativeKind, type NativeOptions } from "../statsWorkbench/nativeCards.js";
import { command, lastRow, removeObject, startSession, sessionDocuments } from "../statsWorkbench/session.js";
import type { TimeChoice } from "../statsWorkbench/filters.js";
import { documentsProblems, type Stored, type WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { dashboardGeometry, parseDashboard, resolveDashboard, type DashboardCard } from "./dashboardModel.js";

export const DASHBOARD_RECORD_VERSION = 2;
export const DASHBOARD_INSTALLED = "libevra-dashboard-installed";
/** 默认总览与旧配置迁移用的基础列数（显示时按实际宽度自动排列，见 S18 响应式布局引擎）。 */
export const DASHBOARD_BASE_COLUMNS = 4;
const MAX_OBJECTS = 40;

export function dashboardStorageKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard:v2:${owner}`;
}

export function legacyDashboardStorageKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard:v1:${owner}`;
}

export interface DashboardPage {
  readonly id: string;
  /** 页面名称；第一页可以为空（显示为「总览」）。 */
  readonly name: string;
  readonly documents: WorkbenchDocuments;
  /**
   * 1.19.102（候选清单 B4）：`per-book` = 「每本账一组」——编辑的是一组卡片（模板），浏览时按总览范围里的每本账
   * 各排一组（数据来自那本账；新账本自动多一组）。
   */
  readonly kind?: "per-book";
}

export interface DashboardRecord {
  readonly v: typeof DASHBOARD_RECORD_VERSION;
  readonly owner: string;
  readonly version: number;
  readonly pages: readonly DashboardPage[];
  readonly activePage: string;
  /** 保存时已知的账本：之后出现的新账本在读取时自动补一张账本卡片。 */
  readonly knownBooks: readonly string[];
  readonly updatedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 文档的建立
// ---------------------------------------------------------------------------

function emptyLayout(baseCols: number, objects: readonly ObjectGeometry[]): LayoutDocumentV1 {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols, objects } };
}

/** 按顺序把卡片放进 `baseCols` 列的网格（每张放到最靠前的空位）。 */
export function packCards(cards: readonly { readonly card: AnalysisCardNode; readonly size: GridSize }[], baseCols = DASHBOARD_BASE_COLUMNS): WorkbenchDocuments {
  const occupied = new Set<number>();
  const objects: ObjectGeometry[] = [];
  const kept: AnalysisCardNode[] = [];
  for (const { card, size } of cards.slice(0, MAX_OBJECTS)) {
    const fitted = { colSpan: Math.min(size.colSpan, baseCols), rowSpan: size.rowSpan };
    const anchor = findEarliestFreeAnchor(occupied, fitted, baseCols);
    if (anchor === null || anchor === undefined) continue;
    placementCells(anchor, fitted, baseCols).forEach((cell) => occupied.add(cell));
    objects.push({ objectType: "analysis-card", objectId: card.objectId, anchor, ...fitted });
    kept.push(card);
  }
  const content: WorkbenchContentDocumentV1 = { schemaVersion: 1, cards: kept, containers: [] };
  return { content, layout: emptyLayout(baseCols, objects.sort((a, b) => a.anchor - b.anchor)) };
}

function native(kind: NativeKind, objectId: string, options: NativeOptions = {}): AnalysisCardNode {
  return newNativeCard(kind, objectId, options);
}

/**
 * 默认总览：只有一本账时，账本卡片与最近账目并排，下面是支出趋势与待处理；多本账时先排各账本卡片，
 * 再放多账本收支、趋势、最近账目与待处理。快捷操作在右侧栏，不在网格里。对象 id 固定（判断「是不是默认」靠它）。
 */
export function defaultDashboardDocuments(bookIds: readonly string[]): WorkbenchDocuments {
  const single = bookIds.length <= 1;
  const ledgerSize: GridSize = single ? { colSpan: 2, rowSpan: 3 } : bookIds.length <= 4 ? { colSpan: 2, rowSpan: 2 } : { colSpan: 1, rowSpan: 2 };
  const ledgers = bookIds.map((bookId) => ({ card: native("ledger", `dash-ledger-${bookId}`, { bookId }), size: ledgerSize }));
  const rest = single
    ? [
        { card: native("recent", "dash-recent"), size: { colSpan: 2, rowSpan: 3 } },
        { card: native("trend", "dash-trend"), size: { colSpan: 4, rowSpan: 2 } },
        { card: native("pending", "dash-pending"), size: { colSpan: 2, rowSpan: 1 } },
      ]
    : [
        { card: native("cross", "dash-cross"), size: { colSpan: 2, rowSpan: 2 } },
        { card: native("recent", "dash-recent"), size: { colSpan: 2, rowSpan: 3 } },
        { card: native("trend", "dash-trend"), size: { colSpan: 4, rowSpan: 2 } },
        { card: native("pending", "dash-pending"), size: { colSpan: 2, rowSpan: 1 } },
      ];
  return packCards([...ledgers, ...rest]);
}

function fingerprint(documents: WorkbenchDocuments): string {
  return configurationFingerprint({ schemaVersion: 1, workspace: documents, presets: [] });
}

export function isDefaultDashboard(documents: WorkbenchDocuments, bookIds: readonly string[]): boolean {
  try {
    return fingerprint(documents) === fingerprint(defaultDashboardDocuments(bookIds));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 旧版（1.18.12–1.19.99）总览配置的迁移
// ---------------------------------------------------------------------------

function legacyCard(card: DashboardCard): AnalysisCardNode | null {
  switch (card.kind) {
    case "ledger":
      return card.bookId === undefined ? null : native("ledger", card.id, {
        bookId: card.bookId,
        ...(card.metric === undefined ? {} : { metric: card.metric }),
        ...(card.showTrend === undefined ? {} : { showTrend: card.showTrend }),
        ...(card.showRecent === undefined ? {} : { showRecent: card.showRecent }),
      });
    case "cross":
    case "trend":
    case "recent":
    case "pending":
      return native(card.kind, card.id);
    case "quick":
      // 快捷操作早已固定在右侧栏，不进网格。
      return null;
  }
}

/** 旧配置 → 新文档：卡片与尺寸、位置照搬（旧的几何本来就是 S17 的占格），隐藏的卡片不放（卡片库里可以再加）。 */
export function migrateLegacyDashboard(raw: unknown, bookIds: readonly string[]): WorkbenchDocuments | null {
  const parsed = parseDashboard(raw);
  if (parsed === null) return null;
  const config = resolveDashboard(parsed, bookIds);
  const crossScope = config.crossScope;
  const cards = config.cards
    .filter((card) => card.hidden !== true)
    .map((card) => {
      const node = legacyCard(card);
      if (node === null || card.kind !== "cross" || crossScope === "all") return node;
      return native("cross", card.id, { books: crossScope });
    })
    .filter((card): card is AnalysisCardNode => card !== null);
  const columns = config.layout?.baseCols ?? DASHBOARD_BASE_COLUMNS;
  const geometry = dashboardGeometry({ ...config, cards: config.cards.filter((card) => card.hidden !== true && card.kind !== "quick") }, columns);
  const known = new Set(cards.map((card) => card.objectId));
  const objects = geometry.objects.filter((object) => known.has(object.objectId));
  const documents: WorkbenchDocuments = {
    content: { schemaVersion: 1, cards: cards.filter((card) => objects.some((object) => object.objectId === card.objectId)), containers: [] },
    layout: emptyLayout(geometry.baseCols, objects),
  };
  return documentsProblems(documents).length === 0 ? documents : null;
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is DashboardRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<DashboardRecord>;
  return record.v === DASHBOARD_RECORD_VERSION && typeof record.owner === "string" && Number.isSafeInteger(record.version) &&
    Array.isArray(record.pages) && record.pages.length > 0 && typeof record.activePage === "string" && Array.isArray(record.knownBooks);
}

export type DashboardLoad =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly record: DashboardRecord }
  | { readonly status: "unreadable"; readonly version: number };

export function loadDashboardRecord(owner: string): DashboardLoad {
  const store = storage();
  if (store === null) return { status: "missing" };
  let raw: string | null;
  try {
    raw = store.getItem(dashboardStorageKey(owner));
  } catch {
    return { status: "missing" };
  }
  if (raw === null) return { status: "missing" };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.owner !== owner) return { status: "unreadable", version: 0 };
    for (const page of value.pages) {
      if (typeof page?.id !== "string" || documentsProblems(page.documents).length > 0) return { status: "unreadable", version: value.version };
    }
    return { status: "ok", record: value };
  } catch {
    return { status: "unreadable", version: 0 };
  }
}

/** 旧配置第一次读取时转成新记录并写入（旧记录不动）；转不出来就当作没有保存过。 */
function migrateIfNeeded(owner: string, bookIds: readonly string[]): void {
  const store = storage();
  if (store === null) return;
  try {
    if (store.getItem(dashboardStorageKey(owner)) !== null) return;
    const legacy = store.getItem(legacyDashboardStorageKey(owner));
    if (legacy === null || bookIds.length === 0) return;
    const documents = migrateLegacyDashboard(JSON.parse(legacy) as unknown, bookIds);
    if (documents === null) return;
    const record: DashboardRecord = {
      v: DASHBOARD_RECORD_VERSION,
      owner,
      version: 1,
      pages: [{ id: "main", name: "", documents }],
      activePage: "main",
      knownBooks: [...bookIds],
      updatedAt: new Date().toISOString(),
    };
    store.setItem(dashboardStorageKey(owner), JSON.stringify(record));
  } catch {
    // 迁移失败不影响显示：按没有保存过处理。
  }
}

function pageOf(record: DashboardRecord, pageId: string | undefined): DashboardPage {
  return (record.pages.find((page) => page.id === pageId) ?? record.pages[0])!;
}

/**
 * 读取时按当前账本派生（不写回）：已经不在的账本的账本卡片不显示；保存之后新出现的账本自动补一张账本卡片。
 */
export function adaptToBooks(documents: WorkbenchDocuments, bookIds: readonly string[], knownBooks: readonly string[], allBooks: readonly string[] = bookIds): WorkbenchDocuments {
  // 不显示的只有真正不在的账本；「统计设置」里没选进范围的账本，已有的账本卡片照常显示，只是不自动补新的。
  const present = new Set(allBooks);
  let state = startSession(documents);
  for (const card of documents.content.cards) {
    if (nativeKindOf(card) !== "ledger") continue;
    const bookId = nativeOptions(card).bookId;
    if (bookId !== undefined && !present.has(bookId)) {
      const result = removeObject(state, card.objectId);
      if (result.ok) state = result.state;
    }
  }
  const known = new Set(knownBooks);
  const withCard = new Set(state.content.cards.filter((card) => nativeKindOf(card) === "ledger").map((card) => nativeOptions(card).bookId));
  for (const bookId of bookIds) {
    if (known.has(bookId) || withCard.has(bookId)) continue;
    const card = native("ledger", `dash-ledger-${bookId}`, { bookId });
    if (state.content.cards.some((item) => item.objectId === card.objectId)) continue;
    const size = nativeSizing("ledger").defaultSize;
    const result = command(state, { type: "insert-card", card, size: { colSpan: Math.min(size.colSpan, state.layout.main.baseCols), rowSpan: size.rowSpan }, collisionPolicy: "reflow" });
    if (result.ok) state = result.state;
  }
  return sessionDocuments(state);
}

/**
 * 工作台宿主的 `readStored`：没有保存过 → 默认总览；读不出来 → 默认总览并标明（原记录不动）。
 * `pageId`：要看的总览页（缺省或已不在 = 第一页）。新账本自动补卡片只在第一页（普通页）；「每本账一组」页
 * 返回模板本身，浏览时再按账本展开（`expandPerBook`）。
 */
export function readDashboard(owner: string | null, bookIds: readonly string[], allBooks: readonly string[] = bookIds, pageId?: string): Stored {
  if (owner === null) return { accountScope: owner, documents: defaultDashboardDocuments(bookIds), version: 0, unreadable: false };
  migrateIfNeeded(owner, allBooks);
  const outcome = loadDashboardRecord(owner);
  if (outcome.status === "ok") {
    const page = pageOf(outcome.record, pageId);
    const first = page === outcome.record.pages[0];
    const documents = page.kind === "per-book" ? page.documents : first ? adaptToBooks(page.documents, bookIds, outcome.record.knownBooks, allBooks) : adaptToBooks(page.documents, [], [], allBooks);
    return { accountScope: owner, documents, version: outcome.record.version, unreadable: false };
  }
  return { accountScope: owner, documents: defaultDashboardDocuments(bookIds), version: outcome.status === "unreadable" ? outcome.version : 0, unreadable: outcome.status === "unreadable" };
}

function currentVersion(store: Storage, owner: string): number | null {
  const raw = store.getItem(dashboardStorageKey(owner));
  if (raw === null) return 0;
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) && value.owner === owner ? value.version : null;
  } catch {
    return null;
  }
}

function writeRecord(store: Storage, record: DashboardRecord): void {
  const key = dashboardStorageKey(record.owner);
  const old = store.getItem(key);
  if (old !== null) store.setItem(`${key}:previous`, old);
  store.setItem(key, JSON.stringify(record));
}

/** 保存一页的文档；本机记录已被别的窗口改过（版本不同）、损坏或文档不合法时不写，返回 `null`。 */
export function saveDashboard(owner: string, documents: WorkbenchDocuments, previousVersion: number, bookIds: readonly string[], pageId?: string): number | null {
  const store = storage();
  if (store === null || documentsProblems(documents).length > 0) return null;
  try {
    const version = currentVersion(store, owner);
    if (version === null || version !== previousVersion) return null;
    const outcome = loadDashboardRecord(owner);
    const previous = outcome.status === "ok" ? outcome.record : null;
    const target = previous === null ? "main" : pageOf(previous, pageId).id;
    const pages = previous === null ? [{ id: "main", name: "", documents }] : previous.pages.map((page) => (page.id === target ? { ...page, documents } : page));
    writeRecord(store, {
      v: DASHBOARD_RECORD_VERSION,
      owner,
      version: previousVersion + 1,
      pages,
      activePage: previous?.activePage ?? "main",
      knownBooks: [...new Set([...(previous?.knownBooks ?? []), ...bookIds])],
      updatedAt: new Date().toISOString(),
    });
    return previousVersion + 1;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 多页总览（1.19.102，候选清单 B2）
// ---------------------------------------------------------------------------

export const MAX_PAGES = 8;
export const PAGE_NAME_MAX = 12;

export interface PageSummary {
  readonly id: string;
  readonly name: string;
  readonly kind?: "per-book";
}

export function listPages(owner: string | null): readonly PageSummary[] {
  if (owner === null) return [{ id: "main", name: "" }];
  const outcome = loadDashboardRecord(owner);
  if (outcome.status !== "ok") return [{ id: "main", name: "" }];
  return outcome.record.pages.map((page) => ({ id: page.id, name: page.name, ...(page.kind === undefined ? {} : { kind: page.kind }) }));
}

/** 改页面列表（新建、改名、删除、换位）：读当前记录、改、版本 +1。没有保存过时先按默认总览建一份记录。 */
function editPages(owner: string, bookIds: readonly string[], change: (pages: readonly DashboardPage[]) => readonly DashboardPage[] | null): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    migrateIfNeeded(owner, bookIds);
    const outcome = loadDashboardRecord(owner);
    if (outcome.status === "unreadable") return false;
    const previous = outcome.status === "ok" ? outcome.record : null;
    const pages = change(previous?.pages ?? [{ id: "main", name: "", documents: defaultDashboardDocuments(bookIds) }]);
    if (pages === null || pages.length === 0 || pages.length > MAX_PAGES) return false;
    writeRecord(store, {
      v: DASHBOARD_RECORD_VERSION,
      owner,
      version: (previous?.version ?? 0) + 1,
      pages,
      activePage: previous?.activePage ?? "main",
      knownBooks: previous?.knownBooks ?? [...bookIds],
      updatedAt: new Date().toISOString(),
    });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DASHBOARD_INSTALLED, { detail: owner }));
    return true;
  } catch {
    return false;
  }
}

export function createPage(owner: string, bookIds: readonly string[], page: Omit<DashboardPage, "id">): string | null {
  const id = newObjectId("box").replace(/^box-/, "page-");
  const name = page.name.trim().slice(0, PAGE_NAME_MAX);
  if (documentsProblems(page.documents).length > 0) return null;
  return editPages(owner, bookIds, (pages) => [...pages, { ...page, id, name }]) ? id : null;
}

export function renamePage(owner: string, bookIds: readonly string[], pageId: string, name: string): boolean {
  return editPages(owner, bookIds, (pages) => pages.map((page) => (page.id === pageId ? { ...page, name: name.trim().slice(0, PAGE_NAME_MAX) } : page)));
}

export function deletePage(owner: string, bookIds: readonly string[], pageId: string): boolean {
  return editPages(owner, bookIds, (pages) => (pages.length <= 1 ? null : pages.filter((page) => page.id !== pageId)));
}

export function movePage(owner: string, bookIds: readonly string[], pageId: string, delta: -1 | 1): boolean {
  return editPages(owner, bookIds, (pages) => {
    const index = pages.findIndex((page) => page.id === pageId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= pages.length) return null;
    const next = [...pages];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
}

/** 这台设备上正在看的总览页（不同步：两台电脑可以各看各的）。 */
export function dashboardPageKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard-page:v1:${owner}`;
}

export function readActivePage(owner: string | null): string | undefined {
  if (owner === null) return undefined;
  try {
    return storage()?.getItem(dashboardPageKey(owner)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeActivePage(owner: string, pageId: string): void {
  try {
    storage()?.setItem(dashboardPageKey(owner), pageId);
  } catch {
    // 只影响下次打开停在哪一页。
  }
}

/**
 * 「每本账一组」的展开（只用于浏览，不写回）：模板里的卡片按每本账复制一组，上下排开；跟随当前账本的分析卡片、
 * 账本 / 趋势卡片换成那本账，多账本卡片只看那本账。对象 id 加 `@账本`，网格最多 40 个对象，放不下的账本不排。
 */
export function expandPerBook(template: WorkbenchDocuments, bookIds: readonly string[]): WorkbenchDocuments {
  const columns = template.layout.main.baseCols;
  const rows = Math.max(1, lastRow(template.layout));
  const perBlock = Math.max(1, template.layout.main.objects.length);
  const books = bookIds.slice(0, Math.max(1, Math.floor(40 / perBlock)));
  const cards: AnalysisCardNode[] = [];
  const containers: ContainerNode[] = [];
  const objects: ObjectGeometry[] = [];
  books.forEach((bookId, index) => {
    const suffix = (id: string): string => `${id}@${bookId}`;
    for (const card of template.content.cards) {
      const kind = nativeKindOf(card);
      let next: AnalysisCardNode = { ...card, objectId: suffix(card.objectId) };
      if (kind === null) next = cardSourceBook(card) === null ? withCardSource(next, bookId) : next;
      else if (kind === "ledger" || kind === "trend") next = withNativeOptions(next, { ...nativeOptions(card), bookId });
      else if (nativeSpec(kind).multiBook) next = withNativeOptions(next, { ...nativeOptions(card), books: [bookId] });
      cards.push(next);
    }
    for (const container of template.content.containers) containers.push({ ...container, objectId: suffix(container.objectId), children: container.children.map(suffix) });
    for (const object of template.layout.main.objects) objects.push({ ...object, objectId: suffix(object.objectId), anchor: object.anchor + index * rows * columns });
  });
  return {
    content: { ...template.content, cards, containers },
    layout: { schemaVersion: template.layout.schemaVersion, layoutAlgorithmVersion: template.layout.layoutAlgorithmVersion, mode: template.layout.mode, main: { baseCols: columns, objects } },
  };
}

/** 展开后的对象 id → 模板里的对象 id（右键菜单在模板上编辑）。 */
export function templateObjectId(objectId: string): string {
  const at = objectId.lastIndexOf("@");
  return at < 0 ? objectId : objectId.slice(0, at);
}

// ---------------------------------------------------------------------------
// 我的预设（1.19.102，候选清单 E3）：保存几套自己的总览布局。只存布局，不存任何金额；本机。
// ---------------------------------------------------------------------------

export const MAX_DASHBOARD_PRESETS = 10;

export interface DashboardPreset {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly documents: WorkbenchDocuments;
}

export function dashboardPresetsKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard-presets:v1:${owner}`;
}

export function loadDashboardPresets(owner: string | null): readonly DashboardPreset[] {
  if (owner === null) return [];
  try {
    const raw = storage()?.getItem(dashboardPresetsKey(owner));
    if (raw === null || raw === undefined) return [];
    const value = JSON.parse(raw) as { v?: unknown; items?: unknown };
    if (value.v !== 1 || !Array.isArray(value.items)) return [];
    return (value.items as DashboardPreset[]).filter((item) =>
      typeof item?.id === "string" && typeof item.name === "string" && typeof item.createdAt === "string" && documentsProblems(item.documents).length === 0,
    ).slice(0, MAX_DASHBOARD_PRESETS);
  } catch {
    return [];
  }
}

function writePresets(owner: string, items: readonly DashboardPreset[]): boolean {
  try {
    storage()?.setItem(dashboardPresetsKey(owner), JSON.stringify({ v: 1, items }));
    return true;
  } catch {
    return false;
  }
}

export function saveDashboardPreset(owner: string, name: string, documents: WorkbenchDocuments): "ok" | "full" | "name" | "invalid" | "storage" {
  const trimmed = name.trim().slice(0, 20);
  if (trimmed === "") return "name";
  if (documentsProblems(documents).length > 0) return "invalid";
  const items = loadDashboardPresets(owner);
  if (items.length >= MAX_DASHBOARD_PRESETS) return "full";
  return writePresets(owner, [...items, { id: newObjectId("box").replace(/^box-/, "preset-"), name: trimmed, createdAt: new Date().toISOString(), documents }]) ? "ok" : "storage";
}

export function deleteDashboardPreset(owner: string, id: string): boolean {
  return writePresets(owner, loadDashboardPresets(owner).filter((item) => item.id !== id));
}

/** 「恢复默认」后原样保存：删掉自己的记录（原文留在 `:previous`），继续跟随默认总览。 */
export function followDefaultDashboard(owner: string, previousVersion: number): number | null {
  const store = storage();
  if (store === null) return null;
  try {
    const version = currentVersion(store, owner);
    if (version === null || version !== previousVersion) return null;
    const key = dashboardStorageKey(owner);
    const old = store.getItem(key);
    if (old !== null) {
      store.setItem(`${key}:previous`, old);
      store.removeItem(key);
    }
    return 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 总览整体的口径（1.19.100）：时间、范围、统计方式。与布局分开保存：改口径不需要进编辑、不改布局版本。
// ---------------------------------------------------------------------------

export type DashboardTime =
  | { readonly kind: "this-month" }
  | { readonly kind: "last-month" }
  | { readonly kind: "ytd" }
  | { readonly kind: "preset"; readonly preset: StatsRangeKey }
  | { readonly kind: "month"; readonly month: string };

/** 右侧栏可以放的模块（1.19.101，候选清单 D1–D4）。 */
export type SidebarKind = "quick" | "messages" | "pending" | "recent" | "books";
export const SIDEBAR_KINDS: readonly SidebarKind[] = ["quick", "messages", "pending", "recent", "books"];
/** 快捷操作里的五种记账方式（与「记一笔」菜单相同的 id）。 */
export const ENTRY_METHOD_IDS: readonly string[] = ["manual", "paste", "voice", "scan", "import"];

export interface SidebarModule {
  readonly kind: SidebarKind;
  /** 收起只留标题。 */
  readonly collapsed?: boolean;
  /** 快捷操作：显示哪几种、什么顺序（缺省全部，手动在最前）；`iconOnly` 只有图标。 */
  readonly methods?: readonly string[];
  readonly iconOnly?: boolean;
  /** 消息：是否显示账户提醒（邀请等，缺省显示）；最近账目 / 消息：最多几条。 */
  readonly account?: boolean;
  readonly limit?: number;
}

export interface SidebarConfig {
  /** 显示哪些模块、什么顺序；不在里面的模块不显示。 */
  readonly modules: readonly SidebarModule[];
}

export const DEFAULT_SIDEBAR: SidebarConfig = { modules: [{ kind: "quick" }, { kind: "messages" }] };
export const SIDEBAR_LIMITS: readonly number[] = [3, 4, 5, 8, 12];

export function parseSidebar(raw: unknown): SidebarConfig {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { modules?: unknown }).modules)) return DEFAULT_SIDEBAR;
  const seen = new Set<SidebarKind>();
  const modules: SidebarModule[] = [];
  for (const item of (raw as { modules: unknown[] }).modules) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as Record<string, unknown>;
    const kind = value["kind"] as SidebarKind;
    if (!SIDEBAR_KINDS.includes(kind) || seen.has(kind)) continue;
    seen.add(kind);
    const methods = Array.isArray(value["methods"]) ? [...new Set(value["methods"].filter((id): id is string => typeof id === "string" && ENTRY_METHOD_IDS.includes(id)))] : null;
    const limit = value["limit"];
    modules.push({
      kind,
      ...(value["collapsed"] === true ? { collapsed: true } : {}),
      ...(methods === null || methods.length === 0 ? {} : { methods }),
      ...(value["iconOnly"] === true ? { iconOnly: true } : {}),
      ...(value["account"] === false ? { account: false } : {}),
      ...(typeof limit === "number" && SIDEBAR_LIMITS.includes(limit) ? { limit } : {}),
    });
  }
  return { modules };
}

export interface DashboardSettings {
  readonly time: DashboardTime;
  /** 总览范围：「全部账本」类卡片统计哪些账本、新账本是否自动出现。 */
  readonly books: "all" | readonly string[];
  /** 综合折算（按交易日期的历史汇率折算成默认币种）；否则原币按币种分别统计。 */
  readonly combined: boolean;
  readonly sidebar: SidebarConfig;
}

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = { time: { kind: "this-month" }, books: "all", combined: false, sidebar: DEFAULT_SIDEBAR };

export function dashboardSettingsKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard-settings:v1:${owner}`;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseTime(raw: unknown): DashboardTime | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value["kind"]) {
    case "this-month":
    case "last-month":
    case "ytd":
      return { kind: value["kind"] };
    case "preset":
      return (STATS_RANGES as readonly unknown[]).includes(value["preset"]) ? { kind: "preset", preset: value["preset"] as StatsRangeKey } : null;
    case "month":
      return typeof value["month"] === "string" && MONTH.test(value["month"]) ? { kind: "month", month: value["month"] } : null;
    default:
      return null;
  }
}

export function parseDashboardSettings(raw: unknown): DashboardSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_DASHBOARD_SETTINGS;
  const value = raw as Record<string, unknown>;
  const books = value["books"];
  return {
    time: parseTime(value["time"]) ?? DEFAULT_DASHBOARD_SETTINGS.time,
    books: Array.isArray(books) ? books.filter((id): id is string => typeof id === "string" && id !== "") : "all",
    combined: value["combined"] === true,
    sidebar: value["sidebar"] === undefined ? DEFAULT_SIDEBAR : parseSidebar(value["sidebar"]),
  };
}

export function readDashboardSettings(owner: string | null): DashboardSettings {
  if (owner === null) return DEFAULT_DASHBOARD_SETTINGS;
  try {
    const raw = storage()?.getItem(dashboardSettingsKey(owner));
    return raw === null || raw === undefined ? DEFAULT_DASHBOARD_SETTINGS : parseDashboardSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_DASHBOARD_SETTINGS;
  }
}

export function writeDashboardSettings(owner: string, settings: DashboardSettings): boolean {
  try {
    storage()?.setItem(dashboardSettingsKey(owner), JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function previousMonth(month: string): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return value === 1 ? `${String(year - 1)}-12` : `${String(year)}-${String(value - 1).padStart(2, "0")}`;
}

/** 总览的时间 → 工作台的时间条件（按设备当地的「今天」）。「本月」是整个自然月（与 1.18.12 起的总览一致）。 */
export function timeChoiceFor(time: DashboardTime, today: string): TimeChoice {
  const month = today.slice(0, 7);
  switch (time.kind) {
    case "this-month":
      return { kind: "month", month };
    case "last-month":
      return { kind: "month", month: previousMonth(month) };
    case "ytd":
      return { kind: "custom", from: `${today.slice(0, 4)}-01-01`, to: today };
    case "preset":
      return { kind: "preset", preset: time.preset };
    case "month":
      return { kind: "month", month: time.month };
  }
}

/** 总览范围里的账本：`all` = 全部；选的账本都不在了也按全部。 */
export function scopeBooks(settings: DashboardSettings, bookIds: readonly string[]): readonly string[] {
  if (settings.books === "all") return bookIds;
  const chosen = new Set(settings.books);
  const kept = bookIds.filter((id) => chosen.has(id));
  return kept.length === 0 ? bookIds : kept;
}

/** 金额遮罩是这台设备上的显示偏好（办公室、投屏时用），不同步。 */
export function dashboardMaskKey(owner: string): string {
  return `${LIBEVRA_KEY_PREFIX}desktop.dashboard-mask:v1:${owner}`;
}

export function readMask(owner: string | null): boolean {
  if (owner === null) return false;
  try {
    return storage()?.getItem(dashboardMaskKey(owner)) === "on";
  } catch {
    return false;
  }
}

export function writeMask(owner: string, masked: boolean): void {
  try {
    if (masked) storage()?.setItem(dashboardMaskKey(owner), "on");
    else storage()?.removeItem(dashboardMaskKey(owner));
  } catch {
    // 写不进去只影响「记住」，这次照样遮住 / 显示。
  }
}

/**
 * 「固定到总览」（1.19.100）：把分析页的一张卡片复制一份放到总览末尾（新对象 id），数据固定来自当时看的那本账。
 * 与总览编辑同一套版本保护；另一个窗口正在保存时返回 `false`，什么都不写。
 */
export function pinCardToDashboard(owner: string, card: AnalysisCardNode, sourceBookId: string | null, bookIds: readonly string[], allBooks: readonly string[] = bookIds): boolean {
  // 放到这台设备上正在看的那一页；那一页是「每本账一组」时放到第一页（模板里不放固定账本的卡片）。
  const active = readActivePage(owner);
  const pageId = listPages(owner).find((page) => page.id === active && page.kind !== "per-book")?.id;
  const stored = readDashboard(owner, bookIds, allBooks, pageId);
  if (stored.unreadable) return false;
  const copy: AnalysisCardNode = { ...withCardSource(card, sourceBookId), objectId: newObjectId("card") };
  const state = startSession(stored.documents);
  const columns = state.layout.main.baseCols;
  const sizing = cardSizing(copy);
  const size = { colSpan: Math.min(sizing.defaultSize.colSpan, columns), rowSpan: sizing.defaultSize.rowSpan };
  const anchor = lastRow(state.layout) * columns + 1;
  const result = command(state, { type: "insert-card", card: copy, size, anchor, collisionPolicy: "reflow" });
  if (!result.ok) return false;
  const version = saveDashboard(owner, sessionDocuments(result.state), stored.version, bookIds, pageId);
  if (version === null) return false;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DASHBOARD_INSTALLED, { detail: owner }));
  return true;
}

/** 在保存的总览里找一张卡片（分析页右侧辅助栏打开总览上的分析卡片时用）。 */
export function findDashboardCard(owner: string, objectId: string): AnalysisCardNode | undefined {
  const outcome = loadDashboardRecord(owner);
  if (outcome.status !== "ok") return undefined;
  for (const page of outcome.record.pages) {
    const card = page.documents.content.cards.find((item) => item.objectId === objectId);
    if (card !== undefined) return card;
  }
  return undefined;
}

/** 总览里实际用到的账本：账本卡片的账本、分析卡片的来源账本，再加上 `extra`（当前账本、多账本卡片的范围）。 */
export function booksUsedBy(documents: WorkbenchDocuments, extra: readonly string[]): readonly string[] {
  const used = new Set(extra);
  for (const card of documents.content.cards) {
    if (isNativeCard(card)) {
      const options = nativeOptions(card);
      if (options.bookId !== undefined) used.add(options.bookId);
      continue;
    }
    const source = card.chart.options?.["source"];
    if (typeof source === "object" && source !== null && typeof (source as Record<string, unknown>)["bookId"] === "string") used.add((source as Record<string, string>)["bookId"]!);
  }
  return [...used];
}
