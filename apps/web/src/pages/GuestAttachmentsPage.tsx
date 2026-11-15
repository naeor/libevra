import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatStorageBytes } from "@libellum/shared";
import { InlineChoice } from "../components/ui/InlineChoice.js";
import { InnerPage } from "../components/Layouts.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { GuestAttachmentPreview, GuestStorageNote, useGuestAttachments, useGuestOwner, useObjectUrl, type GuestEntryLink } from "../components/GuestAttachments.js";
import { useDesktopSurface } from "../desktop/surface.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useEntryOrigin } from "../lib/entryReturn.js";
import { removeGuestAttachment, type GuestAttachment } from "../lib/guest/attachments.js";
import { readGuestBookFor } from "../lib/guest/data.js";

/** 游客的附件页：浏览这本游客账本的全部本机附件、筛选、预览、删除、打开所属账目。 */
export function guestAttachmentMatches(file: GuestAttachment, search: string, type: string): boolean {
  if (search.trim() !== "" && !file.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) return false;
  return type === "" || file.mediaType.startsWith(type);
}

export function sortGuestAttachments(files: readonly GuestAttachment[], sort: string): GuestAttachment[] {
  const order = [...files];
  if (sort === "oldest") order.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "largest") order.sort((a, b) => b.sizeBytes - a.sizeBytes);
  else if (sort === "smallest") order.sort((a, b) => a.sizeBytes - b.sizeBytes);
  else order.sort((a, b) => b.createdAt - a.createdAt);
  return order;
}

function Tile({ file, onOpen }: { file: GuestAttachment; onOpen: () => void }): React.JSX.Element {
  const isImage = file.mediaType.startsWith("image/");
  const url = useObjectUrl(isImage ? file.blob : null);
  return <button className="lv-attachment-tile" onClick={onOpen}>
    <div>{isImage && url ? <img src={url} alt="" loading="lazy" /> : <span className="text-muted">{file.mediaType.split("/")[1]}</span>}</div>
    <strong>{file.name}</strong><small>{formatStorageBytes(file.sizeBytes)}</small>
  </button>;
}

export function GuestAttachmentsPage(): React.JSX.Element {
  const { t } = useI18n();
  const entryOrigin = useEntryOrigin();
  const desktop = useDesktopSurface() !== null;
  const { bookId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const guestId = useGuestOwner();
  const list = useGuestAttachments(guestId, bookId);
  const [search, setSearch] = useState(""), [type, setType] = useState(""), [sort, setSort] = useState("newest");
  const [picking, setPicking] = useState<"type" | "sort" | null>(null);
  const [remove, setRemove] = useState<GuestAttachment | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ReadonlyMap<string, GuestEntryLink>>(new Map());
  useEffect(() => {
    if (!guestId || !bookId) return;
    let active = true;
    void readGuestBookFor(guestId, bookId).then((data) => {
      if (!active || data === null) return;
      const map = new Map<string, GuestEntryLink>();
      for (const row of data.transactions) map.set(row.id, { id: row.id, label: `#${String(row.seq).padStart(6, "0")}`, deleted: false });
      for (const row of data.deleted) map.set(row.id, { id: row.id, label: `#${String(row.seq).padStart(6, "0")}`, deleted: true });
      setEntries(map);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [guestId, bookId, list.items]);
  const items = useMemo(() => sortGuestAttachments((list.items ?? []).filter((file) => guestAttachmentMatches(file, search, type)), sort), [list.items, search, type, sort]);
  const selected = (list.items ?? []).find((file) => file.id === params.get("file"));
  const linksOf = (file: GuestAttachment): GuestEntryLink[] => file.entryIds.map((id) => entries.get(id) ?? { id, label: id.slice(0, 8), deleted: false });
  return <InnerPage title={t("attachments.all")} backTo={`/books/${bookId}`} wideWidth="full">
    <div className="lv-attachment-browser" data-preview={desktop && !!selected ? "true" : undefined}><div className="lv-attachment-browser-list">
      <section className="lv-attachments"><GuestStorageNote bookId={bookId} refreshKey={list.items?.length ?? 0} /></section>
      <div className="lv-attachment-filters"><input className="lv-desk-input min-w-0 w-full" type="search" placeholder={t("attachments.search")} aria-label={t("attachments.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <InlineChoice label={t("attachments.type")} value={type} open={picking === "type"} onToggle={() => setPicking((p) => p === "type" ? null : "type")} onClose={() => setPicking(null)} onSelect={setType} options={[
          { id: "", label: t("attachments.anyType") }, { id: "image/", label: t("attachments.image") }, { id: "application/pdf", label: "PDF" }, { id: "audio/", label: t("attachments.audio") }, { id: "text/", label: t("attachments.text") },
        ]} />
        <InlineChoice label={t("attachments.sort")} value={sort} open={picking === "sort"} onToggle={() => setPicking((p) => p === "sort" ? null : "sort")} onClose={() => setPicking(null)} onSelect={setSort} options={[
          { id: "newest", label: t("attachments.sortTimeDesc") }, { id: "oldest", label: t("attachments.sortTimeAsc") }, { id: "largest", label: t("attachments.sortStorageDesc") }, { id: "smallest", label: t("attachments.sortStorageAsc") },
        ]} />
      </div>
      {list.error ? <p role="alert" className="text-danger">{list.error}</p> : null}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      {list.items === null ? <p className="text-muted">{t("attachments.guest.loading")}</p> : null}
      <div className="lv-attachment-gallery">{items.map((file) => <article key={file.id}><Tile file={file} onOpen={() => setParams({ file: file.id })} />
        <div className="flex flex-wrap gap-2 py-2">{linksOf(file).map((entry) => <Link className="text-helper text-brand" key={entry.id} to={`/transactions/${entry.id}`} state={entryOrigin}>{entry.label}{entry.deleted ? ` · ${t("attachments.guest.entryDeleted")}` : ""}</Link>)}
          <button className="ml-auto text-helper text-danger" onClick={() => setRemove(file)}>{t("attachments.remove")}</button></div></article>)}</div>
      {list.items !== null && items.length === 0 ? <p className="text-muted">{t("attachments.empty")}</p> : null}
    </div>{selected ? <GuestAttachmentPreview file={selected} inline={desktop} entries={linksOf(selected)} onClose={() => setParams({})} /> : null}</div>
    <ConfirmDialog open={remove !== null} busy={busy} title={t("attachments.remove")} description={t("attachments.guest.removeConfirm")} confirmLabel={t("attachments.remove")} tone="danger" onCancel={() => setRemove(null)} onConfirm={() => {
      if (!remove || !guestId || busy) return;
      setBusy(true);
      void removeGuestAttachment(guestId, remove.id).then(() => { if (params.get("file") === remove.id) setParams({}); setRemove(null); void list.reload(); }).catch((e: unknown) => setError(errorMessage(e))).finally(() => setBusy(false));
    }} />
  </InnerPage>;
}
