import "./attachments.css";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatStorageBytes, type AttachmentView } from "@libellum/shared";
import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";
import { cancelPendingAttachment, attachmentProgress, attachmentUrl, pendingAttachments, removePendingAttachment, savePendingAttachment, uploadAttachment,
  useAttachments, useBookStorage, useAccountStorage, type PendingAttachment } from "../lib/attachments.js";
import { useBooks } from "../lib/queries.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AttachmentPdf } from "./AttachmentPdf.js";
import { uuidV7 } from "../lib/uuid.js";

export function AttachmentTransfers(): null {
  const { user } = useAuth();
  const query = useQueryClient();
  useEffect(() => {
    if (!user) return;
    let active = true, busy = false;
    async function send() {
      if (!active || busy || !navigator.onLine) return;
      busy = true;
      try {
        const run = async () => {
          let attempted = false;
          for (const file of await pendingAttachments(user!.id)) {
            if (!active) break;
            if (file.entryIds.length === 0) continue;
            attempted = true;
            try { await uploadAttachment(file, () => active); }
            catch (error) {
              const message = errorMessage(error);
              if (active && file.error !== message && (await pendingAttachments(user!.id)).some(p => p.id === file.id)) await savePendingAttachment({ ...file, error: message });
            }
          }
          if (active && attempted) { void query.invalidateQueries({ queryKey: ["attachments"] }); void query.invalidateQueries({ queryKey: ["storage"] }); void query.invalidateQueries({ queryKey: ["transactions"] }); void query.invalidateQueries({ queryKey: ["transaction"] }); void query.invalidateQueries({ queryKey: ["ledger"] }); void query.invalidateQueries({ queryKey: ["ws-ledger"] }); void query.invalidateQueries({ queryKey: ["ledger-history"] }); void query.invalidateQueries({ queryKey: ["ledger-meta"] }); }
        };
        if (navigator.locks) await navigator.locks.request(`libevra-attachment-upload:${user!.id}`, { ifAvailable: true }, async (lock) => { if (lock) await run(); });
        else await run();
      } finally { busy = false; }
    }
    void send();
    const trigger = () => { void send(); };
    window.addEventListener("online", trigger); window.addEventListener("attachments-pending", trigger);
    const timer = setInterval(trigger, 30_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("online", trigger); window.removeEventListener("attachments-pending", trigger); };
  }, [user?.id, query]);
  return null;
}

export function AttachmentPreview({ file, onClose, inline = false }: { file: AttachmentView; onClose: () => void; inline?: boolean }): React.JSX.Element {
  const { t } = useI18n(); const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!inline) dialog.current?.showModal(); return () => dialog.current?.close(); }, [inline]);
  const url = attachmentUrl(file);
  const content = <>
    <header><div className="min-w-0"><h2 className="truncate text-section-title">{file.name}</h2><p className="text-helper text-muted">{formatStorageBytes(file.sizeBytes)} · {file.uploaderName}</p></div>
      <a className="lv-desk-btn" href={attachmentUrl(file, true)} download>{t("attachments.download")}</a><button className="lv-desk-btn" onClick={onClose}>{t("attachments.close")}</button></header>
    <div className="lv-attachment-preview-body">
      {file.mediaType.startsWith("image/") ? <img src={url} alt={file.name} /> : file.mediaType === "application/pdf" ?
        <AttachmentPdf url={url} /> : file.mediaType.startsWith("audio/") ? <audio controls src={url} preload="metadata" /> :
        <a className="lv-desk-link" href={attachmentUrl(file, true)} download>{t("attachments.download")}</a>}
    </div>
    <nav className="flex flex-wrap gap-3 p-4">{file.entries.map(entry => <Link key={entry.id} className="lv-desk-link" to={`/transactions/${entry.id}?book=${file.bookId}`}>{entry.seq ? `#${String(entry.seq).padStart(6,"0")}` : t("desktop.entries.panel")}{entry.deleted ? ` · ${t("attachments.recoverable")}` : ""}</Link>)}</nav>
  </>;
  return inline ? <aside className="lv-attachment-inline-preview" aria-label={t("attachments.preview")}>{content}</aside> : <dialog ref={dialog} className="lv-attachment-preview" onCancel={onClose} onClose={onClose}>{content}</dialog>;
}

export function AttachmentPanel({ bookId, entryIds, readOnly = false }: {
  bookId: string | null; entryIds: readonly string[]; readOnly?: boolean;
}): React.JSX.Element | null {
  const { user } = useAuth(); const { t } = useI18n(); const query = useQueryClient();
  const list = useAttachments(bookId, entryIds.length === 1 ? entryIds[0] : undefined, "all");
  const storage = useBookStorage(bookId);
  const books = useBooks();
  const { readOnly: sharedOffline } = useSharedLedgerOfflineReadOnly();
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentView | null>(null);
  const [remove, setRemove] = useState<AttachmentView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const selection = entryIds.join(",");
  const [progress, setProgress] = useState(new Map<string, number>());
  useEffect(() => { const refresh = () => setProgress(new Map(attachmentProgress)); window.addEventListener("attachments-progress", refresh); return () => window.removeEventListener("attachments-progress", refresh); }, []);
  useEffect(() => {
    if (!user || !bookId) return;
    let active = true;
    const refresh = () => { void pendingAttachments(user.id).then((rows) => { if (active) setPending(rows.filter((r) => r.bookId === bookId && r.entryIds.some((id) => entryIds.includes(id)))); }).catch(() => undefined); };
    refresh(); window.addEventListener("attachments-pending", refresh);
    return () => { active = false; window.removeEventListener("attachments-pending", refresh); };
  }, [user?.id, bookId, selection]);
  useEffect(() => { if (entryIds.length > 1 && list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage(); }, [selection, list.hasNextPage, list.isFetchingNextPage, list.isFetchNextPageError, list.fetchNextPage]);
  if (!user || !bookId) return null;
  const files = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((f) => f.entries.some((e) => entryIds.includes(e.id)) && f.state === "ready");
  const editable = !readOnly && !sharedOffline && books.data?.books.some(book => book.id === bookId && book.role !== "viewer") === true;
  async function chosen(files: FileList | null) {
    if (!files || !user || !bookId) return;
    try {
      for (const file of Array.from(files)) {
        if (file.size === 0 || file.size > (storage.data?.limits.fileBytes ?? 100_000_000)) throw new Error(t("attachments.limits", {
          file: formatStorageBytes(storage.data?.limits.fileBytes ?? 100_000_000), count: storage.data?.limits.entryFiles ?? 10,
          entry: formatStorageBytes(storage.data?.limits.entryBytes ?? 200_000_000) }));
        await savePendingAttachment({ id: uuidV7(), ownerId: user.id, bookId, entryIds: [...entryIds], name: file.name,
          blob: file, createdAt: Date.now(), error: null });
      }
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); }
  }
  const refresh = () => { void query.invalidateQueries({ queryKey: ["attachments"] }); void query.invalidateQueries({ queryKey: ["storage"] }); void query.invalidateQueries({ queryKey: ["transactions"] }); void query.invalidateQueries({ queryKey: ["transaction"] }); void query.invalidateQueries({ queryKey: ["ledger"] }); void query.invalidateQueries({ queryKey: ["ws-ledger"] }); void query.invalidateQueries({ queryKey: ["ledger-history"] }); void query.invalidateQueries({ queryKey: ["ledger-meta"] }); };
  return <section className="lv-attachments">
    <header><h2 className="text-section-title">{t("attachments.title")}</h2><span className="text-helper text-muted">{t("attachments.count", { count: files.length + pending.length })}</span>
      {editable ? <button type="button" className="lv-desk-btn ml-auto" onClick={() => input.current?.click()}>{t("attachments.add")}</button> : null}</header>
    <input ref={input} type="file" multiple accept="image/*,application/pdf,audio/*,.txt,.csv" className="sr-only" onChange={(e) => { void chosen(e.target.files); e.target.value = ""; }} />
    {entryIds.length > 1 ? <p className="text-helper text-muted">{t("attachments.associated", { count: entryIds.length })}</p> : null}
    {error ? <p role="alert" className="text-helper text-danger">{error}</p> : null}
    {list.isError ? <p role="alert" className="text-helper text-danger">{errorMessage(list.error)}</p> : null}
    {list.isSuccess && files.length === 0 && pending.length === 0 ? <p className="text-helper text-muted">{t("attachments.empty")}</p> : null}
    <ul className="lv-attachment-list">{files.map((file) => <li key={file.id}>
      <button className="lv-attachment-file" onClick={() => setPreview(file)}>
        {file.mediaType.startsWith("image/") ? <img src={attachmentUrl(file)} alt="" loading="lazy" /> : <span aria-hidden="true">↗</span>}
        <span><strong>{file.name}</strong><small>{formatStorageBytes(file.sizeBytes)} · {file.uploaderName}{file.deletedAt ? ` · ${t("attachments.recoverable")}` : ""}</small></span>
      </button>
      {file.canDelete && editable ? <button className="lv-desk-link text-helper" onClick={() => {
        if (file.deletedAt) void apiFetch(`/books/${bookId}/attachments/${file.id}/restore`, { method: "POST" }).then(refresh).catch((e: unknown) => setError(errorMessage(e)));
        else setRemove(file);
      }}>{t(file.deletedAt ? "attachments.restore" : "attachments.remove")}</button> : null}
    </li>)}</ul>
    {pending.map((file) => <div key={file.id} className="lv-attachment-pending"><span className="min-w-0 flex-1"><strong className="text-body break-all">{file.name}</strong><small className="block text-helper text-muted">{formatStorageBytes(file.blob.size)} · {t(progress.has(file.id) ? "attachments.uploading" : file.error ? "attachments.failed" : "attachments.pending")}</small>{progress.has(file.id) ? <progress className="lv-storage-progress" max={file.blob.size} value={progress.get(file.id)} /> : null}{file.error ? <span className="text-helper text-danger">{file.error}</span> : null}</span>
      <button className="lv-desk-link text-helper" onClick={() => { void savePendingAttachment({ ...file, error: null }); }}>{t("attachments.retry")}</button>
      <button className="lv-desk-link text-helper" onClick={() => { void cancelPendingAttachment(file).catch((e: unknown) => setError(errorMessage(e))); }}>{t("common.action.cancel")}</button></div>)}
    {pending.length ? <p className="text-helper text-muted">{t("attachments.localHint")}</p> : null}
    {storage.data ? <p className="text-helper text-muted">{t("attachments.limits", { file: formatStorageBytes(storage.data.limits.fileBytes), count: storage.data.limits.entryFiles, entry: formatStorageBytes(storage.data.limits.entryBytes) })}</p> : null}
    {preview ? <AttachmentPreview file={preview} onClose={() => setPreview(null)} /> : null}
    <ConfirmDialog open={remove !== null} title={t("attachments.remove")} description={t("attachments.deleteConfirm")} confirmLabel={t("attachments.remove")} tone="danger" onCancel={() => setRemove(null)} onConfirm={() => {
      if (remove) void apiFetch(`/books/${bookId}/attachments/${remove.id}`, { method: "DELETE" }).then(() => { setRemove(null); refresh(); }).catch((e: unknown) => setError(errorMessage(e)));
    }} />
  </section>;
}

export function BookAttachmentSummary({ bookId, compact = false }: { bookId: string; compact?: boolean }): React.JSX.Element {
  const storage = useBookStorage(bookId); const files = useAttachments(bookId); const { t } = useI18n();
  const value = storage.data;
  return <section className="lv-attachments lv-book-storage"><header><h2 className="text-section-title">{t("books.detail.storage")}</h2>
    {!compact ? <Link className="lv-desk-link ml-auto text-helper" to={`/books/${bookId}/attachments`}>{t("attachments.all")} →</Link> : null}</header>
    {value ? <><p className="text-body">{t("attachments.used", { used: formatStorageBytes(value.bytes), limit: formatStorageBytes(value.limit) })}</p>
      <progress className="lv-storage-progress" value={Math.min(value.bytes, value.limit)} max={value.limit} />
      <p className="text-helper text-muted">{t("attachments.count", { count: value.attachmentCount })} · {t("attachments.recoverableBytes", { size: formatStorageBytes(value.recoverableBytes) })}</p>
      {value.bytes > value.limit ? <p className="text-helper text-danger">{t("attachments.overLimit")}</p> : null}</> : null}
    {!compact ? <div className="lv-attachment-thumbnails">{files.data?.pages[0]?.items.filter((f) => f.state === "ready").slice(0, 4).map((file) =>
      <Link key={file.id} to={`/books/${bookId}/attachments?file=${file.id}`} title={file.name}>{file.mediaType.startsWith("image/") ? <img src={attachmentUrl(file)} alt={file.name} loading="lazy" /> : <span className="text-helper">{file.name}</span>}</Link>)}</div> : null}
  </section>;
}

export function AccountStorageSummary(): React.JSX.Element | null {
  const storage = useAccountStorage(); const { t } = useI18n();
  if (!storage.data) return null;
  const value = storage.data;
  return <section className="lv-attachments"><h2 className="text-section-title">{t("attachments.accountStorage")}</h2>
    <p>{t("attachments.used", { used: formatStorageBytes(value.bytes), limit: formatStorageBytes(value.limit) })}</p>
    <progress className="lv-storage-progress" value={Math.min(value.bytes, value.limit)} max={value.limit} />
    {value.overLimit ? <p className="text-helper text-danger">{t("attachments.overLimit")}</p> : null}
    <ul>{value.books.map((book) => <li key={book.id} className="flex justify-between gap-4 py-2"><span>{book.name}</span><span className="tabular-nums">{formatStorageBytes(book.bytes)}</span></li>)}</ul>
    <p className="text-helper text-muted">{t("attachments.sharedHint")}</p>
    <a className="lv-desk-link text-helper" href="/api/v1/account/attachments-export">{t("attachments.export")}</a>
  </section>;
}

export function LocalAttachmentStorage(): React.JSX.Element | null {
  const { user } = useAuth(); const { t } = useI18n();
  const [files, setFiles] = useState<PendingAttachment[]>([]), [usage, setUsage] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (user) void pendingAttachments(user.id).then(f => { if (active) setFiles(f); });
      if (navigator.storage?.estimate) void navigator.storage.estimate().then(e => { if (active) setUsage(e.usage ?? null); });
    };
    refresh(); window.addEventListener("attachments-pending", refresh);
    return () => { active = false; window.removeEventListener("attachments-pending", refresh); };
  }, [user?.id]);
  if (!user) return null;
  return <section className="lv-attachments"><h2 className="text-section-title">{t("attachments.local")}</h2>
    {usage !== null ? <p>{t("attachments.localEstimate", { size: formatStorageBytes(usage) })}</p> : null}
    <p>{t("attachments.pendingBytes", { size: formatStorageBytes(files.reduce((n, f) => n + f.blob.size, 0)) })}</p>
    <p className="text-helper text-muted">{t("attachments.localSeparate")}</p>
    {files.length ? <p className="text-helper text-muted">{t("attachments.localHint")}</p> : null}
    <ul>{files.map(f => <li className="flex flex-wrap items-center gap-2 py-2 text-helper" key={f.id}>{f.entryIds.length ? <Link className="lv-desk-link" to={`/transactions/${f.entryIds[0]}?book=${f.bookId}`}>{f.name}</Link> : <span>{f.name} · {t("attachments.unlinked")}</span>}<span> · {formatStorageBytes(f.blob.size)} · {f.error ?? t("attachments.pending")}</span><button className="lv-desk-link" onClick={() => { const url = URL.createObjectURL(f.blob); const link = document.createElement("a"); link.href = url; link.download = f.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }}>{t("attachments.download")}</button>{!f.entryIds.length ? <button className="lv-desk-link" onClick={() => { void removePendingAttachment(f.id); }}>{t("attachments.removeDraft")}</button> : null}</li>)}</ul>
  </section>;
}
