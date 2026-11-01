import { BookAttachmentSummary } from "../components/Attachments.js";
import { BookNotificationBell } from "../components/BookNotificationBell.js";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useBooks, useLedgerMeta } from "../lib/queries.js";
import { ViewLedgerContext } from "../lib/workspaceLedger.js";
import { BookSettingsPage } from "../pages/BookSettingsPage.js";
import { LedgerInvitePage } from "../pages/LedgerInvitePage.js";
import { DesktopHistory, DesktopMembers, DesktopMemberManagement } from "./DesktopLedgerParts.js";
import { DesktopSurfaceProvider } from "./surface.js";
import { DesktopToolbar } from "./DesktopToolbar.js";

/** URL 决定管理对象；浏览资料、设置和历史不会激活另一账本。 */
export function DesktopBookPage({ bookId, children }: { readonly bookId: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <ViewLedgerContext.Provider value={bookId}><BookContent key={bookId} bookId={bookId}>{children}</BookContent></ViewLedgerContext.Provider>;
}

function BookContent({ bookId, children }: { readonly bookId: string; readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const meta = useLedgerMeta(bookId);
  const books = useBooks();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const root = "/books/" + bookId;
  const overview = pathname === root || pathname === root + "/settings";
  const section = new URLSearchParams(search).get("section");
  const [membersOpen, setMembersOpen] = useState(section === "members");
  const shared = (meta.data?.book.memberCount ?? 1) > 1;
  const stats = meta.data?.stats;
  const open = (value: string) => void navigate(root + (value === "" ? "" : "?section=" + value));
  return <div className="flex h-full min-h-0 flex-col">
    <DesktopToolbar title={t("books.detail.title")} actions={<>
      <BookNotificationBell bookId={bookId} />
      <select className="lv-dash-select rounded-field border border-line bg-surface text-base" aria-label={t("desktop.book.viewLedger")} value={bookId} onChange={(event) => void navigate("/books/" + event.target.value)}>
        {(books.data?.books ?? []).map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
      </select>
      <Link className="lv-desk-btn" to="/start">{t("desktop.ledgerPicker.manage")}</Link>
    </>} />
    {meta.isPending ? <p className="p-6 text-muted">{t("desktop.common.loading")}</p> : null}
    {meta.isError ? <div className="p-6"><p role="alert" className="text-danger">{errorMessage(meta.error)}</p><button className="lv-desk-btn mt-4" onClick={() => void meta.refetch()}>{t("common.action.retry")}</button></div> : null}
    {meta.isSuccess ? <div className="lv-desk-book-grid lv-desk-scroll">
      <aside className="lv-desk-book-info">
        <section className="lv-desk-info-card">
          <div className="lv-desk-ledger-badge" aria-hidden="true">{Array.from(meta.data.book.name)[0]}</div>
          <h2 className="text-page-title text-ink break-words">{meta.data.book.name}</h2>
          <p className="text-helper text-muted font-mono">{meta.data.book.bookNumber ?? t("books.noNumber")}</p>
          <dl className="lv-desk-book-facts">
            <div><dt>{t("books.detail.createdAt")}</dt><dd>{stats?.createdAt.slice(0, 10)}</dd></div>
            <div><dt>{t("books.detail.entryCount")}</dt><dd>{t("common.count.entries", { count: stats?.transactionCount ?? 0 })}</dd></div>
            <div><dt>{t("books.detail.eventCount")}</dt><dd>{t("books.detail.events", { count: stats?.eventCount ?? 0 })}</dd></div>
            <div><dt>{t("books.detail.memberCount")}</dt><dd>{t("books.people", { count: meta.data.book.memberCount })}</dd></div>
          </dl>
        </section>
        <section className="lv-desk-info-card">
          <h2 className="text-card-title">{t("desktop.collab.tabs.members")}</h2>
          <DesktopMembers bookId={bookId} onManage={() => setMembersOpen((value) => !value)} />
          {membersOpen ? <DesktopMemberManagement bookId={bookId} /> : null}
          {shared ? <Link className="lv-desk-btn" to={"/ledger?book=" + encodeURIComponent(bookId)}>{t("desktop.book.openCollab")}</Link> :
            <button className="lv-desk-btn" onClick={() => open("invite")}>{t("desktop.collab.tabs.invite")}</button>}
        </section>
        <BookAttachmentSummary bookId={bookId} />
      </aside>
      <main className="lv-desk-book-main">
        <nav className="lv-desk-book-localnav" aria-label={t("desktop.book.sections")}>
          <button className="lv-desk-tab" aria-current={overview && !section ? "page" : undefined} onClick={() => open("")}>{t("books.settings.title")}</button>
          {!shared ? <><button className="lv-desk-tab" aria-current={section === "history" ? "page" : undefined} onClick={() => open("history")}>{t("desktop.collab.tabs.history")}</button>
          <button className="lv-desk-tab" aria-current={section === "invite" ? "page" : undefined} onClick={() => open("invite")}>{t("desktop.collab.tabs.invite")}</button></> : null}
          {!overview ? <Link className="lv-desk-link ml-auto" to={root}>{t("desktop.book.backSettings")}</Link> : null}
        </nav>
        {overview && section === "history" ? <DesktopHistory /> : overview && section === "invite" ? <div className="lv-desk-book-invite"><DesktopSurfaceProvider surface="main" bar="none"><LedgerInvitePage /></DesktopSurfaceProvider></div> :
          overview ? <>
            <div className="lv-desk-book-settings"><DesktopSurfaceProvider surface="main" bar="none"><BookSettingsPage targetBookId={bookId} /></DesktopSurfaceProvider></div>
            {!shared ? <div className="lv-desk-book-history-preview"><DesktopHistory compact /><button className="lv-desk-link text-helper" onClick={() => open("history")}>{t("desktop.book.allHistory")} →</button></div> : null}
          </> :
          <div className="lv-desk-book-editor"><DesktopSurfaceProvider surface="main" bar="heading">{children}</DesktopSurfaceProvider></div>}
      </main>
    </div> : null}
  </div>;
}
