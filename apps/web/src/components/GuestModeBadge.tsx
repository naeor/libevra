import { useGuestMode } from "../lib/guest/session.js";

/**
 * The one guest-specific visual: a small identity badge.
 *
 * ⚠️ **A label, not a banner.** The owner's rule for S14-C: guest mode uses the real screens, with
 * a small 「游客模式」 mark in the existing top bar — white/light background and brand-green text —
 * and **no repeated "you are a guest / please register" notices on every page**. This component is
 * the whole of that difference; it renders nothing at all for a formal account.
 *
 * ⚠️ **It is deliberately not interactive.** A badge that opens a menu would become a second
 * navigation surface; the account page (`/me`) is where switching and clearing live.
 */
export function GuestModeBadge({ className = "" }: { readonly className?: string }): React.JSX.Element | null {
  const guest = useGuestMode();
  if (!guest) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-white px-2 py-0.5 text-micro font-medium text-brand shadow-sm ${className}`}
    >
      游客模式
    </span>
  );
}
