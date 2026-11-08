import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { entryReturnState } from "../lib/entryReturn.js";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";
import type { Transaction } from "@libellum/shared";
import { getAnalysisCatalogEntry } from "@libellum/shared/analysis/catalog";
import { useI18n } from "../i18n/index.js";
import { useAnalysisRange } from "../lib/analysisRange.js";
import { formatLocalDate } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { matchesWorkbenchFilters } from "./filters.js";
import type { WorkbenchScope } from "./scope.js";
import { cardRange, displayCard } from "./cards.js";
import { usePane } from "../workspace/context.js";

// 只记住当前会话的展开状态；按工作区与历史条目隔离，不保存账目内容。
const expandedSources = new Set<string>();

export function sourceEntriesFor(card: AnalysisCardNode, scope: WorkbenchScope, rows: readonly Transaction[]): readonly Transaction[] {
  const range = cardRange(displayCard(card), scope);
  const kind = card.analysis.params["kind"] ?? getAnalysisCatalogEntry(card.analysis.analysisId)?.defaultKind ?? (["AN-P05","AN-P07"].includes(card.analysis.analysisId)?"expense":"both");
  return rows.filter(entry => {
    const date = entry.occurredLocalDate;
    return !entry.deletedAt && date >= range.from && date <= range.to &&
      (scope.combined || entry.currency === scope.currency) &&
      (kind !== "income" && kind !== "expense" || entry.kind === kind) && matchesWorkbenchFilters(entry, scope.filters);
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** 按卡片实际区间读原始账目，沿用现有权限、离线读取和筛选；不重新计算图表。 */
export function SourceEntries({ card, scope }: { readonly card: AnalysisCardNode; readonly scope: WorkbenchScope }): React.JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const pane = usePane();
  const key = `${scope.accountScope}:${pane.instance}:${location.key}:${card.objectId}`;
  const [open, setOpen] = useState(() => expandedSources.has(key));
  return <details open={open} className="mt-3 border-t border-line pt-3" onToggle={event => {
    const next = event.currentTarget.open;
    setOpen(next);
    if (next) {
      expandedSources.add(key);
      if (expandedSources.size > 64) expandedSources.delete(expandedSources.values().next().value!);
    } else expandedSources.delete(key);
  }}>
    <summary className="cursor-pointer text-helper text-brand-dark">{t("statsWorkbench.trace.open")}</summary>
    {open ? <SourceEntryList card={card} scope={scope} /> : null}
  </details>;
}
function SourceEntryList({ card, scope }: { readonly card: AnalysisCardNode; readonly scope: WorkbenchScope }): React.JSX.Element {
  const location = useLocation();
  const { t } = useI18n();
  const [limit, setLimit] = useState(50);
  const range = cardRange(displayCard(card), scope);
  const read = useAnalysisRange(range, scope.readRanges === true);
  const rows = scope.readRanges === true ? read.data?.entries : scope.entries;
  const entries = useMemo(() => sourceEntriesFor(card, scope, rows ?? []), [card, scope, rows]);
  return <div>
    <p className="mt-2 text-helper text-muted">{t("statsWorkbench.trace.title", { count: entries.length })}</p>
    <p className="mt-2 text-helper-relaxed text-muted">{t("statsWorkbench.trace.context")}</p>
    {read.permissionDenied ? <p role="alert" className="text-helper text-warn-dark">{t("statsWorkbench.trace.denied")}</p> : read.loading ? <p className="text-helper text-muted">{t("statsWorkbench.states.loading")}</p> : <>
      {read.error || (scope.readRanges === true ? read.data?.sourceComplete !== true : scope.rangeSourceComplete === false) ? <p className="text-helper text-warn-dark">{t("statsWorkbench.states.partial")}</p> : null}
      <ul className="divide-y divide-line">{entries.slice(0, limit).map(entry => <li key={entry.id}>
        <Link className="flex min-h-11 items-center justify-between gap-3 py-3 text-body text-ink" to={`/transactions/${encodeURIComponent(entry.id)}`} state={entryReturnState(location)}>
          <span className="min-w-0 flex-1"><span className="block truncate">{entry.note || displayCategoryName(entry.categoryName)}</span><span className="block text-helper text-muted">{formatLocalDate(entry.occurredLocalDate)}</span></span>
          <span className="shrink-0 tabular-nums">{entry.kind === "expense" ? "−" : "+"}{formatMoney(entry.amountCents, entry.currency)}</span>
        </Link>
      </li>)}</ul>
      {entries.length > limit ? <button type="button" className="sw-pill sw-pill-sm mt-2" onClick={() => setLimit(value => value + 50)}>{t("statsWorkbench.trace.more")}</button> : null}
    </>}
  </div>;
}
