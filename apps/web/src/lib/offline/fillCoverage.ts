import { scopedKey } from "./scope.js";
import { readValue, writeValue } from "./storage.js";

/**
 * 单月离线历史读取的容量，以及"没取完"这件事记在哪里。
 *
 * ⚠️ **为什么需要这个文件。** 原来的 `fill.ts` 用「最多 40 页 × 每页 100 条 = 4,000 条」
 * 当保护，但达到页数上限时**没有区分「取完了」和「被上限截断」**：它把前 4,000 条当成整月
 * 写进权威本地账本，下次启动又因为缓存里最后一页仍有 cursor 而重拉一遍，永远补不齐。
 * 页数保护本身不是错，错的是**把截断当成完成**。
 *
 * 所以这里的规则拆成两条：
 *
 *  1. 上限提高到一个临时的、可解释的数字（每月约 50,000 条）；它只是本机读取的边界，
 *     **不是**「账本每月只能有 5 万条」的产品规格，长期方案另行记录；
 *  2. 一旦触到上限，**不把这一批写进权威本地账本**，而是记录一条"这个月没取完"的状态，
 *     由下载管理和离线提示明确说出来。离线分析因此看不到这个月，`sourceComplete` 为 false，
 *     而不是拿不完整的数据算出一个看起来很完整的金额。
 */

/**
 * 单月离线历史读取的条数上限。
 *
 * ⚠️ **临时值，不是永久规格。** 起因是所有者发现旧实现每月最多只读到 4,000 条
 * （40 页 × 100 条），超过就静默丢失。这里先把它抬到 50,000，让一个月有 4,001 条时
 * 不会再被旧页数限制截断；真正的长期方案（cursor 完整分页、分批断点恢复、服务端聚合）
 * 写在 `docs/specs/features/离线历史读取容量上限与长期优化-20261028.md`。
 *
 * 与「综合折算单次详细投影 50,000 行」是**两个不同的容量**：前者是每月离线读取，
 * 后者是分析范围一次投给折算引擎的行数；分析范围可以跨月，即使每月都没超，整段仍可能
 * 超过后者，所以那边原有的超限提示不能因为这里放宽而失效。
 */
export const FILL_MONTH_ENTRY_LIMIT = 50_000;

/**
 * 每次请求的条数。
 *
 * ⚠️ **不是屏幕默认的 50，也不是调参。** 默认一页 50 条时，一个月通常要发更多请求；
 * 100 是 API 自己的上限，让一个月通常一次请求就够。见旧实现留下的测量注释。
 */
export const FILL_PAGE_SIZE = 100;

/** 单月最多请求页数，由上限推导，避免两个数字各改各的。 */
export const MAX_FILL_PAGES = Math.ceil(FILL_MONTH_ENTRY_LIMIT / FILL_PAGE_SIZE);

/** 一页交易列表在线响应里，这个模块真正用到的部分。 */
export interface PageOfEntries<TEntry> {
  readonly items: readonly TEntry[];
  readonly nextCursor: string | null;
}

/** 一个月的分页取回结果。`complete === false` 表示被上限截断，**不能**当整月。 */
export interface CollectedMonth<TEntry> {
  readonly pages: readonly PageOfEntries<TEntry>[];
  readonly entries: number;
  readonly complete: boolean;
}

/**
 * 按 cursor 把一个月的交易列表取完，并明确回答"取完了没有"。
 *
 * 抽成纯函数（不碰 IndexedDB、不读 React）是为了让边界真的可测：`FILL_MONTH_ENTRY_LIMIT`
 * 的 100 条一页意味着 3,999 / 4,000 / 4,001 / 49,999 / 50,000 / 50,001 这些边界都在
 * 请求次数上留下痕迹，测试数请求次数就能证明没有截断。
 *
 * `shouldStop` 在**每次请求前**被问一次：账本切换后必须停下，不能把上一个账本的数据
 * 继续写进来。
 */
export async function collectMonthPages<TEntry>(
  fetchPage: (cursor: string | undefined) => Promise<PageOfEntries<TEntry>>,
  options: {
    /** 每取到一页就通知一次，调用方用它把半成品写进 query cache（中断时不丢已取部分）。 */
    readonly onPage?: (pages: readonly PageOfEntries<TEntry>[]) => void;
    /** 返回 true 时不再发下一个请求；已取到的页仍然保留在结果里。 */
    readonly shouldStop?: () => boolean;
    /** 测试用，默认 `MAX_FILL_PAGES`。 */
    readonly maxPages?: number;
  } = {},
): Promise<CollectedMonth<TEntry>> {
  const maxPages = options.maxPages ?? MAX_FILL_PAGES;
  const pages: PageOfEntries<TEntry>[] = [];
  let cursor: string | undefined;
  let complete = false;

  for (let page = 0; page < maxPages; page += 1) {
    if (options.shouldStop?.() === true) break;

    const fetched = await fetchPage(cursor);
    pages.push(fetched);
    options.onPage?.(pages);

    if (fetched.nextCursor === null) {
      complete = true;
      break;
    }

    cursor = fetched.nextCursor;
  }

  let entries = 0;
  for (const page of pages) entries += page.items.length;

  return { pages, entries, complete };
}

/**
 * 记录一个"没取完"的月份。
 *
 * ⚠️ **只记状态，不记交易。** 交易如果写进权威账本，离线统计就会把它当成整月来算——
 * 那正是这一轮要修的问题。这里只有几个数字：读到多少条、上限多少、什么时候发生。
 */
export interface PartialMonth {
  /** 已经取回到本机的条数。 */
  readonly entries: number;
  /** 当时的单月上限，用来解释"为什么停在这里"，也让以后调上限时旧记录仍然说得清。 */
  readonly limit: number;
  /** 记录时间，用于提示里区分新旧。 */
  readonly at: number;
}

export type PartialMonths = Readonly<Record<string, PartialMonth>>;

/** 状态的存储 key（按账本作用域，避免 A 账本的"没取完"出现在 B 账本里）。 */
const PARTIAL_KEY = "offline-fill-partial-months";

/** 读一个未知值并收窄成 `PartialMonth`，坏数据直接忽略，不让它渲染成 NaN。 */
function toPartialMonth(raw: unknown): PartialMonth | null {
  if (typeof raw !== "object" || raw === null) return null;

  const record = raw as { readonly entries?: unknown; readonly limit?: unknown; readonly at?: unknown };
  const entries = typeof record.entries === "number" && Number.isFinite(record.entries) ? record.entries : 0;
  const limit = typeof record.limit === "number" && Number.isFinite(record.limit) ? record.limit : FILL_MONTH_ENTRY_LIMIT;
  const at = typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0;

  return { entries, limit, at };
}

/** 读出所有"没取完"的月份。没有记录时返回空对象。 */
export async function readPartialMonths(): Promise<PartialMonths> {
  const stored = await readValue<unknown>(scopedKey(PARTIAL_KEY));
  if (typeof stored !== "object" || stored === null) return {};

  const months: Record<string, PartialMonth> = {};

  for (const [month, raw] of Object.entries(stored as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/u.test(month)) continue;

    const record = toPartialMonth(raw);
    if (record !== null) months[month] = record;
  }

  return months;
}

/**
 * 写操作的串行队列。
 *
 * 同一次「下载全部」会依次经过多个月份，但手动重试与自动填充可能交错；读-改-写如果不串行，
 * 后写的会覆盖先写的月份记录。串行化在这里是一行代码，在图省事的地方是丢数据。
 */
let writes: Promise<void> = Promise.resolve();

function enqueue(run: () => Promise<void>): Promise<void> {
  writes = writes.then(run, run);

  return writes;
}

/** 记下一个月份没取完。 */
export function recordPartialMonth(month: string, entries: number, limit = FILL_MONTH_ENTRY_LIMIT): Promise<void> {
  return enqueue(async () => {
    const all = await readPartialMonths();

    await writeValue(scopedKey(PARTIAL_KEY), {
      ...all,
      [month]: { entries, limit, at: Date.now() } satisfies PartialMonth,
    });
  });
}

/** 删除一个月份"没取完"的记录（用户删除该月本地数据时调用）。 */
export function forgetPartialMonth(month: string): Promise<void> {
  return enqueue(async () => {
    const all = await readPartialMonths();
    if (!(month in all)) return;

    const { [month]: _removed, ...rest } = all;
    await writeValue(scopedKey(PARTIAL_KEY), rest);
  });
}

/** 清空所有"没取完"的记录（"删除全部已下载数据"时调用）。 */
export function forgetAllPartialMonths(): Promise<void> {
  return enqueue(async () => {
    await writeValue(scopedKey(PARTIAL_KEY), {});
  });
}
