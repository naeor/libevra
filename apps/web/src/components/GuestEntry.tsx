import { Link } from "react-router";

import { createGuestIdentity, guestEntryPath, readGuestIdentity } from "../lib/guest/identity.js";

/**
 * The quiet way in for somebody who is not ready to create an account.
 *
 * ⚠️ **It must exist, be easy to find, and be visibly lighter than "登录 / 创建账号".** The owner's
 * rule for the account entry is that a newcomer should be able to find the way forward, while the
 * primary actions keep their weight. So this is a text-height link under a hairline, in the same
 * place on every account screen, not a second filled button.
 *
 * ⚠️ **S14-B: clicking creates or reopens the persistent local guest identity.** The identity is
 * created here rather than on the workspace page so the first guest visit never shows an empty
 * "preparing" frame — `createGuestIdentity()` reuses an existing identity and is idempotent.
 * The destination is the identity's remembered guest page when there is one, so returning to guest
 * mode resumes where it was left rather than resetting to a welcome screen.
 */
export function GuestEntry(): React.JSX.Element {
  const existing = readGuestIdentity();
  const destination = guestEntryPath(existing);

  return (
    <div className="auth-enter auth-enter-delayed mt-8 border-t border-line pt-5 text-center">
      <Link
        to={destination}
        onClick={() => {
          // Idempotent: an existing identity is reused, never replaced. The result is deliberately
          // ignored here because the destination page reports a storage problem if there is one.
          createGuestIdentity();
        }}
        className="inline-flex min-h-11 items-center justify-center gap-1 rounded-field px-4 text-helper text-muted transition hover:text-ink focus-visible:ring-4 focus-visible:ring-brand-soft focus-visible:outline-none"
      >
        以游客身份继续
        <span aria-hidden="true" className="text-brand">
          ›
        </span>
      </Link>
    </div>
  );
}
