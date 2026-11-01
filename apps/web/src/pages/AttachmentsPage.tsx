import { useDesktopSurface } from "../desktop/surface.js";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatStorageBytes, type AttachmentView } from "@libellum/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InlineChoice } from "../components/ui/InlineChoice.js";
import { InnerPage } from "../components/Layouts.js";
import { AttachmentPreview, BookAttachmentSummary } from "../components/Attachments.js";
import { useAttachments, attachmentUrl } from "../lib/attachments.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";

export function AttachmentsPage(): React.JSX.Element {
  const desktop = useDesktopSurface() !== null;
  const { bookId = "" } = useParams(); const [params, setParams] = useSearchParams(); const { t } = useI18n();
  const [search, setSearch] = useState(""); const [type, setType] = useState(""); const [state, setState] = useState("active");
  const [sort, setSort] = useState("newest"), [purge, setPurge] = useState<AttachmentView | null>(null);
  const [picking, setPicking] = useState<"type" | "state" | "sort" | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const files = useAttachments(bookId, undefined, state, search, type, sort);
  const items = files.data?.pages.flatMap((p) => p.items) ?? [];
  const selected = items.find((file) => file.id === params.get("file"));
  return <InnerPage title={t("attachments.all")} backTo={`/books/${bookId}`} wideWidth="full">
    <div className="lv-attachment-browser" data-preview={desktop && !!selected ? "true" : undefined}><div className="lv-attachment-browser-list">
    <BookAttachmentSummary bookId={bookId} compact />
    <a className="lv-desk-link text-helper" href={`/api/v1/account/attachments-export?bookId=${bookId}`}>{t("attachments.export")}</a>
    <div className="lv-attachment-filters"><input className="lv-desk-input min-w-0 w-full" type="search" placeholder={t("attachments.search")} aria-label={t("attachments.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <InlineChoice label={t("attachments.type")} value={type} open={picking === "type"} onToggle={() => setPicking(p => p === "type" ? null : "type")} onClose={() => setPicking(null)} onSelect={setType} options={[
        { id: "", label: t("attachments.anyType") }, { id: "image/", label: t("attachments.image") }, { id: "application/pdf", label: "PDF" }, { id: "audio/", label: t("attachments.audio") }, { id: "text/", label: t("attachments.text") },
      ]} />
      <InlineChoice label={t("attachments.recoverable")} value={state} open={picking === "state"} onToggle={() => setPicking(p => p === "state" ? null : "state")} onClose={() => setPicking(null)} onSelect={setState} options={[
        { id: "active", label: t("attachments.active") }, { id: "recoverable", label: t("attachments.recoverable") }, { id: "all", label: t("attachments.all") },
      ]} />
      <InlineChoice label={t("attachments.sort")} value={sort} open={picking === "sort"} onToggle={() => setPicking(p => p === "sort" ? null : "sort")} onClose={() => setPicking(null)} onSelect={setSort} options={[
        { id: "newest", label: t("attachments.sortTimeDesc") }, { id: "oldest", label: t("attachments.sortTimeAsc") }, { id: "largest", label: t("attachments.sortStorageDesc") }, { id: "smallest", label: t("attachments.sortStorageAsc") },
      ]} />
    </div>
    {files.isError ? <p role="alert" className="text-danger">{errorMessage(files.error)}</p> : null}
    {error ? <p role="alert" className="text-danger">{error}</p> : null}
    <div className="lv-attachment-gallery">{items.map((file) => <article key={file.id}><button className="lv-attachment-tile" onClick={() => setParams({ file: file.id })}>
      <div>{file.state === "ready" && file.mediaType.startsWith("image/") ? <img src={attachmentUrl(file)} alt="" loading="lazy" /> : <span className="text-muted">{file.mediaType.split("/")[1]}</span>}</div>
      <strong>{file.name}</strong><small>{formatStorageBytes(file.sizeBytes)} · {file.uploaderName}</small><small>{t("attachments.associated", { count: file.entries.length })}</small>
    </button><div className="flex flex-wrap gap-2 py-2">{file.entries.map(entry => <Link className="text-helper text-brand" key={entry.id} to={`/transactions/${entry.id}?book=${bookId}`}>#{String(entry.seq).padStart(6, "0")}</Link>)}
      {file.canDelete && file.deletedAt ? <button className="text-helper text-brand" disabled={busy} onClick={() => { setBusy(true); void apiFetch(`/books/${bookId}/attachments/${file.id}/restore`, { method: "POST" }).then(() => { void client.invalidateQueries({ queryKey: ["attachments"] }); void client.invalidateQueries({ queryKey: ["storage"] }); void client.invalidateQueries({ queryKey: ["transactions"] }); void client.invalidateQueries({ queryKey: ["transaction"] }); void client.invalidateQueries({ queryKey: ["ws-ledger"] }); void client.invalidateQueries({ queryKey: ["ledger-history"] }); void client.invalidateQueries({ queryKey: ["ledger-meta"] }); }).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)); }}>{t("attachments.restore")}</button> : null}
      {file.canDelete && (file.deletedAt || file.entries.every(e => e.deleted)) ? <button className="ml-auto text-helper text-danger" onClick={() => setPurge(file)}>{t("attachments.permanent")}</button> : null}
    </div></article>)}</div>
    {files.isSuccess && items.length === 0 ? <p className="text-muted">{t("attachments.empty")}</p> : null}
    {files.hasNextPage ? <button className="lv-desk-btn" onClick={() => void files.fetchNextPage()}>{t("attachments.more")}</button> : null}
    </div>{selected ? <AttachmentPreview file={selected} inline={desktop} onClose={() => setParams({})} /> : null}</div>
    <ConfirmDialog open={purge !== null} busy={busy} title={t("attachments.permanent")} description={t("attachments.permanentConfirm")} confirmLabel={t("attachments.permanent")} tone="danger" onCancel={() => setPurge(null)} onConfirm={() => {
      if (!purge || busy) return;
      setBusy(true);
      void apiFetch(`/books/${bookId}/attachments/${purge.id}/permanent`, { method: "DELETE" }).then(() => {
        setPurge(null); void client.invalidateQueries({ queryKey: ["attachments"] }); void client.invalidateQueries({ queryKey: ["storage"] }); void client.invalidateQueries({ queryKey: ["transactions"] }); void client.invalidateQueries({ queryKey: ["transaction"] }); void client.invalidateQueries({ queryKey: ["ws-ledger"] }); void client.invalidateQueries({ queryKey: ["ledger-history"] }); void client.invalidateQueries({ queryKey: ["ledger-meta"] });
      }).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }} />
  </InnerPage>;
}
