import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConsentDialog } from "../components/ConsentGate.js";
import { CopyButton } from "../components/CopyButton.js";
import { InnerPage } from "../components/Layouts.js";
import { InlineMessage, ListGroup, ListRow } from "../components/ui/List.js";
import { TextField } from "../components/TextField.js";
import { errorMessage } from "../lib/api.js";
import { fetchAccountExport } from "../lib/consent.js";
import {
  closeAccount,
  deleteServerData,
  fetchAccountLifecycle,
  fetchDataDeletionPreview,
  requestManualRecovery,
  restoreArchivedBook,
  type AccountLifecycle,
  type BookDecisionAction,
  type CloseAccountResult,
  type DataDeletionPreview,
  type DataDeletionResult,
} from "../lib/lifecycle.js";
import { clearAccountLocalData, clearBookLocalData } from "../lib/offline/localCleanup.js";
import { deliverFile } from "../lib/share.js";

function dateText(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

type Dialog = "delete" | "delete-result" | "close" | "close-result" | null;

/**
 * `/settings/account-data` — the account-level data page.
 *
 * The two destructive operations are deliberately different:
 *
 * * **删除服务器数据** removes selected/all ledger data while the account, password, sessions and
 *   recovery code stay exactly as they are;
 * * **注销账号** ends the account and revokes its sessions.
 *
 * They share the same server-side ledger lifecycle functions, but never the same account action.
 */
export function AccountDataPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [data, setData] = useState<AccountLifecycle | null>(null);
  const [preview, setPreview] = useState<DataDeletionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [allBooks, setAllBooks] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [decisions, setDecisions] = useState<Record<string, BookDecisionAction>>({});
  const [deleteResult, setDeleteResult] = useState<DataDeletionResult | null>(null);
  const [closeResult, setCloseResult] = useState<CloseAccountResult | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchAccountLifecycle();
      setData(next);
      setDecisions(
        Object.fromEntries(
          next.books.map((book) => [
            book.bookId,
            book.archived ? "keep_archived" : book.memberCount > 1 ? "leave" : "archive",
          ]),
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

  const activeBooks = data?.books.filter((book) => !book.archived) ?? [];
  const archivedBooks = data?.books.filter((book) => book.archived) ?? [];

  async function openDeleteDialog(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await fetchDataDeletionPreview();
      setPreview(next);
      setSelected(new Set(next.books.map((book) => book.bookId)));
      setAllBooks(false);
      setPassword("");
      setConfirmation("");
      setDialog("delete");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function openCloseDialog(): void {
    setPassword("");
    setConfirmation("");
    setError(null);
    setDialog("close");
  }

  function cancelClose(): void {
    setDialog(null);
    setPassword("");
    setConfirmation("");
    setError(null);
  }

  async function onExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await fetchAccountExport();
      const outcome = await deliverFile(file.fileName, "application/json", file.bytes);
      setNotice(outcome.cancelled ? "已取消导出。" : "账号数据已导出。");
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

  async function submitDelete(): Promise<void> {
    if (confirmation !== "删除服务器数据") {
      setError("请输入「删除服务器数据」确认这次操作。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bookIds = allBooks ? [] : [...selected];
      const result = await deleteServerData({
        password,
        confirmation,
        all: allBooks,
        bookIds,
      });
      if (user !== null) {
        for (const item of result.processed) {
          await clearBookLocalData(user.id, item.bookId);
        }
      }
      setDeleteResult(result);
      setDialog("delete-result");
      setPassword("");
      setConfirmation("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(): Promise<void> {
    if (data === null) return;
    if (confirmation !== "注销账号") {
      setError("请输入「注销账号」确认这次操作。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await closeAccount({
        method: "close_account",
        password,
        confirmation,
        decisions: data.books.map((book) => ({
          bookId: book.bookId,
          action: decisions[book.bookId] ?? "leave",
        })),
      });
      if (user !== null) await clearAccountLocalData(user.id);
      setCloseResult(result);
      setDialog("close-result");
      setPassword("");
      setConfirmation("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function finishClose(): Promise<void> {
    await logout();
    /**
     * ⚠️ **S14-B: `/` rather than `/login`, for the same reason as the ordinary sign-out.**
     * A closed formal account does not erase the browser's guest identity; startup routing should
     * decide between the guest workspace and the account entry instead of forcing the login screen.
     */
    void navigate("/", { replace: true });
  }

  function finishDelete(): void {
    setDialog(null);
    void navigate("/settings/account-data", { replace: true });
    void load();
  }

  const blocked = (data?.blockers.length ?? 0) > 0;
  const deleteBlocked = (preview?.blockers.length ?? 0) > 0;

  return (
    <InnerPage title="账号与数据" backTo="/settings">
      {/**
        * ⚠️ **S16-A：反馈贴着页面顶部，但不再整段铺开。** 服务器的错误说明可能有好几行（例如注销
        * 前需要交接的账本），原来的 `Alert` 会把下面的三组内容整体推出首屏。`InlineMessage` 默认显示
        * 两行、可展开全文、可关闭；文字完整保留，读屏软件读到的是全文。
        *
        * ⚠️ 原来标题下的一句概述（"管理账号数据、已归档账本……"）去掉了：下面三组的组名已经说清楚
        * 这一页管什么，概述只是把第一组往下推。
        */}
      {error === null ? null : (
        <InlineMessage
          tone="error"
          onDismiss={() => {
            setError(null);
          }}
        >
          {error}
        </InlineMessage>
      )}
      {notice === null ? null : (
        <InlineMessage
          tone="success"
          onDismiss={() => {
            setNotice(null);
          }}
        >
          {notice}
        </InlineMessage>
      )}

      <ListGroup title="数据">
        <ListRow
          label="导出我的数据"
          detail="账号资料与当前可访问账本的全部账目"
          onClick={() => void onExport()}
          disabled={busy}
        />
      </ListGroup>

      {/**
        * ⚠️ **读取中不是"没有账本"。** 以前数据还没回来时 `activeBooks` 是空数组，页面会先显示
        * 「当前账号没有账本」再跳成列表；读取失败时也会停在这句话上。现在三种状态分开：读取中、
        * 读取失败（可重试）、真的没有账本。
        */}
      {data === null ? (
        <ListGroup title="我的账本">
          {error === null ? (
            <div className="px-5 py-4 text-body text-muted">正在读取账本……</div>
          ) : (
            <ListRow label="账本列表读取失败" detail="点按重新读取" onClick={() => void load()} disabled={busy} />
          )}
        </ListGroup>
      ) : (
        <ListGroup
          title="我的账本"
          footer={archivedBooks.length === 0 ? "没有已归档账本。" : undefined}
        >
          {activeBooks.length === 0 ? (
            <div className="px-5 py-4">
              <p className="text-body text-ink">当前账号没有账本。</p>
              <p className="mt-1 text-helper text-muted">删除全部账本数据后仍会保留账号，你可以从账本空间新建一本。</p>
              <Button
                variant="secondary"
                fullWidth={false}
                className="mt-3"
                onClick={() => void navigate("/start")}
              >
                去新建账本
              </Button>
            </div>
          ) : (
            activeBooks.map((book) => (
              <ListRow
                key={book.bookId}
                label={<span className="block truncate">{book.name}</span>}
                detail={`${book.bookNumber === null ? "" : `${book.bookNumber} · `}${
                  book.memberCount > 1 ? `共享账本 · ${String(book.memberCount)} 位成员` : "单人账本"
                }`}
                onClick={() => void navigate(`/books/${book.bookId}/settings`)}
              />
            ))
          )}
        </ListGroup>
      )}

      {archivedBooks.length === 0 ? null : (
        <ListGroup title="已归档账本">
          {archivedBooks.map((book) => (
            <div key={book.bookId} className="flex flex-col gap-1 px-5 py-3.5">
              <p className="text-body text-ink">{book.name}</p>
              <p className="text-helper-relaxed text-muted">
                归档于 {dateText(book.archivedAt)} · 自助恢复截止 {dateText(book.selfRestoreUntil)}
              </p>
              <p className="text-helper-relaxed text-muted">预计清理 {dateText(book.scheduledPurgeAt)}（到期后 24 小时内）</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {book.selfRestoreUntil !== null && new Date(book.selfRestoreUntil).getTime() > Date.now() ? (
                  <Button variant="secondary" fullWidth={false} disabled={busy} onClick={() => void onRestore(book.bookId)}>
                    恢复账本
                  </Button>
                ) : null}
                {book.selfRestoreUntil !== null && new Date(book.selfRestoreUntil).getTime() <= Date.now() ? (
                  <Button variant="secondary" fullWidth={false} disabled={busy} onClick={() => void onRequestRecovery(book.bookId)}>
                    申请人工恢复
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </ListGroup>
      )}

      <ListGroup title="危险操作">
        <ListRow
          label="删除服务器数据"
          tone="danger"
          detail="选择账本或全部账本；账号仍保留，可以继续登录和新建账本"
          disabled={busy}
          onClick={() => void openDeleteDialog()}
        />
        <ListRow
          label="注销账号"
          tone="danger"
          detail={
            <>
              逐本处理账本、撤销登录；注销后不能继续使用这个账号
              {blocked ? <span className="block text-danger">有账本需要先处理管理者交接或清理状态。</span> : null}
            </>
          }
          disabled={busy || blocked}
          onClick={openCloseDialog}
        />
      </ListGroup>

      {dialog === "delete" && preview !== null ? (
        <ConsentDialog
          title="删除服务器数据"
          eyebrow="账号会保留"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
                取消
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitDelete()}
                disabled={
                  busy ||
                  deleteBlocked ||
                  password.length === 0 ||
                  (!allBooks && selected.size === 0)
                }
              >
                {busy ? "处理中…" : allBooks ? "删除全部账本数据" : "删除所选账本数据"}
              </Button>
            </>
          }
        >
          <p className="text-body-relaxed text-ink">
            只会删除账本数据。账号、密码、登录状态和恢复码都不会改变，之后仍可登录并新建账本。
          </p>
          <div className="mt-3 rounded-field bg-canvas px-3 py-2 text-helper-relaxed text-muted">
            共享账本：退出协作，其他成员不受影响。单人账本、最后成员账本或已归档账本：永久删除，并保留必要的删除记录。
          </div>

          {deleteBlocked ? (
            <p className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
              有账本暂时不能删除数据（需要管理者交接或存在待处理的恢复申请）。整个操作不会执行。
            </p>
          ) : null}

          <label className="mt-4 flex items-start gap-3 rounded-field border border-line p-3 text-body text-ink">
            <input
              type="checkbox"
              checked={allBooks}
              onChange={(event) => {
                setAllBooks(event.target.checked);
                if (event.target.checked) setSelected(new Set(preview.books.map((book) => book.bookId)));
              }}
              className="mt-1 size-4 shrink-0"
            />
            <span>删除全部账本数据（{String(preview.counts.total)} 本）</span>
          </label>

          <div className="mt-3 flex flex-col gap-2">
            {preview.books.map((book) => {
              const checked = allBooks || selected.has(book.bookId);
              return (
                <label key={book.bookId} className="flex items-start gap-3 rounded-field border border-line px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={allBooks}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(book.bookId);
                        else next.delete(book.bookId);
                        return next;
                      });
                    }}
                    className="mt-1 size-4 shrink-0"
                  />
                  <span className="min-w-0 text-body text-ink">
                    <span className="block">{book.name}</span>
                    <span className="block text-helper text-muted">
                      {book.action === "leave"
                        ? `退出共享账本 · ${String(book.memberCount)} 位成员`
                        : book.archived
                          ? "永久删除已归档账本"
                          : "永久删除账本数据"}
                    </span>
                    {book.blockedReason === null ? null : (
                      <span className="block text-helper text-danger">{book.blockedReason}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <TextField
              label="当前密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="输入「删除服务器数据」确认"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <p className="mt-3 text-helper text-muted">
            旧设备联网后会停止同步并清理对应本地副本；历史备份按备份周期保留，最长约 365 天，到期后清理，不能即时抹除。
          </p>
          {error === null ? null : <Alert>{error}</Alert>}
        </ConsentDialog>
      ) : null}

      {dialog === "delete-result" && deleteResult !== null ? (
        <ConsentDialog
          title="服务器数据已删除"
          eyebrow="账号仍保留"
          footer={<Button onClick={finishDelete}>完成</Button>}
        >
          <p className="text-body-relaxed text-ink">所选账本已按规则处理完毕。账号没有被注销，仍可正常登录。</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-body text-ink">
            {deleteResult.processed.map((item) => (
              <li key={item.bookId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{preview?.books.find((book) => book.bookId === item.bookId)?.name ?? item.bookId.slice(0, 8)}</span>
                <span className="shrink-0">
                  {item.action === "left" || item.action === "already_left"
                    ? "已退出共享账本"
                    : item.action === "deleted"
                      ? "已永久删除"
                      : "此前已删除"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-helper text-muted">
            当前账号剩余 {String(deleteResult.remainingBookCount)} 本账本。没有账本时可以从账本空间新建。
          </p>
        </ConsentDialog>
      ) : null}

      {dialog === "close" && data !== null ? (
        <ConsentDialog
          title="注销账号"
          eyebrow="不可恢复"
          onDismiss={busy ? undefined : cancelClose}
          footer={
            <>
              <Button variant="secondary" onClick={cancelClose} disabled={busy}>
                取消
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitClose()}
                disabled={busy || password.length === 0}
              >
                {busy ? "处理中…" : "确认注销"}
              </Button>
            </>
          }
        >
          <p className="text-body-relaxed text-ink">
            注销后这个账号不能继续登录或同步。下面每一本账本都会按现有生命周期规则处理。
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {data.books.map((book) => (
              <div key={book.bookId} className="rounded-field border border-line px-3 py-2.5">
                <p className="text-body text-ink">{book.name}</p>
                <p className="mt-0.5 text-helper text-muted">
                  {book.archived
                    ? `已归档 · ${dateText(book.archivedAt)}`
                    : book.memberCount > 1
                      ? `共享账本 · ${String(book.memberCount)} 位成员`
                      : "单人账本"}
                </p>
                <select
                  /**
                    * ⚠️ **`text-base`, not `text-body`** —— `index.css` 有一条明确的全局不变量：
                    * 「Never let a form control's text fall below 16px」，因为 iOS Safari 会在低于
                    * 16px 的控件获得焦点时**放大整页且不缩回**。元素选择器 `select { font-size: 16px }`
                    * 就是那条规则，而 `text-body`(14px) 这样的类会把它覆盖掉——**类胜过元素选择器**，
                    * 于是这个下拉成了同一种缺陷的漏网之处（另见 分类/标签/支付方式 的筛选下拉、
                    * 批量编辑弹层的两个下拉）。
                    */
                  className="mt-2 w-full rounded-field border border-line bg-surface px-3 py-2 text-base text-ink"
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
                        ? "退出共享账本"
                        : option === "archive"
                          ? "归档账本（60 天内可恢复）"
                          : option === "keep_archived"
                            ? "保持原归档期限"
                            : "永久删除账本"}
                    </option>
                  ))}
                </select>
                {book.blockedReason === null ? null : <p className="mt-1 text-helper text-danger">{book.blockedReason}</p>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <TextField
              label="当前密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="输入「注销账号」确认"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <p className="mt-3 text-helper text-muted">
            若保留归档账本，会生成一次性恢复凭证；凭证只用于恢复符合条件的归档账本，不能恢复账号。旧设备联网后会退出。
          </p>
          {error === null ? null : <Alert>{error}</Alert>}
        </ConsentDialog>
      ) : null}

      {dialog === "close-result" && closeResult !== null ? (
        <ConsentDialog
          title="账号已注销"
          eyebrow="已停止使用"
          footer={<Button onClick={() => void finishClose()}>返回登录</Button>}
        >
          <p className="text-body-relaxed text-ink">这个账号已注销，无法继续使用；旧设备联网后会退出登录。</p>

          {closeResult.recoveryCredential === null ? (
            <p className="mt-3 text-helper-relaxed text-muted">没有保留需要恢复的归档账本。</p>
          ) : (
            <div className="mt-4 rounded-field border border-line bg-canvas p-4">
              <p className="text-body font-medium text-ink">归档恢复凭证</p>
              <p className="mt-1 text-helper-relaxed text-muted">
                只显示这一次，请现在保存。它用于申请恢复符合条件的归档账本，不能恢复账号。
              </p>
              <div className="mt-3">
                <CopyButton
                  text={closeResult.recoveryCredential}
                  label="复制恢复凭证"
                  copiedLabel="已复制"
                  variant="secondary"
                  rows={3}
                  hint="完整的恢复凭证也显示在下方，可以长按选择。"
                />
              </div>
            </div>
          )}

          <p className="mt-3 text-helper text-muted">
            历史备份按备份周期保留，最长约 365 天，到期后清理；完全离线的设备会在下次联网时退出。
          </p>
        </ConsentDialog>
      ) : null}
    </InnerPage>
  );
}
