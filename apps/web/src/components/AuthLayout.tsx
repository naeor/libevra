import { BrandMark } from "./BrandMark.js";
import { Card } from "./Card.js";
import { GuestEntry } from "./GuestEntry.js";
import { LanguageSwitch } from "./LanguageSwitch.js";

/**
 * The shared frame for every account-entry screen.
 *
 * ⚠️ **One frame, three forms.** Signing in, creating an account, and the restricted (invite-only)
 * variant are the same decision approached from different directions; giving them one wordmark,
 * one card, one place for the switch and one quiet guest entry is what makes the trio read as one
 * product instead of three unrelated screens. The pages still own their own fields and copy — this
 * component owns the rhythm: brand, entry switch, card, footer, guest way out.
 *
 * ⚠️ **The entrance is a 6px rise plus a fade, not a welcome sequence.** The animation exists so a
 * navigation between `/login` and `/register` feels like the same page settling into a new state.
 * It must not become a gate before the form — the first input is present from the first frame, and
 * `prefers-reduced-motion` removes the movement entirely (see the `.auth-enter` note in `index.css`).
 *
 * This is deliberately **not** the ledger-space wave. That animation belongs to arriving in a
 * ledger, not to signing in, and the two must not be conflated (S14-A instruction).
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  navigation,
  guestEntry = true,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  /** The login/register switch, when the screen is one of those two. */
  readonly navigation?: React.ReactNode;
  /** The guest entry is on by default; the guest placeholder page turns it off (it is the destination). */
  readonly guestEntry?: boolean;
}): React.JSX.Element {
  return (
    <main className="min-h-dvh bg-canvas">
      <div className="relative mx-auto flex w-full max-w-[26rem] flex-col px-5 pt-12 pb-10 sm:pt-16">
        {/**
          * ⚠️ **登录前也能切换语言**（S16 国际化）。放在右上角、不占表单的位置；
          * 安全区让它在刘海屏上不被状态栏盖住。
          */}
        <div className="absolute top-[calc(env(safe-area-inset-top,0px)+0.5rem)] right-3">
          <LanguageSwitch />
        </div>
        <header className="auth-enter flex flex-col items-center text-center">
          <span
            aria-hidden="true"
            className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-card"
          >
            <BrandMark className="size-7" />
          </span>
          <p className="text-2xl font-semibold tracking-tight text-ink">Libevra</p>
          <p className="mt-1.5 text-helper text-muted">the free, open ledger</p>
        </header>

        {navigation === undefined ? null : (
          <div className="auth-enter auth-enter-delayed mt-8">{navigation}</div>
        )}

        <Card
          className={`auth-enter auth-enter-delayed sm:p-7 ${
            navigation === undefined ? "mt-10" : "mt-6"
          }`}
        >
          <h1 className="text-page-title text-ink">{title}</h1>
          {subtitle === undefined ? null : (
            <p className="mt-2 text-body-relaxed text-muted">{subtitle}</p>
          )}
          <div className="mt-6 flex flex-col gap-5">{children}</div>
        </Card>

        {footer === undefined ? null : (
          <div className="mt-5 text-center text-helper text-muted">{footer}</div>
        )}

        {guestEntry ? <GuestEntry /> : null}
      </div>
    </main>
  );
}
