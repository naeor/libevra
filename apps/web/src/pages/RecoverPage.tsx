import { PASSWORD_MIN_LENGTH, recoverRequestSchema } from "@libellum/shared";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Button } from "../components/Button.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { apiFetch, errorMessage } from "../lib/api.js";

export function RecoverPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [username, setUsername] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const parsed = recoverRequestSchema.safeParse({ username, recoveryCode, newPassword });
    if (!parsed.success) {
      // zod 提示是 `@libellum/shared` 里的中文原文，按当前界面语言查表显示。
      const issue = parsed.error.issues[0]?.message;
      setError(issue === undefined ? t("auth.recover.invalid") : translateSharedMessage(issue));
      return;
    }

    setBusy(true);
    try {
      const response = await apiFetch<{ recoveryCode: string }>("/auth/recover", {
        method: "POST",
        body: parsed.data,
      });
      setIssuedCode(response.recoveryCode);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (issuedCode) {
    return (
      <AuthLayout title={t("auth.recover.doneTitle")} subtitle={t("auth.recover.doneSubtitle")}>
        <RecoveryCodeCard
          code={issuedCode}
          onContinue={() => {
            void navigate("/login", { replace: true });
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.recover.title")}
      subtitle={t("auth.recover.subtitle")}
      footer={
        <Link className="font-medium text-brand-dark hover:underline" to="/login">
          {t("auth.recover.backToLogin")}
        </Link>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
        {error ? <Alert>{error}</Alert> : null}

        <TextField
          label={t("auth.field.username")}
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />

        <TextField
          label={t("auth.field.recoveryCode")}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          hint={t("auth.recover.recoveryCodeHint")}
          value={recoveryCode}
          onChange={(event) => {
            setRecoveryCode(event.target.value);
          }}
        />

        <TextField
          label={t("auth.field.newPassword")}
          type="password"
          autoComplete="new-password"
          hint={t("auth.field.passwordMin", { min: PASSWORD_MIN_LENGTH })}
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
          }}
        />

        <Button type="submit" disabled={busy}>
          {busy ? t("auth.recover.submitting") : t("auth.recover.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
