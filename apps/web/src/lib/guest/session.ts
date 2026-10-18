import { useAuth, useAuthOptional } from "../../auth/AuthProvider.js";
import { readGuestIdentity, type GuestIdentity } from "./identity.js";
import { setGuestRuntimeId } from "./runtime.js";

/**
 * Guest mode is **a signed-out session with a persisted guest identity** — nothing else.
 *
 * ⚠️ **Formal accounts always win.** A browser can hold a guest identity *and* a valid session at
 * the same time (the guest data is preserved across login on purpose), and in that case every page
 * must use the account path. That is why this reads `user` rather than only the identity.
 *
 * ⚠️ **Synchronous by design.** The identity is in `localStorage`, so the routing decision and the
 * data-source decision can both be made before the first guest screen paints. A network round trip
 * here would reintroduce exactly the login-page flash S14-B removed.
 */
export function useGuestIdentity(): GuestIdentity | null {
  /**
   * ⚠️ **A decorative badge may be rendered without `<AuthProvider>`** (component tests render
   * shared headers statically). Outside the provider there is no signed-in session to prioritise,
   * so a persisted identity is the whole answer. Inside the app, `useAuth` is used and the rule is
   * exactly as below: a formal user always wins.
   */
  const optional = useAuthOptional();
  const auth = optional ?? null;
  if (auth !== null && (auth.status === "loading" || auth.user !== null)) return null;

  return readGuestIdentity();
}

export function useGuestMode(): boolean {
  return useGuestIdentity() !== null;
}

/**
 * Keeps the non-React write path in step with the same decision.
 *
 * Rendered inside `AuthProvider` and before the app shell, so its render runs before any page that
 * could write. See `runtime.ts` for why this is not an effect.
 */
export function DataModeSync(): null {
  const { status, user } = useAuth();
  const identity = status === "loading" || user !== null ? null : readGuestIdentity();

  setGuestRuntimeId(identity?.id ?? null);
  return null;
}
