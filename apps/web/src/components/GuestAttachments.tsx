import "./attachments.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { formatStorageBytes, type LedgerImportResult } from "@libellum/shared";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useEntryOrigin } from "../lib/entryReturn.js";
import { useLedger } from "../lib/queries.js";
import {
  addGuestAttachment, guestAttachmentUsage, listGuestAttachments, localSpace, removeGuestAttachment, type GuestAttachment, type LocalSpace,
} from "../lib/guest/attachments.js";
import {
  attachmentMigrationProgress, planGuestAttachmentMigration, queueGuestAttachmentMigration, readAttachmentMigrationRecord,
  type GuestAttachmentMigrationProgress, type GuestAttachmentMigrationRecord,
} from "../lib/guest/attachmentMigration.js";
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

/**
 * 1.19.97 · 转正式账号后的附件上传（账本导入页“完成”一步，导入任务确认之后）。
 *
 * 第一次显示时把要迁的附件加入登录用户的上传队列（每次导入只加一次，见 `lib/guest/attachmentMigration.ts`），
 * 之后只显示进度：队列由全局 `AttachmentTransfers` 在后台上传，离开本页也会继续。这本游客账本没有附件时不显示。
 */
export function GuestAttachmentMigrationCard({ importId, userId, guestId, guestBookId, result }: {
  importId: string; userId: string; guestId: string; guestBookId: string;
  result: Pick<LedgerImportResult, "targetBook" | "imported" | "updated">;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [record, setRecord] = useState<GuestAttachmentMigrationRecord | null>(() => readAttachmentMigrationRecord(userId, importId));
  const [progress, setProgress] = useState<GuestAttachmentMigrationProgress | null>(null);
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const targetBookId = result.targetBook.id;

  const queue = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const plan = await planGuestAttachmentMigration({ userId, guestId, guestBookId, result });
      if (plan.items.length === 0 && plan.leftBehind === 0) { setEmpty(true); return; }
      await queueGuestAttachmentMigration({ importId, userId, guestBookId, plan, targetBookId });
      setRecord(readAttachmentMigrationRecord(userId, importId));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
    // `result` 是同一次导入的回执；按回执 id 区分即可，不把对象本身当依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, userId, guestId, guestBookId, targetBookId]);

  useEffect(() => {
    if (record !== null || started.current) return;
    started.current = true;
    void queue();
  }, [record, queue]);

  useEffect(() => {
    if (record === null || record.ids.length === 0) return;
    let active = true;
    const refresh = () => { void attachmentMigrationProgress(record).then((next) => { if (active) setProgress(next); }).catch(() => undefined); };
    refresh();
    window.addEventListener("attachments-pending", refresh);
    window.addEventListener("attachments-progress", refresh);
    const timer = setInterval(refresh, 3_000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("attachments-pending", refresh);
      window.removeEventListener("attachments-progress", refresh);
    };
  }, [record]);

  if (empty || (record !== null && record.ids.length === 0 && record.leftBehind === 0)) return null;
  const done = record !== null && progress !== null && progress.uploaded >= progress.total;
  return (
    <section data-testid="guest-attachment-migration" className="flex flex-col gap-2 rounded-card border border-line bg-surface px-5 py-4">
      <p className="text-body font-medium text-ink">{t("attachments.guest.migrationTitle")}</p>
      {record === null && busy ? <p className="text-helper-relaxed text-muted">{t("attachments.guest.migrationPreparing")}</p> : null}
      {record !== null && record.ids.length > 0 ? (
        done ? (
          <p className="text-helper-relaxed text-brand-dark">{t("attachments.guest.migrationDone", { total: record.ids.length })}</p>
        ) : (
          <>
            <p className="text-helper-relaxed text-ink">
              {t("attachments.guest.migrationQueued", { total: record.ids.length, size: formatStorageBytes(record.bytes), uploaded: progress?.uploaded ?? 0 })}
            </p>
            <p className="text-helper-relaxed text-muted">{t("attachments.guest.migrationBackground")}</p>
          </>
        )
      ) : null}
      {progress !== null && progress.failed > 0 && !done ? (
        <p role="status" className="text-helper-relaxed text-warn-dark [overflow-wrap:anywhere]">
          {t("attachments.guest.migrationFailed", { count: progress.failed, reason: progress.error ?? "" })}
        </p>
      ) : null}
      {record !== null && record.leftBehind > 0 ? (
        <p className="text-helper-relaxed text-muted">{t("attachments.guest.migrationLeftBehind", { count: record.leftBehind })}</p>
      ) : null}
      {error === null ? null : (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-helper-relaxed text-warn-dark [overflow-wrap:anywhere]">{error}</p>
          <button type="button" disabled={busy} onClick={() => void queue()}
            className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50">
            {t("attachments.guest.migrationRetry")}
          </button>
        </div>
      )}
    </section>
  );
}
