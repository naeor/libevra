import { useState } from "react";

import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { ProfileAccountNumberSheet } from "../components/ProfileAccountNumberSheet.js";
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
 * Fields remain read-only. Only the account number opens its copy actions.
 */
export function ProfilePage(): React.JSX.Element {
  const { user } = useAuth();
  const [numberOpen, setNumberOpen] = useState(false);

  if (!user) return <></>;

  return (
    <InnerPage title="个人资料" backTo="/me">
      {/* 个人资料独立保留紧凑的只读样式，不回调共享 FactRow 的全站文字层级。 */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-card border border-line bg-surface p-5 text-body">
        <dt className="text-muted">昵称</dt>
        <dd className="min-w-0 break-words text-right text-ink">{user.displayName}</dd>
        <dt className="text-muted">用户名</dt>
        <dd className="min-w-0 break-words text-right text-ink">{user.username}</dd>
        <dt className="text-muted">账号编号</dt>
        <dd className="min-w-0 text-right">
          <button
            type="button"
            aria-label={`账号编号 ${user.accountNumber}，打开复制选项`}
            aria-haspopup="dialog"
            aria-expanded={numberOpen}
            onClick={() => setNumberOpen(true)}
            className="-my-3 inline-flex min-h-11 max-w-full items-center rounded-sm py-3 font-mono text-ink tabular-nums transition-colors hover:text-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft"
          >
            {user.accountNumber}
          </button>
        </dd>
        <dt className="text-muted">注册时间</dt>
        <dd className="min-w-0 text-right text-ink tabular-nums">{formatDateTime(user.createdAt)}</dd>
      </dl>

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
          to="/settings/recovery-code"
        />
      </ListGroup>
      <ProfileAccountNumberSheet open={numberOpen} number={user.accountNumber} onClose={() => setNumberOpen(false)} />
    </InnerPage>
  );
}
