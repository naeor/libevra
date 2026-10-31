/**
 * **总览（Dashboard）的布局模型**——纯函数，便于测试。
 *
 * 两层：外层是卡片网格（账本卡片与功能卡片按顺序排，尺寸只有紧凑 / 标准 / 扩展三档）；内层是每张卡片按自己
 * 的实际大小决定显示多少内容（由卡片组件负责）。
 *
 * - 账本卡片的集合由真实账本决定：新账本自动加在账本卡片之后，不在列表里的账本（退出、归档）自动去掉，
 *   其它卡片与用户的顺序、尺寸不受影响。
 * - 窗口变化只改变列数与排布，不改写保存的配置；只有用户在编辑后按「完成」才保存。
 */
export type CardSize = "compact" | "standard" | "expanded";
export type CardKind = "ledger" | "cross" | "recent" | "pending" | "quick";
export type LedgerMetric = "expense" | "income" | "balance";

export interface DashboardCard {
  readonly id: string;
  readonly kind: CardKind;
  readonly size: CardSize;
  readonly hidden?: boolean;
  /** 账本卡片：对应的账本。 */
  readonly bookId?: string;
  /** 账本卡片：主要指标。 */
  readonly metric?: LedgerMetric;
}

export interface DashboardConfig {
  readonly version: 1;
  readonly cards: readonly DashboardCard[];
  /** 多账本收支卡片的范围：全部账本，或指定账本。 */
  readonly crossScope: "all" | readonly string[];
}

export const FEATURE_KINDS: readonly Exclude<CardKind, "ledger">[] = ["cross", "quick", "recent", "pending"];

export function ledgerCardId(bookId: string): string {
  return `ledger:${bookId}`;
}

/** 默认布局：只有一本账时让它占主要位置，旁边放快捷操作、最近账目与待处理；多本账时排成账本卡片网格。 */
export function defaultDashboard(bookIds: readonly string[]): DashboardConfig {
  const single = bookIds.length <= 1;
  const ledgerSize: CardSize = single ? "expanded" : bookIds.length <= 4 ? "standard" : "compact";
  const ledgers: DashboardCard[] = bookIds.map((bookId) => ({ id: ledgerCardId(bookId), kind: "ledger", size: ledgerSize, bookId, metric: "expense" }));
  const features: DashboardCard[] = single
    ? [
        { id: "quick", kind: "quick", size: "standard" },
        { id: "recent", kind: "recent", size: "standard" },
        { id: "pending", kind: "pending", size: "compact" },
        { id: "cross", kind: "cross", size: "standard", hidden: true },
      ]
    : [
        { id: "cross", kind: "cross", size: "standard" },
        { id: "quick", kind: "quick", size: "standard" },
        // 多本账时最近账目与待处理默认放在右侧辅助栏，需要时可以加回主区。
        { id: "recent", kind: "recent", size: "standard", hidden: true },
        { id: "pending", kind: "pending", size: "compact", hidden: true },
      ];
  return { version: 1, cards: [...ledgers, ...features], crossScope: "all" };
}

const SIZES: readonly CardSize[] = ["compact", "standard", "expanded"];
const METRICS: readonly LedgerMetric[] = ["expense", "income", "balance"];

/** 读本机保存的配置；格式不对时当作没有保存过。 */
export function parseDashboard(raw: unknown): DashboardConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as { version?: unknown; cards?: unknown; crossScope?: unknown };
  if (value.version !== 1 || !Array.isArray(value.cards)) return null;
  const cards: DashboardCard[] = [];
  const seen = new Set<string>();
  for (const item of value.cards as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const card = item as Record<string, unknown>;
    const kind = card.kind;
    const size = card.size;
    if (typeof card.id !== "string" || seen.has(card.id)) continue;
    if (kind !== "ledger" && !FEATURE_KINDS.includes(kind as Exclude<CardKind, "ledger">)) continue;
    if (!SIZES.includes(size as CardSize)) continue;
    if (kind === "ledger" && typeof card.bookId !== "string") continue;
    seen.add(card.id);
    cards.push({
      id: card.id,
      kind: kind as CardKind,
      size: size as CardSize,
      ...(card.hidden === true ? { hidden: true } : {}),
      ...(typeof card.bookId === "string" ? { bookId: card.bookId } : {}),
      ...(METRICS.includes(card.metric as LedgerMetric) ? { metric: card.metric as LedgerMetric } : {}),
    });
  }
  const crossScope = Array.isArray(value.crossScope) ? (value.crossScope as unknown[]).filter((id): id is string => typeof id === "string") : "all";
  return { version: 1, cards, crossScope };
}

/**
 * 把保存的配置和当前真实账本合在一起：去掉已经不在的账本，新账本加在最后一张账本卡片后面，
 * 缺少的功能卡片按默认补上（隐藏）。没有保存过时用默认布局。
 */
export function resolveDashboard(saved: DashboardConfig | null, bookIds: readonly string[]): DashboardConfig {
  if (saved === null) return defaultDashboard(bookIds);
  const present = new Set(bookIds);
  const kept = saved.cards.filter((card) => card.kind !== "ledger" || (card.bookId !== undefined && present.has(card.bookId)));
  const known = new Set(kept.filter((card) => card.kind === "ledger").map((card) => card.bookId));
  const fresh: DashboardCard[] = bookIds
    .filter((bookId) => !known.has(bookId))
    .map((bookId) => ({ id: ledgerCardId(bookId), kind: "ledger", size: "standard", bookId, metric: "expense" }));
  const lastLedger = kept.reduce((last, card, index) => (card.kind === "ledger" ? index : last), -1);
  const cards = [...kept.slice(0, lastLedger + 1), ...fresh, ...kept.slice(lastLedger + 1)];
  const defaults = defaultDashboard(bookIds).cards;
  for (const kind of FEATURE_KINDS) {
    if (!cards.some((card) => card.kind === kind)) {
      const fallback = defaults.find((card) => card.kind === kind);
      if (fallback !== undefined) cards.push({ ...fallback, hidden: true });
    }
  }
  const crossScope = saved.crossScope === "all" ? "all" : saved.crossScope.filter((id) => present.has(id));
  return { version: 1, cards, crossScope: crossScope !== "all" && crossScope.length === 0 ? "all" : crossScope };
}

export function moveCard(config: DashboardConfig, id: string, delta: -1 | 1): DashboardConfig {
  const visible = config.cards.filter((card) => card.hidden !== true);
  const index = visible.findIndex((card) => card.id === id);
  const target = visible[index + delta];
  if (index === -1 || target === undefined) return config;
  const cards = [...config.cards];
  const from = cards.findIndex((card) => card.id === id);
  const to = cards.findIndex((card) => card.id === target.id);
  const moving = cards[from];
  const other = cards[to];
  if (moving === undefined || other === undefined) return config;
  cards[from] = other;
  cards[to] = moving;
  return { ...config, cards };
}

export function updateCard(config: DashboardConfig, id: string, patch: Partial<Omit<DashboardCard, "id" | "kind" | "bookId">>): DashboardConfig {
  return {
    ...config,
    cards: config.cards.map((card) => {
      if (card.id !== id) return card;
      const next: DashboardCard = { ...card, ...patch };
      if (patch.hidden === false) {
        const { hidden: _hidden, ...rest } = next;
        return rest;
      }
      return next;
    }),
  };
}

/** 网格列数：按容器宽度，每列至少约 220px，最多 6 列。 */
export function dashboardColumns(width: number): number {
  if (width <= 0) return 4;
  return Math.max(1, Math.min(6, Math.floor((width + 16) / (220 + 16))));
}

/** 一张卡片在当前列数下占几列、几行（列数不够时收窄，不会超出网格）。 */
export function cardSpan(size: CardSize, columns: number): { readonly columns: number; readonly rows: number } {
  if (size === "compact") return { columns: 1, rows: 1 };
  if (size === "standard") return { columns: Math.min(2, columns), rows: 1 };
  return { columns: Math.min(2, columns), rows: 2 };
}

/** 多账本收支：按币种分别合计所选账本本月的记录（不折算、不去重）。 */
export interface CurrencyTotals {
  readonly currency: string;
  readonly expenseCents: number;
  readonly incomeCents: number;
  readonly balanceCents: number;
}

export function totalsByCurrency(
  summaries: readonly { readonly currencies: readonly { readonly currency: string; readonly expenseCents: number; readonly incomeCents: number; readonly balanceCents: number }[] }[],
  preferred: string,
): readonly CurrencyTotals[] {
  const byCurrency = new Map<string, { expenseCents: number; incomeCents: number; balanceCents: number }>();
  for (const summary of summaries) {
    for (const item of summary.currencies) {
      const total = byCurrency.get(item.currency) ?? { expenseCents: 0, incomeCents: 0, balanceCents: 0 };
      total.expenseCents += item.expenseCents;
      total.incomeCents += item.incomeCents;
      total.balanceCents += item.balanceCents;
      byCurrency.set(item.currency, total);
    }
  }
  return [...byCurrency.entries()]
    .map(([currency, total]) => ({ currency, ...total }))
    .sort((a, b) => (a.currency === preferred ? -1 : b.currency === preferred ? 1 : b.expenseCents + b.incomeCents - (a.expenseCents + a.incomeCents)));
}
