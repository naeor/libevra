import { loginRequestSchema } from "@libellum/shared";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { AuthSwitcher } from "../components/AuthSwitcher.js";
import { Button } from "../components/Button.js";
import { PasswordField } from "../components/PasswordField.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { errorMessage } from "../lib/api.js";

export function LoginPage(): React.JSX.Element {
  const { user, login, sessionRevoked, sessionEndReason } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      // zod 提示是 `@libellum/shared` 里的中文原文，按当前界面语言查表显示。
      const issue = parsed.error.issues[0]?.message;
      setError(issue === undefined ? t("auth.login.missingFields") : translateSharedMessage(issue));
      return;
    }

    setBusy(true);
    try {
      await login(parsed.data.username, parsed.data.password);
      /**
       * ⚠️ **`?next=` is honoured only when it names a same-site path**, and that check is not
       * decoration: an open redirect that forwards to `https://evil.example` right after a genuine
       * sign-in is how a phishing page borrows the real one's credibility. `/join/<token>` is the
       * case this exists for — **the token has to survive the sign-in round trip**, and the address
       * bar is the only place it can survive a reload too.
       */
      const next = new URLSearchParams(window.location.search).get("next");
      await navigate(next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/", {
        replace: true,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.login.title")}
      subtitle={t("auth.login.subtitle")}
      navigation={<AuthSwitcher active="login" />}
      footer={
        <div className="flex flex-col items-center gap-2">
          <Link className="text-muted transition hover:text-ink" to="/recover">
            {t("auth.login.forgotPassword")}
          </Link>
          <Link className="text-helper text-muted/80 transition hover:text-ink" to="/recover-archive">
            {t("auth.login.recoverArchive")}
          </Link>
        </div>
      }
    >
      {sessionRevoked ? (
        <Alert tone="info">
          {sessionEndReason === "account_closed"
            ? t("auth.login.sessionAccountClosed")
            : sessionEndReason === "account_disabled"
              ? t("auth.login.sessionAccountDisabled")
              : t("auth.login.sessionExpired")}
        </Alert>
      ) : null}

      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {error === null ? null : <Alert>{error}</Alert>}

        <TextField
          label={t("auth.field.username")}
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <PasswordField
          label={t("auth.field.password")}
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        <Button type="submit" disabled={busy}>
          {busy ? t("auth.login.submitting") : t("auth.login.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
