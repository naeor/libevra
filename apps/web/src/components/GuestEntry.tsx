import { Link } from "react-router";

import { useI18n } from "../i18n/index.js";
import { createGuestIdentity } from "../lib/guest/identity.js";

/**
 * The quiet way in for somebody who is not ready to create an account.
 *
 * ⚠️ **It must exist, be easy to find, and be visibly lighter than "登录 / 创建账号".** The owner's
 * rule for the account entry is that a newcomer should be able to find the way forward, while the
 * primary actions keep their weight. So this is a text-height link under a hairline, in the same
 * place on every account screen, not a second filled button.
 *
 * ⚠️ **S14-C: guest mode is the real app, so this goes to `/` — not to a separate workspace.**
 * The click creates or reopens the persistent local identity; the route guard then renders the
 * same 明细/记账/分析 pages with the guest data source. A guest arriving at a fresh browser gets
 * the one-time welcome overlay from the app shell, which is the only guest-specific presentation
 * left.
 */
export function GuestEntry(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="auth-enter auth-enter-delayed mt-8 border-t border-line pt-5 text-center">
      <Link
        to="/"
        onClick={() => {
          // Idempotent: an existing identity is reused, never replaced. The result is deliberately
          // ignored here because the app reports a storage problem if there is one.
          createGuestIdentity();
        }}
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-field px-4 text-helper text-muted transition hover:text-ink focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        {t("auth.guestEntry")}
        <span aria-hidden="true" className="text-brand">
          ›
        </span>
      </Link>
    </div>
  );
}
