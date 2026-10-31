/**
 * **明细的批量选择、批量编辑与批量删除**（手机明细页与电脑版明细共用同一份，见 AGENTS「一件事只留一份记录」）。
 *
 * 由 `DetailPage` 原样搬出：写入仍走与单笔详情相同的 `updateEntry` / `deleteEntry`（离线队列、幂等、冲突链不变），
 * 权限仍由既有的 `batchPermission` 与共享账本的角色探测决定，这里没有新增或改动任何判断。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Transaction } from "@libellum/shared";

import { useI18n } from "../../i18n/index.js";
import { errorMessage } from "../../lib/api.js";
import { readMarks } from "../../lib/offline/localLedger.js";
import { deleteEntry, updateEntry } from "../../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../../lib/offline/writePolicy.js";
import {
  EMPTY_BATCH_DRAFT,
  allLoadedSelected,
  batchDeleteConfirmation,
  batchPermission,
  buildBatchEdit,
  selectedLoadedIds,
  summarizeBatch,
  type BatchEditDraft,
  type BatchItemResult,
  type BatchRoleState,
  type BatchSummary,
} from "./batch.js";

interface LedgerIndexSource {
  readonly categories: Parameters<typeof buildBatchEdit>[2]["categories"];
  readonly paymentMethods: Parameters<typeof buildBatchEdit>[2]["paymentMethods"];
  readonly tags: Parameters<typeof buildBatchEdit>[2]["tags"];
}

export function useLedgerBatch({
  ordered,
  conflicted,
  ledger,
  guest,
  offline,
  filterKey,
  onEnter,
}: {
  /** 当前显示（已载入）的账目，按显示顺序。 */
  readonly ordered: readonly Transaction[];
  readonly conflicted: ReadonlySet<string>;
  readonly ledger: LedgerIndexSource | undefined;
  readonly guest: boolean;
  readonly offline: boolean;
  /** 筛选条件变化时清空选择并提示（月份、收支、分类……由调用方拼成一个键）。 */
  readonly filterKey: string;
  readonly onEnter?: () => void;
}) {
  const { t } = useI18n();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchDraft, setBatchDraft] = useState<BatchEditDraft>(EMPTY_BATCH_DRAFT);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [roleState, setRoleState] = useState<BatchRoleState>({ status: "idle" });

  /**
   * ⚠️ **The existing write gate, reused rather than re-implemented.** Shared ledger + offline =
   * read-only is the project's own rule (`writePolicy.ts`), and it is the same fact the write layer
   * refuses on. A second, separately-computed answer is how a button ends up enabled over a
   * guaranteed failure.
   */
  const { readOnly: sharedOfflineReadOnly, shared } = useSharedLedgerOfflineReadOnly();

  const permission = batchPermission({ guest, shared, sharedOfflineReadOnly, role: roleState });

  /** Every entry the list currently holds — the whole of what "全选" may mean. */
  const loadedIds = useMemo(() => ordered.map((entry) => entry.id), [ordered]);
  const selectedIds = useMemo(
    () => selectedLoadedIds(loadedIds, selected),
    [loadedIds, selected],
  );
  const selectedEntries = useMemo(
    () => ordered.filter((entry) => selected.has(entry.id)),
    [ordered, selected],
  );
  const selectedKinds = useMemo(
    () => [...new Set(selectedEntries.map((entry) => entry.kind))],
    [selectedEntries],
  );
  const everythingLoadedSelected = allLoadedSelected(loadedIds, selected);

  const ledgerIndex = useMemo(
    () => ({
      categories: ledger?.categories ?? [],
      paymentMethods: ledger?.paymentMethods ?? [],
      tags: ledger?.tags ?? [],
    }),
    [ledger],
  );

  const enterBatch = (): void => {
    /** The entry cards belong to the other mode; two open modes at once is one too many. */
    onEnter?.();
    setSelecting(true);
    setSelected(new Set<string>());
    setSelectionNotice(null);
    setBatchSummary(null);
    setBatchDraft(EMPTY_BATCH_DRAFT);
    setRoleState(shared ? { status: "loading" } : { status: "idle" });
  };

  const exitBatch = (): void => {
    setSelecting(false);
    setSelected(new Set<string>());
    setSelectionNotice(null);
    setBatchEditOpen(false);
    setConfirmBatchDelete(false);
    setBatchSummary(null);
    setBatchDraft(EMPTY_BATCH_DRAFT);
    setRoleState({ status: "idle" });
  };

  /**
   * ⚠️ **Leaving the current filter clears the selection, and says so.**
   *
   * A tick that is no longer on screen is a tick nobody can check before pressing 删除. The
   * alternative — keeping it and acting on it — is the "看不见的选中项被误操作" case the owner
   * asked to rule out. The notice exists so the reset reads as a rule rather than as a glitch.
   */
  const previousFilterKey = useRef(filterKey);

  useEffect(() => {
    if (previousFilterKey.current === filterKey) return;

    previousFilterKey.current = filterKey;
    setSelected(new Set<string>());
    setSelectionNotice(t("ledger.detail.filterChanged"));
    setBatchSummary(null);
  }, [filterKey]);

  /**
   * ⚠️ **One entry at a time, through the existing single-entry write path.**
   *
   * No batch endpoint, no schema change: each entry goes through `updateEntry`, which is the same
   * function the entry screen uses — so the offline queue, the idempotency and the conflict chain
   * all behave exactly as they already do. The loop is the only new thing, and it is what allows a
   * per-entry result instead of one opaque success.
   */
  const applyBatchEdit = async (draft: BatchEditDraft): Promise<void> => {
    if (!permission.allowed || selectedEntries.length === 0 || batchBusy) return;

    setBatchBusy(true);
    const results: BatchItemResult[] = [];

    try {
      for (const entry of selectedEntries) {
        /**
         * ⚠️ **A conflicted entry is refused rather than edited.** Its mark says "waiting for the
         * user's choice"; a new edit on top would be a third version, and the sync layer would hold
         * it back until that choice is made — work that looks done and is not.
         */
        if (conflicted.has(entry.id)) {
          results.push({
            id: entry.id,
            status: "failed",
            reason: t("ledger.detail.conflictPending"),
          });
          continue;
        }

        const plan = buildBatchEdit(entry, draft, ledgerIndex);

        if (plan.kind === "blocked") {
          results.push({ id: entry.id, status: "failed", reason: plan.reason });
          continue;
        }

        if (plan.kind === "unchanged") {
          results.push({ id: entry.id, status: "unchanged" });
          continue;
        }

        try {
          const outcome = await updateEntry(entry.id, plan.input, plan.apply);

          results.push(
            outcome === null
              ? { id: entry.id, status: "failed", reason: t("ledger.detail.notOnDevice") }
              : { id: entry.id, status: "ok", pending: outcome.pending },
          );
        } catch (caught) {
          results.push({ id: entry.id, status: "failed", reason: errorMessage(caught) });
        }
      }
    } finally {
      setBatchSummary(summarizeBatch(results, "edit"));
      /** ⚠️ Only the failures stay selected, so a retry starts from the right rows. */
      setSelected(new Set(results.filter((result) => result.status === "failed").map((result) => result.id)));
      setBatchEditOpen(false);
      setBatchBusy(false);
    }
  };

  const runBatchDelete = async (): Promise<void> => {
    setConfirmBatchDelete(false);

    if (!permission.allowed || selectedEntries.length === 0 || batchBusy) return;

    setBatchBusy(true);
    let results: BatchItemResult[] = [];

    try {
      for (const entry of selectedEntries) {
        if (conflicted.has(entry.id)) {
          results.push({
            id: entry.id,
            status: "failed",
            reason: t("ledger.detail.conflictPending"),
          });
          continue;
        }

        try {
          /** ⚠️ The existing soft-delete path, per entry: marked first, then delivered if it can be. */
          await deleteEntry(entry.id);
          results.push({ id: entry.id, status: "ok", pending: offline });
        } catch (caught) {
          results.push({ id: entry.id, status: "failed", reason: errorMessage(caught) });
        }
      }
    } finally {
      /**
       * ⚠️ **"Queued" is read from the marks afterwards, not assumed from the offline flag.**
       *
       * A delete that the server refused is still pending too — the mark is the honest record of
       * "this device has asked and the server has not agreed yet" — and a summary that called it
       * "deleted" would be reporting a request as a fact.
       */
      try {
        const marks = await readMarks();

        results = results.map((result) =>
          result.status === "ok"
            ? { id: result.id, status: "ok", pending: marks[result.id]?.pending === true }
            : result,
        );
      } catch {
        /** Reading the marks failed: the offline flag already gives the conservative answer. */
      }

      setBatchSummary(summarizeBatch(results, "delete"));
      setSelected(new Set(results.filter((result) => result.status === "failed").map((result) => result.id)));
      setBatchBusy(false);
    }
  };


  const deleteConfirmation = batchDeleteConfirmation(selectedIds.length);

  return {
    selecting,
    selected,
    setSelected,
    selectionNotice,
    batchEditOpen,
    setBatchEditOpen,
    batchDraft,
    setBatchDraft,
    confirmBatchDelete,
    setConfirmBatchDelete,
    batchBusy,
    batchSummary,
    setRoleState,
    shared,
    permission,
    loadedIds,
    selectedIds,
    selectedEntries,
    selectedKinds,
    everythingLoadedSelected,
    ledgerIndex,
    enterBatch,
    exitBatch,
    applyBatchEdit,
    runBatchDelete,
    deleteConfirmation,
  };
}

export type LedgerBatch = ReturnType<typeof useLedgerBatch>;
