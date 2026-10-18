import { Link } from "react-router";

/**
 * The quiet way in for somebody who is not ready to create an account.
 *
 * ⚠️ **It must exist, be easy to find, and be visibly lighter than "登录 / 创建账号".** The owner's
 * rule for the account entry is that a newcomer should be able to find the way forward, while the
 * primary actions keep their weight. So this is a text-height link under a hairline, in the same
 * place on every account screen, not a second filled button.
 *
 * ⚠️ **It goes to a real address (`/guest`) that explains the real state.** S14-A builds the entry
 * point only; guest identity and guest bookkeeping are S14-B. A button that appears to start guest
 * mode and does nothing would be worse than no button at all, so the destination is an honest
 * placeholder until S14-B replaces it.
 */
export function GuestEntry(): React.JSX.Element {
  return (
    <div className="auth-enter auth-enter-delayed mt-8 border-t border-line pt-5 text-center">
      <Link
        to="/guest"
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
