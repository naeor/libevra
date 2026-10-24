import { useState } from "react";

import { useI18n } from "../i18n/index.js";
import { Alert } from "./Alert.js";
import { Button } from "./Button.js";
import { Card } from "./Card.js";

/**
 * Shown exactly once, right after a recovery code is created.
 *
 * The code can never be retrieved again, so the way forward stays blocked
 * behind a confirmation — losing it means losing the only self-service route
 * back into the account.
 */
export function RecoveryCodeCard({
  code,
  onContinue,
}: {
  readonly code: string;
  readonly onContinue: () => void;
}): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">{t("auth.recoveryCard.notice")}</Alert>

      <Card className="bg-brand-soft/50 text-center">
        <p className="font-mono text-lg tracking-[0.18em] text-brand-dark select-all">{code}</p>
      </Card>

      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? t("auth.recoveryCard.copied") : t("auth.recoveryCard.copy")}
      </Button>

      <label className="flex items-start gap-3 rounded-field border border-line px-4 py-3 text-body text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked);
          }}
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
        />
        <span className="min-w-0">{t("auth.recoveryCard.confirm")}</span>
      </label>

      <Button disabled={!confirmed} onClick={onContinue}>
        {t("auth.recoveryCard.done")}
      </Button>
    </div>
  );
}
