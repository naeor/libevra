import { useEffect, useRef, useState } from "react";
import { historyChangeText, historySentenceText } from "../components/HistoryList.js";
import { MemberList } from "../components/MemberList.js";
import { UserAvatar } from "../components/UserAvatar.js";
import { useI18n } from "../i18n/index.js";
import { formatInstant } from "../lib/datetime.js";
import { useBookMembers, useLedgerHistory } from "../lib/queries.js";
import { EntryDetailPage } from "../pages/EntryDetailPage.js";
import { DesktopSurfaceProvider } from "./surface.js";

/** 只读成员摘要。管理操作仍由 MemberList 的原权限检查负责。 */
export function DesktopMembers({ bookId, onManage }: { readonly bookId: string; readonly onManage: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const members = useBookMembers(bookId);
  const list = members.data?.members ?? [];
  return <div className="lv-desk-members">
    {members.isPending ? <span className="text-helper text-muted">{t("collab.members.loading")}</span> : null}
    {members.isError ? <span className="text-helper text-muted">{t("collab.members.loadFailed")}</span> : null}
    {list.slice(0, 4).map((member) => <span key={member.userId} className="lv-desk-member">
      <UserAvatar avatarId={member.avatarId} className="size-7" />
      <span className="text-helper text-ink">{member.displayName}</span>
      {member.isCreator ? <span className="text-micro text-brand-dark">{t("collab.members.creator")}</span> : null}
      <span className="text-micro text-muted">{member.isAdmin === true ? t("collab.role.admin") : t(member.role === "viewer" ? "collab.role.viewer" : member.role === "recorder" ? "collab.role.recorder" : "collab.role.editor")}</span>
    </span>)}
    <button type="button" className="lv-desk-link text-helper" onClick={onManage}>{list.length > 4 ? t("desktop.collab.moreMembers", { count: list.length }) : t("desktop.collab.manageMembers")}</button>
  </div>;
}

export function DesktopMemberManagement({ bookId }: { readonly bookId: string }): React.JSX.Element {
  return <div className="lv-desk-member-management"><MemberList bookId={bookId} /></div>;
}

/** 桌面历史有自己的搜索、展开与滚动区域，展开变更不会挤走留言输入框。 */
export function DesktopHistory({ compact = false }: { readonly compact?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const history = useLedgerHistory(compact ? 8 : 200);
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [entryId, setEntryId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    if (entryId !== null) dialog.current?.showModal();
    else dialog.current?.close();
  }, [entryId]);
  const entries = history.data?.entries ?? [];
  const actors = [...new Set(entries.map((entry) => entry.actorName).filter((name): name is string => name !== null))];
  const filtered = entries.filter((entry) => (actor === "" || entry.actorName === actor) &&
    [historySentenceText(entry), ...entry.changes.map(historyChangeText)].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="lv-desk-history">
    <header className="lv-desk-history-tools">
      <h2 className="text-section-title text-ink">{t("desktop.collab.tabs.history")}</h2>
      <span className="text-helper text-muted">{t("desktop.collab.historyCount", { count: history.data?.total ?? 0 })}</span>
      <button className="lv-desk-link text-helper" disabled={history.isFetching} onClick={() => void history.refetch()}>{t("desktop.collab.refresh")}</button>
      {!compact ? <div className="lv-desk-history-filters">
        <input type="search" className="lv-desk-input" aria-label={t("desktop.collab.searchHistory")} placeholder={t("desktop.collab.searchHistory")} value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="lv-dash-select rounded-field border border-line bg-surface text-base" aria-label={t("desktop.collab.actor")} value={actor} onChange={(event) => setActor(event.target.value)}>
          <option value="">{t("desktop.collab.allActors")}</option>
          {actors.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div> : null}
    </header>
    {history.isPending ? <p className="p-4 text-helper text-muted">{t("ledger.history.loading")}</p> : null}
    {history.isError ? <p role="alert" className="p-4 text-helper text-danger">{t("ledger.history.failed")}</p> : null}
    {history.isSuccess && filtered.length === 0 ? <p className="p-4 text-helper text-muted">{t(query || actor ? "desktop.collab.noMatch" : "ledger.page.historyEmpty")}</p> : null}
    <div className="lv-desk-history-rows">
      {filtered.map((entry) => <details key={entry.id} className="lv-desk-history-row">
        <summary><span className="min-w-0 text-body text-ink">{historySentenceText(entry)}</span><time className="text-helper text-muted tabular-nums" dateTime={entry.occurredAt}>{formatInstant(entry.occurredAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></summary>
        <div className="lv-desk-history-changes">
          {entry.changes.length > 0 ? <ul>{entry.changes.map((change, index) => <li key={index} className="text-helper text-muted">{historyChangeText(change)}</li>)}</ul> : <p className="text-helper text-muted">{t("desktop.collab.noFieldChanges")}</p>}
          {entry.transactionId === null ? null : <button className="lv-desk-link text-helper" onClick={() => setEntryId(entry.transactionId)}>{t("desktop.entries.panel")} →</button>}
        </div>
      </details>)}
    </div>
    {(history.data?.total ?? 0) > entries.length ? <p className="p-3 text-helper text-muted">{t("ledger.history.totalNote", { total: history.data?.total ?? 0, shown: entries.length })}</p> : null}
    <dialog ref={dialog} className="lv-desk-record-dialog" onCancel={() => setEntryId(null)} onClose={() => setEntryId(null)}>
      <DesktopSurfaceProvider surface="panel" onClose={() => setEntryId(null)}>
        {entryId === null ? null : <EntryDetailPage entryId={entryId} />}
      </DesktopSurfaceProvider>
    </dialog>
  </section>;
}
