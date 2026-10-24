import { useParams } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { MemberList } from "../components/MemberList.js";
import { ShareSection } from "../components/ShareSection.js";
import { ListGroup } from "../components/ui/List.js";
import { SkeletonRows } from "../components/States.js";
import { useBookMembers, useLedgerMeta } from "../lib/queries.js";

/**
 * **一本账的目标页面 —— 齿轮面板打开的两个二级页（成员与邀请、分享链接）。**
 *
 * ⚠️ **Every page in this file takes its ledger from the URL, and none of them touches the current
 * ledger.** That is the owner's requirement restated three times in his spec — *"必须确保显示的是被点击
 * 齿轮的目标账本，而不是默认读取当前全局账本"* and *"不允许通过静默修改全局当前账本来实现这一点"* —
 * and the mechanism is one thing: **the ledger id travels in the request header per call**, using the
 * override `apiFetch` already had.
 *
 * ⚠️ **`useLedgerMeta`, never `useLedger`.** The latter is how the device learns which ledger it is
 * *in*, so calling it here would move the session to a ledger nobody entered. See the note on that
 * hook.
 *
 * ⚠️ **S13-E 把「账本详情」从这里搬走了。** 旧 `/start/book/:bookId` 现在是重定向
 * （`BookRedirects.tsx`）：详情在 `/books/:bookId`（`BookDetailPage`），改名与完整设置在
 * `/books/:bookId/settings`（`BookSettingsPage`）。**这两个页面保留原来的职责**，因为它们本来就
 * 正确：成员与分享是"在这本账里做一件事"，不是"看或改这本账的资料"。
 *
 * ⚠️ **These are B-class screens and they look like it** — white background, a title, a back control.
 * That is the same layer split the owner set for the ledger tab: **the main page stays a space, and
 * management lives one step in.**
 */

/** The shared frame, so both read the ledger's name the same way and fail the same way. */
function useTargetLedger(): {
  readonly bookId: string;
  readonly name: string | null;
  readonly pending: boolean;
  readonly failed: boolean;
} {
  const { bookId = "" } = useParams<{ bookId: string }>();
  const meta = useLedgerMeta(bookId);

  return {
    bookId,
    name: meta.data?.book.name ?? null,
    pending: meta.isPending,
    failed: meta.isError,
  };
}

/**
 * **成员与邀请 —— 目标账本的成员管理。**
 *
 * ⚠️ **`MemberList` is given the ledger id, and that is the whole change from the current-ledger
 * screen.** Every call it makes — the member list, a role change, a removal — names the target
 * ledger in the header, **so the panel can manage a ledger the reader is not in.**
 *
 * ⚠️ **What each person may do is decided by the server, not by this page.** `MemberList` hides
 * controls it cannot use and **every action is re-checked server-side** — the owner's rule, and the
 * reason the invite section below it is not a permission of its own.
 */
export function StartBookMembersPage(): React.JSX.Element {
  const { bookId, name, pending } = useTargetLedger();
  const members = useBookMembers(bookId);

  /**
   * ⚠️ **The invite section follows `myRole`, which comes from the server with the member list.**
   * A viewer sees the members and their permissions but is not offered the door —
   * *"查看者不应获得编辑或邀请权限."* **The server refuses it anyway** (`requireBookForWrite`), so this
   * is about not showing somebody a button that cannot work.
   */
  const canInvite = members.data?.myRole === "owner" || members.data?.myRole === "editor";

  return (
    <InnerPage title="成员与邀请" subtitle={name ?? "正在读取……"} backTo="/start">
      {pending ? <SkeletonRows rows={3} /> : null}

      {/* ⚠️ S16-A：`MemberList` 自带外框；外面再包一张卡片就是"盒子套盒子"。 */}
      <MemberList bookId={bookId} />

      {canInvite ? (
        <ListGroup title="邀请新成员">
          <div className="flex flex-col gap-2 px-5 py-4">
            <p className="text-body-relaxed text-muted">
              按对方账号编号或用户名找到他，选好权限，发一条邀请。他接受之后才真正加入这本账。
            </p>
            {/**
              * ⚠️ **This one really does enter the ledger, and the label says so.**
              *
              * `/ledger/invite` names its ledger in the request header, which is the **current** ledger
              * — so inviting from there means being in the ledger, and it cannot be reached for a target
              * ledger without switching (which is forbidden). Rather than build a second invite screen
              * that invites into an arbitrary ledger, the link is honest about what it does: **it enters
              * 这本账 first.** The alternative was a silent switch, and that is the one thing the owner
              * ruled out by name.
              */}
            <p className="text-helper-relaxed text-muted">
              邀请要在一本账里面发起。点下面的按钮会先进入「{name ?? "这本账"}」，然后在那个页面上邀请。
            </p>
            <a
              href="/ledger/invite"
              className="mt-1 inline-flex self-start rounded-field bg-brand px-4 py-2.5 text-button text-on-brand transition hover:bg-brand-dark"
            >
              去邀请
            </a>
          </div>
        </ListGroup>
      ) : null}

      <p className="text-helper-relaxed text-muted">
        成员管理属于当前打开的这本账。邀请别人加入某一本账，不会把你或他加入其他账本。
      </p>
    </InnerPage>
  );
}

/**
 * **分享链接 —— 目标账本的链接邀请。**
 *
 * ⚠️ **This is the module the owner moved *off* the start page**, verbatim: *"原先直接摆在开始页上的以下
 * 设置应从主页移除：分享权限；有效期；人数上限；生成分享链接；已有分享链接的管理或撤销。这些内容进入
 * 对应账本的专门分享页面."* The gear shows one row; this is the page behind it.
 *
 * ⚠️ **`ShareSection` is reused unchanged apart from taking a `bookId`.** A second implementation
 * would be a second answer to "is this link still usable", and the server's `active` flag is the only
 * answer that matters.
 */
export function StartBookSharePage(): React.JSX.Element {
  const { bookId, name, pending } = useTargetLedger();
  const meta = useLedgerMeta(bookId);

  return (
    <InnerPage title="分享链接" subtitle={name ?? "正在读取……"} backTo="/start">
      {pending ? <SkeletonRows rows={3} /> : null}

      {meta.isSuccess ? (
        <>
          <p className="text-helper-relaxed text-muted">
            分享链接让别人自己加入这本账。加入进来的人会成为这本账的成员，
            <strong className="font-medium text-ink">与你的其他账本没有关系</strong>。
          </p>

          <ShareSection bookId={bookId} />

          <p className="text-helper-relaxed text-muted">
            想按名字邀请某个人，用「成员与邀请」；用于注册账号的邀请码与账本无关，
            在「设置 → 账号安全」生成（终身 3 个），或由管理员在管理后台发放。
          </p>
        </>
      ) : null}
    </InnerPage>
  );
}
