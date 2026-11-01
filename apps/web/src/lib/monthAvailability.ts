import type { Transaction, TransactionListResponse } from "@libellum/shared";

export type MonthAvailability = Readonly<Record<string, boolean | undefined>>;
export type MonthSamples = Readonly<Record<string, Readonly<Record<string, TransactionListResponse | null>>>>;

export function monthsInYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`);
}

/** 仅探查所浏览年份，每月每本账最多取一条；整个面板最多三个并行请求。 */
export async function readMonthSamples(
  months: readonly string[],
  bookIds: readonly string[],
  fetchPage: (bookId: string, month: string) => Promise<TransactionListResponse>,
  cancelled: () => boolean,
): Promise<MonthSamples> {
  const samples: Record<string, Record<string, TransactionListResponse | null>> = {};
  const jobs = months.flatMap(month => bookIds.map(bookId => ({ month, bookId })));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (!cancelled()) {
      const job = jobs[next++];
      if (job === undefined) return;
      let page: TransactionListResponse | null;
      try { page = await fetchPage(job.bookId, job.month); } catch { page = null; }
      if (cancelled()) return;
      (samples[job.month] ??= {})[job.bookId] = page;
    }
  }));
  return samples;
}

/** 未下载 / 请求失败不等于空月。只在范围内所有账本均确定为空时禁用。 */
export function monthAvailability({ months, bookIds, samples, local, localBookId, pending, deleted, completeLocal = false }: {
  readonly months: readonly string[];
  readonly bookIds: readonly string[];
  readonly samples: MonthSamples | undefined;
  readonly local: readonly Transaction[];
  readonly localBookId: string | null;
  readonly pending: ReadonlySet<string>;
  readonly deleted: ReadonlySet<string>;
  readonly completeLocal?: boolean;
}): MonthAvailability {
  return Object.fromEntries(months.map(month => {
    if (completeLocal) return [month, local.some(entry => !deleted.has(entry.id) && entry.occurredLocalDate.startsWith(month))];
    const states = bookIds.map(bookId => {
      const own = bookId === localBookId;
      const entries = own ? local.filter(entry => !deleted.has(entry.id) && entry.occurredLocalDate.startsWith(month)) : [];
      if (entries.some(entry => pending.has(entry.id))) return true;
      const page = samples?.[month]?.[bookId];
      if (page == null) return entries.length > 0 ? true : undefined;
      if (page.items.some(entry => !own || (!deleted.has(entry.id) && !pending.has(entry.id)))) return true;
      // 样本可能已被本机删除或移到别月；仍有后续页时不能推断整月为空。
      return page.nextCursor === null ? false : undefined;
    });
    return [month, states.includes(true) ? true : states.length > 0 && states.every(state => state === false) ? false : undefined];
  }));
}
