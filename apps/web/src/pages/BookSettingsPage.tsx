import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { BookIdentityCard, BookSwitcherSheet } from "../components/BookSwitcherSheet.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { TextField } from "../components/TextField.js";
import { errorMessage } from "../lib/api.js";
import {
  useBookMembers,
  useBooks,
  useCurrentBookId,
  useDisposeBook,
  useLedgerMeta,
  useLeaveBook,
  useRenameBook,
} from "../lib/queries.js";

/**
 * **账本设置 —— `/books/:bookId/settings`（S13-E）。**
 *
 * ⚠️ **`bookId` 来自地址，页面只认它。** 所有读写都点名这本账：`useLedgerMeta(bookId)`、
 * `useBookMembers(bookId)`、`useRenameBook` 的 `{ bookId }`、三个 organizer 的 mutations。
 * **这一页不调用 `useLedger()`**——那会把设备搬进正在管理的账本（`setCurrentBook` /
 * `setOfflineBook`），而所有者明确禁止"通过静默修改全局当前账本来实现目标账本管理"（1.10.08）。
 *
 * ⚠️ **管理一本不在其中的账本时，这一页只改这本账。** 改名、分类、标签、支付方式、导出导入
 * 全部带目标 `bookId`；失效的缓存也按目标 key 走（见 `useLedgerInvalidator`）。
 *
 * ⚠️ **`?rename=1` 是给旧入口用的**：`BookManageSheet` 的「重命名」跳到这里并带该参数，
 * 页面一打开就弹输入框——**齿轮面板不在半屏菜单里放输入框**（旧行为保持不变）。
 *
 * ⚠️ **viewer 看不到假入口。** 名称行不可点、危险操作按 `useBooks()` 的 `role` / `isCreator`
 * 决定；但**服务端权限仍然是最终依据**，界面只是不给人一个按了必然失败的按钮。
 */
export function BookSettingsPage(): React.JSX.Element {
  const { bookId = "" } = useParams<{ bookId: string }>();

  /**
   * ⚠️ **Keyed by the ledger, so switching targets cannot carry a half-finished edit across.**
   * The sheet switches the id in the URL; without the key, an open rename draft for A would still be
   * on screen after the address — and every request — had moved to B.
   */
  return <BookSettings key={bookId} bookId={bookId} />;
}

function BookSettings({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);
  const books = useBooks();
  /**
   * ⚠️ **Read only as a fallback for `myRole`**, for the moment `/books` has not answered yet.
   * Nothing on this page reads the *target's* entries through it — it is the member list of the
   * ledger named in the URL, which is the ledger being managed.
   */
  const members = useBookMembers(bookId);
  const currentBookId = useCurrentBookId();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const rename = useRenameBook();
  const dispose = useDisposeBook();
  const leave = useLeaveBook();

  const [switcher, setSwitcher] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "dispose" | "leave">(null);
  /** A target chosen while a rename draft was unsaved — the question, not the navigation. */
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const row = books.data?.books.find((book) => book.id === bookId);
  const name = meta.data?.book.name ?? row?.name ?? null;
  const bookNumber = meta.data?.book.bookNumber ?? row?.bookNumber ?? null;
  const memberCount = meta.data?.book.memberCount ?? row?.memberCount;

  const role = row?.role ?? members.data?.myRole;
  const canWrite = role === "owner" || role === "editor";
  /**
   * ⚠️ **`useBooks()` is the source for 弃置/退出**, because `isCreator` is the flag the server's
   * rules are written against (`createdBy`) and the management sheet already reads it there.
   * **Unknown is not the same as false**: until the list answers, neither danger action is shown —
   * offering 「退出」 to the creator only produces `creator_cannot_leave`.
   */
  const isCreator = row?.isCreator;

  /**
   * ⚠️ **The deep link that opens the rename field** (`?rename=1`). It waits for the name, seeds it
   * once, and never re-seeds — so a refetch landing while somebody types cannot overwrite them.
   */
  const autoOpened = useRef(false);

  useEffect(() => {
    if (autoOpened.current) return;
    if (!canWrite || !meta.isSuccess) return;
    if (search.get("rename") !== "1") return;

    autoOpened.current = true;
    setDraft(meta.data.book.name);
    setRenameError(null);
    setRenaming(true);
  }, [canWrite, meta.isSuccess, meta.data, search]);

  function openRename(): void {
    autoOpened.current = true;
    setDraft(name ?? "");
    setRenameError(null);
    setRenaming(true);

    const next = new URLSearchParams(search);
    next.set("rename", "1");
    setSearch(next, { replace: true });
  }

  /** ⚠️ Closing drops the parameter, so a refresh does not reopen a dialog nobody asked for. */
  function closeRename(): void {
    setRenaming(false);
    setRenameError(null);

    const next = new URLSearchParams(search);
    next.delete("rename");
    setSearch(next, { replace: true });
  }

  function submitRename(): void {
    const value = draft.trim();
    /** ⚠️ The same bounds the server enforces — 1–40, trimmed — checked here so the error is instant. */
    if (value === "") {
      setRenameError("账本名称不能为空。");
      return;
    }
    if (value.length > 40) {
      setRenameError("账本名称最多 40 个字。");
      return;
    }

    setRenameError(null);
    void rename
      .mutateAsync({ bookId, name: value })
      .then(() => {
        closeRename();
      })
      .catch((caught: unknown) => {
        /** ⚠️ The draft is kept: an error must not also cost the reader what they typed. */
        setRenameError(errorMessage(caught));
      });
  }

  /**
   * ⚠️ **Switching targets never discards typing silently.**
   *
   * The sheet is the only way to change `bookId`, and a rename dialog can be open behind it (a
   * dialog is modal, but a browser back/forward or a second tab can still get here, and the guard
   * should not depend on which one happened). If the draft differs from the saved name, the reader
   * is asked — **cancelling keeps the draft and the dialog exactly as they were.**
   */
  const savedName = meta.data?.book.name ?? "";
  const draftIsDirty = renaming && draft.trim() !== "" && draft.trim() !== savedName;

  function goTo(nextId: string): void {
    void navigate(`/books/${nextId}/settings`, { replace: true });
  }

  function selectTarget(nextId: string): void {
    setSwitcher(false);

    if (nextId === bookId) return;
    if (draftIsDirty) {
      setPendingSwitch(nextId);
      return;
    }

    goTo(nextId);
  }

  /**
   * ⚠️ **After 弃置/退出 the ledger is gone from the reader's list**, so staying on its settings page
   * would show a ledger that no longer exists. Leaving the ledger the device is *in* has to move the
   * session too — the same reason `BookManageSheet` reloads in that case.
   */
  function afterRemoval(): void {
    if (bookId === currentBookId) {
      window.location.assign("/");
      return;
    }
    void navigate("/start");
  }

  function runDispose(): void {
    setError(null);
    void dispose
      .mutateAsync(bookId)
      .then(() => {
        afterRemoval();
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
        setConfirming(null);
      });
  }

  function runLeave(): void {
    setError(null);
    void leave
      .mutateAsync(bookId)
      .then(() => {
        afterRemoval();
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
        setConfirming(null);
      });
  }

  return (
    <InnerPage
      title="账本设置"
      subtitle={name === null ? "正在读取……" : `${name}${bookNumber === null ? "" : ` · ${bookNumber}`}`}
      backTo="/start"
    >
      {meta.isPending ? <SkeletonRows rows={4} /> : null}

      {meta.isSuccess ? (
        <>
          <BookIdentityCard
            bookId={bookId}
            name={name ?? ""}
            bookNumber={bookNumber}
            memberCount={memberCount}
            caption="正在管理"
            onSwitch={() => {
              setSwitcher(true);
            }}
          />

          {/* ---------------------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-helper text-muted">账本资料</h2>

            <ul className="overflow-hidden rounded-card border border-line bg-surface">
              {canWrite ? (
                <ActionRow
                  label="账本名称"
                  value={name ?? ""}
                  onSelect={openRename}
                />
              ) : (
                /**
                 * ⚠️ **A viewer gets a value, not a button.** The server would refuse the rename
                 * anyway (`requireBookForWrite`); showing the control would only teach them that
                 * the app is broken.
                 */
                <ReadOnlyRow label="账本名称" value={name ?? ""} />
              )}
              <ReadOnlyRow label="账本编号" value={bookNumber ?? "（未分配编号）"} />
            </ul>

            {canWrite ? null : (
              <p className="px-1 text-helper-relaxed text-muted">
                你对这本账只有查看权限，所以名称等资料不能在这里修改。
              </p>
            )}
          </section>

          {/* ---------------------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-helper text-muted">记账管理</h2>
            <ul className="overflow-hidden rounded-card border border-line bg-surface">
              <NavRow
                label="分类管理"
                hint="支出、收入的分类；归档不影响已有记录"
                to={`/books/${bookId}/settings/categories`}
              />
              <NavRow
                label="标签管理"
                hint="跨分类标记，例如「出差」「可报销」"
                to={`/books/${bookId}/settings/tags`}
              />
              <NavRow
                label="支付方式"
                hint="微信、支付宝、银行卡、现金等"
                to={`/books/${bookId}/settings/payment-methods`}
              />
            </ul>
          </section>

          {/* ---------------------------------------------------------------- */}
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-helper text-muted">数据管理</h2>
            <ul className="overflow-hidden rounded-card border border-line bg-surface">
              <NavRow
                label="导出数据"
                hint="把这本账导出为 CSV / Excel"
                to={`/books/${bookId}/settings/export`}
              />
              <NavRow
                label="导入历史账"
                hint="从 CSV 批量导入这本账"
                to={`/books/${bookId}/settings/import`}
              />
            </ul>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/**
            * ⚠️ **Danger sits at the bottom, apart from everything else, and it is the creator's or
            * the member's own action.** 弃置 and 退出 are different things and are never merged:
            * 弃置 sets the whole ledger aside for everybody (creator only); 退出 is one person
            * leaving somebody else's ledger (and the creator has no 退出 — the server refuses it).
            */}
          {isCreator === undefined ? null : (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-helper text-muted">危险操作</h2>

              <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
                {error === null ? null : <Alert>{error}</Alert>}

                {isCreator ? (
                  <>
                    <p className="text-body-relaxed text-muted">
                      弃置后这本账对所有人都不再显示，数据保留，你作为创建者随时可以恢复。
                    </p>
                    <button
                      type="button"
                      disabled={dispose.isPending}
                      onClick={() => {
                        setError(null);
                        setConfirming("dispose");
                      }}
                      className="flex w-full items-center justify-center rounded-field border border-danger/40 px-4 py-3 text-button-lg font-medium text-danger transition hover:bg-danger-soft disabled:opacity-45"
                    >
                      弃置这本账
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-body-relaxed text-muted">
                      退出后这本账不再出现在你的列表里，你也就看不到它的账目了。已经记过的账目会保留。
                    </p>
                    <button
                      type="button"
                      disabled={leave.isPending}
                      onClick={() => {
                        setError(null);
                        setConfirming("leave");
                      }}
                      className="flex w-full items-center justify-center rounded-field border border-danger/40 px-4 py-3 text-button-lg font-medium text-danger transition hover:bg-danger-soft disabled:opacity-45"
                    >
                      退出账本
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          <p className="text-helper-relaxed text-muted">
            成员与邀请、分享链接在账本空间的齿轮面板里，和以前一样。
          </p>
        </>
      ) : null}

      {/**
        * ⚠️ **A target that cannot be read says so, and offers the two honest ways out** — back, or
        * another ledger. It never quietly shows the current ledger's settings instead.
        */}
      {meta.isError ? (
        <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium text-ink">打不开这本账</h2>
            <p role="alert" className="text-body-relaxed text-muted">
              {errorMessage(meta.error)}
            </p>
            <p className="text-helper-relaxed text-muted">
              它可能已经被弃置，或者你已经不在其中。这一页不会自动换成你当前的账本。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Link
              to="/start"
              className="rounded-field bg-brand px-4 py-3 text-center text-button-lg font-medium text-white transition hover:bg-brand-dark"
            >
              返回账本空间
            </Link>
            <button
              type="button"
              onClick={() => {
                setSwitcher(true);
              }}
              className="rounded-field bg-brand-soft px-4 py-3 text-button-lg font-medium text-brand-dark transition hover:bg-brand-soft/70"
            >
              选择其他账本
            </button>
          </div>
        </section>
      ) : null}

      {/**
        * ⚠️ **The rename form is a dialog, not a row editor.** It needs a text field and somewhere to
        * show an error, and it must seed itself with the current name (`openRename`) — the same
        * validation the old `/start/book/:id` screen used, kept because the server has not changed.
        */}
      <ConfirmDialog
        open={renaming}
        title="重命名这本账"
        description="改名之后，这本账的所有成员看到的都是新名称。"
        confirmLabel={rename.isPending ? "正在保存……" : "保存"}
        cancelLabel="取消"
        tone="default"
        busy={rename.isPending}
        onCancel={closeRename}
        onConfirm={submitRename}
      >
        <div className="mt-4 flex flex-col gap-2">
          {renameError === null ? null : (
            <p role="alert" className="rounded-field bg-danger-soft px-4 py-3 text-body text-danger">
              {renameError}
            </p>
          )}
          <TextField
            label="账本名称"
            value={draft}
            maxLength={40}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitRename();
            }}
          />
        </div>
      </ConfirmDialog>

      {/**
        * ⚠️ **The question that keeps an unsaved name.** Cancelling leaves the dialog and the typed
        * text exactly where they were; confirming navigates and the keyed page drops the draft.
        */}
      <ConfirmDialog
        open={pendingSwitch !== null}
        title="换个账本继续？"
        description="正在修改的账本名称还没有保存。"
        consequences={[
          "切换后这个名称不会被保存",
          "这本账的名称、分类与标签都保持不变",
          "取消可以回来继续编辑",
        ]}
        confirmLabel="不保存，切换"
        cancelLabel="留下继续编辑"
        tone="default"
        onCancel={() => {
          setPendingSwitch(null);
        }}
        onConfirm={() => {
          const next = pendingSwitch;
          setPendingSwitch(null);
          setRenaming(false);
          setRenameError(null);
          if (next !== null) goTo(next);
        }}
      />

      <ConfirmDialog
        open={confirming === "dispose"}
        title={`弃置「${name ?? "这本账"}」？`}
        description="弃置是整本账对所有人搁置起来，它不再出现在任何成员的列表里。数据不会删除。"
        consequences={[
          "对这本账的所有成员都不再显示",
          "账目、成员、留言全部保留，不是删除",
          "创建者随时可以恢复",
        ]}
        confirmLabel="弃置这本账"
        busy={dispose.isPending}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={runDispose}
      />

      <ConfirmDialog
        open={confirming === "leave"}
        title={`退出「${name ?? "这本账"}」？`}
        description="退出后这本账不再出现在你的列表里，你也就看不到它的账目了。"
        consequences={["不再拥有这本账的访问权限", "你记过的账目与历史都会保留", "你加入的其他账本不受影响"]}
        confirmLabel="退出账本"
        busy={leave.isPending}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={runLeave}
      />

      <BookSwitcherSheet
        open={switcher}
        currentTargetId={bookId}
        purpose="manage"
        onClose={() => {
          setSwitcher(false);
        }}
        onSelect={selectTarget}
      />
    </InnerPage>
  );
}

/** A row that goes somewhere — real arrow, because it really navigates. */
function NavRow({
  label,
  hint,
  to,
}: {
  readonly label: string;
  readonly hint: string;
  readonly to: string;
}): React.JSX.Element {
  return (
    <li>
      <Link
        to={to}
        className="flex w-full items-center justify-between gap-4 border-b border-line px-5 py-4 text-left transition last:border-b-0 hover:bg-canvas"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-ink">{label}</span>
          <span className="text-helper text-muted">{hint}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-helper text-muted">
          ›
        </span>
      </Link>
    </li>
  );
}

/** A row that opens something — shows the current value on the right, and a real arrow. */
function ActionRow({
  label,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly value: string;
  readonly onSelect: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-4 border-b border-line px-5 py-4 text-left transition last:border-b-0 hover:bg-canvas"
      >
        <span className="shrink-0 text-sm text-ink">{label}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-helper text-muted">{value}</span>
          <span aria-hidden="true" className="shrink-0 text-helper text-muted">
            ›
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * A value that cannot be changed here — **no arrow, and deliberately not a disabled button either**
 * (`SettingsPage` uses `disabled` for "not built yet"; this row is read-only by design, not pending).
 */
function ReadOnlyRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <span className="shrink-0 text-sm text-ink">{label}</span>
      <span className="min-w-0 truncate text-helper text-muted">{value}</span>
    </li>
  );
}
