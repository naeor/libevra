/**
 * 分析工作台的全局筛选（S17 状态 B：筛选展开态）。
 *
 * ⚠️ **只描述「看哪段时间、用哪个币种」，不保存任何金额。** 生效条件写在地址栏（与旧分析页同一组
 * 参数 `range` / `month` / `currency` / `analysis`，旧链接继续有效），所以从卡片详情返回、刷新页面
 * 都能恢复同一份条件；面板里尚未「应用」的草稿只存在于组件状态，绝不冒充生效条件。
 *
 * ⚠️ **时间上限沿用 `MAX_STATS_DAYS`（400 天）**：与既有统计口径、S-01 v2 §17 一致，超出的自定义
 * 区间在应用前就被拒绝，而不是截断后悄悄少算。
 *
 * ⚠️ **W5 完整筛选（2026-10-28）**：在时间与币种之外，工作台还支持按**分类 / 支付方式 / 标签**
 * 多选筛选。语义直接对齐冻结分析协议 S-01 v2 的 `ResolvedFilters`：
 *
 * - `null` = 该维度**不限**；`[]` = 该维度**限制为空集**（结果为空），二者不可互换；
 * - 标签是「任一命中」（账目带有的标签与所选标签有交集即保留），不是必须全部命中；
 * - id 上限 50（G-12a 白名单约束），去重后写入地址栏；未知 id 不会命中任何账目。
 *
 * 筛选仍只描述「看哪一部分账目」，**不保存任何金额**；生效条件写在地址栏，草稿只在组件状态。
 */
import {
  CURRENCIES,
  MAX_STATS_DAYS,
  STATS_RANGES,
  addDays,
  daysBetween,
  endOfMonth,
  rangeForPreset,
  startOfMonth,
  type Currency,
  type DateRange,
  type StatsBucket,
  type StatsRangeKey,
  type Transaction,
} from "@libellum/shared";

export type TimeChoice =
  | { readonly kind: "preset"; readonly preset: StatsRangeKey }
  | { readonly kind: "this-month" }
  | { readonly kind: "month"; readonly month: string }
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

export interface WorkbenchFilters {
  readonly time: TimeChoice;
  /** 原币模式下查看的币种；`null` = 跟随账号默认币种。 */
  readonly currency: Currency | null;
  /**
   * 是否综合折算。工作台默认综合统计，独立于明细金额的设备显示偏好。
   * `analysis=currency` 表示原币；游客仍使用原币离线数据，不触发汇率网络请求。
   */
  readonly combined: boolean;
  /** 分类多选：`null`/缺省 = 不限，`[]` = 限制为空集（S-01 v2 `ResolvedFilters` 语义）。 */
  readonly categoryIds?: readonly string[] | null;
  /** 支付方式多选，语义同上。 */
  readonly paymentMethodIds?: readonly string[] | null;
  /** 标签多选，语义同上；任一命中即保留。 */
  readonly tagIds?: readonly string[] | null;
}

/** 工作台三个维度筛选的规范化结果：缺省统一成 `null`（不限），空数组保持 `[]`（空集）。 */
export interface WorkbenchFilterIds {
  readonly categoryIds: readonly string[] | null;
  readonly paymentMethodIds: readonly string[] | null;
  readonly tagIds: readonly string[] | null;
}

/** G-12a：每个 id 数组去重后最多 50 个。 */
export const MAX_FILTER_IDS = 50;

const FILTER_PARAM = { categoryIds: "category", paymentMethodIds: "payment", tagIds: "tag" } as const;

export const DEFAULT_TIME: TimeChoice = { kind: "preset", preset: "30d" };

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value) || value.startsWith("0000")) return false;
  // 2 月 30 日之类的日期：交给日历自己回答，而不是只看格式。
  return endOfMonth(value) >= value;
}

/** 自定义区间能否生效；不能时返回原因 id（文案在界面层）。 */
export function customRangeProblem(from: string, to: string): "invalid" | "order" | "too-long" | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return "invalid";
  if (from > to) return "order";
  if (daysBetween(from, to) > MAX_STATS_DAYS) return "too-long";
  return null;
}

/** 无效旧链接不能悄悄冒充完整的自定义范围；页面同时说明回退到近 30 天。 */
export function filterUrlProblem(params: URLSearchParams): ReturnType<typeof customRangeProblem> {
  return params.get("range") === "custom" ? customRangeProblem(params.get("from") ?? "", params.get("to") ?? "") : null;
}

/** 把三个维度的可选字段规范化成 `null`/数组；缺省与 `null` 都表示「不限」。 */
export function filterIds(filters: WorkbenchFilters): WorkbenchFilterIds {
  return {
    categoryIds: normalizeIds(filters.categoryIds),
    paymentMethodIds: normalizeIds(filters.paymentMethodIds),
    tagIds: normalizeIds(filters.tagIds),
  };
}

function normalizeIds(ids: readonly string[] | null | undefined): readonly string[] | null {
  if (ids === null || ids === undefined) return null;
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id.length === 0 || id.length > 64) continue;
    seen.add(id);
    if (seen.size >= MAX_FILTER_IDS) break;
  }
  return [...seen];
}

/** 地址栏里的多选 id 列表：空值=不限（`null`），显式 `?category=` 传给 normalizeIds 后变成空集。 */
function readIdList(params: URLSearchParams, key: string): readonly string[] | null {
  if (!params.has(key)) return null;
  return normalizeIds(params.getAll(key));
}

function writeIdList(next: URLSearchParams, key: string, ids: readonly string[] | null | undefined): void {
  const normalized = normalizeIds(ids);
  if (normalized === null) return;
  // 空集必须显式留在地址栏（`?category=`），否则会退化成「不限」——两者语义不同。
  if (normalized.length === 0) next.append(key, "");
  else for (const id of normalized) next.append(key, id);
}

/** 多选 chip 的点击语义：不限 → 只选这一项；已选 → 取消；未选 → 追加（最多 50）。 */
export function toggleFilterId(current: readonly string[] | null, id: string): readonly string[] {
  if (current === null) return [id];
  if (current.includes(id)) return current.filter((value) => value !== id);
  return [...current, id].slice(0, MAX_FILTER_IDS);
}

/** 不含任何维度筛选（时间/币种以外）时原样返回同一数组，避免不必要的重算。 */
export function hasDimensionFilters(filters: WorkbenchFilters): boolean {
  const ids = filterIds(filters);
  return ids.categoryIds !== null || ids.paymentMethodIds !== null || ids.tagIds !== null;
}

/**
 * 单条账目是否通过工作台的维度筛选（分类 / 支付方式 / 标签）。
 *
 * 与 S-01 v2 `filterEntries` 同语义：`null` 不限；数组用「属于所选集」判断；
 * 标签是任一命中（不是全部命中）；支付方式为 `null` 的账目在支付方式筛选下不保留。
 */
export function matchesWorkbenchFilters(entry: Transaction, filters: WorkbenchFilters): boolean {
  const { categoryIds, paymentMethodIds, tagIds } = filterIds(filters);
  if (categoryIds !== null && !categoryIds.includes(entry.categoryId)) return false;
  if (
    paymentMethodIds !== null &&
    (entry.paymentMethodId === null || !paymentMethodIds.includes(entry.paymentMethodId))
  ) {
    return false;
  }
  if (tagIds !== null && !(entry.tags ?? []).some((tag) => tagIds.includes(tag.id))) return false;
  return true;
}

/** 对账目列表应用维度筛选；没有任何维度条件时返回原数组（引用不变）。 */
export function filterWorkbenchEntries(
  entries: readonly Transaction[],
  filters: WorkbenchFilters,
): readonly Transaction[] {
  if (!hasDimensionFilters(filters)) return entries;
  return entries.filter((entry) => matchesWorkbenchFilters(entry, filters));
}

/** 综合折算的缓存键：维度条件变了就要重新折算（缺汇率影响范围会随之变化）。 */
export function filterKey(filters: WorkbenchFilters): string {
  const { categoryIds, paymentMethodIds, tagIds } = filterIds(filters);
  return JSON.stringify([categoryIds, paymentMethodIds, tagIds]);
}

/** 从地址栏读出生效条件；无法识别的值退回默认，而不是报错白屏。 */
export function readFilters(params: URLSearchParams): WorkbenchFilters {
  const range = params.get("range");
  const month = params.get("month") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const currency = params.get("currency");

  let time: TimeChoice = DEFAULT_TIME;
  if (range === "custom") {
    if (customRangeProblem(from, to) === null) time = { kind: "custom", from, to };
  }
  else if (MONTH.test(month) && !month.startsWith("0000")) time = { kind: "month", month };
  else if (range === "this-month") time = { kind: "this-month" };
  else if (STATS_RANGES.includes(range as StatsRangeKey)) time = { kind: "preset", preset: range as StatsRangeKey };

  return {
    time,
    currency: CURRENCIES.includes(currency as Currency) ? (currency as Currency) : null,
    combined: params.get("analysis") !== "currency",
    categoryIds: readIdList(params, FILTER_PARAM.categoryIds),
    paymentMethodIds: readIdList(params, FILTER_PARAM.paymentMethodIds),
    tagIds: readIdList(params, FILTER_PARAM.tagIds),
  };
}

/** 把生效条件写回地址栏；不认识的其它参数原样保留。 */
export function writeFilters(previous: URLSearchParams, filters: WorkbenchFilters): URLSearchParams {
  const next = new URLSearchParams(previous);
  for (const key of ["range", "month", "from", "to", "currency", "analysis", ...Object.values(FILTER_PARAM)]) {
    next.delete(key);
  }

  const { time } = filters;
  if (time.kind === "preset") {
    // 默认的近 30 天不写进地址，旧链接与新链接指向同一状态。
    if (time.preset !== "30d") next.set("range", time.preset);
  } else if (time.kind === "this-month") {
    next.set("range", "this-month");
  } else if (time.kind === "month") {
    next.set("month", time.month);
  } else {
    next.set("range", "custom");
    next.set("from", time.from);
    next.set("to", time.to);
  }
  if (filters.currency !== null) next.set("currency", filters.currency);
  if (!filters.combined) next.set("analysis", "currency");
  writeIdList(next, FILTER_PARAM.categoryIds, filters.categoryIds);
  writeIdList(next, FILTER_PARAM.paymentMethodIds, filters.paymentMethodIds);
  writeIdList(next, FILTER_PARAM.tagIds, filters.tagIds);
  return next;
}

/** 时间选择 → 含两端的业务日期区间（设备当地的「今天」）。 */
export function resolveRange(time: TimeChoice, today: string): DateRange {
  switch (time.kind) {
    case "preset":
      return rangeForPreset(time.preset, today);
    case "this-month":
      return { from: startOfMonth(today), to: today };
    case "month":
      return { from: `${time.month}-01`, to: endOfMonth(`${time.month}-01`) };
    case "custom":
      return { from: time.from, to: time.to };
  }
}

/** 与旧分析页一致：超过 120 天按月分桶，否则按日。 */
export function bucketFor(range: DateRange): StatsBucket {
  return daysBetween(range.from, range.to) > 120 ? "month" : "day";
}

export function sameTime(a: TimeChoice, b: TimeChoice): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function sameFilters(a: WorkbenchFilters, b: WorkbenchFilters): boolean {
  if (!sameTime(a.time, b.time) || a.currency !== b.currency || a.combined !== b.combined) return false;
  const left = filterIds(a);
  const right = filterIds(b);
  return (
    sameIds(left.categoryIds, right.categoryIds) &&
    sameIds(left.paymentMethodIds, right.paymentMethodIds) &&
    sameIds(left.tagIds, right.tagIds)
  );
}

function sameIds(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 生效条件被外部改变（返回、刷新、卡片上的「改用原币查看」）时，草稿怎么办：
 * **没改动过的草稿跟着新条件走；改动过的草稿原样保留**（收起面板不丢草稿，见交互补充 §3）。
 */
export function followDraft(draft: WorkbenchFilters, previousEffective: WorkbenchFilters, nextEffective: WorkbenchFilters): WorkbenchFilters {
  return sameFilters(draft, previousEffective) ? nextEffective : draft;
}

/** 本月的前一个月（「上月」快捷项）。 */
export function previousMonth(today: string): string {
  return startOfMonth(addDays(startOfMonth(today), -1)).slice(0, 7);
}
