import { useEffect, useState } from "react";

import { BrandMark } from "./BrandMark.js";
import { useI18n } from "../i18n/index.js";
import { updateGuestIdentity } from "../lib/guest/identity.js";
import { useGuestIdentity } from "../lib/guest/session.js";

const WELCOME_MS = 1_400;

/**
 * The one-time, brand-only welcome for a brand-new guest (kept from S14-B, now over the real app).
 *
 * ⚠️ **The flag is persisted and cleared on the first mount**, so a reload, a reopened browser or
 * coming back from a formal account cannot replay it. The owner allowed one light transition for a
 * first visit and ruled out treating every open as the first one.
 *
 * ⚠️ **It never gates content.** The screens are already rendered underneath; this is an opaque
 * brand panel fading away, not a loading state. `prefers-reduced-motion` removes it via CSS.
 */
export function GuestWelcome(): React.JSX.Element | null {
  const identity = useGuestIdentity();
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  /**
   * ⚠️ **The identity is usually created on the login screen, which this component is already
   * mounted on.** So the flag cannot be read only in `useState`'s initialiser: the click that
   * creates it happens in the same SPA session, and the shell merely re-renders. This effect picks
   * the fresh identity up; the persistence guard (`welcomePending`) still makes it once-per-identity.
   */
  useEffect(() => {
    if (visible) return;
    if (identity?.welcomePending === true) setVisible(true);
  }, [identity?.id, identity?.welcomePending, visible]);

  useEffect(() => {
    if (!visible) return;

    // Persist the "seen" flag immediately: a refresh during the animation must not replay it.
    updateGuestIdentity({ welcomePending: false });
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, WELCOME_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [visible]);

  if (!visible || identity === null) return null;

  return (
    <div className="guest-welcome flex items-center justify-center" aria-hidden="true">
      <div className="flex flex-col items-center gap-3 text-on-brand">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-on-brand/15">
          <BrandMark className="size-8" />
        </span>
        <p className="text-2xl font-semibold tracking-tight">{t("common.appName")}</p>
        <p className="px-6 text-center text-body text-on-brand/85">{t("account.guest.welcome")}</p>
      </div>
    </div>
  );
}
