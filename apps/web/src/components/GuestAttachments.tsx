import "./attachments.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { formatStorageBytes } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useEntryOrigin } from "../lib/entryReturn.js";
import { useLedger } from "../lib/queries.js";
import {
  addGuestAttachment, guestAttachmentUsage, listGuestAttachments, localSpace, removeGuestAttachment, type GuestAttachment, type LocalSpace,
} from "../lib/guest/attachments.js";
import { guestRuntimeId } from "../lib/guest/runtime.js";
import { useGuestMode } from "../lib/guest/session.js";
import { BottomSheet } from "./BottomSheet.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AttachmentPdf } from "./AttachmentPdf.js";
import { materialAttributes } from "../s19/material.js";
import "../s19/material-components.css";

/**
 * 游客附件界面（附件原件在本机，见 `lib/guest/attachments.ts`）。
 *
 * 与登录用户的差别：没有上传 / 配额服务器；删除是永久删除并有确认框（游客没有“可恢复的服务器副本”，
 * 软删除只会白占本机空间）；预览用 `URL.createObjectURL`，用完释放。
 */
const CAPSULE = materialAttributes("capsule", { shape: "pill" });
const MATERIAL_CLASS = "lv-material lv-material-effects lv-press";

/** 当前游客 id；账号路径为 null。只取字符串，不把身份对象当依赖。 */
export function useGuestOwner(): string | null {
  const guest = useGuestMode();
  return guest ? guestRuntimeId() : null;
}

/** 游客附件列表，随 `attachments-pending`（本机库每次写入都会发）刷新。 */
export function useGuestAttachments(guestId: string | null, bookId: string | null, entryId?: string) {
  const [items, setItems] = useState<GuestAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!guestId || !bookId) { setItems([]); return; }
    try {
      const all = await listGuestAttachments(guestId, bookId);
      setItems(entryId === undefined ? all : all.filter((file) => file.entryIds.includes(entryId)));
      setError(null);
    } catch (caught) { setError(errorMessage(caught)); setItems((current) => current ?? []); }
  }, [guestId, bookId, entryId]);
  useEffect(() => {
    void reload();
    const listener = () => { void reload(); };
    window.addEventListener("attachments-pending", listener);
    return () => window.removeEventListener("attachments-pending", listener);
  }, [reload]);
  return { items, error, reload };
}

/** 预览 / 缩略图用的临时地址：换文件或卸载时释放。 */
export function useObjectUrl(blob: Blob | null): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** 提示 + 本机已用 / 可用空间。 */
export function GuestStorageNote({ bookId = null, refreshKey = 0 }: { bookId?: string | null; refreshKey?: number }): React.JSX.Element {
  const { t } = useI18n();
  const guestId = useGuestOwner();
  const [space, setSpace] = useState<LocalSpace | null>(null);
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void localSpace().then((value) => { if (active) setSpace(value); });
      if (guestId) void guestAttachmentUsage(guestId, bookId ?? undefined).then((value) => { if (active) setUsage(value); }).catch(() => undefined);
    };
    refresh(); window.addEventListener("attachments-pending", refresh);
    return () => { active = false; window.removeEventListener("attachments-pending", refresh); };
  }, [guestId, bookId, refreshKey]);
  return <>
    <p className="text-helper text-muted">{t("attachments.guest.notice")}</p>
    {space === null ? null : space.usage !== null && space.available !== null
      ? <p className="text-helper text-muted">{t("attachments.guest.localUsage", { used: formatStorageBytes(space.usage), available: formatStorageBytes(space.available) })}</p>
      : <p className="text-helper text-muted">{t("attachments.guest.localUsageUnknown")}</p>}
    {usage !== null && usage.count > 0 ? <p className="text-helper text-muted">{t("attachments.guest.bookUsed", { count: usage.count, size: formatStorageBytes(usage.bytes) })}</p> : null}
  </>;
}

export interface GuestEntryLink { id: string; label: string; deleted: boolean }

/** 预览：图片、PDF、音频内嵌，其它类型只给下载。 */
export function GuestAttachmentPreview({ file, onClose, inline = false, entries }: {
  file: GuestAttachment; onClose: () => void; inline?: boolean; entries?: readonly GuestEntryLink[];
}): React.JSX.Element {
  const { t } = useI18n();
  const origin = useEntryOrigin();
  const url = useObjectUrl(file.blob);
  const download = url ? <a className="lv-desk-btn" href={url} download={file.name}>{t("attachments.download")}</a> : null;
  const body = <>
    <div className="lv-attachment-preview-body">
      {!url ? null : file.mediaType.startsWith("image/") ? <img src={url} alt={file.name} />
        : file.mediaType === "application/pdf" ? <AttachmentPdf url={url} />
        : file.mediaType.startsWith("audio/") ? <audio controls src={url} preload="metadata" />
        : <a className="lv-desk-link" href={url} download={file.name}>{t("attachments.download")}</a>}
    </div>
    {entries ? <nav className="flex flex-wrap gap-3 p-4">{entries.map((entry) => <Link key={entry.id} className="lv-desk-link" to={`/transactions/${entry.id}`} state={origin}>
      {entry.label}{entry.deleted ? ` · ${t("attachments.guest.entryDeleted")}` : ""}</Link>)}</nav> : null}
  </>;
  if (inline) return <aside className="lv-attachment-inline-preview" aria-label={t("attachments.preview")}>
    <header><div className="min-w-0"><h2 className="truncate text-section-title">{file.name}</h2><p className="text-helper text-muted">{formatStorageBytes(file.sizeBytes)}</p></div>
      {download}<button className="lv-desk-btn" onClick={onClose}>{t("attachments.close")}</button></header>
    {body}
  </aside>;
  return <BottomSheet label={file.name} title={<span className="break-all">{file.name}</span>} description={formatStorageBytes(file.sizeBytes)}
    headerActions={download} detent="large" dialogClassName="lv-attachment-sheet" onClose={onClose}>{body}</BottomSheet>;
}

/** 缩略图（图片）或占位箭头。 */
function GuestThumb({ file }: { file: GuestAttachment }): React.JSX.Element {
  const isImage = file.mediaType.startsWith("image/");
  const url = useObjectUrl(isImage ? file.blob : null);
  return isImage && url ? <img src={url} alt="" loading="lazy" /> : <span aria-hidden="true">↗</span>;
}

/** 账目详情页的附件区（游客版）。 */
export function GuestAttachmentPanel({ entryIds, readOnly = false }: { entryIds: readonly string[]; readOnly?: boolean }): React.JSX.Element | null {
  const { t } = useI18n();
  const guestId = useGuestOwner();
  const ledger = useLedger();
  const bookId = ledger.data?.book.id ?? null;
  const entryId = entryIds.length === 1 ? entryIds[0] : undefined;
  const list = useGuestAttachments(guestId, bookId, entryId);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GuestAttachment | null>(null);
  const [remove, setRemove] = useState<GuestAttachment | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!guestId || !bookId) return null;
  const files = (list.items ?? []).filter((file) => file.entryIds.some((id) => entryIds.includes(id)));
  async function chosen(selected: FileList | null) {
    if (!selected || !guestId || !bookId) return;
    setBusy(true); setError(null);
    try { for (const file of Array.from(selected)) await addGuestAttachment({ guestId, bookId, entryIds: [...entryIds], file }); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); void list.reload(); }
  }
  return <section className="lv-attachments" data-guest-attachments="">
    <header><h2 className="text-section-title">{t("attachments.title")}</h2><span className="text-helper text-muted">{t("attachments.count", { count: files.length })}</span>
      {readOnly ? null : <button type="button" {...CAPSULE} disabled={busy} className={`lv-desk-btn ml-auto ${MATERIAL_CLASS}`} onClick={() => input.current?.click()}>{t("attachments.add")}</button>}</header>
    <input ref={input} type="file" multiple accept="image/*,application/pdf,audio/*,.txt,.csv" className="sr-only" onChange={(event) => { void chosen(event.target.files); event.target.value = ""; }} />
    {error ? <p role="alert" className="text-helper text-danger">{error}</p> : null}
    {list.error ? <p role="alert" className="text-helper text-danger">{list.error}</p> : null}
    {list.items !== null && files.length === 0 ? <p className="text-helper text-muted">{t("attachments.empty")}</p> : null}
    <ul className="lv-attachment-list">{files.map((file) => <li key={file.id}>
      <button {...materialAttributes("interactive")} className={`lv-attachment-file ${MATERIAL_CLASS}`} onClick={() => setPreview(file)}>
        <GuestThumb file={file} />
        <span><strong>{file.name}</strong><small>{formatStorageBytes(file.sizeBytes)}</small></span>
      </button>
      {readOnly ? null : <button {...materialAttributes("danger-quiet")} className={`lv-desk-link text-helper ${MATERIAL_CLASS}`} onClick={() => setRemove(file)}>{t("attachments.remove")}</button>}
    </li>)}</ul>
    <p className="text-helper text-muted">{t("attachments.limits", { file: formatStorageBytes(100_000_000), count: 10, entry: formatStorageBytes(200_000_000) })}</p>
    <GuestStorageNote bookId={bookId} />
    {preview ? <GuestAttachmentPreview file={preview} onClose={() => setPreview(null)} /> : null}
    <ConfirmDialog open={remove !== null} busy={busy} title={t("attachments.remove")} description={t("attachments.guest.removeConfirm")} confirmLabel={t("attachments.remove")} tone="danger"
      onCancel={() => setRemove(null)} onConfirm={() => {
        if (!remove || !guestId) return;
        setBusy(true);
        void removeGuestAttachment(guestId, remove.id).then(() => { setRemove(null); void list.reload(); }).catch((caught: unknown) => setError(errorMessage(caught))).finally(() => setBusy(false));
      }} />
  </section>;
}

/** 账本详情里的本机附件概览（游客版 `BookAttachmentSummary`）。 */
export function GuestBookAttachmentSummary({ bookId }: { bookId: string }): React.JSX.Element {
  const { t } = useI18n();
  return <section className="lv-attachments lv-book-storage"><header><h2 className="text-section-title">{t("attachments.guest.storageTitle")}</h2>
    <Link className="lv-desk-link ml-auto text-helper" to={`/books/${bookId}/attachments`}>{t("attachments.all")} →</Link></header>
    <GuestStorageNote bookId={bookId} />
  </section>;
}

/** 账本导入页：选中的游客账本有附件时的提醒（不阻止迁移）。 */
export function GuestAttachmentMigrationNote({ guestId, bookId }: { guestId: string; bookId: string }): React.JSX.Element | null {
  const { t } = useI18n();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    setCount(0);
    void guestAttachmentUsage(guestId, bookId).then((usage) => { if (active) setCount(usage.count); }).catch(() => undefined);
    return () => { active = false; };
  }, [guestId, bookId]);
  return count > 0 ? <p role="note" data-testid="guest-attachment-migration-note" className="mt-2 text-helper-relaxed text-muted">{t("attachments.guest.migrationNote", { count })}</p> : null;
}
