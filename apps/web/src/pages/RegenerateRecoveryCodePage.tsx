import { useState } from "react";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { InnerPage } from "../components/Layouts.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";

export function RegenerateRecoveryCodePage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (password.length === 0) {
      setError(t("account.recoveryCode.passwordRequired"));
      return;
    }

    setBusy(true);
    try {
      const response = await apiFetch<{ recoveryCode: string }>("/auth/recovery-code", {
        method: "POST",
        body: { password },
      });
      setIssuedCode(response.recoveryCode);
      setPassword("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (issuedCode) {
    return (
      <InnerPage
        title={t("account.recoveryCode.issuedTitle")}
        subtitle={t("account.recoveryCode.issuedSubtitle")}
        backTo="/settings"
      >
        <RecoveryCodeCard code={issuedCode} onContinue={() => void navigate("/settings")} />
      </InnerPage>
    );
  }

  return (
    <InnerPage
      title={t("account.recoveryCode.title")}
      subtitle={t("account.recoveryCode.subtitle")}
      backTo="/settings"
    >
      <Card>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          {error ? <Alert>{error}</Alert> : null}

          <p className="text-body-relaxed text-muted">{t("account.recoveryCode.explanation")}</p>

          <TextField
            label={t("account.recoveryCode.currentPassword")}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />

          <Button type="submit" disabled={busy}>
            {busy ? t("account.recoveryCode.submitting") : t("account.recoveryCode.submit")}
          </Button>
        </form>
      </Card>
    </InnerPage>
  );
}
