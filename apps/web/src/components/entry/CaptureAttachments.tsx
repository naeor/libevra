import { useCallback, useEffect, useRef, useState } from "react";
import { formatStorageBytes } from "@libellum/shared";
import { useAuth } from "../../auth/AuthProvider.js";
import { useI18n } from "../../i18n/index.js";
import { useDesktopActive } from "../../desktop/surface.js";
import { usePane } from "../../workspace/context.js";
import { errorMessage } from "../../lib/api.js";
import { pendingAttachments, savePendingAttachment, updatePendingAttachment, removePendingAttachment, useBookStorage, type PendingAttachment } from "../../lib/attachments.js";
import { captureAttachmentLimit, captureDraftsFor, resolveAttachmentDraft, type AttachmentTarget } from "../../lib/captureAttachments.js";
import { AttachmentPdf } from "../AttachmentPdf.js";
import { Reveal, useListMotion } from "../ui/ComponentMotion.js";
import { materialAttributes } from "../../s19/material.js";
import "../../s19/material-components.css";
import "./capture.css";
import { uuidV7 } from "../../lib/uuid.js";
import { assertLocalRoom, pruneStaleGuestDrafts } from "../../lib/guest/attachments.js";
import { useGuestOwner, GuestStorageNote } from "../GuestAttachments.js";

const EMPTY_TARGETS: readonly AttachmentTarget[] = [];
/**
 * 附件区的小按钮（关联本次全部、清除选择、下载）按紧凑胶囊（CapsuleButton compact）的用途声明材质（1.19.57）。
 * 保留原来的 `lv-desk-link`：电脑版、Pad、Original 与深色外观不变；浅色手机外壳里由胶囊材质接管，点击区 44px。
 */
const CAPSULE = materialAttributes("capsule", { shape: "pill" });
const CAPSULE_CLASS = "lv-desk-link lv-material lv-material-effects lv-press text-helper";
// 录入页跳到核对页时仍等待同一工作区正在写入的文件。
const pendingWrites = new Map<string, Promise<void>>();

/** 每个工作区、账号、账本、录入方式独立暂存；路由间只传候选标识，不传原文件。 */
export function useCaptureAttachments(bookId: string | null, flow: string, targets: readonly AttachmentTarget[] = EMPTY_TARGETS, disabled = false) {
  const { user: account } = useAuth(); const { t } = useI18n(); const pane = usePane();
  // 游客：附件原件按游客 id 存在本机（lib/guest/attachments.ts）；其余流程与登录用户相同。
  const guestId = useGuestOwner();
  const user = account ? { id: account.id } : guestId ? { id: guestId } : null;
  const guest = account === null && guestId !== null;
  const storage = useBookStorage(bookId);
  const scope = `capture:${pane.instance}:${flow}`;
  const [storedFiles, setFiles] = useState<PendingAttachment[]>([]);
  const files = user && bookId ? captureDraftsFor(storedFiles, user.id, bookId, scope) : [];
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const key = `${user?.id}:${bookId}:${scope}`;
  useEffect(() => { if (guestId) void pruneStaleGuestDrafts(guestId).catch(() => undefined); }, [guestId]);
  const activeKey = useRef(key); activeKey.current = key;
  const workingRef = useRef(false);
  const reload = useCallback(async () => {
    if (!user || !bookId) { setFiles([]); return; }
    const found = await pendingAttachments(user.id);
    if (activeKey.current === key) setFiles(captureDraftsFor(found, user.id, bookId, scope));
  }, [user?.id, bookId, scope, key]);
  useEffect(() => {
    setFiles([]); setError(null);
    void reload().catch(e => setError(errorMessage(e)));
    const listener = () => { void reload().catch(e => setError(errorMessage(e))); };
    window.addEventListener("attachments-pending", listener);
    return () => window.removeEventListener("attachments-pending", listener);
  }, [reload]);
  const limits = storage.data?.limits ?? { fileBytes: 100_000_000, entryFiles: 10, entryBytes: 200_000_000 };
  const limitsText = t("attachments.limits", { file: formatStorageBytes(limits.fileBytes), count: limits.entryFiles, entry: formatStorageBytes(limits.entryBytes) });

  async function mutate(action: () => Promise<void>) {
    if (workingRef.current || disabled || pendingWrites.has(key)) return;
    workingRef.current = true; setWorking(true); setError(null);
    const write = (async () => {
      try { await action(); await reload(); } catch (caught) { setError(errorMessage(caught)); }
      finally { workingRef.current = false; setWorking(false); }
    })();
    pendingWrites.set(key, write);
    await write;
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }
  async function add(incoming: File[]) {
    if (!user || !bookId) return;
    await mutate(async () => {
      const next = [...files];
      for (const blob of incoming) {
        const file: PendingAttachment = { id: uuidV7(), ownerId: user.id, bookId, entryIds: [], name: blob.name, blob, createdAt: Date.now(), error: null,
          draftLink: { scope, targets: targets.length === 1 ? [...targets] : [], resolved: {} } };
        next.push(file);
        if (!captureAttachmentLimit(next, limits)) throw new Error(limitsText);
        if (guest) await assertLocalRoom(blob.size);
        await savePendingAttachment(file);
      }
    });
  }
  async function associate(file: PendingAttachment, chosen: AttachmentTarget[]) {
    await mutate(async () => {
      if (chosen.length > 100) throw new Error(t("attachments.capture.targetLimit"));
      const next = resolveAttachmentDraft({ ...file, draftLink: { scope, targets: chosen, resolved: file.draftLink?.resolved ?? {} } }, {});
      if (!captureAttachmentLimit(files.map(item => item.id === file.id ? next : item), limits)) throw new Error(limitsText);
      await updatePendingAttachment(file, { entryIds: next.entryIds, ...(next.draftLink && { draftLink: next.draftLink }), error: next.error });
    });
  }
  /** 附件故障不能把已保存账目误报为保存失败；未完成的原件仍在下载与离线中可取回。 */
  async function commit(saved: Readonly<Record<string, string>>): Promise<void> {
    if (!user || !bookId) return;
    // 等待大文件落盘，避免保存账目时漏掉尚未写完的附件。
    await pendingWrites.get(key);
    workingRef.current = true; setWorking(true);
    try {
      for (const file of captureDraftsFor(await pendingAttachments(user.id), user.id, bookId, scope)) {
        const next = resolveAttachmentDraft(file, saved);
        await updatePendingAttachment(file, { entryIds: next.entryIds, ...(next.draftLink && { draftLink: next.draftLink }), error: next.error });
      }
      await reload();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { workingRef.current = false; setWorking(false); }
  }
  const panel = !user || !bookId ? null : <CaptureAttachmentPanel guest={guest} files={files} targets={targets} disabled={disabled || working} error={error} limitsText={limitsText}
    onAdd={add} onAssociate={associate} onRemove={file => mutate(() => removePendingAttachment(file))} />;
  return { panel, files, commit, working };
}

export function CaptureLayout({ children, panel }: { children: React.ReactNode; panel: React.ReactNode }) {
  const desktop = useDesktopActive();
  return desktop ? <div className="lv-capture-layout" data-panel={panel ? true : undefined}><div className="lv-capture-main">{children}</div>{panel ? <aside className="lv-capture-aside">{panel}</aside> : null}</div> : <>{children}</>;
}

export function CaptureMobileAttachments({ panel }: { panel: React.ReactNode }) {
  return useDesktopActive() ? null : <div className="lv-capture-mobile">{panel}</div>;
}

function CaptureAttachmentPanel({ guest, files, targets, disabled, error, limitsText, onAdd, onAssociate, onRemove }: {
  guest: boolean; files: PendingAttachment[]; targets: readonly AttachmentTarget[]; disabled: boolean; error: string | null; limitsText: string;
  onAdd: (files: File[]) => Promise<void>; onAssociate: (file: PendingAttachment, targets: AttachmentTarget[]) => Promise<void>; onRemove: (file: PendingAttachment) => Promise<void>;
}) {
  const { t } = useI18n(); const input = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const filesRef = useRef<HTMLUListElement>(null);
  useListMotion(filesRef, files.map(file => file.id).join("|"));
  const preview = files.find(file => file.id === previewId) ?? files.at(-1);
  return <section className="lv-capture-attachments" aria-label={t("attachments.title")}>
    <header><h2 className="text-section-title">{t("attachments.title")}</h2><span className="text-helper text-muted">{files.length} · {formatStorageBytes(files.reduce((sum, file) => sum + file.blob.size, 0))}</span></header>
    <button type="button" className="lv-capture-upload" data-dragging={dragging || undefined} disabled={disabled} onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) void onAdd(Array.from(event.dataTransfer.files)); }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
      <strong className="text-button">{t("attachments.add")}</strong><span className="text-helper">{t("attachments.capture.drop")}</span>
    </button>
    <input ref={input} className="sr-only" type="file" multiple accept="image/*,audio/*,application/pdf,.txt,.csv" disabled={disabled} onChange={event => { void onAdd(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <p className="text-helper-relaxed text-muted">{limitsText}</p>
    {error ? <p role="alert" className="text-helper text-danger">{error}</p> : null}
    {guest ? <GuestStorageNote /> : null}
    {files.length === 0 ? <p className="text-helper-relaxed text-muted">{t(guest ? "attachments.guest.captureHint" : "attachments.capture.hint")}</p> : <>
      {/* 用途（1.19.57）：可点选预览的文件行是可点击卡片（选中用 aria-pressed），「删除」是次要危险操作。
          材质只在浅色手机外壳生效（s19/entry-workspace.css「附件区」）；电脑版、Pad、Original 与深色仍是原控件外观。 */}
      <ul ref={filesRef} className="lv-capture-files">{files.map(file => { const selected = file.id === preview?.id; return <li key={file.id} data-selected={selected || undefined}>
        <button type="button" onClick={() => setPreviewId(file.id)} aria-pressed={selected} {...materialAttributes("interactive")} className="lv-capture-file lv-material lv-material-effects lv-press"><strong className="text-body">{file.name}</strong><small className="text-helper text-muted">{formatStorageBytes(file.blob.size)} · {file.draftLink?.targets.length ? t("attachments.associated", { count: file.draftLink.targets.length }) : t("attachments.capture.unassigned")}</small></button>
        <button type="button" {...materialAttributes("danger-quiet")} className="lv-desk-link lv-material lv-press text-helper" disabled={disabled} onClick={() => void onRemove(file)}>{t("attachments.remove")}</button>
      </li>; })}</ul>
      <Reveal open={preview !== undefined} keep={false}>{preview ? <>
        <DraftPreview key={preview.id} file={preview} />
        <fieldset className="lv-capture-targets" disabled={disabled}><legend className="text-card-title">{t("attachments.capture.targets")}</legend>
          <div className="flex flex-wrap gap-3 py-2"><button type="button" {...CAPSULE} className={CAPSULE_CLASS} disabled={targets.length === 0} onClick={() => void onAssociate(preview, [...targets])}>{t("attachments.capture.all")}</button><button type="button" {...CAPSULE} className={CAPSULE_CLASS} onClick={() => void onAssociate(preview, [])}>{t("attachments.capture.clear")}</button></div>
          {targets.length > 8 ? <input type="search" aria-label={t("attachments.capture.search")} placeholder={t("attachments.capture.search")} value={search} onChange={event => setSearch(event.target.value)} /> : null}
          <div className="lv-capture-target-list">{[...targets, ...(preview.draftLink?.targets.filter(item => !targets.some(target => target.id === item.id)) ?? [])].filter(item => item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(target => {
            const selected = preview.draftLink?.targets.some(item => item.id === target.id) ?? false;
            return <label key={target.id}><input type="checkbox" checked={selected} onChange={() => void onAssociate(preview, selected ? preview.draftLink!.targets.filter(item => item.id !== target.id) : [...(preview.draftLink?.targets ?? []), target])} /><span>{target.label}{preview.draftLink?.resolved[target.id] ? ` · ${t("attachments.capture.saved")}` : ""}</span></label>;
          })}</div>
          {targets.length === 0 ? <p className="text-helper text-muted">{t("attachments.capture.afterRecognition")}</p> : null}
          {targets.length > 100 ? <p className="text-helper text-muted">{t("attachments.capture.targetLimit")}</p> : null}
          <p className="text-helper-relaxed text-muted">{t("attachments.capture.associationHint")}</p>
        </fieldset>
      </> : null}</Reveal>
    </>}
  </section>;
}

function DraftPreview({ file }: { file: PendingAttachment }) {
  const { t } = useI18n(); const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(file.blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [file.blob]);
  if (!url) return null;
  const type = file.blob.type;
  // 预览窗是展示卡片（display）；不能预览的文件给一个胶囊「下载」。
  return <div className="lv-capture-preview lv-material lv-material-effects" {...materialAttributes("display")} aria-label={t("attachments.preview")}>
    {type.startsWith("image/") ? <img src={url} alt={file.name} /> : type === "application/pdf" || /\.pdf$/i.test(file.name) ? <AttachmentPdf url={url} /> : type.startsWith("audio/") ? <audio src={url} controls preload="metadata" /> : <a {...CAPSULE} className={CAPSULE_CLASS} href={url} download={file.name}>{t("attachments.download")}</a>}
  </div>;
}
