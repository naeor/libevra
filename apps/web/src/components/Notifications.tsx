import { useState, type ReactNode } from "react";

import { isChineseLocale, t as translate, useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import {
  useDecideNotification,
  useMarkNotificationsRead,
  useNotifications,
  type NotificationView,
} from "../lib/queries.js";

/**
 * The bell, and the panel it opens.
 *
 * ⚠️ **The owner described this screen in detail, and the details are the design**:
 *
 * > *"在协作者页面顶部增加一个'提醒'按钮，用一个铃铛图形表示，点开后会进入提醒板块。
 * > 把这些需要他处理的内容都放到通知板块中……每个通知就像明细一样，在板块中占一个小矩形
 * > （显示部分简略信息，标题以及发送者和发送者留言（只显示前n个字）），下方有同意和拒绝两个按钮，
 * > 直接点击小矩形也可以进入信息-详情页面查看详情。有待处理信息时，提醒按钮右上角会出现小红点。"*
 *
 * So: a bell at the top, a red dot when something is waiting, one rectangle per notification with a
 * truncated message, **two buttons on the rectangle itself**, and the whole rectangle is also a way
 * in to the detail.
 *
 * ⚠️ **"我已看过" and "我已处理" are different states, and both are kept.** Opening the panel marks
 * things read (the dot clears), but a notification stays in the pending list until it is answered —
 * **clearing a dot must never look like answering a question.**
 */
export function NotificationBell({
  showHeading = true,
  extraAction,
  panelClassName,
}: {
  readonly showHeading?: boolean;
  /**
   * ⚠️ **One button next to the bell, not a second bell.**
   *
   * The 账本/协作 header now carries two actions (通知 + 账本设置). They must share one size, one
   * outline and one focus treatment, so the second one rides *inside* this component's action row
   * rather than being positioned beside it by the page. The page still owns where it goes and what
   * it does; this component only owns the row it sits in.
   */
  readonly extraAction?: ReactNode;
  /** 吸顶栏中的面板作为浮层，避免通知内容改变标题栏的测量高度。 */
  readonly panelClassName?: string;
} = {}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const inbox = useNotifications();
  const markRead = useMarkNotificationsRead();
  const { t } = useI18n();

  const unread = inbox.data?.unreadCount ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={
          /**
           * ⚠️ **Two placements, one component.** It used to sit in a card with a 「提醒」 heading on
           * its own row. In 1.10.05 the owner moved it into **the green header's top-right corner** —
           * *"在账本／协作一级页面绿色顶部区域右上角直接提供通知铃铛"* — where a heading would be
           * noise, and where the panel below needs to be full width rather than beside a label.
           *
           * ⚠️ **The heading is hidden rather than removed**, because the panel is shared: a second
           * bell somewhere else can still ask for it, and **one component with a flag beats two
           * copies that drift** (`教训.md` §8.12).
           */
          showHeading ? "flex items-center justify-between gap-3" : "flex justify-end"
        }
      >
        {showHeading ? <h2 className="text-body text-muted">{t("collab.notifications.heading")}</h2> : null}

        <div className="flex items-center gap-2">
          <button
          type="button"
          onClick={() => {
            setOpen((was) => {
              const next = !was;
              /**
               * ⚠️ **Opening it is what clears the dot**, and the request is fired and not awaited:
               * the panel must appear at once, and a failed "mark read" is not a reason to keep the
               * reader waiting. The next load reports the truth either way.
               */
              if (next && unread > 0) void markRead.mutateAsync().catch(() => undefined);
              return next;
            });
          }}
          aria-expanded={open}
          aria-label={
            unread > 0
              ? t("collab.notifications.bellUnread", { count: unread })
              : t("collab.notifications.bell")
          }
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition hover:bg-canvas"
        >
          <BellIcon />
          {unread > 0 ? (
            <span
              data-testid="notification-dot"
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface"
            />
          ) : null}
          </button>
          {extraAction}
        </div>
      </div>

      {open ? <div className={panelClassName} data-header-panel={panelClassName ? "" : undefined}><NotificationPanel /></div> : null}
    </div>
  );
}

/** 导出只为测试能直接渲染面板（铃铛默认收起，静态渲染打不开它）。 */
export function NotificationPanel(): React.JSX.Element {
  const inbox = useNotifications();
  const decide = useDecideNotification();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { t } = useI18n();

  if (inbox.isPending) return <p className="text-body text-muted">{t("collab.notifications.loading")}</p>;
  if (!inbox.isSuccess) return <p className="text-body text-danger">{t("collab.notifications.loadFailed")}</p>;

  const { notifications, pendingCount } = inbox.data;

  return (
    <div className="flex flex-col gap-3">
      {error !== null ? (
        <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </p>
      ) : null}

      {notifications.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-5 py-4 text-body text-muted">
          {t("collab.notifications.empty")}
        </p>
      ) : null}

      {pendingCount > 0 ? (
        <p className="text-helper text-muted">
          {t("collab.notifications.pending", { count: pendingCount })}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {notifications.map((notification) => (
          <li key={notification.id}>
            <NotificationCard
              notification={notification}
              expanded={expanded === notification.id}
              busy={decide.isPending}
              onToggle={() => {
                setExpanded((current) => (current === notification.id ? null : notification.id));
              }}
              onDecide={(decision) => {
                setError(null);
                void decide
                  .mutateAsync({ id: notification.id, decision })
                  .catch((caught: unknown) => {
                    setError(errorMessage(caught));
                  });
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One notification: a rectangle with a summary, two buttons, and the full text behind a tap.
 *
 * ⚠️ **The two buttons are on the rectangle rather than behind the detail view**, which is what the
 * owner asked for: deciding is the common action, and making somebody open a card to find the
 * buttons would add a tap to the thing they came to do.
 */
function NotificationCard({
  notification,
  expanded,
  busy,
  onToggle,
  onDecide,
}: {
  readonly notification: NotificationView;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onDecide: (decision: "accepted" | "declined") => void;
}): React.JSX.Element {
  const decided = notification.status !== "pending";
  const { t } = useI18n();
  const message = messageOf(notification);

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-1 px-5 py-4 text-left"
      >
        {/* S16：英文标题更长，标题与状态徽标允许换行 */}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink [overflow-wrap:anywhere]">
          {titleOf(notification)}
          {statusBadge(notification)}
        </span>

        <span className="text-helper text-muted [overflow-wrap:anywhere]">
          {t("collab.notifications.sender", {
            name: notification.sender.displayName,
            accountNumber: notification.sender.accountNumber,
          })}
        </span>

        {message === null ? null : (
          <span className="text-helper-relaxed text-muted [overflow-wrap:anywhere]">
            {expanded ? message : truncate(message, 40)}
          </span>
        )}
      </button>

      {decided ? (
        <p className="border-t border-line px-5 py-3 text-helper text-muted">
          {notification.status === "accepted"
            ? t("collab.notifications.acceptedNote")
            : t("collab.notifications.declinedNote")}
        </p>
      ) : (
        <div className="flex gap-3 border-t border-line px-5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onDecide("accepted");
            }}
            className="flex-1 rounded-field bg-brand px-4 py-2 text-sm text-on-brand transition hover:bg-brand-dark disabled:opacity-45"
          >
            {t("collab.notifications.accept")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onDecide("declined");
            }}
            className="flex-1 rounded-field bg-canvas px-4 py-2 text-body text-muted transition hover:text-ink disabled:opacity-45"
          >
            {t("collab.notifications.decline")}
          </button>
        </div>
      )}
    </article>
  );
}

/** The heading on one card. */
function titleOf(notification: NotificationView): string {
  /**
   * ⚠️ **There used to be a `collaborator_request` branch here, and it is gone (1.10.05)** — the
   * account-level system it belonged to was removed, and the server stopped returning that kind.
   *
   * ⚠️ **Nothing was left behind for old rows, on purpose.** The migration deletes the ones that were
   * still pending — *"不能让用户收到点击后无法完成的历史通知"* — and the ones already decided are kept as
   * history but filtered out of this list by the server, so **a card for a retired kind can never
   * reach this function.** A branch here would be dead code that implies the case still exists.
   */
  if (notification.kind === "referral_reminder") return translate("collab.notifications.referralTitle");
  return notification.book === null
    ? translate("collab.notifications.bookInvite")
    : translate("collab.notifications.bookInviteTo", { name: notification.book.name });
}

/**
 * The text under the sender line.
 *
 * ⚠️ S16：`book_invite` 的附言是邀请人自己写的话（用户数据），原样显示。`referral_reminder` 的正文
 * 却是**服务器用中文写成的固定句子**（`apps/api/src/collab/referral.ts`）：中文界面照旧显示原文，
 * 其它语言按通知类型换成同义译文，人名取发出邀请码的人（即发送者）。
 */
function messageOf(notification: NotificationView): string | null {
  if (notification.message === null) return null;
  if (notification.kind === "referral_reminder" && !isChineseLocale()) {
    return translate("collab.notifications.referralMessage", { name: notification.sender.displayName });
  }
  return notification.message;
}

/** A decided card says so; a pending one says nothing, because the buttons already say it. */
function statusBadge(notification: NotificationView): React.JSX.Element | null {
  if (notification.status === "accepted") {
    return (
      <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-micro text-brand-dark">
        {translate("collab.notifications.accepted")}
      </span>
    );
  }

  if (notification.status === "declined") {
    return (
      <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-micro text-muted">
        {translate("collab.notifications.declined")}
      </span>
    );
  }

  return null;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function BellIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
