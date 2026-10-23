import { InnerPage } from "../components/Layouts.js";
import { CopyInline, FactRow, ListGroup, ListRow } from "../components/ui/List.js";
import { useAuth } from "../auth/AuthProvider.js";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Who you are, as the server knows it.
 *
 * Split out of the account screen on the owner's suggestion. The account
 * screen answers "where do I go"; this answers "what does the system know about
 * me", and those are different questions — mixing them is how the account
 * number ended up printed twice on one page.
 *
 * Nothing here is editable yet. Fields that look editable but are not would be
 * worse than fields that plainly are not, so the page states what each value is
 * for and leaves it at that until editing exists.
 */
export function ProfilePage(): React.JSX.Element {
  const { user } = useAuth();

  if (!user) return <></>;

  return (
    <InnerPage title="个人资料" backTo="/me">
      {/**
        * ⚠️ **S16-A：每一项的说明贴在它自己下面，不再在页面下半部分另列一遍。**
        *
        * 所有者：*"顶部已经展示昵称、用户名和账号编号，下方却又使用大型卡片逐项解释它们的作用。
        * 请减少重复信息，使必要解释更接近对应内容。"* 原来的「各项的作用」卡片把四个名字又写了一次；
        * 现在名字只出现一次，值在右边，作用写在同一行下面。
        *
        * ⚠️ **仍然是只读资料（`FactRow`），不是可点的设置行**：这里没有任何可编辑的项，
        * 排版规范 §15.3 也明确不要把这份 `<dl>` 改成设置菜单式的可点列表。
        */}
      <ListGroup as="dl" footer="用户名和账号编号可安全地分享给他人，以便对方将你添加为协作者。">
        <FactRow label="昵称" value={user.displayName} hint="应用内显示的名字，可以与其他人重复。" />
        <FactRow label="用户名" value={user.username} hint="登录时使用，全站唯一。协作者可以通过它找到你。" />
        <FactRow
          label="账号编号"
          value={user.accountNumber}
          mono
          action={<CopyInline text={user.accountNumber} />}
          hint="八位数字，与用户名等效，但更容易抄写和读出。协作者可以用它找到你。"
        />
        <FactRow label="注册时间" value={formatDateTime(user.createdAt)} />
      </ListGroup>

      {/**
        * ⚠️ **安全提醒保留，而且放在恢复码旁边**——它说的就是恢复码。所有者明确：*"不要删除安全提醒。"*
        * 生成新恢复码的入口本来只在 设置 → 账号安全；在讲恢复码的这一处也给出去处，读完说明就能处理。
        */}
      <ListGroup
        title="恢复码"
        footer={
          <span className="text-warn-dark">请勿向任何人透露恢复码。恢复码应被妥善保管。</span>
        }
      >
        <ListRow
          label="生成新的恢复码"
          detail="忘记密码时唯一的找回方式。它只在你注册时显示一次，服务器只保存它的哈希值，无法再取回原文。"
          to="/settings/recovery-code"
        />
      </ListGroup>
    </InnerPage>
  );
}
