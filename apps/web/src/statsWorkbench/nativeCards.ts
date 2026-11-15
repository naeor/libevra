/**
 * **总览专属卡片**（1.19.100）：电脑版总览与分析工作台共用同一套网格、编辑会话与布局文档；总览除了分析卡片，
 * 还有账本、多账本收支、趋势、最近账目、待处理、快捷操作等「总览卡片」。
 *
 * - 它们在布局文档里仍是 `analysis-card` 节点（D 的 schema 不变），`analysisId` 用 `DB-` 前缀，`chartFamily`
 *   固定为 `dashboard`；D 的参数白名单把未知编号当只读占位保留（警告、不是错误），分析工作台从不提供这些卡片。
 * - 卡片自己的选项写在 `chart.options.native`（D 的 `chart.options` 本就是自由对象）；**账本 id 不写进
 *   `analysis.params`**（G-12a 隐私黑名单禁止 `bookId` 之类的键）。
 * - 分析卡片在总览上可以指定数据来自哪一本账：`chart.options.source = { bookId }`；不写就是当前账本。
 * - 尺寸：每种总览卡片声明可选尺寸（「调整尺寸」面板与布局投影的约束都从这里取），卡片按实际像素决定显示多少内容。
 */
import type { AnalysisCardNode, GridSize } from "@libellum/shared/analysis/layout";

import type { useI18n } from "../i18n/index.js";

export const NATIVE_PREFIX = "DB-";
export const NATIVE_FAMILY = "dashboard";

export type NativeKind = "ledger" | "cross" | "trend" | "recent" | "pending" | "quick" | "inbox" | "calendar" | "templates" | "compare";
export type NativeMetric = "expense" | "income" | "balance";

/** `chart.options.native`：总览卡片自己的选项。缺省值见各卡片的说明。 */
export interface NativeOptions {
  /** 账本卡片（必填）、趋势卡片（单本）：对应的账本。 */
  readonly bookId?: string;
  /** 多账本收支、最近账目、月历、对比、待整理：包括哪些账本；缺省或 `"all"` = 总览范围内的全部账本。 */
  readonly books?: "all" | readonly string[];
  /** 账本卡片 / 对比卡片的主要指标（缺省支出）。 */
  readonly metric?: NativeMetric;
  /** 账本卡片：大尺寸下是否显示趋势、最近账目（缺省显示）。 */
  readonly showTrend?: boolean;
  readonly showRecent?: boolean;
}

interface NativeSpec {
  readonly kind: NativeKind;
  readonly defaultSize: GridSize;
  readonly minSize: GridSize;
  /** 「调整尺寸」可选的占格（宽 × 高）。 */
  readonly sizes: readonly GridSize[];
  /** 是否可以选多本账（否则只看一本或跟随当前账本）。 */
  readonly multiBook: boolean;
}

const size = (colSpan: number, rowSpan: number): GridSize => ({ colSpan, rowSpan });

const SPECS: Readonly<Record<NativeKind, NativeSpec>> = {
  ledger: { kind: "ledger", defaultSize: size(2, 2), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(1, 2), size(2, 2), size(3, 2), size(4, 2), size(2, 3), size(3, 3), size(4, 3)], multiBook: false },
  cross: { kind: "cross", defaultSize: size(2, 2), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(2, 2), size(3, 2), size(4, 2), size(2, 3), size(4, 3)], multiBook: true },
  trend: { kind: "trend", defaultSize: size(4, 2), minSize: size(2, 1), sizes: [size(2, 1), size(2, 2), size(3, 2), size(4, 2), size(3, 3), size(4, 3)], multiBook: false },
  recent: { kind: "recent", defaultSize: size(2, 3), minSize: size(2, 1), sizes: [size(2, 1), size(1, 2), size(2, 2), size(2, 3), size(2, 4), size(3, 3), size(3, 4), size(4, 3), size(4, 4)], multiBook: true },
  pending: { kind: "pending", defaultSize: size(2, 1), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(1, 2), size(2, 2)], multiBook: false },
  quick: { kind: "quick", defaultSize: size(2, 1), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(3, 1), size(4, 1), size(1, 2), size(2, 2)], multiBook: false },
  inbox: { kind: "inbox", defaultSize: size(2, 2), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(2, 2), size(2, 3), size(3, 2), size(4, 2)], multiBook: true },
  calendar: { kind: "calendar", defaultSize: size(3, 3), minSize: size(2, 2), sizes: [size(2, 2), size(3, 2), size(3, 3), size(4, 3), size(4, 4), size(2, 3)], multiBook: true },
  templates: { kind: "templates", defaultSize: size(2, 2), minSize: size(1, 1), sizes: [size(1, 1), size(2, 1), size(1, 2), size(2, 2), size(3, 2), size(4, 1), size(4, 2)], multiBook: false },
  compare: { kind: "compare", defaultSize: size(4, 2), minSize: size(2, 1), sizes: [size(2, 1), size(2, 2), size(3, 2), size(4, 2), size(3, 3), size(4, 3)], multiBook: true },
};

export const NATIVE_KINDS: readonly NativeKind[] = ["ledger", "cross", "trend", "recent", "pending", "quick", "inbox", "calendar", "templates", "compare"];

export function nativeAnalysisId(kind: NativeKind): string {
  return `${NATIVE_PREFIX}${kind}`;
}

export function nativeKindOfId(analysisId: string): NativeKind | null {
  if (!analysisId.startsWith(NATIVE_PREFIX)) return null;
  const kind = analysisId.slice(NATIVE_PREFIX.length);
  return (NATIVE_KINDS as readonly string[]).includes(kind) ? (kind as NativeKind) : null;
}

export function isNativeId(analysisId: string): boolean {
  return nativeKindOfId(analysisId) !== null;
}

export function isNativeCard(card: AnalysisCardNode): boolean {
  return isNativeId(card.analysis.analysisId);
}

export function nativeKindOf(card: AnalysisCardNode): NativeKind | null {
  return nativeKindOfId(card.analysis.analysisId);
}

export function nativeSpec(kind: NativeKind): NativeSpec {
  return SPECS[kind];
}

export function nativeSizing(kind: NativeKind): { readonly defaultSize: GridSize; readonly minSize: GridSize; readonly sizes: readonly GridSize[] } {
  const spec = SPECS[kind];
  return { defaultSize: spec.defaultSize, minSize: spec.minSize, sizes: spec.sizes };
}

const METRICS: readonly NativeMetric[] = ["expense", "income", "balance"];

/** 读卡片上的总览选项；格式不对的字段当作没写（不抛错，卡片按缺省显示）。 */
export function nativeOptions(card: AnalysisCardNode): NativeOptions {
  const raw = card.chart.options?.["native"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const books = value["books"];
  return {
    ...(typeof value["bookId"] === "string" && value["bookId"] !== "" ? { bookId: value["bookId"] } : {}),
    ...(books === "all" ? { books: "all" as const } : Array.isArray(books) ? { books: books.filter((id): id is string => typeof id === "string" && id !== "") } : {}),
    ...(METRICS.includes(value["metric"] as NativeMetric) ? { metric: value["metric"] as NativeMetric } : {}),
    ...(typeof value["showTrend"] === "boolean" ? { showTrend: value["showTrend"] } : {}),
    ...(typeof value["showRecent"] === "boolean" ? { showRecent: value["showRecent"] } : {}),
  };
}

export function withNativeOptions(card: AnalysisCardNode, options: NativeOptions): AnalysisCardNode {
  return { ...card, chart: { ...card.chart, options: { ...(card.chart.options ?? {}), native: { ...options } } } };
}

export function newNativeCard(kind: NativeKind, objectId: string, options: NativeOptions = {}): AnalysisCardNode {
  return {
    objectId,
    type: "analysis-card",
    analysis: { analysisId: nativeAnalysisId(kind), params: {} },
    chart: { chartFamily: NATIVE_FAMILY, options: { native: { ...options } } },
    rangePolicy: "inherit",
  };
}

/** 分析卡片的数据来源：`null` = 当前账本。 */
export function cardSourceBook(card: AnalysisCardNode): string | null {
  const raw = card.chart.options?.["source"];
  if (typeof raw !== "object" || raw === null) return null;
  const bookId = (raw as Record<string, unknown>)["bookId"];
  return typeof bookId === "string" && bookId !== "" ? bookId : null;
}

export function withCardSource(card: AnalysisCardNode, bookId: string | null): AnalysisCardNode {
  const { source: _source, ...rest } = card.chart.options ?? {};
  const options = bookId === null ? rest : { ...rest, source: { bookId } };
  return { ...card, chart: Object.keys(options).length === 0 ? { chartFamily: card.chart.chartFamily } : { ...card.chart, options } };
}

/**
 * 总览上每张卡片（分析卡片与总览卡片都有）的显示选项（1.19.100），写在 `chart.options.display`：
 * 卡片备注、没有数据时怎么显示、点卡片去哪里、是否总是遮住金额。分析页的卡片没有这些键，行为不变。
 */
export interface CardDisplay {
  /** 用户写给自己的一行说明（≤ 60 字）。 */
  readonly note?: string;
  /** `quiet`：这段时间没有账目时只留一句说明并变淡。缺省照常显示。 */
  readonly empty?: "quiet";
  /** `entries`：点卡片打开明细；`analysis`：打开分析；`none`：不响应点击。缺省按卡片种类。 */
  readonly open?: "entries" | "analysis" | "none";
  /** 金额遮罩关闭时也遮住这张卡（悬停、按住或键盘聚焦时显示）。 */
  readonly masked?: boolean;
}

export const NOTE_MAX = 60;

export function cardDisplay(card: AnalysisCardNode): CardDisplay {
  const raw = card.chart.options?.["display"];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const note = typeof value["note"] === "string" ? value["note"].trim().slice(0, NOTE_MAX) : "";
  const open = value["open"];
  return {
    ...(note === "" ? {} : { note }),
    ...(value["empty"] === "quiet" ? { empty: "quiet" as const } : {}),
    ...(open === "entries" || open === "analysis" || open === "none" ? { open } : {}),
    ...(value["masked"] === true ? { masked: true } : {}),
  };
}

export function withCardDisplay(card: AnalysisCardNode, display: CardDisplay): AnalysisCardNode {
  const { display: _display, ...rest } = card.chart.options ?? {};
  const clean = Object.fromEntries(Object.entries(display).filter(([, value]) => value !== undefined && value !== false && value !== ""));
  const options = Object.keys(clean).length === 0 ? rest : { ...rest, display: clean };
  return { ...card, chart: Object.keys(options).length === 0 ? { chartFamily: card.chart.chartFamily } : { ...card.chart, options } };
}

/** 选中的账本集合（多账本卡片）；`all` 或没写 = 全部 `available`。不在 `available` 里的账本（退出、归档）去掉。 */
export function resolveBooks(selection: NativeOptions["books"], available: readonly string[]): readonly string[] {
  if (selection === undefined || selection === "all") return available;
  const present = new Set(available);
  const chosen = selection.filter((id) => present.has(id));
  return chosen.length === 0 ? available : chosen;
}

// ---------------------------------------------------------------------------
// 标题：账本卡片用账本名称（账本改名后随之变化）
// ---------------------------------------------------------------------------

/**
 * 当前已知的账本名称，由总览页随账本列表更新。`cardTitle` 是纯函数、在编辑格、菜单与卡片库里都要用，
 * 拿不到 React 上下文，所以账本名称放在这里；只有名称，不含任何金额或账目。
 */
let bookNames: ReadonlyMap<string, string> = new Map();

export function setNativeBookNames(names: ReadonlyMap<string, string>): void {
  bookNames = names;
}

export function nativeBookName(bookId: string | undefined): string | undefined {
  return bookId === undefined ? undefined : bookNames.get(bookId);
}

type Translate = ReturnType<typeof useI18n>["t"];

export function nativeKindTitle(kind: NativeKind, t: Translate): string {
  return t(`desktop.dashboard.cards.${kind}`);
}

export function nativeTitle(card: AnalysisCardNode, t: Translate): string {
  const kind = nativeKindOf(card);
  if (kind === null) return t("statsWorkbench.card.unknown");
  if (kind === "ledger") return nativeBookName(nativeOptions(card).bookId) ?? nativeKindTitle(kind, t);
  return nativeKindTitle(kind, t);
}
