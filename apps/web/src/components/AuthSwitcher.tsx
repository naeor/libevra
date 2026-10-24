import { Link } from "react-router";

/**
 * The two account-entry destinations, as one control.
 *
 * ⚠️ **A switch, not two links in two different footers.** Logging in and creating an account are
 * the same decision seen from two sides; putting them in one place means the way back is always
 * where the reader arrived, instead of at the bottom of a form they have already started filling.
 *
 * It is a real navigation (`Link` to `/login`, `/register`) rather than local state: each address
 * must survive a refresh and answer "which form is this" on its own.
 */
export function AuthSwitcher({
  active,
}: {
  readonly active: "login" | "register";
}): React.JSX.Element {
  return (
    <nav
      aria-label="账号入口"
      className="grid grid-cols-2 gap-1 rounded-field bg-brand-soft/60 p-1"
    >
      <SwitchLink to="/login" label="登录" selected={active === "login"} />
      <SwitchLink to="/register" label="创建账号" selected={active === "register"} />
    </nav>
  );
}

function SwitchLink({
  to,
  label,
  selected,
}: {
  readonly to: string;
  readonly label: string;
  readonly selected: boolean;
}): React.JSX.Element {
  return (
    <Link
      to={to}
      aria-current={selected ? "page" : undefined}
      className={`flex min-h-11 items-center justify-center rounded-[0.6875rem] text-button transition ${
        selected
          ? "bg-surface text-ink shadow-card"
          : "text-muted hover:text-ink focus-visible:ring-4 focus-visible:ring-focus-ring focus-visible:outline-none"
      }`}
    >
      {label}
    </Link>
  );
}
