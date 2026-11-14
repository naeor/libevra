import { useRef, useState } from "react";
import { useSwapReveal } from "../components/ui/ComponentMotion.js";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { InnerPage } from "../components/Layouts.js";
import { RecoveryCodeCard } from "../components/RecoveryCodeCard.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";
import { useGoBack } from "../lib/connectivity.js";

export function RegenerateRecoveryCodePage(): React.JSX.Element {
  /** 1.19.75（审查 T5）：「继续」上一条正是设置时退回去（返回转场、不再叠一层历史），否则仍前往设置。 */
  /**
   * 1.19.81（所有者 2026-11-15）：新恢复码之后的「继续」回到来路（账号安全、个人资料……从哪里进来就回哪里），与顶栏返回同一个动作——
   * 有上一条就 `-1`（按返回方向播放），会话第一条（深链）才用声明的上级「设置」。原来固定前往「设置」。
   */
  const continueToSettings = useGoBack("/settings");
  const { t } = useI18n();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  // 1.19.80：表单 → 新恢复码换屏时新内容淡入轻移（两个分支共用同一个外层，React 保留它只换内容）。
  const swapRef = useRef<HTMLDivElement | null>(null);
  useSwapReveal(swapRef, issuedCode !== null);
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
        <div ref={swapRef}><RecoveryCodeCard code={issuedCode} onContinue={continueToSettings} /></div>
      </InnerPage>
    );
  }

  return (
    <InnerPage
      title={t("account.recoveryCode.title")}
      subtitle={t("account.recoveryCode.subtitle")}
      backTo="/settings"
    >
      <div ref={swapRef}>
      <Card className="lv-settings-task">
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
      </div>
    </InnerPage>
  );
}
