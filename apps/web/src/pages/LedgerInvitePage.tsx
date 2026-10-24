import { useState } from "react";
import { Link } from "react-router";

import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { MemberList } from "../components/MemberList.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { useInviteToBook, useLedger, useLookupAccount, type DirectoryAccount } from "../lib/queries.js";

/**
 * **邀请成员 —— 直接邀请某个人加入当前账本。**
 *
 * ⚠️ **This page used to send people somewhere else.** It said *"在「协作者」页面按对方账号编号找到
 * 他，然后邀请他加入这本账"* and offered a 去邀请 button pointing at `/collaborators`. The owner's
 * complaint is the reason it now does the work itself:
 *
 * > *"不再通过「邀请新成员 → 去邀请 → 协作者」这一冗长路径."*
 *
 * ⚠️ **⚠️ The server never required the detour.** `POST /books/invite` has taken an account number
 * and a role directly since 2026-10-12 — the account-level collaborator step in front of it was
 * removed then. **What was left was the screen still describing it**, which is why this file changed
 * and the route did not.
 *
 * ⚠️ **The flow is one confirmation, and it is the invitee's**: search → pick a role → send →
 * they accept → they are a member. *"一次账本邀请只需要一次接受确认"*, and *"邀请发出时不能立即授予
 * 账本访问权限."* Nothing on this screen grants anything; it only asks.
 */
export function LedgerInvitePage(): React.JSX.Element {
  const ledger = useLedger();
  const lookup = useLookupAccount();
  const invite = useInviteToBook();

  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<DirectoryAccount | null>(null);
  const [invitation, setInvitation] = useState<
    { id: string; status: "pending" | "accepted" | "declined" } | null
  >(null);
  const [canInvite, setCanInvite] = useState(true);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  /**
   * S16：账本名是用户数据，原样插进句子；还没读到账本时用整句的“这本账”说法，
   * 而不是把“这本账”当成名字塞进引号（英文里会读成一个叫 this ledger 的账本）。
   */
  const bookName = ledger.data?.book.name;
  const subtitle = bookName === undefined
    ? t("collab.invite.subtitleCurrent")
    : t("collab.invite.subtitle", { name: bookName });

  /**
   * ⚠️ **One box for both ways of naming somebody**, because the server takes either and the user
   * should not have to classify what they typed. The shape decides: **eight digits is a number,
   * anything else is a username** — and the server validates both, so a wrong guess is a clear error
   * and not a silent miss.
   *
   * ⚠️ **Exact values only, both ways** (see `collab/directory.ts`): a prefix search would let
   * anybody walk the user base one character at a time. **Nothing here weakens that** — a partial
   * value simply finds nobody.
   */
  function lookupInput(): { accountNumber?: string; username?: string } {
    const value = query.trim();
    return /^[0-9]{8}$/.test(value) ? { accountNumber: value } : { username: value };
  }

  function runLookup(): void {
    const input = lookupInput();
    if ((input.accountNumber ?? input.username ?? "") === "") return;

    setError(null);
    setAccount(null);
    setInvitation(null);
    setSent(false);

    void lookup
      .mutateAsync(input)
      .then((found) => {
        setAccount(found.account);
        setInvitation(found.invitation);
        setCanInvite(found.canInvite);
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      });
  }

  function send(): void {
    if (account === null) return;

    setError(null);

    void invite
      .mutateAsync({
        ...(query.trim() !== "" && /^[0-9]{8}$/.test(query.trim())
          ? { accountNumber: account.accountNumber }
          : { username: account.username }),
        role,
      })
      .then(() => {
        setSent(true);
        /**
         * ⚠️ **Re-read the invitation rather than assuming it**, so the card shows what the server
         * now holds — including the "refreshed" case, where an invitation was already waiting and
         * this only changed its role.
         */
        return lookup.mutateAsync(lookupInput());
      })
      .then((again) => {
        setInvitation(again.invitation);
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
      });
  }

  return (
    <InnerPage
      title={t("collab.invite.title")}
      subtitle={subtitle}
      backTo="/ledger"
    >
      {/**
        * ⚠️ **The search card.** It is the whole point of the page: *"通过用户名或账号编号搜索目标用户"*
        * and *"选择目标用户及其账本权限"* and *"发送加入当前账本的邀请."*
        */}
      {/**
        * ⚠️ **S16-A：表单直接放在页面上。** 原来外面套了一张卡片、卡片里再写一个「邀请某个人」——
        * 页面标题已经是「邀请成员」，这一层标题和外框都只是重复。找到的人仍是一张浅绿卡片：
        * 它是"选中的对象"，权限选择与发送都属于它。
        */}
      <section aria-label={t("collab.invite.sectionLabel")} className="flex flex-col gap-4">

        <TextField
          label={t("collab.invite.queryLabel")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") runLookup();
          }}
          placeholder={t("collab.invite.queryPlaceholder")}
          hint={t("collab.invite.queryHint")}
          inputMode="text"
          autoComplete="off"
        />

        <div className="flex gap-3">
          <Button
            fullWidth={false}
            disabled={lookup.isPending || query.trim() === ""}
            onClick={runLookup}
          >
            {lookup.isPending ? t("collab.invite.searching") : t("collab.invite.search")}
          </Button>
        </div>

        {error === null ? null : (
          <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
            {error}
          </p>
        )}

        {/**
          * ⚠️ **Found, and what to do about it.** The role is chosen here rather than on a later
          * screen, which is the owner's step 4 — *"选择目标用户及其账本权限"* — and it travels with the
          * invitation (`notifications.payload`), so what the sender chose is what acceptance grants.
          */}
        {account === null ? null : (
          <div className="flex flex-col gap-4 rounded-card border border-brand/30 bg-brand-soft/30 p-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-base font-medium text-ink">{account.displayName}</span>
              <span className="truncate text-helper text-muted">
                {account.username} · <span className="font-mono">{account.accountNumber}</span>
              </span>
            </div>

            {account.alreadyMember ? (
              /** ⚠️ Stated instead of offering a button the server would refuse. */
              <p className="text-body-relaxed text-muted">
                {t("collab.invite.alreadyMember")}
              </p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-body text-ink">{t("collab.invite.roleLegend")}</legend>

                  {(
                    [
                      { value: "editor", label: t("collab.invite.roleEditor.label"), hint: t("collab.invite.roleEditor.hint") },
                      { value: "viewer", label: t("collab.invite.roleViewer.label"), hint: t("collab.invite.roleViewer.hint") },
                    ] as const
                  ).map((option) => (
                    <label key={option.value} className="flex items-start gap-3 text-body text-ink">
                      <input
                        type="radio"
                        name="invite-role"
                        value={option.value}
                        checked={role === option.value}
                        onChange={() => {
                          setRole(option.value);
                        }}
                        className="mt-1"
                      />
                      <span>
                        {option.label}
                        <span className="mt-0.5 block text-helper-relaxed text-muted">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                {/**
                  * ⚠️ **A viewer may not invite**, and the server refuses it too — the screen says so
                  * rather than hiding the button, because **a control that disappears reads as a bug**
                  * and the reason is something the reader can act on.
                  */}
                {canInvite ? (
                  <Button disabled={invite.isPending} onClick={send}>
                    {invite.isPending ? t("collab.invite.sending") : t("collab.invite.send")}
                  </Button>
                ) : (
                  <p className="rounded-field bg-canvas px-4 py-3 text-body-relaxed text-muted">
                    {t("collab.invite.viewerCannotInvite")}
                  </p>
                )}

                {/**
                  * ⚠️ **The state of an invitation already sent, from the server.** The owner asked
                  * that *"邀请接受或拒绝后，状态正确更新"* — and this is where the sender finds out,
                  * because they are the one looking the person up again.
                  */}
                {invitation === null ? null : (
                  <p className="text-helper-relaxed text-muted">
                    {invitation.status === "pending"
                      ? t("collab.invite.status.pending")
                      : invitation.status === "declined"
                        ? t("collab.invite.status.declined")
                        : t("collab.invite.status.accepted")}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {sent ? (
          <p role="status" className="rounded-field bg-brand-soft px-4 py-3 text-body text-brand-dark">
            {t("collab.invite.sent")}
          </p>
        ) : null}
      </section>

      {/**
        * ⚠️ **成员列表自己有外框**（`MemberList`），外面再包一张卡片就是"盒子套盒子"。
        * 这里只给它一个组名。
        */}
      <section className="flex flex-col gap-2">
        <h2 className="px-5 text-helper font-medium text-muted">{t("collab.invite.membersHeading")}</h2>
        <MemberList />
      </section>

      {/**
        * ⚠️ **The sharing link, named as the third way in.** The owner keeps the concepts apart —
        * 邀请成员（点名邀请）· 分享链接（链接邀请）· 邀请码（注册账号）— and this sentence is where
        * the second one is pointed at, so somebody holding a link need not go looking.
        *
        * ⚠️ **The registration-code half used to say 「账户」页面, which stopped being true when the
        * code moved to 设置 → 账号安全 (`ReferralCodePage`, 2026-10-13).** It is the same sentence
        * the sharing screen carries, and it now names the place that exists **and** the second,
        * real way one is issued since S13: an administrator creating it in the console.
        */}
      <p className="text-helper-relaxed text-muted">{t("collab.invite.otherWays")}</p>

      <Link to="/ledger" className="text-body text-brand transition hover:text-brand-dark">
        {t("collab.invite.backToLedger")}
      </Link>
    </InnerPage>
  );
}
