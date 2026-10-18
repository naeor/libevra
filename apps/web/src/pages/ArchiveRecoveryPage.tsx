import { useState } from "react";

import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { errorMessage } from "../lib/api.js";
import { apiFetch } from "../lib/api.js";

/**
 * Public claim form for an archived ledger whose owner has closed the account.
 *
 * It requires the one-time credential issued at closure, the account number and the ledger number.
 * A request is not a recovery: an administrator must verify eligibility and approve it.
 */
export function ArchiveRecoveryPage(): React.JSX.Element {
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
    <AuthLayout title="恢复归档账本">
      {request === null ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <p className="text-body-relaxed text-muted">
            账号注销时如果选择了保留归档账本，会得到一条一次性恢复凭证。提交后需要管理员核验，不会仅凭账本编号直接恢复。
          </p>
          {error === null ? null : <Alert>{error}</Alert>}
          <TextField
            label="原账号编号"
            inputMode="numeric"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
          <TextField
            label="一次性恢复凭证"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
          <TextField
            label="原账本编号"
            inputMode="numeric"
            value={bookNumber}
            onChange={(event) => setBookNumber(event.target.value)}
          />
          <TextField
            label="接收账本的账号编号（可选）"
            inputMode="numeric"
            value={targetAccountNumber}
            onChange={(event) => setTargetAccountNumber(event.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "提交中…" : "提交恢复申请"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <Alert tone="info">
            申请已提交。管理员核验后才会恢复；审核截止 {new Date(request.deadlineAt).toLocaleString("zh-CN")}。
          </Alert>
          <p className="text-body-relaxed text-muted">
            申请编号：<span className="font-mono">{request.requestId}</span>
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              window.location.assign("/login");
            }}
          >
            返回登录
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
