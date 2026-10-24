import { useCallback, useEffect, useState } from "react";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { EmptyState, ErrorState, SkeletonRows } from "../components/States.js";
import { TextField } from "../components/TextField.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch, errorMessage } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";

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

/** S16：按当前界面语言格式化（中文输出与原来的 `toLocaleString("zh-CN", …)` 相同）。 */
function dateText(value: string | null): string {
  return value === null ? "—" : formatInstant(value, { dateStyle: "medium", timeStyle: "short" });
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
  const { t } = useI18n();

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
    <InnerPage title={t("admin.lifecycle.title")} backTo="/admin">
      <p className="text-body-relaxed text-muted">
        {t("admin.lifecycle.intro")}
      </p>
      {error === null ? null : <Alert>{error}</Alert>}
      {requests === null ? <SkeletonRows rows={3} /> : null}
      {requests !== null && requests.length === 0 ? <EmptyState title={t("admin.lifecycle.emptyTitle")} description={t("admin.lifecycle.emptyDescription")} /> : null}
      {requests !== null && requests.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {requests.map((request) => (
            <div key={request.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">{t("admin.lifecycle.ledger", { number: request.bookNumber ?? request.bookId.slice(0, 8) })}</p>
                  <p className="text-helper text-muted">
                    {t("admin.lifecycle.requester", { number: request.requesterAccountNumber })} · {request.kind === "closed_account" ? t("admin.lifecycle.closedAccount") : t("admin.lifecycle.activeAccount")}
                  </p>
                  <p className="text-helper text-muted">{t("admin.lifecycle.deadline", { date: dateText(request.deadlineAt) })}</p>
                </div>
                {/* `status` 是服务器的状态标识（pending 等），原样显示 */}
                <span className="shrink-0 rounded-full bg-canvas px-2 py-1 text-helper text-muted">{request.status}</span>
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
                    {t("admin.lifecycle.approve")}
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected({ request, action: "reject" })}>
                    {t("admin.lifecycle.reject")}
                  </Button>
                </div>
              ) : (
                <p className="text-helper text-muted [overflow-wrap:anywhere]">
                  {request.decidedAt === null ? "" : t("admin.lifecycle.decidedAt", { date: dateText(request.decidedAt) })}
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
        title={selected?.action === "approve" ? t("admin.lifecycle.approveTitle") : t("admin.lifecycle.rejectTitle")}
        description={t("admin.lifecycle.dialogDescription")}
        consequences={
          selected?.action === "approve"
            ? [
                t("admin.lifecycle.approveConsequences.target"),
                t("admin.lifecycle.approveConsequences.private"),
                t("admin.lifecycle.approveConsequences.lifecycle"),
              ]
            : [t("admin.lifecycle.rejectConsequences.rejected"), t("admin.lifecycle.rejectConsequences.purge")]
        }
        confirmLabel={selected?.action === "approve" ? t("admin.lifecycle.approve") : t("admin.lifecycle.rejectConfirm")}
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
              label={t("admin.lifecycle.targetLabel")}
              hint={t("admin.lifecycle.targetHint")}
              value={targetAccountNumber}
              onChange={(event) => setTargetAccountNumber(event.target.value)}
            />
          ) : null}
          <TextField
            label={t("admin.lifecycle.noteLabel")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <TextField
            label={t("admin.lifecycle.passwordLabel")}
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
