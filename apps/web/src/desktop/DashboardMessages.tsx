import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { EntryChangeNoticeView } from "@libellum/shared";
import { useAuth } from "../auth/AuthProvider.js";
import { BookNotificationBell } from "../components/BookNotificationBell.js";
import { NotificationBell } from "../components/Notifications.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";
import { useNotifications } from "../lib/queries.js";

type Book = { readonly id: string; readonly name: string };

/** 只读预览；已读与处理操作仍由原有通知入口负责。 */
export function DashboardMessages({ books }: { books: readonly Book[] }) {
  const { user } = useAuth();
  const { t } = useI18n();
  return <section aria-label={t("desktop.dashboard.messages")}>
    <h2 className="text-card-title text-ink">{t("desktop.dashboard.messages")}</h2>
    {user ? <SignedInMessages userId={user.id} books={books} /> : <p className="text-helper text-muted">{t("desktop.dashboard.messagesEmpty")}</p>}
  </section>;
}

function SignedInMessages({ userId, books }: { userId: string; books: readonly Book[] }) {
  const { t } = useI18n();
  const inbox = useNotifications();
  const unread = useQuery({ queryKey: ["book-notices", userId, "unread"],
    queryFn: () => apiFetch<{ books: Record<string, number> }>("/book-notices/unread"), refetchInterval: 30_000 });
  const messages = (inbox.data?.notifications ?? []).filter(n => !n.readAt || n.status === "pending");
  const bookCount = books.reduce((n, book) => n + (unread.data?.books[book.id] ?? 0), 0);
  return <>
    {inbox.isPending || unread.isPending ? <p className="text-helper text-muted">{t("common.status.loading")}</p> : null}
    {inbox.isError || unread.isError ? <p role="status" className="text-helper text-muted">{t("desktop.dashboard.messagesFailed")}</p> : null}
    {inbox.isSuccess && unread.isSuccess && messages.length === 0 && bookCount === 0 ? <p className="text-helper text-muted">{t("desktop.dashboard.messagesEmpty")}</p> : null}
    <ul className="lv-dash-message-list">
      {messages.slice(0, 4).map(message => <li key={message.id} className="lv-dash-message-account">
        <div className="lv-dash-message-copy text-body">
          <span className="text-brand-dark">{message.kind === "referral_reminder" ? t("collab.notifications.referralTitle") : message.book ? t("collab.notifications.bookInviteTo", { name: message.book.name }) : t("collab.notifications.bookInvite")}</span>
          <small className="text-helper">{t("desktop.dashboard.accountMessage")} · {message.sender.displayName}</small>
          <small className="text-helper"><time>{formatInstant(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></small>
        </div>
      </li>)}
    </ul>
    {messages.length > 0 ? <NotificationBell showHeading={false} trigger={<span className="text-helper">{t("desktop.dashboard.accountMessages")} ({messages.length}) →</span>} /> : null}
    <ul className="lv-dash-message-list">
      {books.map(book => <BookMessage key={book.id} book={book} userId={userId} count={unread.data?.books[book.id] ?? 0} />)}
    </ul>
  </>;
}

function BookMessage({ book, userId, count }: { book: Book; userId: string; count: number }) {
  const { t } = useI18n();
  // 与铃铛共用查询，避免预览和详情各自保存一份通知；无新提醒时不逐本请求。
  const list = useInfiniteQuery({ queryKey: ["book-notices", userId, book.id], enabled: count > 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<{ items: EntryChangeNoticeView[]; nextCursor: string | null }>(`/books/${book.id}/notices`, { query: { cursor: pageParam ?? undefined } }),
    getNextPageParam: page => page.nextCursor ?? undefined, refetchInterval: count > 0 ? 30_000 : false });
  const latest = list.data?.pages.flatMap(page => page.items).find(item => !item.readAt);
  // 已读计数清零时只隐藏入口，保持已打开的详情窗口挂载。
  return <li><BookNotificationBell bookId={book.id} hiddenTrigger={count === 0} trigger={<span className="lv-dash-message-copy">
    <span className="text-body">{latest ? t("attachments.changed", { name: latest.actorName ?? "—", seq: String(latest.transactionSeq ?? "").padStart(6, "0") }) : t("desktop.dashboard.bookMessages", { count })}</span>
    <span className="lv-dash-message-book text-helper">{book.name}</span>
    {latest ? <small className="text-helper"><time>{formatInstant(latest.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time> · {t("desktop.dashboard.bookMessages", { count })}</small> : null}
  </span>} /></li>;
}
