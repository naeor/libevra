import {
  DUPLICATE_SCOPE_LABELS,
  decimalsFor,
  CURRENCIES,
  describeDuplicateMatch,
  formatTransactionNumber,
  MAX_TAGS_PER_TRANSACTION,
  normalizeNotDuplicatePair,
  type Currency,
  type DuplicatePairResult,
  type Transaction,
} from "@libellum/shared";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { BatchAddSheet } from "../components/entry/BatchAddSheet.js";
import { InnerPage } from "../components/Layouts.js";
import { ErrorState, SkeletonRows } from "../components/States.js";
import { useUndo } from "../components/UndoProvider.js";
import { errorMessage } from "../lib/api.js";
import { candidateFromEntry, checkNewCandidates, duplicateBookId } from "../lib/duplicateReview.js";
import { isGuestRuntime } from "../lib/guest/runtime.js";
import { createNotDuplicateRelations } from "../lib/notDuplicateRelations.js";
import { deleteEntry, updateEntry } from "../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import {
  formatDateTimeInZone,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  toLocalDate,
  toLocalIso,
} from "../lib/datetime.js";
import { currencyName, formatMoney, minorToInput, parseAmountInput } from "../lib/format.js";
import {
  useDeleteTransaction,
  useLedger,
  useRestoreTransaction,
  useTransaction,
  useUpdateTransaction,
} from "../lib/queries.js";

/**
 * One entry: everything recorded about it, plus the three things a person
 * actually wants here — correct it, copy it, or remove it.
 *
 * Removal asks first and offers to undo afterwards. The wording of that dialog
 * is specific on purpose: the row is kept on the server, but **the user cannot
 * bring it back through the interface on their own**, and saying "may be
 * unrecoverable" instead would be a vaguer claim than the truth.
 */
export function EntryDetailPage(): React.JSX.Element {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { showUndo } = useUndo();

  const ledger = useLedger();
  const entry = useTransaction(id);
  const update = useUpdateTransaction(id);
  const remove = useDeleteTransaction();
  const restore = useRestoreTransaction();
  const { readOnly: sharedOfflineReadOnly } = useSharedLedgerOfflineReadOnly();

  const [editing, setEditing] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSavedCount, setBatchSavedCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 「更多」里的即时重复检测（S15-E4 第 7 条）。
   *
   * ⚠️ 只查**这一笔**与账本历史，不扫全账本：用户点的是“这笔有没有重复”，
   * 全账本扫描是账本设置里那个明确的入口。结果不自动做任何事，只展示依据。
   */
  const duplicateSettings = useDuplicateDetectionSettings();
  const [duplicateCheck, setDuplicateCheck] = useState<{
    readonly pairs: readonly DuplicatePairResult[];
    readonly others: readonly Transaction[];
    readonly scope: "server" | "local";
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [busyPairKey, setBusyPairKey] = useState<string | null>(null);

  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [note, setNote] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  /**
   * ⚠️ **The entry's own time, or `null` until it has loaded — and the `null` is the fix.**
   *
   * The owner's report: "在明细页面修改订单时，什么都不要变，也就是说不要把时间改成系统当时的时间——修改订单时时间应当
   * 默认是订单修改之前记录的时间."
   *
   * **Why it happened**: this started as `new Date()`, and the effect below replaces it with the entry's own time
   * **once the entry arrives**. The 编辑 button was live before that — **so opening the editor early, or saving
   * quickly, used "now" as the entry's time and wrote it back.** The row then moved to the top of the ledger for no
   * reason the user could see.
   *
   * ⚠️ **`null` means "not known yet", and the editor is not offered until it is known.** A default is only a
   * convenience when it is the right one; **a default that silently overwrites the user's data is a defect.**
   */
  const [occurredAt, setOccurredAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!entry.data) return;
    setAmountText(minorToInput(entry.data.amountCents, entry.data.currency));
    setCategoryId(entry.data.categoryId);
    setPaymentMethodId(entry.data.paymentMethodId);
    setCurrency(entry.data.currency);
    setNote(entry.data.note ?? "");
    setTagIds(entry.data.tags.map((tag) => tag.id));
    setOccurredAt(new Date(entry.data.occurredAt));
  }, [entry.data]);

  if (entry.isPending) {
    return (
      <InnerPage title="记账详情" backTo="/">
        <SkeletonRows rows={3} />
      </InnerPage>
    );
  }

  if (entry.isError || !entry.data) {
    return (
      <InnerPage title="记账详情" backTo="/">
        <ErrorState
          message={errorMessage(entry.error)}
          onRetry={() => {
            void entry.refetch();
          }}
        />
      </InnerPage>
    );
  }

  const data = entry.data;
  const ownCategories = (ledger.data?.categories ?? []).filter(
    (category) => category.kind === data.kind && !category.isArchived,
  );
  const ownPaymentMethods = (ledger.data?.paymentMethods ?? []).filter((method) => !method.isArchived);

  if (data.deletedAt !== null && data.deletedAt !== undefined) {
    return (
      <InnerPage title="记账详情" subtitle="这笔账目已删除" backTo="/ledger/history">
        <section className="rounded-card border border-line bg-surface px-5 py-5">
          <p className="text-helper text-muted">{data.kind === "expense" ? "支出" : "收入"} · 已删除</p>
          <p className="mt-1 text-3xl font-semibold text-ink">
            {formatMoney(data.amountCents, data.currency, { withCode: true })}
          </p>
          <p className="mt-2 text-body text-ink">
            {data.categoryName}
            {data.paymentMethodName === null ? "" : ` · ${data.paymentMethodName}`}
          </p>
          <p className="mt-3 text-body text-muted">{data.occurredLocalDate} 的记录</p>
          {data.note === null ? null : <p className="mt-1 text-body-relaxed text-muted">{data.note}</p>}
          <p className="mt-3 text-helper text-muted">
            删除时间：{formatDateTimeInZone(data.deletedAt, data.occurredTz)}
          </p>
          {data.deletedByImportId === undefined ? null : (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-helper-relaxed text-muted">通过账本导入移除</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-helper text-ink">查看导入任务编号</summary>
                <p className="mt-1 break-all rounded-field bg-canvas px-3 py-2 font-mono text-helper text-muted">
                  {data.deletedByImportId}
                </p>
              </details>
            </div>
          )}
          <p className="mt-1 text-helper-relaxed text-muted">
            恢复后将保留原账目编号。账本须仍然存在，且你有编辑权限。
          </p>
        </section>

        {error === null ? null : <Alert>{error}</Alert>}

        <button
          type="button"
          disabled={restore.isPending}
          onClick={() => {
            setError(null);
            void (async () => {
              try {
                await restore.mutateAsync(id);
                await entry.refetch();
              } catch (caught) {
                setError(errorMessage(caught));
              }
            })();
          }}
          className="w-full rounded-field bg-brand px-4 py-3 text-button-lg font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-45"
        >
          {restore.isPending ? "正在恢复…" : "恢复账目"}
        </button>
        <button
          type="button"
          onClick={() => void navigate("/ledger/history")}
          className="w-full rounded-field border border-line bg-surface px-4 py-3 text-button-lg font-medium text-ink transition hover:bg-canvas"
        >
          返回历史记录
        </button>
      </InnerPage>
    );
  }

  async function save(): Promise<void> {
    /**
     * ⚠️ **The entry's time is required, and the guard is the point.** See the note on `occurredAt`: writing "now"
     * because the entry had not loaded is how an edit silently moved a row to the top of the ledger.
     */
    if (occurredAt === null) return;
    setError(null);

    let amountCents: number;
    try {
      amountCents = parseAmountInput(amountText, currency);
    } catch {
      setError(
        decimalsFor(currency) === 0
          ? `${currencyName(currency)}不支持小数，请输入整数金额。`
          : `金额格式不正确，${currencyName(currency)}最多两位小数。`,
      );
      return;
    }

    try {
      /**
       * ⚠️ **Editing goes through the offline path, so it works with no signal and the row changes at once.**
       *
       * `updateEntry` writes the device's copy first and queues the change for the server, then delivers it
       * if it can. **`occurredAt` is deliberately *not* sent as a field the device cannot resolve**: the
       * offline copy is built from the stored entry, so everything the user did not edit keeps the value the
       * server gave it — **including `categoryName` and `version`, which the screen shows and the queue needs
       * as its base.** Sending only what changed is what makes the local entry identical to the server's once
       * the queue drains, instead of a second shape that has to be reconciled.
       */
      const outcome = await updateEntry(
        id,
        {
          version: data.version,
          amountCents,
          categoryId,
          paymentMethodId,
          currency,
          note: note.trim() === "" ? null : note.trim(),
          tagIds,
          occurredAt: toLocalIso(occurredAt),
          occurredLocalDate: toLocalDate(occurredAt),
          occurredTz: data.occurredTz,
        },
        (current) => {
          /**
           * ⚠️ **The offline copy needs a category id, and the update may not have one.**
           *
           * `UpdateTransactionInput.categoryId` allows null — the server files a null category under the
           * book's own 暂无分类 row and **resolves it on the way in**, so the stored entry always has an id.
           * The device cannot resolve it, so it keeps the id it already holds: **the offline entry stays
           * well-formed and the server corrects it if the two differ.**
           */
          const resolvedCategoryId = categoryId ?? current.categoryId;

          return {
            ...current,
            amountCents,
            categoryId: resolvedCategoryId,
            currency,
            note: note.trim() === "" ? null : note.trim(),
            paymentMethodId,
            occurredAt: toLocalIso(occurredAt),
            occurredLocalDate: toLocalDate(occurredAt),
            /**
             * ⚠️ **The category's *name* is taken from the ledger**, because the server denormalises it onto
             * each entry and the offline copy has no server to ask. An entry whose category was changed would
             * otherwise keep showing the old name until the queue drained — **a display that contradicts the
             * edit the user just made, for as long as the network is out.**
             */
            categoryName:
              ledger.data?.categories.find((category) => category.id === resolvedCategoryId)?.name ??
              current.categoryName,
            paymentMethodName:
              paymentMethodId === null
                ? null
                : (ledger.data?.paymentMethods.find((method) => method.id === paymentMethodId)?.name ??
                  current.paymentMethodName),
            tagIds,
          };
        },
      );

      /**
       * A `null` means the device does not hold this entry, which should not happen for a screen reached from
       * the ledger — but if it does, the server path is the honest fallback rather than a silent no-op.
       */
      if (outcome === null) {
        await update.mutateAsync({
          version: data.version,
          amountCents,
          categoryId,
          paymentMethodId,
          currency,
          note: note.trim() === "" ? null : note.trim(),
          tagIds,
          occurredAt: toLocalIso(occurredAt),
          occurredLocalDate: toLocalDate(occurredAt),
          occurredTz: data.occurredTz,
        });
      }

      /**
       * ⚠️ **Saving an edit goes back to the ledger, not to the entry's own read-only view.**
       *
       * The owner's report: "修改记账之后不会跳转到明细；反而会跳转到记账详情，还要自己退出."
       *
       * ⚠️ **His reading of it is the right one** — the screen behaves differently for its two jobs. **Deleting
       * already returns to the ledger** (the entry is gone; there is nothing to stay for), while editing left the
       * user on a read-only page **they had just finished with**, so every edit cost an extra tap to get back to
       * the list they were working in.
       *
       * ⚠️ **The screen is reached from the ledger and returns to the ledger** — a push and a pop, not a detour.
       */
      await navigate("/");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function doDelete(): Promise<void> {
    setConfirmDelete(false);
    setError(null);

    try {
      /**
       * ⚠️ **Deleting offline marks the entry instead of removing it.**
       *
       * The row leaves the screen immediately, and its stored copy stays — **that copy is what round 3 needs
       * to show the user what they deleted while asking whether the delete should stand.** The undo below
       * restores from the server, so it needs a connection; **its button is honest about that rather than
       * pretending to work.**
       */
      await deleteEntry(id);
      await navigate("/");
      showUndo({
        message: "已删除这笔记账",
        onUndo: async () => {
          await restore.mutateAsync(id);
        },
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  /**
   * 对**当前这一笔**跑一次统一检测。
   *
   * 判定、设置、文案都走 `checkNewCandidates`（与手动/语音/拍照同一个核心），
   * 结果只保留与这一笔有关的配对；检测失败要说出来，因为这是用户主动点的一次检查。
   */
  async function checkDuplicatesForEntry(): Promise<void> {
    const data = entry.data;
    if (data === undefined) return;
    setChecking(true);
    setCheckError(null);
    try {
      const bookId = duplicateBookId();
      const result = await checkNewCandidates(
        bookId,
        [candidateFromEntry(data, bookId)],
        duplicateSettings.settings,
      );
      const pairs = result.pairs.filter((pair) => pair.leftId === data.id || pair.rightId === data.id);
      setDuplicateCheck({
        pairs,
        others: result.history.filter((other) => other.id !== data.id),
        scope: result.scope,
      });
    } catch (caught) {
      setCheckError(errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  /** 用户明确说“不是同一笔”才写关系；展示本身不做任何写入。 */
  async function markNotDuplicate(pair: DuplicatePairResult): Promise<void> {
    const normalized = normalizeNotDuplicatePair(pair.leftId, pair.rightId);
    if (!normalized.ok) {
      setCheckError("这两笔无法建立「不是同一笔」关系。");
      return;
    }
    setBusyPairKey(pair.pairKey);
    setCheckError(null);
    try {
      await createNotDuplicateRelations(duplicateBookId(), {
        pairs: [{ transactionIdA: normalized.pair.transactionAId, transactionIdB: normalized.pair.transactionBId }],
        decisionSource: "manual",
      });
      setDuplicateCheck((current) =>
        current === null
          ? current
          : { ...current, pairs: current.pairs.filter((item) => item.pairKey !== pair.pairKey) },
      );
    } catch (caught) {
      setCheckError(`「不是同一笔」没有记住：${errorMessage(caught)}`);
    } finally {
      setBusyPairKey(null);
    }
  }

  return (
    <InnerPage
      title={editing ? "修改记账" : "记账详情"}
      onBack={() => {
        if (editing) setEditing(false);
        else void navigate("/");
      }}
      actions={
        editing || sharedOfflineReadOnly ? null : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
            }}
            className="text-sm font-medium text-brand-dark transition hover:underline"
          >
            修改
          </button>
        )
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      {batchSavedCount > 0 ? (
        <Alert tone="success">已新增 {String(batchSavedCount)} 笔账目。</Alert>
      ) : null}
      {sharedOfflineReadOnly ? (
        <Alert>
          当前离线，共享账本暂时只能查看。恢复网络后可以修改或删除这笔记录；之前尚未同步的改动会保留。
        </Alert>
      ) : null}

      <section className="rounded-card border border-line bg-surface p-5">
        <p className="text-xs text-muted">{data.kind === "expense" ? "支出" : "收入"}</p>
        <p className="mt-1 text-3xl font-semibold text-ink tabular-nums">
          {data.kind === "expense" ? "-" : "+"}
          {formatMoney(data.amountCents, data.currency, { withCode: true })}
        </p>
      </section>

      {editing ? (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">金额</h2>
            <input
              value={amountText}
              onChange={(event) => {
                setAmountText(event.target.value);
              }}
              inputMode="decimal"
              className="rounded-field border border-line bg-surface px-3.5 py-3 text-2xl font-semibold text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">分类</h2>
            <div className="grid grid-cols-3 gap-2">
              {ownCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(category.id === categoryId ? null : category.id);
                  }}
                  className={`rounded-field py-3 text-sm transition ${
                    category.id === categoryId ? "bg-brand text-white" : "bg-surface text-ink"
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">支付方式</h2>
            <div className="flex flex-wrap gap-2">
              {ownPaymentMethods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => {
                    setPaymentMethodId(method.id === paymentMethodId ? null : method.id);
                  }}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    method.id === paymentMethodId ? "bg-brand text-white" : "bg-surface text-ink"
                  }`}
                >
                  {method.name}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">币种</h2>
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => {
                    setCurrency(code);
                  }}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    code === currency ? "bg-brand text-white" : "bg-surface text-ink"
                  }`}
                >
                  {currencyName(code)}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">时间</h2>
            <input
              type="datetime-local"
              step="1"
              value={occurredAt === null ? "" : toDateTimeLocalValue(occurredAt)}
              onChange={(event) => {
                const parsed = fromDateTimeLocalValue(event.target.value);
                if (parsed) setOccurredAt(parsed);
              }}
              className="rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">备注</h2>
            <input
              value={note}
              maxLength={200}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              className="rounded-field border border-line bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            />
          </section>

          {(ledger.data?.tags.length ?? 0) > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-card-title text-ink">
                标签（最多 {String(MAX_TAGS_PER_TRANSACTION)} 个）
              </h2>
              <div className="flex flex-wrap gap-2">
                {(ledger.data?.tags ?? []).map((tag) => {
                  const selected = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        setTagIds((current) =>
                          current.includes(tag.id)
                            ? current.filter((value) => value !== tag.id)
                            : current.length >= MAX_TAGS_PER_TRANSACTION
                              ? current
                              : [...current, tag.id],
                        );
                      }}
                      style={selected ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                      className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                        selected ? "text-white" : "border-line bg-surface text-ink"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={sharedOfflineReadOnly || update.isPending}
              onClick={() => {
                setBatchOpen(true);
              }}
              className="flex-1 rounded-field border border-brand bg-surface py-3.5 text-button-lg font-medium text-brand-dark transition hover:bg-brand-soft disabled:opacity-45"
            >
              批量记账
            </button>
            <button
              type="button"
              disabled={sharedOfflineReadOnly || update.isPending}
              onClick={() => void save()}
              className="flex-[1.4] rounded-field bg-brand py-3.5 text-button-lg font-medium text-white transition hover:bg-brand-dark disabled:opacity-45"
            >
              {update.isPending ? "保存中…" : "保存修改"}
            </button>
          </div>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-5 text-body [&>dd]:min-w-0 [&>dd]:break-words">
            <dt className="text-card-title text-ink">分类</dt>
            <dd className="text-right text-ink">
              {data.categoryIsSystem ? "暂无分类" : data.categoryName}
            </dd>

            <dt className="text-card-title text-ink">支付方式</dt>
            <dd className="text-right text-ink">{data.paymentMethodName ?? "未记录"}</dd>

            <dt className="text-card-title text-ink">币种</dt>
            <dd className="text-right text-ink">{currencyName(data.currency)}</dd>

            <dt className="text-card-title text-ink">时间</dt>
            <dd className="text-right text-ink tabular-nums">{formatDateTimeInZone(data.occurredAt, data.occurredTz)}</dd>

            <dt className="text-card-title text-ink">时区</dt>
            <dd className="text-right text-muted">{data.occurredTz}</dd>

            <dt className="text-card-title text-ink">备注</dt>
            <dd className="text-right text-ink">{data.note ?? "无"}</dd>

            {/**
              * ⚠️ **The number appears here and nowhere else.**
              *
              * The owner's rule: *"在明细界面不会直接这些编号，但点进每一笔账目之后……写出编号多少多少."*
              * So it is deliberately **absent from the list** — a list is scanned by amount and time,
              * and a row of `#0000xx` would be noise there — while the detail screen is where somebody
              * asks "which entry is this?".
              *
              * ⚠️ **Hidden when the entry has no number, rather than shown as blank.** An entry typed
              * offline has not reached the server, so it genuinely has none yet; rendering
              * `编号 —` would read as "this entry has no number", which is true and confusing.
              * **A row that is simply not there says the same thing without implying a fault.**
              */}
            {data.seq === undefined ? null : (
              <>
                <dt className="text-card-title text-ink">编号</dt>
                <dd className="text-right font-mono text-ink">{formatTransactionNumber(data.seq)}</dd>
              </>
            )}
          </dl>

          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-card-title text-ink">标签</h2>
            {data.tags.length === 0 ? (
              <p className="px-1 text-sm text-muted">没有标签</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.tags.map((tag) => (
                  <span
                    key={tag.id}
                    style={{ backgroundColor: tag.color }}
                    className="rounded-full px-3.5 py-1.5 text-sm text-white"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          <button
            type="button"
            onClick={() => {
              void navigate("/add", { state: { copyFrom: data } });
            }}
            className="w-full rounded-field bg-brand-soft py-3 text-sm font-medium text-brand-dark transition hover:bg-brand-soft/70"
          >
            复制这一笔
          </button>

          {/**
           * ⚠️ **S15-E4 第 7 条：明细页的“更多”里放“重复账目检测”。**
           *
           * 放在“复制这一笔”之后、删除之前：它不是主操作，但比删除更常被需要；
           * 点一下只对**这一笔**检查，不会开始一次全账本扫描。
           */}
          <details className="rounded-field border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-body font-medium">更多</summary>
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
              <button
                type="button"
                disabled={checking || !duplicateSettings.settings.enabled}
                onClick={() => void checkDuplicatesForEntry()}
                className="w-full rounded-field bg-brand-soft py-3 text-sm font-medium text-brand-dark transition hover:bg-brand-soft/70 disabled:opacity-45"
              >
                {checking ? "正在检测…" : "重复账目检测"}
              </button>
              <p className="text-helper text-muted">
                只检查这一笔与本账本的历史记录；不会删除、合并或修改任何账目。
                {duplicateSettings.settings.enabled ? "" : "（重复提醒已关闭，需要先到设置里打开。）"}
              </p>

              {checkError === null ? null : <Alert tone="error">{checkError}</Alert>}

              {duplicateCheck === null ? null : (
                <div className="flex flex-col gap-2">
                  {duplicateCheck.pairs.length === 0 ? (
                    <p className="text-helper text-muted">
                      没有发现符合当前规则的疑似重复。
                      {duplicateCheck.scope === "local"
                        ? `（本次只比对了${DUPLICATE_SCOPE_LABELS.local}，不能据此认为账本里没有重复。）`
                        : ""}
                    </p>
                  ) : (
                    <>
                      <p className="text-helper text-muted">
                        找到 {duplicateCheck.pairs.length} 笔相似记录。疑似重复不会自动处理。
                      </p>
                      <ul className="flex flex-col gap-2">
                        {duplicateCheck.pairs.map((pair) => {
                          const otherId = pair.leftId === data.id ? pair.rightId : pair.leftId;
                          const other = duplicateCheck.others.find((item) => item.id === otherId);
                          return (
                            <li key={pair.pairKey} className="flex flex-col gap-1 rounded-field bg-canvas px-3 py-2">
                              <button
                                type="button"
                                onClick={() => void navigate(`/transactions/${otherId}`)}
                                className="flex items-baseline justify-between gap-3 text-left text-body"
                              >
                                <span className="truncate">
                                  {other?.note?.trim() === "" || other?.note == null ? "（无备注）" : other.note}
                                </span>
                                <span className="shrink-0 text-muted">
                                  {other === undefined
                                    ? ""
                                    : `${other.occurredLocalDate} · ${formatMoney(other.amountCents, other.currency)}`}
                                </span>
                              </button>
                              <p className="text-helper text-muted">{describeDuplicateMatch(pair)}</p>
                              <button
                                type="button"
                                disabled={isGuestRuntime() || busyPairKey === pair.pairKey}
                                onClick={() => void markNotDuplicate(pair)}
                                className="self-start text-helper text-brand-dark underline disabled:opacity-45"
                              >
                                {busyPairKey === pair.pairKey ? "正在记录…" : "这两笔不是同一笔"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          </details>

          <button
            type="button"
            disabled={sharedOfflineReadOnly}
            onClick={() => {
              setConfirmDelete(true);
            }}
            className="w-full rounded-field bg-danger py-3.5 text-button-lg font-medium text-white transition hover:bg-danger-dark disabled:opacity-45"
          >
            删除这笔记账
          </button>
        </>
      )}

      <BatchAddSheet
        open={batchOpen}
        source={data}
        onClose={() => {
          setBatchOpen(false);
        }}
        onSaved={(count) => {
          setBatchSavedCount(count);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        busy={remove.isPending}
        title="删除这笔账目？"
        description={`即将删除这笔 ${formatMoney(data.amountCents, data.currency, { withCode: true })} 的记录。`}
        consequences={[
          "删除后，可从编辑历史打开账目并恢复；账本须仍然存在，且你有编辑权限",
          "本月的总额、笔数与结余会立即重新计算",
          "删除后的几秒内仍可在底部选择「撤销」",
        ]}
        confirmLabel="确认删除"
        onCancel={() => {
          setConfirmDelete(false);
        }}
        onConfirm={() => void doDelete()}
      />
    </InnerPage>
  );
}
