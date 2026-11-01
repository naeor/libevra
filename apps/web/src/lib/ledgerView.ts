import type { Transaction } from "@libellum/shared";
import type { QueryClient } from "@tanstack/react-query";
import { asLocalPage, filterLocally, type LocalFilters } from "./offline/localLedger.js";

/** Default for callers that have no device marks (e.g. tests of the older behaviour). */
const NO_DELETED: ReadonlySet<string> = new Set();

/** Apply the complete view filter after merging: persisted query pages may predate this fix. */
export function mergeLedgerEntries(
  local: readonly Transaction[],
  remote: readonly Transaction[],
  pending: ReadonlySet<string>,
  filters: LocalFilters,
  /**
   * ⚠️ **Deletion tombstones must not be rendered, whether the delete is still queued or
   * already acknowledged** (S15-C, 2026-10-20). The stored copy is kept on purpose — round 3
   * needs it to ask whether a delete should stand — but that copy is the reason a deleted row
   * stayed on screen: the merge combined it with the query's list and nothing removed it.
   * The row component's own note says a deleted row is "never rendered at all in practice";
   * this parameter is what makes that true again.
   */
  deleted: ReadonlySet<string> = NO_DELETED,
): readonly Transaction[] {
  const byId = new Map(remote.map(entry => [entry.id, entry]));
  for (const entry of local) {
    const server = byId.get(entry.id);
    if (server === undefined || pending.has(entry.id) || entry.version >= server.version) {
      // 附件与空间由服务器独立维护；本机未同步的金额等字段仍按原规则保留。
      // 同一账目版本的本机副本不能把刚上传的附件数量覆盖回旧值。
      byId.set(entry.id, server === undefined ? entry : {
        ...entry,
        ...(server.attachmentCount === undefined ? {} : { attachmentCount: server.attachmentCount }),
        ...(server.attachmentTypes === undefined ? {} : { attachmentTypes: server.attachmentTypes }),
        ...(server.storageBytes === undefined ? {} : { storageBytes: server.storageBytes }),
      });
    }
  }
  return filterLocally([...byId.values()], filters).filter((entry) => !deleted.has(entry.id));
}

/** A local write must retain each query's income/expense, category and currency constraints. */
export function updateTransactionViews(client: QueryClient, entries: readonly Transaction[]): void {
  const months = new Set(entries.map(entry => entry.occurredLocalDate.slice(0, 7)));
  for (const query of client.getQueryCache().getAll()) {
    const [name, raw] = query.queryKey;
    if (name !== "transactions" || typeof raw !== "object" || raw === null) continue;
    const filters = raw as LocalFilters;
    if (filters.month === undefined || !months.has(filters.month)) continue;
    client.setQueryData(query.queryKey, { pages: [asLocalPage(filterLocally(entries, filters))], pageParams: [undefined] });
  }
}

/**
 * 取前 `limit` 笔，再把最后那一天补完整：日分组的标题下不能只画半天的账目。
 * `entries` 已按时间从新到旧排好（`sortByTime`）。
 */
export function limitToWholeDays(entries: readonly Transaction[], limit: number): readonly Transaction[] {
  if (entries.length <= limit) return entries;
  let end = limit;
  const lastDay = entries[limit - 1]?.occurredLocalDate;
  while (end < entries.length && entries[end]!.occurredLocalDate === lastDay) end += 1;
  return entries.slice(0, end);
}
