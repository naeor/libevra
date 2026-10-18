import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ConsentDialog } from "../components/ConsentGate.js";
import { InnerPage } from "../components/Layouts.js";
import { TextField } from "../components/TextField.js";
import { errorMessage } from "../lib/api.js";
import { fetchAccountExport } from "../lib/consent.js";
import {
  bookLifecycleAction,
  closeAccount,
  deleteServerData,
  fetchAccountLifecycle,
  requestManualRecovery,
  restoreArchivedBook,
  type AccountLifecycle,
  type BookDecisionAction,
  type CloseAccountResult,
  type CloseMethod,
} from "../lib/lifecycle.js";
import { deliverFile } from "../lib/share.js";
import { clearAccountLocalData, clearBookLocalData } from "../lib/offline/localCleanup.js";

function dateText(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * `/settings/account-data` — the account-level data page, also reachable while an agreement is
 * blocking ordinary use. It only exposes lifecycle metadata, never ledger entries.
 */
export function AccountDataPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [data, setData] = useState<AccountLifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"close" | "delete" | "result" | null>(null);
  const [method, setMethod] = useState<CloseMethod>("close_account");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [decisions, setDecisions] = useState<Record<string, BookDecisionAction>>({});
  const [result, setResult] = useState<CloseAccountResult | null>(null);
  const [confirmBook, setConfirmBook] = useState<{ bookId: string; action: "archive" | "delete" | "leave" } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchAccountLifecycle();
      setData(next);
      setDecisions(
        Object.fromEntries(
          next.books.map((book) => [book.bookId, book.archived ? "keep_archived" : book.memberCount > 1 ? "leave" : "archive"]),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const archived = useMemo(() => data?.books.filter((book) => book.archived) ?? [], [data]);
  const active = useMemo(() => data?.books.filter((book) => !book.archived) ?? [], [data]);

  async function onExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await fetchAccountExport();
      const outcome = await deliverFile(file.fileName, "application/json", file.bytes);
      setNotice(outcome.cancelled ? "已取消导出。" : "账号数据已导出。文件范围包含当前可访问账本中的全部账目。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onRestore(bookId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await restoreArchivedBook(bookId);
      await load();
      setNotice("账本已恢复。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onRequestRecovery(bookId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const request = await requestManualRecovery(bookId);
      await load();
      setNotice(`人工恢复申请已提交，审核截止 ${dateText(request.deadlineAt)}。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onBookAction(bookId: string, action: "archive" | "delete" | "leave"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await bookLifecycleAction(bookId, action);
      if (user !== null) await clearBookLocalData(user.id, bookId);
      await load();
      if (action === "leave") setNotice("已退出这本账，其他成员的数据不受影响。");
      else if (action === "archive") setNotice("账本已归档。");
      else setNotice("账本已永久删除。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(): Promise<void> {
    if (data === null) return;
    setBusy(true);
    setError(null);
    try {
      const expected = method === "delete_data" ? "删除服务器数据" : "注销账号";
      if (confirmation !== expected) {
        setError(`请输入「${expected}」确认这次操作。`);
        return;
      }
      const outcome =
        method === "delete_data"
          ? await deleteServerData({ password, confirmation })
          : await closeAccount({
              method,
              password,
              confirmation,
              decisions: data.books.map((book) => ({
                bookId: book.bookId,
                action: decisions[book.bookId] ?? "leave",
              })),
            });
      setResult(outcome);
      if (user !== null) await clearAccountLocalData(user.id);
      setDialog("result");
      setPassword("");
      setConfirmation("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishClosure(): Promise<void> {
    await logout();
    void navigate("/login", { replace: true });
  }

  const blocked = (data?.blockers.length ?? 0) > 0;

  return (
    <InnerPage title="账号与数据" backTo="/settings">
      <p className="text-body-relaxed text-muted">
        这里只处理账号和账本的生命周期，不提供账目正文。删除账本和注销账号都是不可逆操作，请先看清影响范围。
      </p>

      {error === null ? null : <Alert>{error}</Alert>}
      {notice === null ? null : (
        <p className="rounded-field bg-brand-soft px-3 py-2 text-helper-relaxed text-brand-dark">{notice}</p>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-helper text-muted">账号数据</h2>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
          <p className="text-body text-ink">{data?.account.displayName ?? "账号"}</p>
          <p className="text-helper text-muted">账号编号 {data?.account.accountNumber ?? "—"}</p>
          <Button variant="secondary" onClick={() => void onExport()} disabled={busy}>
            导出我的数据
          </Button>
          <p className="text-helper text-muted">
            导出包含账号资料和当前可访问账本的全部账目，包含共享账本中其他成员记录的账目。
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-helper text-muted">我的账本</h2>
        {active.length === 0 ? <p className="rounded-card border border-line bg-surface p-4 text-helper text-muted">没有仍在使用的账本。</p> : null}
        {active.map((book) => (
          <div key={book.bookId} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body font-medium text-ink">{book.name}</p>
                <p className="text-helper text-muted">
                  {book.memberCount > 1 ? `共享账本 · ${String(book.memberCount)} 位成员` : "单人账本"}
                  {book.bookNumber === null ? "" : ` · 编号 ${book.bookNumber}`}
                </p>
              </div>
            </div>
            {book.blockedReason === null ? null : <p className="text-helper text-danger">{book.blockedReason}</p>}
            <div className="flex flex-wrap gap-2">
              {book.memberCount > 1 ? (
                <Button
                  variant="secondary"
                  disabled={busy || book.options.length === 0}
                  onClick={() => void onBookAction(book.bookId, "leave")}
                >
                  退出协作
                </Button>
              ) : (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmBook({ bookId: book.bookId, action: "archive" })}>
                    归档账本
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmBook({ bookId: book.bookId, action: "delete" })}>
                    永久删除
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      {archived.length === 0 ? null : (
        <section className="flex flex-col gap-2.5">
          <h2 className="px-1 text-helper text-muted">已归档账本</h2>
          {archived.map((book) => (
            <div key={book.bookId} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <p className="text-body font-medium text-ink">{book.name}</p>
              <p className="text-helper text-muted">归档时间：{dateText(book.archivedAt)}</p>
              <p className="text-helper text-muted">自助恢复截止：{dateText(book.selfRestoreUntil)}</p>
              <p className="text-helper text-muted">预计自动清理：{dateText(book.scheduledPurgeAt)}（到期后 24 小时内执行）</p>
              <div className="flex flex-wrap gap-2">
                {book.options.includes("keep_archived") && book.selfRestoreUntil !== null ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void onRestore(book.bookId)}>
                    恢复账本
                  </Button>
                ) : null}
                {book.selfRestoreUntil !== null && new Date(book.selfRestoreUntil).getTime() <= Date.now() ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void onRequestRecovery(book.bookId)}>
                    申请人工恢复
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-helper text-muted">账号处理</h2>
        <div className="flex flex-col gap-3 rounded-card border border-danger-soft bg-danger-soft/40 p-4">
          <p className="text-body font-medium text-ink">删除服务器数据</p>
          <p className="text-helper-relaxed text-muted">
            退出共享账本；永久删除单人账本和已归档账本；撤销会话与邀请。其他成员的数据不会受影响。账号将不能继续使用。
          </p>
          <Button
            variant="secondary"
            disabled={busy || blocked}
            onClick={() => {
              setMethod("delete_data");
              setDialog("delete");
              setError(null);
            }}
          >
            删除服务器数据
          </Button>
          <p className="mt-1 text-body font-medium text-ink">注销账号</p>
          <p className="text-helper-relaxed text-muted">
            逐本处理账本后注销。共享账本退出协作，单人账本可归档或永久删除，已归档账本可保持归档或删除。账号本身会停用并匿名化。
          </p>
          <Button
            variant="ghost"
            disabled={busy || blocked}
            onClick={() => {
              setMethod("close_account");
              setDialog("close");
              setError(null);
            }}
          >
            注销账号
          </Button>
          {blocked ? <p className="text-helper text-danger">有账本还需要先处理管理者交接或清理状态，暂不能注销。</p> : null}
        </div>
      </section>

      {dialog === "close" || dialog === "delete" ? (
        <ConsentDialog
          title={method === "delete_data" ? "删除服务器数据" : "注销账号"}
          eyebrow="不可逆操作"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
                取消
              </Button>
              <Button onClick={() => void submitClose()} disabled={busy || password.length === 0}>
                {busy ? "处理中…" : method === "delete_data" ? "删除并注销" : "确认注销"}
              </Button>
            </>
          }
        >
          {method === "close_account" && data !== null ? (
            <div className="flex flex-col gap-3">
              {data.books.map((book) => (
                <div key={book.bookId} className="rounded-field border border-line px-3 py-2.5">
                  <p className="text-body text-ink">{book.name}</p>
                  <p className="mt-0.5 text-helper text-muted">
                    {book.archived
                      ? `归档于 ${dateText(book.archivedAt)}`
                      : book.memberCount > 1
                        ? `共享账本 · ${String(book.memberCount)} 位成员`
                        : "单人账本"}
                  </p>
                  <select
                    className="mt-2 w-full rounded-field border border-line bg-surface px-3 py-2 text-body text-ink"
                    value={decisions[book.bookId] ?? "leave"}
                    disabled={book.options.length === 0 || busy}
                    onChange={(event) => {
                      const value = event.target.value as BookDecisionAction;
                      setDecisions((current) => ({ ...current, [book.bookId]: value }));
                    }}
                  >
                    {book.options.map((option) => (
                      <option key={option} value={option}>
                        {option === "leave"
                          ? "退出协作"
                          : option === "archive"
                            ? "归档（60 天内可恢复）"
                            : option === "keep_archived"
                              ? "保持原归档期限"
                              : "永久删除"}
                      </option>
                    ))}
                  </select>
                  {book.blockedReason === null ? null : <p className="mt-1 text-helper text-danger">{book.blockedReason}</p>}
                </div>
              ))}
              <p className="text-helper text-muted">
                归档账本会保留数据到原定的 365 天清理日；选择保持归档不会重置原有期限。若归档账本需要以后恢复，注销后会提供一次性恢复凭证。
              </p>
            </div>
          ) : (
            <p className="text-body-relaxed text-ink">
              将退出共享账本、永久删除单人账本和已归档账本，并撤销所有会话与邀请。此操作不会删除其他成员的数据，但当前账号将无法继续使用。
            </p>
          )}

          <div className="mt-4 flex flex-col gap-3">
            <TextField
              label="当前密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <TextField
              label={`输入「${method === "delete_data" ? "删除服务器数据" : "注销账号"}」确认`}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
          </div>
          {error === null ? null : <Alert>{error}</Alert>}
        </ConsentDialog>
      ) : null}

      <ConfirmDialog
        open={confirmBook !== null}
        title={
          confirmBook?.action === "delete"
            ? "永久删除这本账？"
            : confirmBook?.action === "archive"
              ? "归档这本账？"
              : "退出这本账？"
        }
        description={
          confirmBook?.action === "delete"
            ? "账本内容会立即进入永久删除流程，不能由你恢复。"
            : confirmBook?.action === "archive"
              ? "数据会保留，60 天内可自行恢复，满 365 天后自动清理。"
              : "只撤销你的访问与同步权限，其他成员的数据不受影响。"
        }
        consequences={
          confirmBook?.action === "delete"
            ? ["账目、分类、标签和留言会被清理", "保留不含正文的删除墓碑", "其他账本不受影响"]
            : confirmBook?.action === "archive"
              ? ["账本从普通列表消失", "归档日期以服务器 UTC 时间为准", "恢复后再次归档会重新计算期限"]
              : ["你不再看到这本账", "你记过的账目与历史保留", "其他成员不受影响"]
        }
        confirmLabel={confirmBook?.action === "delete" ? "永久删除" : confirmBook?.action === "archive" ? "归档" : "退出"}
        tone={confirmBook?.action === "delete" ? "danger" : "default"}
        busy={busy}
        onCancel={() => setConfirmBook(null)}
        onConfirm={() => {
          const pending = confirmBook;
          setConfirmBook(null);
          if (pending !== null) void onBookAction(pending.bookId, pending.action);
        }}
      />

      {dialog === "result" && result !== null ? (
        <ConsentDialog
          title="账号已注销"
          eyebrow="完成"
          footer={
            <Button onClick={() => void finishClosure()}>返回登录</Button>
          }
        >
          {result.recoveryCredential === null ? (
            <p className="text-body-relaxed text-ink">服务器数据已按选择的方案处理，账号已经停用。本机稍后会退出登录。</p>
          ) : (
            <>
              <p className="text-body-relaxed text-ink">账号已经停用，账本已归档。</p>
              <p className="mt-3 text-helper-relaxed text-muted">
                请现在保存这条一次性恢复凭证。以后若要找回归档账本，需要用它向管理员提交人工恢复申请；服务器只保存它的哈希，丢失后无法由系统还原。
              </p>
              <p className="mt-3 select-all break-all rounded-field bg-canvas px-3 py-3 font-mono text-body text-ink">
                {result.recoveryCredential}
              </p>
              <p className="mt-3 text-helper text-muted">
                恢复时还需要账号编号，以及原账本编号；管理员核验后才会恢复，不会仅凭账本编号交还数据。
              </p>
            </>
          )}
        </ConsentDialog>
      ) : null}
    </InnerPage>
  );
}
