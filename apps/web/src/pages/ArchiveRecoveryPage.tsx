import { useState } from "react";
import { Trans } from "react-i18next";

import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { apiFetch } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";

/** 与原来的 `toLocaleString()` 默认格式相同的字段（中文仍是 `2026/10/25 14:30:00`），随界面语言排列。 */
const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * Public claim form for an archived ledger whose owner has closed the account.
 *
 * It requires the one-time credential issued at closure, the account number and the ledger number.
 * A request is not a recovery: an administrator must verify eligibility and approve it.
 */
export function ArchiveRecoveryPage(): React.JSX.Element {
  const { t } = useI18n();
  const [accountNumber, setAccountNumber] = useState("");
  const [credential, setCredential] = useState("");
  const [bookNumber, setBookNumber] = useState("");
  const [targetAccountNumber, setTargetAccountNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<{ requestId: string; deadlineAt: string } | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ requestId: string; deadlineAt: string }>(
        "/account-recovery/request",
        {
          method: "POST",
          body: {
            accountNumber: accountNumber.trim(),
            recoveryCredential: credential.trim(),
            bookNumber: bookNumber.trim(),
            ...(targetAccountNumber.trim() === ""
              ? {}
              : { targetAccountNumber: targetAccountNumber.trim() }),
          },
        },
      );
      setRequest(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t("auth.archive.title")}>
      {request === null ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <p className="text-body-relaxed text-muted">{t("auth.archive.intro")}</p>
          {error === null ? null : <Alert>{error}</Alert>}
          <TextField
            label={t("auth.archive.accountNumber")}
            inputMode="numeric"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
          <TextField
            label={t("auth.archive.credential")}
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
          <TextField
            label={t("auth.archive.bookNumber")}
            inputMode="numeric"
            value={bookNumber}
            onChange={(event) => setBookNumber(event.target.value)}
          />
          <TextField
            label={t("auth.archive.targetAccountNumber")}
            inputMode="numeric"
            value={targetAccountNumber}
            onChange={(event) => setTargetAccountNumber(event.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? t("auth.archive.submitting") : t("auth.archive.submit")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Alert tone="info">
            {t("auth.archive.submitted", { deadline: formatInstant(request.deadlineAt, DEADLINE_FORMAT) })}
          </Alert>
          <p className="break-words text-body-relaxed text-muted">
            <Trans
              i18nKey="auth.archive.requestId"
              values={{ id: request.requestId }}
              components={{ mono: <span className="font-mono" /> }}
            />
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.assign("/login");
            }}
          >
            {t("auth.archive.backToLogin")}
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
