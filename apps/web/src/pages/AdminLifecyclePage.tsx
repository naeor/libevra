import { useCallback, useEffect, useState } from "react";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { EmptyState, ErrorState, SkeletonRows } from "../components/States.js";
import { TextField } from "../components/TextField.js";
import { apiFetch, errorMessage } from "../lib/api.js";

interface RecoveryRequest {
  readonly id: string;
  readonly bookId: string;
  readonly bookNumber: string | null;
  readonly requesterAccountNumber: string;
  readonly kind: "active_account" | "closed_account";
  readonly status: string;
  readonly requestedAt: string;
  readonly deadlineAt: string;
  readonly decidedAt: string | null;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
  readonly targetAccountNumber: string | null;
}

function dateText(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Administrator review for archived-ledger recovery requests.
 *
 * ⚠️ **A request never contains ledger content**, and approving one only moves an archive back into
 * an active account's lifecycle. The administrator still cannot read the ledger's entries.
 */
export function AdminLifecyclePage(): React.JSX.Element {
  const [requests, setRequests] = useState<RecoveryRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ request: RecoveryRequest; action: "approve" | "reject" } | null>(null);
  const [password, setPassword] = useState("");
  const [targetAccountNumber, setTargetAccountNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await apiFetch<{ requests: RecoveryRequest[] }>("/admin/lifecycle/requests");
      setRequests(response.requests);
    } catch (caught) {
      setError(errorMessage(caught));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(): Promise<void> {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(`/admin/lifecycle/requests/${selected.request.id}/decide`, {
        method: "POST",
        body: {
          password,
          action: selected.action,
          ...(targetAccountNumber.trim() === "" ? {} : { targetAccountNumber: targetAccountNumber.trim() }),
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      });
      setSelected(null);
      setPassword("");
      setTargetAccountNumber("");
      setNote("");
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InnerPage title="账本恢复申请" backTo="/admin">
      <p className="text-body-relaxed text-muted">
        这里只处理归档账本的恢复申请；管理员看不到账目内容。先核验申请人的恢复凭证与账号归属，再决定。
      </p>
      {error === null ? null : <Alert>{error}</Alert>}
      {requests === null ? <SkeletonRows rows={3} /> : null}
      {requests !== null && requests.length === 0 ? <EmptyState title="没有恢复申请" description="新申请会出现在这里。" /> : null}
      {requests !== null && requests.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {requests.map((request) => (
            <div key={request.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-body font-medium text-ink">账本 {request.bookNumber ?? request.bookId.slice(0, 8)}</p>
                  <p className="text-helper text-muted">
                    申请账号 {request.requesterAccountNumber} · {request.kind === "closed_account" ? "已注销账号" : "使用中账号"}
                  </p>
                  <p className="text-helper text-muted">审核截止：{dateText(request.deadlineAt)}</p>
                </div>
                <span className="rounded-full bg-canvas px-2 py-1 text-helper text-muted">{request.status}</span>
              </div>
              {request.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelected({ request, action: "approve" });
                      setTargetAccountNumber(request.targetAccountNumber ?? "");
                    }}
                  >
                    批准恢复
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected({ request, action: "reject" })}>
                    拒绝
                  </Button>
                </div>
              ) : (
                <p className="text-helper text-muted">
                  {request.decidedAt === null ? "" : `处理于 ${dateText(request.decidedAt)}`}
                  {request.decidedByName === null ? "" : ` · ${request.decidedByName}`}
                  {request.decisionNote === null ? "" : ` · ${request.decisionNote}`}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={selected !== null}
        title={selected?.action === "approve" ? "批准恢复这本账？" : "拒绝恢复申请？"}
        description="这个操作会写入管理员审计，并且需要重新输入你的密码。"
        consequences={
          selected?.action === "approve"
            ? ["账本恢复到指定账号", "不会向管理员显示账目内容", "恢复后按正常生命周期继续"]
            : ["申请被拒绝", "到期后账本仍会按原定时间清理"]
        }
        confirmLabel={selected?.action === "approve" ? "批准恢复" : "拒绝申请"}
        tone={selected?.action === "approve" ? "default" : "danger"}
        busy={busy}
        onCancel={() => {
          setSelected(null);
          setPassword("");
        }}
        onConfirm={() => void decide()}
      >
        <div className="mt-4 flex flex-col gap-3">
          {selected?.action === "approve" ? (
            <TextField
              label="接收账本的账号编号"
              hint="仅已注销账号的申请需要填写；使用中账号会恢复到原账号。"
              value={targetAccountNumber}
              onChange={(event) => setTargetAccountNumber(event.target.value)}
            />
          ) : null}
          <TextField
            label="处理备注（可选）"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <TextField
            label="当前密码"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </InnerPage>
  );
}
