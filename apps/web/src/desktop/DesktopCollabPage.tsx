import { BookNotificationBell } from "../components/BookNotificationBell.js";
import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { MessageBoardFull } from "../components/MessageBoard.js";
import { useI18n } from "../i18n/index.js";
import { useLedger } from "../lib/queries.js";
import { ViewLedgerContext, useViewBookId } from "../lib/workspaceLedger.js";
import { readQuoteRequest } from "../pages/MessageBoardPage.js";
import { LedgerInvitePage } from "../pages/LedgerInvitePage.js";
import { DesktopHistory, DesktopMembers, DesktopMemberManagement } from "./DesktopLedgerParts.js";
import { DesktopSplit, useElementWidth } from "./DesktopSplit.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { DesktopSurfaceProvider } from "./surface.js";
import { splitLayout, PANEL_DEFAULT } from "./split.js";

/** 编辑记录与留言同时可用；邀请与成员管理在页头就近展开。 */
export function DesktopCollabPage(): React.JSX.Element {
  const { search } = useLocation();
  const book = new URLSearchParams(search).get("book");
  return <ViewLedgerContext.Provider value={book}><CollabContent key={book ?? "current"} /></ViewLedgerContext.Provider>;
}

function CollabContent(): React.JSX.Element {
  const { t } = useI18n();
  const ledger = useLedger();
  const bookId = useViewBookId();
  const { pathname, search } = useLocation();
  const [management, setManagement] = useState<"members" | "invite" | null>(() => pathname.endsWith("/invite") ? "invite" : pathname.endsWith("/members") ? "members" : null);
  const [showMessages, setShowMessages] = useState(pathname.endsWith("/messages"));
  const box = useElementWidth<HTMLDivElement>();
  const fits = splitLayout(box.width, PANEL_DEFAULT).fits;
  const quoteRequest = readQuoteRequest(new URLSearchParams(search));
  if (ledger.isSuccess && (ledger.data.book.memberCount ?? 1) <= 1 && bookId !== null) {
    const section = pathname.endsWith("/invite") ? "invite" : pathname.endsWith("/history") ? "history" : pathname.endsWith("/members") ? "members" : "";
    return <Navigate replace to={"/books/" + bookId + (section ? "?section=" + section : "")} />;
  }
  if (ledger.isError) return <div className="p-6"><p role="alert" className="text-danger">{t("collab.messages.ledgerLoadFailed")}</p><button className="lv-desk-btn mt-4" onClick={() => void ledger.refetch()}>{t("common.action.retry")}</button></div>;
  return <div ref={box.ref} className="flex h-full min-h-0 flex-col">
    <DesktopToolbar title={t("desktop.collab.title")} meta={ledger.data?.book.name} actions={<>
      {bookId ? <BookNotificationBell bookId={bookId} /> : null}
      <button className="lv-desk-btn" aria-expanded={management === "invite"} onClick={() => setManagement(management === "invite" ? null : "invite")}>{t("desktop.collab.tabs.invite")}</button>
      {bookId === null ? null : <Link className="lv-desk-btn" to={"/books/" + bookId}>{t("books.detail.title")}</Link>}
      {!fits ? <button className="lv-desk-btn" onClick={() => setShowMessages((value) => !value)}>{t(showMessages ? "desktop.collab.tabs.history" : "desktop.collab.tabs.messages")}</button> : null}
    </>} />
    {bookId === null ? null : <div className="lv-desk-collab-members"><DesktopMembers bookId={bookId} onManage={() => setManagement(management === "members" ? null : "members")} /></div>}
    <div className="min-h-0 flex-1">
      <DesktopSplit whenNarrow="overlay" panelLabel={t("desktop.collab.messagesPanel")} onClosePanel={() => setShowMessages(false)}
        panel={ledger.data !== undefined && (fits || showMessages) ? <div className="flex h-full min-h-0 flex-col">
          <div className="lv-desk-panel-bar flex items-center justify-between"><h2 className="text-section-title">{t("desktop.collab.messagesPanel")}</h2>{!fits ? <button className="lv-desk-link text-helper" onClick={() => setShowMessages(false)}>{t("desktop.page.back")}</button> : null}</div>
          <div className="min-h-0 flex-1"><MessageBoardFull key={bookId} bookName={ledger.data.book.name} {...(quoteRequest ? { quoteRequest } : {})} /></div>
        </div> : null}>
        <div className="lv-desk-collab-main lv-desk-scroll">
          {management === null ? null : <section className="lv-desk-collab-manage">
            <header className="flex items-center justify-between gap-3"><h2 className="text-card-title">{t(management === "invite" ? "desktop.collab.tabs.invite" : "desktop.collab.manageMembers")}</h2><button className="lv-desk-link text-helper" onClick={() => setManagement(null)}>{t("desktop.common.done")}</button></header>
            {management === "members" && bookId !== null ? <DesktopMemberManagement bookId={bookId} /> : <DesktopSurfaceProvider surface="main" bar="none"><LedgerInvitePage /></DesktopSurfaceProvider>}
          </section>}
          <DesktopHistory />
        </div>
      </DesktopSplit>
    </div>
  </div>;
}
