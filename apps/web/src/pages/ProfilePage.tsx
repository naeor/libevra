import { useState } from "react";

import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { ProfileAccountNumberSheet } from "../components/ProfileAccountNumberSheet.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { formatInstant } from "../lib/datetime.js";

function formatDateTime(iso: string): string {
  return formatInstant(iso, {
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
  const { t } = useI18n();

  if (!user) return <></>;

  return (
    <InnerPage title={t("account.profile.title")} backTo="/me">
      {/* 个人资料独立保留紧凑的只读样式，不回调共享 FactRow 的全站文字层级。 */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-card border border-line bg-surface p-5 text-body">
        <dt className="text-muted">{t("account.profile.nickname")}</dt>
        <dd className="min-w-0 break-words text-right text-ink">{user.displayName}</dd>
        <dt className="text-muted">{t("account.profile.username")}</dt>
        <dd className="min-w-0 break-words text-right text-ink">{user.username}</dd>
        <dt className="text-muted">{t("account.profile.accountNumber")}</dt>
        <dd className="min-w-0 text-right">
          <button
            type="button"
            aria-label={t("account.profile.accountNumberAction", { number: user.accountNumber })}
            aria-haspopup="dialog"
            aria-expanded={numberOpen}
            onClick={() => setNumberOpen(true)}
            className="-my-3 inline-flex min-h-11 max-w-full items-center rounded-sm py-3 font-mono text-ink tabular-nums transition-colors hover:text-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
          >
            {user.accountNumber}
          </button>
        </dd>
        <dt className="text-muted">{t("account.profile.createdAt")}</dt>
        <dd className="min-w-0 text-right text-ink tabular-nums">{formatDateTime(user.createdAt)}</dd>
      </dl>

      {/**
        * ⚠️ **安全提醒保留，而且放在恢复码旁边**——它说的就是恢复码。所有者明确：*"不要删除安全提醒。"*
        * 生成新恢复码的入口本来只在 设置 → 账号安全；在讲恢复码的这一处也给出去处，读完说明就能处理。
        */}
      <ListGroup
        title={t("account.profile.recoveryCode")}
        footer={<span className="text-warn-dark">{t("account.profile.recoveryWarning")}</span>}
      >
        <ListRow label={t("account.profile.regenerate")} to="/settings/recovery-code" />
      </ListGroup>
      <ProfileAccountNumberSheet open={numberOpen} number={user.accountNumber} onClose={() => setNumberOpen(false)} />
    </InnerPage>
  );
}
