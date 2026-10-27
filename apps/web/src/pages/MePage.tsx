import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { UserAvatar } from "../components/UserAvatar.js";
import { TabPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { useI18n } from "../i18n/index.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useBooks, useCurrentBookId } from "../lib/queries.js";
import { formatAppVersion } from "../lib/version.js";
import { GuestMePage } from "./GuestMePage.js";

/**
 * `/me` for either identity.
 *
 * ⚠️ **One page, two data sources — the same rule as the ledger screens.** A guest gets a variant
 * of the same account page (same frame, same row rhythm, same dialogs) containing only what can
 * actually work without an account: local settings, switching to a formal account, and data cleanup.
 * The account implementation below is unchanged.
 */
export function MePage(): React.JSX.Element {
  const guest = useGuestMode();
  return guest ? <GuestMePage /> : <AccountMePage />;
}

/**
 * The account screen.
 *
 * Shaped like the account page of a phone's settings, because that is the
 * pattern people already know for "the things about me": a mark, a name, then
 * a list of places to go. Everything that used to be crammed into the header —
 * the account number, the settings gear — has moved to the place its label
 * says it belongs, which is also why the account number now appears once.
 *
 * Signing out is deliberately separated from everything else: bottom, on its
 * own, in the warning colour, behind a confirmation like any other action that
 * cannot be trivially undone.
 */
function AccountMePage(): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const currentBookId = useCurrentBookId();
  const books = useBooks();
  const { t } = useI18n();

  if (!user) return <></>;

  const currentBook = books.data?.books.find((book) => book.id === currentBookId);

  /**
   * One list, in the order somebody would look for things: who I am, then
   * what I manage, then settings.
   *
   * ⚠️ **分类管理 / 支付方式 / 标签 不再列在这里（S13-E）。** 这三样属于**某本账**——
   * 同一个账号在不同账本里可以有不同分类——所以入口迁往账本设置页。页面与路由
   * （`/categories`、`/payment-methods`、`/tags`）本轮不动，只删这一屏的入口。
   */
  const links: { to: string; label: string; hint?: string }[] = [
    { to: "/profile", label: t("account.me.profile") },
    /**
     * ⚠️ **S16-A：「我的账本」打开的是当前账本的详情，而不是账本空间的开始页。**
     *
     * 所有者：*"「我的账本」仍然指向旧的账本空间开始页。请调整为进入当前选中账本的详情页。"*
     * 目标由 `myBookTarget` 决定（见下方），**不写死任何账本 id**；第二行显示当前账本的名字，
     * 取代原来那行用户名（用户名与这一行的意思无关）。
     */
    {
      to: myBookTarget(currentBookId, books.data?.books),
      label: t("account.me.myLedger"),
      hint:
        currentBook?.name ??
        (currentBookId === null ? t("account.me.myLedgerChoose") : t("account.me.myLedgerHint")),
    },
    { to: "/downloads", label: t("account.me.downloads"), hint: t("account.me.downloadsHint") },
    /**
     * ⚠️ **The version, where somebody looks when something is wrong.**
     *
     * The owner asked for it here rather than in 设置: "在账户中加入软件更新部分". That is the
     * right place — a version screen is consulted when the program is misbehaving, and the
     * account screen is where the other "about this device and this account" rows live.
     */
    { to: "/update", label: t("account.me.updates"), hint: t("account.me.updatesHint", { version: formatAppVersion() }) },
    { to: "/settings", label: t("account.me.settings"), hint: t("account.me.settingsHint") },
  ];

  return (
    <TabPage active="/me" onNavigate={(to) => void navigate(to)}>
      {/*
        The band is taller than its contents and centres them, rather than
        hanging the mark off the top edge with all the slack left underneath.
        The min-height is what keeps the visual weight in the middle of the
        colour instead of at its top.
      */}
      <header className="flex min-h-64 flex-col items-center justify-center gap-3 bg-brand px-6 py-10 text-on-brand">
        <UserAvatar avatarId={user.avatarId} className="size-24 ring-4 ring-on-brand" />
        <p className="mt-1 truncate text-page-title">{user.displayName}</p>
        <p className="text-xs text-on-brand/75">@{user.username}</p>
      </header>

      <nav className="px-6 pt-5">
        {/**
          * ⚠️ **The row padding is `px-5`, and that is the list convention, not a preference.**
          *
          * The owner's ruling (2026-10-14): *"外层容器不额外设置水平内边距；每一行自行管理内边距；
          * 水平内边距原则上为 20px；分隔线自然贯通列表容器."*
          *
          * ⚠️ **This list was the last one still on `px-6`.** Settings and the category manager had
          * already settled on `px-5`, and the markup here is otherwise *identical* to theirs — same
          * `<ul>` inside the same `rounded-card` frame, same `<li>` → `<button>` → label + hint + `›`.
          * **Two lists with the same job and different padding is the defect**, and the fix is one
          * class rather than a new component.
          */}
        <ListGroup>
          {links.map((link) => (
            <ListRow
              key={link.to}
              label={link.label}
              detail={link.hint}
              to={link.to}
            />
          ))}
        </ListGroup>
      </nav>

      {/**
        * ⚠️ **The account-level referral code used to be rendered right here, and it moved again
        * (2026-10-13).** The owner's instruction: *"账户里边生成邀请码单独包装成一个入口，放到
        * 设置-账号安全里面."*
        *
        * ⚠️ **So it is now a row in 设置 → 账号安全, and the page behind it is `ReferralCodePage`.**
        * Its history is worth keeping in view, because each move was the same correction: it started
        * on the **ledger's collaboration screen** (wrong — it joins nobody to a ledger), then on
        * **账户** as an inline block (right category, wrong weight — it competed with this screen's
        * own list), and now **beside 密码 and 恢复码**, which are the other things that are about the
        * account itself.
        *
        * ⚠️ **The 设置 row names it, so this screen must not grow a second copy.** Two entry points
        * to one quota is how a screen ends up showing a number nothing maintains (`教训.md` §8.12).
        */}

      <div className="px-6 py-8">
        <button
          type="button"
          onClick={() => {
            setConfirmSignOut(true);
          }}
          className="w-full rounded-field bg-danger py-3.5 text-button-lg font-medium text-on-brand shadow-sm transition hover:bg-danger-dark"
        >
          {t("account.me.signOut")}
        </button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title={t("account.me.signOutTitle")}
        description={t("account.me.signOutDescription")}
        consequences={[t("account.me.signOutSession"), t("account.me.signOutRecovery")]}
        confirmLabel={t("account.me.signOut")}
        onCancel={() => {
          setConfirmSignOut(false);
        }}
        onConfirm={() => {
          setConfirmSignOut(false);

          /**
           * ⚠️ **Signing out replaces the entry instead of adding one, and that is the fix
           * for the loop the owner reported.**
           *
           * "如果登录的时候处于下载管理更多，退出时会退出到下载管理，然后再退出会返回上一步，
           * 也就是下载管理更多" — and his image of where it came from was close: "一般登录时也不会
           * 登录下载管理更多界面，修改一下保底逻辑吧."
           *
           * What happened: `RequireAuth` sends a signed-out user to `/login` with
           * `<Navigate replace>`, which replaces *that one entry* — so every screen the user
           * had visited is still in the browser's history behind it. Pressing 返回 walks back
           * through them, `RequireAuth` bounces each one to `/login`, and the user is thrown
           * forward again. **The history is the bug, not any single screen.**
           *
           * `replace` moves the current entry rather than pushing a new one, so signing out leaves
           * one entry behind instead of a trail — and there is nothing to bounce between.
           *
           * ⚠️ **S14-B: the destination is `/`, not `/login`.** With a persistent guest identity
           * on this browser, "signed out" means "no formal session, but a guest may still be here";
           * the startup routing decides between the guest workspace and the account entry. Sending
           * `/login` would race with the now-stale user state and bounce through the guest
           * redirect anyway — and without a guest it still lands on `/login`.
           */
          void logout().then(() => {
            void navigate("/", { replace: true });
          });
        }}
      />
    </TabPage>
  );
}

/**
 * **「我的账本」去哪里。**
 *
 * - 设备还不知道当前账本（新登录、本机数据被清理）→ 账本空间，在那里选一本；
 * - 账本列表已经读到，而当前账本不在其中（被移出、账本已弃置）→ 同样回到账本空间，
 *   **不打开一个注定"打不开"的详情页**；
 * - 其余情况（包括离线、列表还没读到）→ `/books/:id`。详情页自己能处理"读不到这本账"，
 *   并且只读、不会改变当前账本（见 `BookDetailPage`）。
 *
 * 地址里带的是设备当前账本的 id，所以刷新、返回都能重新回答"这是哪一本"。
 */
export function myBookTarget(
  currentBookId: string | null,
  books: readonly { readonly id: string }[] | undefined,
): string {
  if (currentBookId === null) return "/start";
  if (books !== undefined && !books.some((book) => book.id === currentBookId)) return "/start";
  return `/books/${currentBookId}`;
}
