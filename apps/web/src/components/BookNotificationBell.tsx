import "./attachments.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import type { EntryChangeNoticeView } from "@libellum/shared";
import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";
import { formatMoney } from "../lib/format.js";
import type { Currency } from "@libellum/shared";

function describe(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(describe).join("、");
  if (typeof value === "object") {
    const row = value as { name?: unknown; tag?: unknown };
    return row.name ? String(row.name) : row.tag ? describe(row.tag) : JSON.stringify(value);
  }
  return String(value);
}

export function BookNotificationBell({ bookId, trigger, hiddenTrigger = false }: { bookId: string; trigger?: ReactNode; hiddenTrigger?: boolean }): React.JSX.Element | null {
  const { user } = useAuth(); const { t } = useI18n(); const client = useQueryClient();
  const [open, setOpen] = useState(false); const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const unread = useQuery({ queryKey: ["book-notices", user?.id, "unread"], enabled: !!user,
    queryFn: () => apiFetch<{ books: Record<string, number> }>("/book-notices/unread"), refetchInterval: 30_000 });
  const list = useInfiniteQuery({ queryKey: ["book-notices", user?.id, bookId], enabled: !!user && open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<{ items: EntryChangeNoticeView[]; nextCursor: string | null }>(`/books/${bookId}/notices`, { query: { cursor: pageParam ?? undefined } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined, staleTime: 0 });
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => {
    if (!open || !list.data) return;
    const ids = list.data.pages.flatMap((p) => p.items).filter((n) => !n.readAt).map((n) => n.id);
    if (ids.length) void (async () => { for (let i = 0; i < ids.length; i += 200) await apiFetch(`/books/${bookId}/notices/read`, { method: "POST", body: { ids: ids.slice(i, i + 200) } }); })()
      .then(() => client.invalidateQueries({ queryKey: ["book-notices", user?.id, "unread"] }))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [open, list.data, bookId, user?.id, client]);
  if (!user) return null;
  return <div onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
    <button type="button" hidden={hiddenTrigger} className={trigger ? "lv-dash-message-link" : "lv-notice-bell"} aria-label={t("attachments.bookBell")} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {trigger ?? <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>}
      {(unread.data?.books[bookId] ?? 0) > 0 ? <span className={trigger ? "lv-dash-message-dot" : "lv-notice-dot"} /> : null}
    </button>
    <dialog ref={dialog} className="lv-notice-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header><h2 className="text-section-title">{t("attachments.bookBell")}</h2><button className="lv-desk-btn" onClick={() => setOpen(false)}>{t("attachments.close")}</button></header>
      {list.isPending ? <p className="p-4 text-muted">{t("common.status.loading")}</p> : null}
      {list.isError || error ? <p role="alert" className="p-4 text-danger">{error ?? errorMessage(list.error)}</p> : null}
      {list.isSuccess && !list.data.pages[0]?.items.length ? <p className="p-4 text-muted">{t("attachments.noticesEmpty")}</p> : null}
      <ul>{list.data?.pages.flatMap((p) => p.items).map((notice) => <li key={notice.id} className="border-b border-line p-4">
        <p className="text-body font-medium">{t("attachments.changed", { name: notice.actorName ?? "—", seq: String(notice.transactionSeq ?? "").padStart(6, "0") })}</p>
        <time className="text-helper text-muted">{formatInstant(notice.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time>
        {notice.entry?.note ? <p className="mt-2 text-body">{notice.entry.note}</p> : null}
        <dl className="my-3 flex flex-col gap-1">{Object.entries(notice.changes).map(([key, value]) => <div key={key} className="text-helper"><dt className="inline text-muted">{t(`attachments.field.${key}`, { defaultValue: key })} · </dt>
          <dd className="inline">{key === "amountCents" && notice.entry?.currency ? `${formatMoney(Number(value.from), (notice.changes["currency"]?.from ?? notice.entry.currency) as Currency)} → ${formatMoney(Number(value.to), notice.entry.currency as Currency)}` : `${describe(value.from)} → ${describe(value.to)}`}</dd></div>)}</dl>
        {notice.transactionId ? <Link className="lv-desk-link text-helper" to={`/transactions/${notice.transactionId}?book=${bookId}`} onClick={() => setOpen(false)}>{t("desktop.entries.panel")} →</Link> : null}
      </li>)}</ul>
      {list.hasNextPage ? <button className="lv-desk-btn m-4" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("attachments.more")}</button> : null}
    </dialog>
  </div>;
}
