import { PASSWORD_MIN_LENGTH, changePasswordRequestSchema } from "@libellum/shared";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { InnerPage } from "../components/Layouts.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { apiFetch, errorMessage } from "../lib/api.js";

export function ChangePasswordPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(false);

    const parsed = changePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      // zod 提示是 `@libellum/shared` 里的中文原文，按当前界面语言查表显示。
      const issue = parsed.error.issues[0]?.message;
      setError(issue === undefined ? t("account.changePassword.invalid") : translateSharedMessage(issue));
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/auth/password", { method: "POST", body: parsed.data });
      setCurrentPassword("");
      setNewPassword("");
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InnerPage
      title={t("account.changePassword.title")}
      subtitle={t("account.changePassword.subtitle")}
      backTo="/settings"
    >
      <Card>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          {error ? <Alert>{error}</Alert> : null}
          {done ? <Alert tone="success">{t("account.changePassword.done")}</Alert> : null}

          <TextField
            label={t("account.changePassword.currentPassword")}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />

          <TextField
            label={t("account.changePassword.newPassword")}
            type="password"
            autoComplete="new-password"
            hint={t("auth.field.passwordMin", { min: PASSWORD_MIN_LENGTH })}
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
            }}
          />

          <Button type="submit" disabled={busy}>
            {busy ? t("account.changePassword.submitting") : t("account.changePassword.submit")}
          </Button>
        </form>
      </Card>
    </InnerPage>
  );
}
