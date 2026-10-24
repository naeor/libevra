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
import { isChineseLocale, t as translate, useI18n } from "../i18n/index.js";
import { errorMessage } from "../lib/api.js";
import { fetchAccountExport } from "../lib/consent.js";
import { formatInstant } from "../lib/datetime.js";
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
  return formatInstant(value, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * **服务器要求的确认原文**（`apps/api/src/routes/lifecycle.ts` 逐字比对）。提交给服务器的永远是这两句，
 * 不随界面语言变化。
 */
const DELETE_CONFIRMATION = "删除服务器数据"; // i18n-ignore：服务器逐字校验的确认原文，不是界面文字
const CLOSE_CONFIRMATION = "注销账号"; // i18n-ignore：服务器逐字校验的确认原文，不是界面文字

/**
 * 用户输入的确认短语是否有效（S16 国际化）。
 *
 * ⚠️ **服务器原文永远有效，中文界面的判断与以前完全相同**（中文短语就是服务器原文，逐字比对）。
 * 其它语言另外接受**当前语言的短语**（忽略首尾空格与大小写，手机键盘常自动大写首字母）——让英文用户
 * 不必输入中文；通过后提交的仍是服务器原文。这只是界面上的防误触，真正的校验（密码 + 原文）在服务器。
 */
export function confirmationAccepted(typed: string, serverPhrase: string, localizedPhrase: string): boolean {
  if (typed === serverPhrase) return true;
  if (localizedPhrase === serverPhrase) return false;
  return typed.trim().toLocaleLowerCase() === localizedPhrase.trim().toLocaleLowerCase();
}

const BLOCKED_REASONS = ["purging", "pendingRecovery", "noSuccessor", "noSuccessorClose"] as const;

/**
 * 服务器给的「暂时不能处理」原因按当前语言显示。
 *
 * 中文界面原样显示服务器原文（与以前相同）；其它语言用中文原文反查 `account.data.blockedReason.*`，
 * 查到就显示译文，查不到（服务器以后新增的说法）就原样显示，不丢信息。
 */
export function blockedReasonText(reason: string): string {
  if (isChineseLocale()) return reason;
  for (const key of BLOCKED_REASONS) {
    if (translate(`account.data.blockedReason.${key}`, { lng: "zh-CN" }) === reason) {
      return translate(`account.data.blockedReason.${key}`);
    }
  }
  return reason;
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
  const { t } = useI18n();
  const deletePhrase = t("account.data.deletePhrase");
  const closePhrase = t("account.data.closePhrase");
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
      setNotice(outcome.cancelled ? t("account.data.exportCancelled") : t("account.data.exportDone"));
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
      setNotice(t("account.data.restored"));
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
      setNotice(t("account.data.manualRecoveryRequested", { deadline: dateText(request.deadlineAt) }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(): Promise<void> {
    if (!confirmationAccepted(confirmation, DELETE_CONFIRMATION, deletePhrase)) {
      setError(t("account.data.phraseRequired", { phrase: deletePhrase }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bookIds = allBooks ? [] : [...selected];
      const result = await deleteServerData({
        password,
        confirmation: DELETE_CONFIRMATION,
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
    if (!confirmationAccepted(confirmation, CLOSE_CONFIRMATION, closePhrase)) {
      setError(t("account.data.phraseRequired", { phrase: closePhrase }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await closeAccount({
        method: "close_account",
        password,
        confirmation: CLOSE_CONFIRMATION,
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
    <InnerPage title={t("account.data.title")} backTo="/settings">
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

      <ListGroup title={t("account.data.groupData")}>
        <ListRow
          label={t("account.data.export")}
          detail={t("account.data.exportDetail")}
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
        <ListGroup title={t("account.data.myLedgers")}>
          {error === null ? (
            <div className="px-5 py-4 text-body text-muted">{t("account.data.loadingLedgers")}</div>
          ) : (
            <ListRow
              label={t("account.data.loadFailed")}
              detail={t("account.data.loadRetry")}
              onClick={() => void load()}
              disabled={busy}
            />
          )}
        </ListGroup>
      ) : (
        <ListGroup
          title={t("account.data.myLedgers")}
          footer={archivedBooks.length === 0 ? t("account.data.noArchived") : undefined}
        >
          {activeBooks.length === 0 ? (
            <div className="px-5 py-4">
              <p className="text-body text-ink">{t("account.data.noLedgers")}</p>
              <p className="mt-1 text-helper text-muted">{t("account.data.noLedgersHint")}</p>
              <Button
                variant="secondary"
                fullWidth={false}
                className="mt-3"
                onClick={() => void navigate("/start")}
              >
                {t("account.data.createLedger")}
              </Button>
            </div>
          ) : (
            activeBooks.map((book) => (
              <ListRow
                key={book.bookId}
                label={<span className="block truncate">{book.name}</span>}
                detail={`${book.bookNumber === null ? "" : `${book.bookNumber} · `}${
                  book.memberCount > 1
                    ? t("account.data.sharedLedger", { count: book.memberCount })
                    : t("account.data.soloLedger")
                }`}
                onClick={() => void navigate(`/books/${book.bookId}/settings`)}
              />
            ))
          )}
        </ListGroup>
      )}

      {archivedBooks.length === 0 ? null : (
        <ListGroup title={t("account.data.archivedGroup")}>
          {archivedBooks.map((book) => (
            <div key={book.bookId} className="flex min-w-0 flex-col gap-1 px-5 py-3.5">
              <p className="break-words text-body text-ink">{book.name}</p>
              <p className="text-helper-relaxed text-muted">
                {t("account.data.archivedAt", {
                  archivedAt: dateText(book.archivedAt),
                  restoreUntil: dateText(book.selfRestoreUntil),
                })}
              </p>
              <p className="text-helper-relaxed text-muted">
                {t("account.data.purgeAt", { purgeAt: dateText(book.scheduledPurgeAt) })}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {book.selfRestoreUntil !== null && new Date(book.selfRestoreUntil).getTime() > Date.now() ? (
                  <Button variant="secondary" fullWidth={false} disabled={busy} onClick={() => void onRestore(book.bookId)}>
                    {t("account.data.restore")}
                  </Button>
                ) : null}
                {book.selfRestoreUntil !== null && new Date(book.selfRestoreUntil).getTime() <= Date.now() ? (
                  <Button variant="secondary" fullWidth={false} disabled={busy} onClick={() => void onRequestRecovery(book.bookId)}>
                    {t("account.data.requestRecovery")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </ListGroup>
      )}

      <ListGroup title={t("account.data.danger")}>
        <ListRow
          label={t("account.data.deleteServerData")}
          tone="danger"
          detail={t("account.data.deleteServerDataDetail")}
          disabled={busy}
          onClick={() => void openDeleteDialog()}
        />
        <ListRow
          label={t("account.data.closeAccount")}
          tone="danger"
          detail={
            <>
              {t("account.data.closeAccountDetail")}
              {blocked ? <span className="block text-danger">{t("account.data.closeBlocked")}</span> : null}
            </>
          }
          disabled={busy || blocked}
          onClick={openCloseDialog}
        />
      </ListGroup>

      {dialog === "delete" && preview !== null ? (
        <ConsentDialog
          title={t("account.data.delete.title")}
          eyebrow={t("account.data.delete.eyebrow")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={busy}>
                {t("account.data.cancel")}
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
                {busy
                  ? t("account.data.processing")
                  : allBooks
                    ? t("account.data.delete.submitAll")
                    : t("account.data.delete.submitSelected")}
              </Button>
            </>
          }
        >
          <p className="text-body-relaxed text-ink">{t("account.data.delete.intro")}</p>
          <div className="mt-3 rounded-field bg-canvas px-3 py-2 text-helper-relaxed text-muted">
            {t("account.data.delete.rules")}
          </div>

          {deleteBlocked ? (
            <p className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
              {t("account.data.delete.blocked")}
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
            <span className="min-w-0">{t("account.data.delete.all", { count: preview.counts.total })}</span>
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
                    <span className="block break-words">{book.name}</span>
                    <span className="block text-helper text-muted">
                      {book.action === "leave"
                        ? t("account.data.delete.leaveShared", { count: book.memberCount })
                        : book.archived
                          ? t("account.data.delete.deleteArchived")
                          : t("account.data.delete.deleteData")}
                    </span>
                    {book.blockedReason === null ? null : (
                      <span className="block text-helper text-danger">{blockedReasonText(book.blockedReason)}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <TextField
              label={t("account.data.currentPassword")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label={t("account.data.phraseLabel", { phrase: deletePhrase })}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <p className="mt-3 text-helper text-muted">{t("account.data.delete.backupNote")}</p>
          {error === null ? null : <Alert>{error}</Alert>}
        </ConsentDialog>
      ) : null}

      {dialog === "delete-result" && deleteResult !== null ? (
        <ConsentDialog
          title={t("account.data.deleteResult.title")}
          eyebrow={t("account.data.deleteResult.eyebrow")}
          footer={<Button onClick={finishDelete}>{t("account.data.deleteResult.done")}</Button>}
        >
          <p className="text-body-relaxed text-ink">{t("account.data.deleteResult.intro")}</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-body text-ink">
            {deleteResult.processed.map((item) => (
              <li key={item.bookId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{preview?.books.find((book) => book.bookId === item.bookId)?.name ?? item.bookId.slice(0, 8)}</span>
                <span className="shrink-0">
                  {item.action === "left" || item.action === "already_left"
                    ? t("account.data.deleteResult.left")
                    : item.action === "deleted"
                      ? t("account.data.deleteResult.deleted")
                      : t("account.data.deleteResult.alreadyDeleted")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-helper text-muted">
            {t("account.data.deleteResult.remaining", { count: deleteResult.remainingBookCount })}
          </p>
        </ConsentDialog>
      ) : null}

      {dialog === "close" && data !== null ? (
        <ConsentDialog
          title={t("account.data.close.title")}
          eyebrow={t("account.data.close.eyebrow")}
          onDismiss={busy ? undefined : cancelClose}
          footer={
            <>
              <Button variant="secondary" onClick={cancelClose} disabled={busy}>
                {t("account.data.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => void submitClose()}
                disabled={busy || password.length === 0}
              >
                {busy ? t("account.data.processing") : t("account.data.close.submit")}
              </Button>
            </>
          }
        >
          <p className="text-body-relaxed text-ink">{t("account.data.close.intro")}</p>
          <div className="mt-3 flex flex-col gap-2">
            {data.books.map((book) => (
              <div key={book.bookId} className="rounded-field border border-line px-3 py-2.5">
                <p className="break-words text-body text-ink">{book.name}</p>
                <p className="mt-0.5 text-helper text-muted">
                  {book.archived
                    ? t("account.data.close.archived", { date: dateText(book.archivedAt) })
                    : book.memberCount > 1
                      ? t("account.data.sharedLedger", { count: book.memberCount })
                      : t("account.data.soloLedger")}
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
                        ? t("account.data.close.optionLeave")
                        : option === "archive"
                          ? t("account.data.close.optionArchive")
                          : option === "keep_archived"
                            ? t("account.data.close.optionKeepArchived")
                            : t("account.data.close.optionDelete")}
                    </option>
                  ))}
                </select>
                {book.blockedReason === null ? null : (
                  <p className="mt-1 text-helper text-danger">{blockedReasonText(book.blockedReason)}</p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <TextField
              label={t("account.data.currentPassword")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label={t("account.data.phraseLabel", { phrase: closePhrase })}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <p className="mt-3 text-helper text-muted">{t("account.data.close.credentialNote")}</p>
          {error === null ? null : <Alert>{error}</Alert>}
        </ConsentDialog>
      ) : null}

      {dialog === "close-result" && closeResult !== null ? (
        <ConsentDialog
          title={t("account.data.closeResult.title")}
          eyebrow={t("account.data.closeResult.eyebrow")}
          footer={<Button onClick={() => void finishClose()}>{t("account.data.closeResult.backToLogin")}</Button>}
        >
          <p className="text-body-relaxed text-ink">{t("account.data.closeResult.intro")}</p>

          {closeResult.recoveryCredential === null ? (
            <p className="mt-3 text-helper-relaxed text-muted">{t("account.data.closeResult.noCredential")}</p>
          ) : (
            <div className="mt-4 rounded-field border border-line bg-canvas p-4">
              <p className="text-body font-medium text-ink">{t("account.data.closeResult.credentialTitle")}</p>
              <p className="mt-1 text-helper-relaxed text-muted">{t("account.data.closeResult.credentialNote")}</p>
              <div className="mt-3">
                <CopyButton
                  text={closeResult.recoveryCredential}
                  label={t("account.data.closeResult.copy")}
                  copiedLabel={t("account.data.closeResult.copied")}
                  variant="secondary"
                  rows={3}
                  hint={t("account.data.closeResult.copyHint")}
                />
              </div>
            </div>
          )}

          <p className="mt-3 text-helper text-muted">{t("account.data.closeResult.backupNote")}</p>
        </ConsentDialog>
      ) : null}
    </InnerPage>
  );
}
