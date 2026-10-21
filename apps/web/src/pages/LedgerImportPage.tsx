import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ledgerImportResultSchema,
  type ImportJobStatus,
  type IncrementalDecisionAction,
  type IncrementalPreviewResponse,
  type IncrementalSourceStatus,
  type FormalSourceDisposition,
  type GuestCleanupPreviewResponse,
  type LedgerImportRequest,
  type LedgerImportResult,
} from "@libellum/shared";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { InlineChoice, type InlineChoiceOption } from "../components/ui/InlineChoice.js";
import { apiFetch, ApiRequestError, errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { formatTimeWithZone } from "../lib/datetime.js";
import { DEFAULT_BOOK_NAME } from "@libellum/shared";
import { useActivateBook, useBooks } from "../lib/queries.js";
import { useGoBack } from "../lib/connectivity.js";
import {
  buildNewImportTarget,
  hasLocalGuestIdentity,
  isSoloImportBook,
  loadBookImportTarget,
  loadGuestImportSource,
} from "../lib/ledgerImport/sources.js";
import { loadFormalImportPreview } from "../lib/ledgerImport/formal.js";
import {
  recoverGroupDecisions,
  recoverTaxonomyResolutions,
  summarizeDraftRecovery,
  type DraftRecoverySummary,
} from "../lib/ledgerImport/recovery.js";
import {
  confirmImportJob,
  createImportJob,
  getImportJob,
  refreshImportJobActivity,
  resumeImportJob,
  undoImportJob,
} from "../lib/ledgerImport/job.js";
import {
  decisionsForRequest,
  incrementalExclusions,
  loadIncrementalPreview,
  defaultIncrementalAction,
} from "../lib/ledgerImport/incremental.js";
import {
  getFormalSourceDisposition,
  getFormalSourceDispositionByReceipt,
  previewGuestCleanup,
} from "../lib/ledgerImport/cleanup.js";
import {
  cleanupMigratedGuestTransactions,
  guestCleanupTransactions,
  guestDataValue,
  restoreGuestCleanup,
} from "../lib/guest/data.js";
import { bookLifecycleAction } from "../lib/lifecycle.js";
import { fetchNotDuplicatePairKeys } from "../lib/notDuplicateRelations.js";
import { guestSourceOfSource } from "../lib/ledgerImport/submit.js";
import { buildImportPreview } from "../lib/ledgerImport/preview.js";
import {
  taxonomyResolutionKey,
  type TaxonomyResolutionAction,
  type TaxonomyResolutionMap,
} from "../lib/ledgerImport/mapping.js";
import {
  buildLedgerImportRequest,
  unresolvedConflicts,
  unresolvedDuplicateGroups,
} from "../lib/ledgerImport/submit.js";
import {
  importedSourceCount,
  isOneToOne,
  presetDecision,
  removedTargets,
  skippedSourceIds,
  sourceHandling,
  targetHandling,
  unresolvedGroupCount,
  withSourceHandling,
  withTargetHandling,
  type GroupDecisionDraft,
  type GroupDecisionMap,
  type GroupPresetAction,
  type SourceHandling,
  type TargetHandling,
} from "../lib/ledgerImport/decisions.js";
import {
  loadPendingTasks,
  removePendingTask,
  savePendingTask,
  type PendingImportTask,
} from "../lib/ledgerImport/journal.js";
import type {
  DuplicateRecord,
  ImportBookOption,
  ImportPreview,
  ImportSource,
  ImportTarget,
  TaxonomyConflict,
} from "../lib/ledgerImport/types.js";

/**
 * S14-D D2 · 游客账本真实导入。
 *
 * 视觉仍是 D1 的向导：**选择 → 预览 → 核对 → 确认**。D2 只增加完成真实操作所需的交互：
 * taxonomy 冲突选择、重复组的「保留 A / 两边都保留」、确认摘要、提交进度、暂停/重试、结果对账。
 * **D2 不删除目标 A 的任何记录**；四种冲突处理的删除分支留到 D3。
 */
type Step = "select" | "preview" | "review" | "confirm";
type SubmitState = "idle" | "submitting" | "paused" | "error" | "success";

const STEP_ITEMS = [
  { id: "select" as const, label: "选择" },
  { id: "preview" as const, label: "预览" },
  { id: "review" as const, label: "核对" },
  { id: "confirm" as const, label: "确认" },
];

function parseStep(value: string | null): Step {
  return value === "preview" || value === "review" || value === "confirm" ? value : "select";
}

function parseGroup(value: string | null): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function newId(): string {
  return crypto.randomUUID();
}

function totalsOf(transactions: readonly { kind: "expense" | "income"; amountCents: number; currency: string }[]) {
  const map = new Map<string, { expenseCents: number; incomeCents: number; count: number }>();
  for (const item of transactions) {
    const current = map.get(item.currency) ?? { expenseCents: 0, incomeCents: 0, count: 0 };
    if (item.kind === "expense") current.expenseCents += item.amountCents;
    else current.incomeCents += item.amountCents;
    current.count += 1;
    map.set(item.currency, current);
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([currency, value]) => ({ currency, ...value }));
}

export function LedgerImportPage(): React.JSX.Element {
  const { user } = useAuth();
  const duplicateSettings = useDuplicateDetectionSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const step = parseStep(search.get("step"));
  const requestedTargetId = search.get("target") ?? "";
  // Decision B (owner 2026-10-19): imports no longer create a target ledger. Old links that
  // still carry target=new are redirected to "no target selected"; the server also refuses the
  // legacy direct-write endpoint even if a cached client bypasses this UI.
  const targetId = requestedTargetId === "new" ? "" : requestedTargetId;
  const sourceKey = search.get("source") ?? "";
  const targetIsNew = false;
  const currentNewName = search.get("newName") ?? DEFAULT_BOOK_NAME;
  const requestedGroup = parseGroup(search.get("group"));
  const jobIdParam = search.get("job") ?? "";

  const books = useBooks();
  const activateBook = useActivateBook();
  const [snapshots, setSnapshots] = useState<{ source: ImportSource; target: ImportTarget } | null>(null);
  const [fingerprints, setFingerprints] = useState<{ source: string; target: string } | null>(null);
  const [recovery, setRecovery] = useState<DraftRecoverySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, TaxonomyResolutionAction>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, GroupDecisionDraft>>(new Map());
  const [removalConfirmOpen, setRemovalConfirmOpen] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<LedgerImportResult | null>(null);
  const [pendingTasks, setPendingTasks] = useState<readonly PendingImportTask[]>([]);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [jobBusy, setJobBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [confirmConfirmOpen, setConfirmConfirmOpen] = useState(false);
  const [incremental, setIncremental] = useState<IncrementalPreviewResponse | null>(null);
  const [incrementalBusy, setIncrementalBusy] = useState(false);
  const [incrementalError, setIncrementalError] = useState<string | null>(null);
  const [incrementalDecisions, setIncrementalDecisions] = useState<Map<string, IncrementalDecisionAction>>(
    new Map(),
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setPendingTasks(user === null ? [] : loadPendingTasks().filter((task) => task.userId === user.id));
  }, [user]);

  /**
   * D5 任务轮询。进度和最终结果都来自服务端任务表；刷新页面后靠 URL 里的 job id 重新接上。
   */
  useEffect(() => {
    if (jobIdParam === "") {
      setJob(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getImportJob(jobIdParam);
        if (cancelled) return;
        setJob(next);
        if ((next.status === "confirmed" || next.status === "completed") && next.result !== null) {
          setResult(next.result);
          setSubmitState("success");
          setSubmitError(null);
          setStepConfirmFromJob();
          return;
        }
        if (next.status === "awaiting_confirmation") {
          setStepConfirmFromJob();
          setSubmitState("paused");
          setSubmitError(null);
        } else if (next.status === "undoing" || next.status === "confirming") {
          setStepConfirmFromJob();
          setSubmitState("submitting");
          setSubmitError(null);
        } else if (next.status === "undone") {
          setStepConfirmFromJob();
          setSubmitState("error");
          setSubmitError("导入已撤销；本次造成的账目、分类和来源状态已恢复。");
          return;
        } else if (next.status === "undo_failed") {
          setSubmitState("error");
          setSubmitError(next.lastErrorMessage ?? "撤销失败；账本仍保持锁定，可以重试撤销。");
          return;
        } else if (next.status === "paused") {
          setSubmitState("paused");
          setSubmitError(next.lastErrorMessage);
        } else if (next.status === "failed" || next.status === "cancelled" || next.status === "expired") {
          setSubmitState("error");
          setSubmitError(next.lastErrorMessage);
          return;
        } else {
          setSubmitState("submitting");
        }
        timer = setTimeout(() => void poll(), 1_000);
      } catch (caught) {
        if (cancelled) return;
        setSubmitError(errorMessage(caught));
        setSubmitState("error");
        // API 重启/断线是暂时状态：继续轮询，恢复后不需要用户手动刷新。
        timer = setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIdParam]);

  function setStepConfirmFromJob(): void {
    if (search.get("step") !== "confirm") {
      const next = new URLSearchParams(search);
      next.set("step", "confirm");
      setSearch(next, { replace: true });
    }
  }

  const soloBooks = useMemo<readonly ImportBookOption[]>(() => {
    return (books.data?.books ?? []).filter((book) => isSoloImportBook(book)).map((book) => ({ ...book }));
  }, [books.data]);

  const target = soloBooks.find((book) => book.id === targetId) ?? null;
  const sourceBook = soloBooks.find((book) => book.id === sourceKey) ?? null;
  const sourceIsGuest = sourceKey === "guest";
  const sourceIsFormal = sourceBook !== null;
  const accountLabel = user === null ? "正式账号" : user.displayName.trim() === "" ? user.username : user.displayName;
  const guestAvailable = useMemo(() => hasLocalGuestIdentity(), []);
  /**
   * ⚠️ **离开导入页去哪里，以及"怎么离开"**（S15-C，返回循环）。
   *
   * `backTo` 是深链时的落点：选了目标账本就回它的设置，没选就回账本空间。
   * ⚠️ **正常进入时不能 `navigate(backTo)`（push）**：那会在历史里再写一条设置页；
   * 设置页的 `parent` 返回如果还 `replace` 成账本详情，详情脚下那条就仍是没被消耗的导入页，
   * 一按 `-1` 就落回导入——导入 ⇄ 设置 ⇄ 详情 走成环。现在两边都统一走 `useGoBack` 的
   * `parent` 语义：**有上一条历史就 pop 掉自己**（正常入口下上一条就是账本设置），
   * 深链才用 `backTo` 兜底。配合步骤切换的 `replace`，整页只占一条历史记录。
   */
  const backTo = target === null ? "/start" : `/books/${target.id}/settings`;
  const goBack = useGoBack(backTo, "parent");
  /**
   * 目标账本里确认过的「不是同一笔」。
   *
   * 导入预览在浏览器里跑，服务端不会替它过滤关系；读不到就当“没有关系”——
   * 宁可多提示一次，也不要因为一次读失败而漏掉真正的重复。
   */
  const [suppressedPairKeys, setSuppressedPairKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    if (target === null) {
      setSuppressedPairKeys(new Set<string>());
      return;
    }
    let cancelled = false;
    void fetchNotDuplicatePairKeys(target.id)
      .then((keys) => {
        if (!cancelled) setSuppressedPairKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setSuppressedPairKeys(new Set<string>());
      });
    return () => {
      cancelled = true;
    };
  }, [target]);
  const preview = useMemo(() => {
    if (snapshots === null) return null;
    const excluded = incrementalExclusions(incremental);
    return buildImportPreview(
      snapshots.source,
      snapshots.target,
      resolutions as TaxonomyResolutionMap,
      {
        excludeDuplicateSourceIds: excluded.sourceIds,
        excludeDuplicateTargetIds: excluded.targetIds,
        duplicateSettings: duplicateSettings.settings,
        suppressedPairKeys,
      },
    );
  }, [snapshots, resolutions, incremental, duplicateSettings.settings, suppressedPairKeys]);

  /** 读取服务端增量状态；失败时仍允许首次导入，但不能假装没有历史。 */
  useEffect(() => {
    if (snapshots === null || targetIsNew) {
      setIncremental(null);
      setIncrementalError(null);
      return;
    }
    let cancelled = false;
    setIncrementalBusy(true);
    setIncrementalError(null);
    void loadIncrementalPreview({ targetBookId: snapshots.target.bookId, source: snapshots.source })
      .then((next) => {
        if (cancelled) return;
        setIncremental(next);
        setIncrementalDecisions(new Map());
      })
      .catch((caught: unknown) => {
        if (!cancelled) setIncrementalError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setIncrementalBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshots, targetIsNew]);

  const groups = preview?.duplicateGroups ?? [];
  const groupIndex = groups.length === 0 ? 0 : Math.min(requestedGroup, groups.length - 1);
  const currentGroup = groups[groupIndex] ?? null;
  const conflictCount = preview === null ? 0 : unresolvedConflicts(preview, resolutions);
  const unresolvedGroups = preview === null ? 0 : unresolvedDuplicateGroups(preview, decisions);
  const incrementalReady = targetIsNew || incremental !== null;
  const canConfirm =
    preview !== null && conflictCount === 0 && unresolvedGroups === 0 && incrementalReady && incrementalError === null;
  const lastRequest = useRef<LedgerImportRequest | null>(null);

  function patchSearch(patch: Record<string, string | undefined>, replace = false): void {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setSearch(next, { replace });
  }

  /**
   * ⚠️ **步骤切换用 `replace`，整页只占一条历史记录。**
   *
   * 导入页自己是"选择 → 预览 → 核对 → 确认"的小流程，页内的「返回」负责逐步后退
   * （见 `onBack`）。如果每一步都 push，历史里就会留下 `step=preview`、`step=select` 等
   * 多条同一个页面的记录：从本页离开时 pop 一次只会回到上一个步骤，而不是回到打开它的
   * 账本设置——这正是一开始复现出的返回循环的一部分。**步骤是这一页的状态，不是一个去处。**
   */
  function goStep(next: Step): void {
    setSubmitError(null);
    patchSearch({ step: next, group: undefined }, true);
  }

  function changeTarget(next: string): void {
    if (sourceIsFormal && next === "new") return;
    setSnapshots(null);
    setFingerprints(null);
    setRecovery(null);
    setJob(null);
    setLoadError(null);
    setSubmitError(null);
    patchSearch({
      target: next === "" ? undefined : next,
      source: sourceKey === "" ? undefined : sourceKey,
      step: "select",
      group: undefined,
      job: undefined,
      newName: next === "new" ? currentNewName : undefined,
    }, true);
  }

  function changeSource(next: string): void {
    setSnapshots(null);
    setFingerprints(null);
    setRecovery(null);
    setJob(null);
    setLoadError(null);
    setSubmitError(null);
    const nextTarget = next !== "guest" && targetIsNew ? "" : targetId;
    patchSearch({
      target: nextTarget === "" ? undefined : nextTarget,
      source: next === "" ? undefined : next,
      step: "select",
      group: undefined,
      job: undefined,
      newName: nextTarget === "new" ? currentNewName : undefined,
    }, true);
  }

  /** 读取预览；游客来源由本机读取，正式来源必须由服务器读取并返回指纹。 */
  useEffect(() => {
    if (step === "select" || user === null) return;
    if (targetId === "" || (targetIsNew && currentNewName.trim() === "")) return;
    if (sourceIsGuest && !guestAvailable) return;
    if (!sourceIsGuest && !sourceIsFormal) return;
    if (sourceIsFormal && (targetIsNew || targetId === sourceKey)) return;

    const alreadyLoaded =
      snapshots !== null &&
      (sourceIsGuest
        ? snapshots.source.kind === "guest" &&
          (targetIsNew
            ? snapshots.target.bookId === "new" && snapshots.target.identity.name === currentNewName.trim()
            : snapshots.target.bookId === targetId)
        : snapshots.source.kind === "book" &&
          snapshots.source.bookId === sourceKey &&
          snapshots.target.bookId === targetId);
    if (alreadyLoaded) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        if (sourceIsGuest) {
          const source = await loadGuestImportSource();
          if (source === null) throw new Error("本机没有可用的游客账本。");
          const targetSnapshot = targetIsNew
            ? buildNewImportTarget(currentNewName)
            : await loadBookImportTarget(targetId);
          if (cancelled) return;
          setSnapshots({ source, target: targetSnapshot });
          setFingerprints(null);
        } else {
          const formal = await loadFormalImportPreview(sourceKey, targetId);
          if (cancelled) return;
          setSnapshots({ source: formal.source, target: formal.target });
          setFingerprints({ source: formal.sourceFingerprint, target: formal.targetFingerprint });
        }
        setRecovery(null);
        setResolutions(new Map());
        setDecisions(new Map());
      } catch (caught) {
        if (!cancelled) setLoadError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    step,
    user,
    sourceKey,
    sourceIsGuest,
    sourceIsFormal,
    guestAvailable,
    targetId,
    targetIsNew,
    currentNewName,
    snapshots,
  ]);

  /** 指向不完整步骤的地址回到选择，避免空白页。 */
  useEffect(() => {
    if (!books.isSuccess) return;
    const validSource = sourceIsGuest ? guestAvailable : sourceIsFormal;
    const validTarget =
      targetId !== "" &&
      !(sourceIsFormal && (targetIsNew || targetId === sourceKey));
    if (step !== "select" && (sourceKey === "" || !validSource || !validTarget || user === null)) {
      patchSearch({ step: "select", group: undefined }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    books.isSuccess,
    step,
    sourceKey,
    sourceIsGuest,
    sourceIsFormal,
    guestAvailable,
    targetId,
    targetIsNew,
    user,
  ]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step, requestedGroup]);

  function onBack(): void {
    if (submitState === "submitting") return;
    if (step === "confirm") {
      if (result !== null) {
        goBack();
        return;
      }
      if (groups.length > 0) {
        goStep("review");
        return;
      }
      goStep("preview");
      return;
    }
    if (step === "review") {
      goStep("preview");
      return;
    }
    if (step === "preview") {
      goStep("select");
      return;
    }
    goBack();
  }

  function chooseResolution(conflict: TaxonomyConflict, action: TaxonomyResolutionAction): void {
    setResolutions((previous) => {
      const next = new Map(previous);
      next.set(taxonomyResolutionKey(conflict.type, conflict.sourceId), action);
      return next;
    });
    // 映射会改变重复检测的 matchKey；之前组决定可能已不成立，必须重新核对。
    setDecisions(new Map());
    setSubmitError(null);
  }

  function setGroupPreset(groupId: string, action: GroupPresetAction): void {    const group = preview?.duplicateGroups.find((item) => item.id === groupId);
    if (group === undefined) return;
    setDecisions((previous) => {
      const next = new Map(previous);
      next.set(groupId, presetDecision(group, action));
      return next;
    });
    setSubmitError(null);
  }

  function setGroupSource(groupId: string, sourceId: string, handling: SourceHandling): void {
    const group = preview?.duplicateGroups.find((item) => item.id === groupId);
    if (group === undefined) return;
    setDecisions((previous) => {
      const base = previous.get(groupId) ?? presetDecision(group, "keep_both");
      const next = new Map(previous);
      next.set(groupId, withSourceHandling(base, sourceId, handling));
      return next;
    });
    setSubmitError(null);
  }

  function setGroupTarget(groupId: string, targetId: string, handling: TargetHandling): void {
    const group = preview?.duplicateGroups.find((item) => item.id === groupId);
    if (group === undefined) return;
    setDecisions((previous) => {
      const base = previous.get(groupId) ?? presetDecision(group, "keep_both");
      const next = new Map(previous);
      next.set(groupId, withTargetHandling(base, targetId, handling));
      return next;
    });
    setSubmitError(null);
  }

  function setIncrementalDecision(sourceTransactionId: string, action: IncrementalDecisionAction): void {
    setIncrementalDecisions((previous) => {
      const next = new Map(previous);
      next.set(sourceTransactionId, action);
      return next;
    });
    setSubmitError(null);
  }

  /**
   * D4：提交被服务器判定来源/目标已变化后，重新从服务器读取 B/A，并只恢复仍完全安全的草稿。
   * 先恢复 taxonomy 冲突选择，再用恢复后的映射重建预览，最后按组签名恢复逐条决定。
   */
  async function reloadFormalPreviewWithRecovery(): Promise<boolean> {
    if (preview === null || !sourceIsFormal || targetIsNew) return false;
    const next = await loadFormalImportPreview(sourceKey, targetId);
    const basePreview = buildImportPreview(
      next.source,
      next.target,
      resolutions as TaxonomyResolutionMap,
      { duplicateSettings: duplicateSettings.settings },
    );
    const recoveredResolutions = recoverTaxonomyResolutions(
      preview,
      basePreview,
      resolutions as TaxonomyResolutionMap,
    );
    const finalPreview = buildImportPreview(
      next.source,
      next.target,
      recoveredResolutions as TaxonomyResolutionMap,
      { duplicateSettings: duplicateSettings.settings },
    );
    const groupRecovery = recoverGroupDecisions(preview, finalPreview, decisions);
    const summary = summarizeDraftRecovery(decisions, resolutions, groupRecovery, recoveredResolutions);

    setSnapshots({ source: next.source, target: next.target });
    setFingerprints({ source: next.sourceFingerprint, target: next.targetFingerprint });
    setResolutions(new Map(recoveredResolutions));
    setDecisions(groupRecovery.decisions);
    setRecovery(summary);
    setSubmitState("idle");
    setSubmitError(null);
    setResult(null);
    patchSearch({ step: "preview", group: undefined }, true);
    return true;
  }

  async function runSubmit(
    request: LedgerImportRequest,
    labels: { targetLabel: string; sourceLabel: string },
    sourceForReconcile: ImportSource | null = null,
  ): Promise<void> {
    setSubmitState("submitting");
    setSubmitError(null);
    setResult(null);
    try {
      const send = () =>
        apiFetch<unknown>("/ledger-imports", {
          method: "POST",
          body: request,
          timeoutMs: 120_000,
        });
      /**
       * Same importId in two tabs must not run twice. The server receipt is the final
       * idempotency backstop; this lock makes the local UI wait for the same task rather
       * than racing two requests that would both need to be reconciled.
       */
      const raw =
        typeof navigator !== "undefined" && "locks" in navigator
          ? await navigator.locks.request(`ledger-import:${request.importId}`, send)
          : await send();
      const parsed = ledgerImportResultSchema.parse(raw);
      if (!mounted.current) return;
      const requestSkipped = new Set(
        request.duplicateGroups.flatMap((group) => {
          if (group.sourceActions !== undefined) {
            return group.sourceActions.filter((item) => item.action === "skip").map((item) => item.sourceTransactionId);
          }
          return group.action === "keep_a" || group.action === "keep_neither" ? group.sourceIds : [];
        }),
      );
      const requestRemovedCount = request.duplicateGroups.reduce((total, group) => {
        if (group.targetActions !== undefined) {
          return total + group.targetActions.filter((item) => item.action === "remove").length;
        }
        return total + (group.action === "keep_b" || group.action === "keep_neither" ? group.targetIds.length : 0);
      }, 0);
      const sourceTransactions = sourceForReconcile?.transactions ?? request.source?.transactions ?? null;
      if (sourceTransactions !== null) {
        const expectedSkipped = requestSkipped.size;
        const expectedImported = sourceTransactions.length - expectedSkipped;
        const expectedTotals = totalsOf(
          sourceTransactions.filter((item) => !requestSkipped.has(item.id)),
        );
        if (
          parsed.importedCount !== expectedImported ||
          parsed.skippedCount !== expectedSkipped ||
          parsed.removedCount !== requestRemovedCount ||
          parsed.removedTargets.length !== requestRemovedCount ||
          parsed.targetCountAfter !==
            parsed.targetExistingBefore - requestRemovedCount + parsed.importedCount ||
          JSON.stringify(parsed.totals) !== JSON.stringify(expectedTotals)
        ) {
          setSubmitError("服务器已完成提交，但回执与本地预期不一致。请先截图保留本页，然后打开目标账本核对；不要重复提交。");
          setResult(parsed);
          setSubmitState("error");
          return;
        }
      }
      setResult(parsed);
      setSubmitState("success");
      // 保留本地任务日志直到用户明确完成/离开，刷新后还能凭同一 importId 找回回执。
      savePendingTask({
        userId: user?.id ?? "",
        request,
        targetLabel: labels.targetLabel,
        sourceLabel: labels.sourceLabel,
        createdAt: new Date().toISOString(),
      });
      setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
    } catch (caught) {
      if (!mounted.current) return;
      const message = errorMessage(caught);
      const code = caught instanceof ApiRequestError ? caught.code : "";

      /**
       * D4：正式来源/目标在预览后变化时，不把用户赶回空白选择页。先清除旧任务，再重新从
       * 服务器读取并恢复仍然安全的草稿；无法恢复的部分保持未决定并在核对页高亮。
       */
      if (
        (code === "source_changed" || code === "target_changed") &&
        request.sourceBookId !== undefined &&
        sourceIsFormal
      ) {
        removePendingTask(request.importId);
        setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
        try {
          const reloaded = await reloadFormalPreviewWithRecovery();
          if (reloaded) {
            setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
            return;
          }
        } catch (recoveryError) {
          if (!mounted.current) return;
          setSubmitError(errorMessage(recoveryError));
          setSubmitState("error");
          return;
        }
      }

      if (
        code === "source_changed" ||
        code === "target_changed" ||
        code === "already_imported" ||
        code.startsWith("taxonomy_") ||
        code.startsWith("decision_") ||
        code === "duplicate_"
      ) {
        removePendingTask(request.importId);
        setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
        setSubmitError(message);
        setSubmitState("error");
        return;
      }
      setSubmitError(message);
      setSubmitState("paused");
      setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
    }
  }

  async function handleSubmit(): Promise<void> {
    if (preview === null || !canConfirm || submitState !== "idle") return;
    setSubmitState("submitting");
    const importId = newId();
    const targetLabel = preview.target.identity.name;
    const sourceLabel = preview.source.identity.name;
    let request: Awaited<ReturnType<typeof buildLedgerImportRequest>> | null = null;
    try {
      request = await buildLedgerImportRequest({
        importId,
        preview,
        targetIsNew,
        resolutions,
        decisions,
        serverSourceFingerprint: fingerprints?.source,
        serverTargetFingerprint: fingerprints?.target,
        incrementalDecisions: decisionsForRequest(incremental, incrementalDecisions),
      });

      /**
       * Phase 4: every import goes through the reversible server job. There is no synchronous
       * direct-write fallback in the web UI; target ledgers must already exist.
       */
      const hasIncrementalHistory =
        incremental !== null && incremental.summary.newCount < preview.source.transactions.length;
      if (incrementalError !== null && hasIncrementalHistory) {
        throw new Error("无法读取增量历史，暂不开始导入；请刷新后重试。");
      }
      const created = await createImportJob(request);
      setJob(created);
      setSubmitState("submitting");
      patchSearch({ step: "confirm", job: created.id }, true);
      return;
    } catch (caught) {
      const message = errorMessage(caught);
      const code = caught instanceof ApiRequestError ? caught.code : "";
      if (request === null) {
        setSubmitError(message);
        setSubmitState("error");
        return;
      }
      /**
       * The reversible job path can fail its creation-time fingerprint check before a job exists.
       * Reuse the same D4 recovery as the direct path: reload the formal preview and restore all
       * still-safe draft choices instead of leaving the user on a dead error page.
       */
      if (
        (code === "source_changed" || code === "target_changed") &&
        request.sourceBookId !== undefined
      ) {
        removePendingTask(request.importId);
        setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
        try {
          const reloaded = await reloadFormalPreviewWithRecovery();
          if (reloaded) return;
        } catch (recoveryError) {
          if (!mounted.current) return;
          setSubmitError(errorMessage(recoveryError));
          setSubmitState("error");
          return;
        }
      }
      if (
        code === "source_changed" ||
        code === "target_changed" ||
        code === "already_imported" ||
        code.startsWith("taxonomy_") ||
        code.startsWith("decision_") ||
        code === "duplicate_"
      ) {
        removePendingTask(request.importId);
        setPendingTasks(user === null ? [] : loadPendingTasks().filter((item) => item.userId === user.id));
        setSubmitError(message);
        setSubmitState("error");
        return;
      }
      setSubmitError(message);
      setSubmitState("error");
    }
  }

  async function resumeTask(task: PendingImportTask): Promise<void> {
    if (user !== null && task.userId !== user.id) {
      setSubmitError("这个导入任务属于另一个账号。请先登录原账号，再继续检查。");
      setSubmitState("error");
      return;
    }
    setResumeBusy(true);
    setSubmitError(null);
    try {
      lastRequest.current = task.request;
      const requestTarget = task.request.target;
      patchSearch({
        step: "confirm",
        target: requestTarget.kind === "new" ? "new" : requestTarget.bookId,
        source: task.request.sourceBookId ?? "guest",
        newName: requestTarget.kind === "new" ? requestTarget.name : undefined,
      }, true);
      await runSubmit(task.request, { targetLabel: task.targetLabel, sourceLabel: task.sourceLabel });
    } finally {
      setResumeBusy(false);
    }
  }

  function dropTask(importId: string): void {
    removePendingTask(importId);
    setPendingTasks((previous) => previous.filter((item) => item.request.importId !== importId));
  }

  async function resumeJob(): Promise<void> {
    if (job === null) return;
    setJobBusy(true);
    setSubmitError(null);
    try {
      const next = await resumeImportJob(job.id);
      setJob(next);
      setSubmitState("submitting");
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setJobBusy(false);
    }
  }

  async function confirmJob(): Promise<void> {
    if (job === null) return;
    setJobBusy(true);
    setSubmitError(null);
    try {
      const next = await confirmImportJob(job.id);
      setJob(next);
      setSubmitState("submitting");
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setJobBusy(false);
    }
  }

  async function undoJob(): Promise<void> {
    if (job === null) return;
    setJobBusy(true);
    setSubmitError(null);
    try {
      const next = await undoImportJob(job.id);
      setJob(next);
      setSubmitState("submitting");
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setJobBusy(false);
    }
  }

  async function keepWaiting(): Promise<void> {
    if (job === null) return;
    setJobBusy(true);
    setSubmitError(null);
    try {
      const next = await refreshImportJobActivity(job.id);
      setJob(next);
      setSubmitError("已延长等待时间；自动轮询不会延长期限。");
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setJobBusy(false);
    }
  }

  const jobActive = job !== null && submitState !== "success";

  const subtitle =
    step === "select"
      ? "把本机游客账本或另一本正式单人账本导入目标账本。先确认来源和目标。"
      : step === "preview"
        ? "确认方向、映射和重复候选。预览和核对都不会修改任何账本。"
        : step === "review"
          ? "核对来源变化与可能重复的账目；只有你明确选择更新的目标才会改变，自动导入不会静默覆盖。"
          : jobActive
            ? "导入任务已在服务器执行；关闭页面不会中断，重新打开可继续查看真实进度。"
            : "确认最终摘要后才会真正写入。来源账本数据会保留。";

  return (
    <InnerPage
      title="导入账本"
      subtitle={subtitle}
      backTo={backTo}
      onBack={onBack}
      actions={
        <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
          {submitState === "success" ? "已完成" : sourceIsGuest ? "游客来源" : sourceIsFormal ? "正式账本来源" : "选择来源"}
        </span>
      }
    >
      <StepRail step={step} />

      {pendingTasks.length === 0 || submitState === "success" || recovery !== null ? null : (
        <PendingTaskBanner
          tasks={pendingTasks}
          busy={resumeBusy}
          onResume={(task) => void resumeTask(task)}
          onDrop={dropTask}
        />
      )}

      {books.isPending ? <SkeletonRows rows={3} /> : null}
      {books.isError ? <Alert>{errorMessage(books.error)}</Alert> : null}
      {loadError === null ? null : <Alert>{loadError}</Alert>}
      {incrementalError === null ? null : <Alert>{incrementalError}</Alert>}
      {submitError === null ? null : <Alert>{submitError}</Alert>}
      {recovery === null || recovery.message === null ? null : (
        <DraftRecoveryNotice summary={recovery} />
      )}
      {jobActive && job !== null ? (
        <BatchJobPanel
          job={job}
          busy={jobBusy}
          onResume={() => void resumeJob()}
          onConfirm={() => setConfirmConfirmOpen(true)}
          onUndo={() => setCancelConfirmOpen(true)}
          onKeepWaiting={() => void keepWaiting()}
          onRefresh={() => {
            if (jobIdParam !== "") {
              void getImportJob(jobIdParam)
                .then((next) => setJob(next))
                .catch((caught: unknown) => setSubmitError(errorMessage(caught)));
            }
          }}
        />
      ) : null}

      {books.isSuccess && step === "select" ? (
        <SelectionStep
          targetId={targetId}
          target={target}
          targetIsNew={targetIsNew}
          newName={currentNewName}
          soloBooks={soloBooks}
          sourceBooks={soloBooks.filter((book) => book.id !== targetId)}
          sourceBook={sourceBook}
          guestAvailable={guestAvailable}
          sourceKey={sourceKey}
          accountLabel={accountLabel}
          onChangeTarget={changeTarget}
          onChangeSource={changeSource}
          onChangeNewName={(name) => patchSearch({ newName: name }, true)}
          onContinue={() => {
            if (sourceKey === "") {
              setLoadError("请选择来源账本。");
              return;
            }
            if (sourceIsGuest && !guestAvailable) {
              setLoadError("本机没有可用的游客账本。");
              return;
            }
            if (sourceIsFormal && (targetId === "" || targetIsNew || targetId === sourceKey)) {
              setLoadError("正式账本来源需要选择另一本现有正式账本作为目标。");
              return;
            }
            if (targetId === "") {
              setLoadError("请选择目标账本。");
              return;
            }
            if (targetIsNew && currentNewName.trim() === "") {
              setLoadError("请填写新账本名称。");
              return;
            }
            setLoadError(null);
            goStep("preview");
          }}
        />
      ) : null}

      {step !== "select" && loading ? <SkeletonRows rows={5} /> : null}

      {step === "preview" && !jobActive && !loading && loadError === null && preview !== null ? (
        <PreviewStep
          preview={preview}
          conflictCount={conflictCount}
          resolutions={resolutions}
          onResolve={chooseResolution}
          onBack={() => goStep("select")}
          onReview={() => patchSearch({ step: "review", group: "0" }, true)}
          onConfirm={() => goStep("confirm")}
          needsIncrementalReview={(incremental?.statuses ?? []).some(
            (status) =>
              status.status !== "new" &&
              status.status !== "unchanged",
          )}
        />
      ) : null}

      {step === "review" && !jobActive && !loading && loadError === null && preview !== null ? (
        <>
          {incrementalError === null ? null : <Alert>{incrementalError}</Alert>}
          {incremental === null ? null : (
            <IncrementalReview
              statuses={incremental.statuses}
              summary={incremental.summary}
              source={preview.source}
              target={preview.target}
              decisions={incrementalDecisions}
              onDecision={setIncrementalDecision}
            />
          )}
          <ReviewStep
            preview={preview}
            groupIndex={groupIndex}
            decisions={decisions}
            onPreset={setGroupPreset}
            onSource={setGroupSource}
            onTarget={setGroupTarget}
            onPrevious={() => {
              if (groupIndex > 0) patchSearch({ group: String(groupIndex - 1) }, true);
            }}
            onNext={() => {
              if (groupIndex < groups.length - 1) patchSearch({ group: String(groupIndex + 1) }, true);
            }}
            onBack={() => goStep("preview")}
            onConfirm={() => goStep("confirm")}
            canConfirm={canConfirm}
            needsReviewGroupIds={recovery?.needsReviewGroupIds ?? []}
          />
        </>
      ) : null}

      {step === "confirm" && !jobActive && preview !== null && !loading && loadError === null ? (
        <ConfirmStep
          preview={preview}
          targetIsNew={targetIsNew}
          decisions={decisions}
          canConfirm={canConfirm}
          submitState={submitState}
          result={result}
          onStart={() => {
            const removals = preview === null ? [] : removedTargets(preview, decisions);
            if (removals.length > 0) setRemovalConfirmOpen(true);
            else void handleSubmit();
          }}
          onRetry={() => {
            const request = lastRequest.current ?? loadPendingTasks().find((item) => item.userId === user?.id)?.request;
            if (request === undefined) {
              setSubmitState("idle");
              return;
            }
            void runSubmit(
              request,
              {
                targetLabel: preview.target.identity.name,
                sourceLabel: preview.source.identity.name,
              },
              preview.source,
            );
          }}
          onBack={() => goStep(groups.length > 0 ? "review" : "preview")}
          onFinish={() => {
            if (result !== null) dropTask(result.importId);
            goBack();
          }}
          onOpenTarget={(bookId) => {
            if (result !== null) dropTask(result.importId);
            void (async () => {
              try {
                await activateBook.mutateAsync(bookId);
                void navigate("/");
              } catch (caught) {
                setSubmitError(errorMessage(caught));
              }
            })();
          }}
        />
      ) : null}

      {step === "confirm" && submitState === "success" && result !== null && preview !== null ? (
        <SourceRetentionCard
          result={result}
          preview={preview}
          jobId={job?.id ?? null}
          onError={setSubmitError}
        />
      ) : null}

      {step === "confirm" && (preview === null || loading) ? <SkeletonRows rows={4} /> : null}

      <ConfirmDialog
        open={removalConfirmOpen}
        title="确认软删除目标账目？"
        description={
          preview === null
            ? "本次导入会软删除目标账本中的记录。"
            : `本次将软删除 ${String(removedTargets(preview, decisions).length)} 笔目标 A 记录，并导入 ${String(importedSourceCount(preview, decisions))} 笔来源 B 记录。`
        }
        consequences={[
          "只会软删除你在核对页明确标记为「移除」的目标记录",
          "被移除的记录会进入现有账目删除/恢复机制，编号不变",
          "来源账本数据不会因此被删除",
          "提交在同一事务中完成；失败会整体回滚，不会出现 A 已删而 B 未写入",
        ]}
        confirmLabel="确认删除并导入"
        busy={submitState === "submitting"}
        onCancel={() => {
          if (submitState !== "submitting") setRemovalConfirmOpen(false);
        }}
        onConfirm={() => {
          setRemovalConfirmOpen(false);
          void handleSubmit();
        }}
      >
        {preview === null ? null : (
          <ul className="max-h-40 overflow-auto rounded-field bg-canvas px-3 py-2 text-helper text-ink">
            {removedTargets(preview, decisions).map((item) => (
              <li key={item.transactionId} className="flex justify-between gap-3 border-b border-line py-1 last:border-b-0">
                <span className="min-w-0 truncate">
                  {item.occurredLocalDate} · {item.categoryLabel}
                  {item.note === null ? "" : ` · ${item.note}`}
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(item.amountCents, item.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="撤销本次导入？"
        description="撤销会恢复本次导入造成的业务变化，而不是只停止后续批次。"
        consequences={[
          "本任务新增的目标账目会被移除，更新过的目标账目会恢复原值",
          "本次写入的分类、标签、来源状态和回执会恢复到导入前状态",
          "其他账本、其他设备的离线待同步数据不会被删除",
          "撤销失败时账本保持锁定并显示失败，不会伪装成功或直接解锁",
          "撤销完成后才能再次编辑这本账本",
        ]}
        confirmLabel="确认安全撤销本次导入"
        busy={jobBusy}
        onCancel={() => {
          if (!jobBusy) setCancelConfirmOpen(false);
        }}
        onConfirm={() => {
          setCancelConfirmOpen(false);
          void undoJob();
        }}
      >
        <p className="text-helper-relaxed text-muted">
          已提交 {String(job?.nextBatch ?? 0)} 批，新增 {String(job?.importedCount ?? 0)} 笔、更新{" "}
          {String(job?.updatedCount ?? 0)} 笔；这些变化都会被精确恢复。
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmConfirmOpen}
        title="确认完成这次导入？"
        description="确认后本次导入进入正式状态，不能再撤销。"
        consequences={[
          "服务器会完成最终对账并写入正式导入回执",
          "目标 A 的最终移除操作会在确认事务中执行",
          "账本业务锁会在确认成功后释放",
          "只有确认完成后才开放来源清理或正式来源处置",
          "确认失败会回到等待确认并保留锁，不会释放账本",
        ]}
        confirmLabel="确认完成"
        busy={jobBusy}
        onCancel={() => {
          if (!jobBusy) setConfirmConfirmOpen(false);
        }}
        onConfirm={() => {
          setConfirmConfirmOpen(false);
          void confirmJob();
        }}
      />
    </InnerPage>
  );
}

function StepRail({ step }: { readonly step: Step }): React.JSX.Element {
  const activeIndex = STEP_ITEMS.findIndex((item) => item.id === step);
  return (
    <ol className="flex items-center gap-1.5 px-1 text-helper" aria-label="导入步骤">
      {STEP_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true" className="h-px w-2 shrink-0 bg-line" /> : null}
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-medium ${
                active ? "bg-brand text-white" : done ? "bg-brand-soft text-brand-dark" : "bg-canvas text-muted"
              }`}
            >
              {index + 1}
            </span>
            <span className={active ? "text-ink" : "text-muted"}>{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function BatchJobPanel({
  job,
  busy,
  onResume,
  onConfirm,
  onUndo,
  onKeepWaiting,
  onRefresh,
}: {
  readonly job: ImportJobStatus;
  readonly busy: boolean;
  readonly onResume: () => void;
  readonly onConfirm: () => void;
  readonly onUndo: () => void;
  readonly onKeepWaiting: () => void;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  const labels: Record<ImportJobStatus["status"], string> = {
    queued: "排队中",
    running: "正在导入",
    finalizing: "最终对账中",
    awaiting_confirmation: "批次已完成，等待最终确认",
    confirming: "正在最终确认",
    confirmed: "已确认完成",
    undoing: "正在安全撤销",
    undone: "已撤销",
    undo_failed: "撤销失败，账本保持锁定",
    paused: "已暂停",
    failed: "需要处理",
    completed: "已完成（旧版）",
    cancelled: "已取消（旧版）",
    expired: "已过期，来源快照已清理",
  };
  const [now, setNow] = useState(Date.now());
  const deadline = job.confirmationDeadline === null ? null : Date.parse(job.confirmationDeadline);
  useEffect(() => {
    if (deadline === null || job.status !== "awaiting_confirmation") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [deadline, job.status]);
  const remainingSeconds =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1_000));
  const percent =
    job.totalBatches === 0
      ? 100
      : Math.min(100, Math.round((job.nextBatch / job.totalBatches) * 100));
  const canResume = job.status === "paused" || job.status === "failed";
  const canUndo = job.canUndo;
  const canConfirm = job.canConfirm;
  const waiting = job.status === "awaiting_confirmation" || job.status === "paused";
  return (
    <section data-testid="import-job-progress" className="flex flex-col gap-4">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-helper text-muted">可撤销导入任务</p>
            <p className="mt-1 text-body font-medium text-ink">{labels[job.status]}</p>
          </div>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
            {job.nextBatch} / {job.totalBatches} 批
          </span>
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          已处理 {String(job.nextBatch)} / {String(job.totalBatches)} 批；
          新增 {String(job.importedCount)} 笔 · 更新 {String(job.updatedCount)} 笔 · 跳过 {String(job.skippedCount)} 笔。
          总来源 {String(job.sourceCount)} 笔。
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${String(percent)}%` }} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          在最终确认前，这本账本处于服务端业务锁中，其他设备的写入会被拒绝；撤销会恢复本次已提交的业务变化，而不是只停止后续批次。
        </p>
        {job.status === "awaiting_confirmation" ? (
          <p
            className={`mt-2 text-helper-relaxed ${remainingSeconds !== null && remainingSeconds <= 60 ? "text-warning-dark" : "text-muted"}`}
          >
            {remainingSeconds === null
              ? "等待确认。"
              : `请在 ${String(Math.floor(remainingSeconds / 60))} 分 ${String(remainingSeconds % 60)} 秒内确认或撤销；超时将自动安全撤销。`}
          </p>
        ) : null}
        {job.status === "paused" && remainingSeconds !== null ? (
          <p className="mt-2 text-helper-relaxed text-warning-dark">
            暂停中，超时后会自动安全撤销（约剩 {String(remainingSeconds)} 秒）。可以先继续任务。
          </p>
        ) : null}
        {job.nextBatch > 0 && (job.status === "paused" || job.status === "failed") ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            已提交的 {String(job.nextBatch)} 个批次可以完整撤销；撤销前不会释放账本锁。
          </p>
        ) : null}
        {job.status === "undo_failed" ? (
          <p className="mt-2 text-helper-relaxed text-warning-dark">
            撤销未完成，账本仍保持锁定；请重试撤销。系统不会把失败显示为成功，也不会直接解锁。
          </p>
        ) : null}
        {job.status === "undone" ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            本次导入造成的新增、更新和来源状态已恢复；账本锁已释放。
          </p>
        ) : null}
        {job.lastErrorMessage === null ? null : <Alert>{job.lastErrorMessage}</Alert>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-field border border-line px-3 py-2 text-button text-muted"
          >
            刷新进度
          </button>
          {waiting ? (
            <button
              type="button"
              onClick={onKeepWaiting}
              disabled={busy}
              className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
            >
              我还在，延长等待
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="rounded-field bg-brand px-3 py-2 text-button text-white disabled:opacity-50"
            >
              {busy ? "正在恢复…" : "继续任务"}
            </button>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-field bg-brand px-3 py-2 text-button text-white disabled:opacity-50"
            >
              确认完成
            </button>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              className="rounded-field border border-danger/40 px-3 py-2 text-button text-danger-dark disabled:opacity-50"
            >
              {job.status === "undo_failed" ? "重试撤销" : "撤销本次导入"}
            </button>
          ) : null}
        </div>
        {job.status === "expired" ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            旧版任务暂停超过恢复期限，来源快照已清理；已经导入的账目仍保留。
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PendingTaskBanner({
  tasks,
  busy,
  onResume,
  onDrop,
}: {
  readonly tasks: readonly PendingImportTask[];
  readonly busy: boolean;
  readonly onResume: (task: PendingImportTask) => void;
  readonly onDrop: (importId: string) => void;
}): React.JSX.Element {
  const task = tasks[0]!;
  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-body font-medium text-ink">有一次导入还没有确认结果</p>
      <p className="mt-1 text-helper-relaxed text-muted">
        {task.sourceLabel} → {task.targetLabel}。继续只会用同一个任务编号向服务器确认，不会重复生成账目。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onResume(task)}
          disabled={busy}
          className="rounded-field bg-brand px-3 py-2 text-button text-white disabled:opacity-50"
        >
          {busy ? "正在检查…" : "继续检查结果"}
        </button>
        <button
          type="button"
          onClick={() => onDrop(task.request.importId)}
          className="rounded-field border border-line px-3 py-2 text-button text-muted"
        >
          放弃本机记录
        </button>
      </div>
      <p className="mt-2 text-helper text-muted">放弃只清除本机任务记录，不会删除已经导入的账目。</p>
    </section>
  );
}

function DraftRecoveryNotice({ summary }: { readonly summary: DraftRecoverySummary }): React.JSX.Element {
  return (
    <section className="rounded-card border border-brand/30 bg-brand-soft px-4 py-3">
      <p className="text-body font-medium text-brand-dark">{summary.message}</p>
      <p className="mt-1 text-helper-relaxed text-brand-dark/80">
        已恢复 {String(summary.restoredGroups)} 组重复决定
        {summary.resetGroups > 0 ? `，${String(summary.resetGroups)} 组需要重新核对` : ""}
        {summary.restoredConflicts > 0 ? `；已恢复 ${String(summary.restoredConflicts)} 个映射选择` : ""}
        {summary.resetConflicts > 0 ? `，${String(summary.resetConflicts)} 个映射需要重新选择` : ""}。
      </p>
      {summary.needsReviewGroupIds.length === 0 ? null : (
        <p className="mt-1 text-helper text-brand-dark/80">受影响的冲突组已在核对页高亮。</p>
      )}
    </section>
  );
}

function SelectionStep({
  targetId,
  target,
  targetIsNew,
  newName,
  soloBooks,
  sourceBooks,
  sourceBook,
  guestAvailable,
  sourceKey,
  accountLabel,
  onChangeTarget,
  onChangeSource,
  onChangeNewName,
  onContinue,
}: {
  readonly targetId: string;
  readonly target: ImportBookOption | null;
  readonly targetIsNew: boolean;
  readonly newName: string;
  readonly soloBooks: readonly ImportBookOption[];
  readonly sourceBooks: readonly ImportBookOption[];
  readonly sourceBook: ImportBookOption | null;
  readonly guestAvailable: boolean;
  readonly sourceKey: string;
  readonly accountLabel: string;
  readonly onChangeTarget: (next: string) => void;
  readonly onChangeSource: (next: string) => void;
  readonly onChangeNewName: (next: string) => void;
  readonly onContinue: () => void;
}): React.JSX.Element {
  const formalSource = sourceBook !== null;
  const canContinue =
    sourceKey !== "" &&
    (formalSource ? targetId !== "" && !targetIsNew && targetId !== sourceKey : guestAvailable && targetId !== "");
  /**
   * 哪一列账本选择器正打开着：`null` 表示都关着。
   *
   * ⚠️ **S15-C 第四轮：两处换成内嵌下拉列表**（`InlineChoice`，与 `/add` 分类选择器同一形态）。
   * 上一轮的 `ChoiceSheet`（底部面板）把整屏盖住；来源与目标紧挨着、需要对照着看，
   * 展开在字段下方才读得清。**`ChoiceSheet` 本身保留**（`/add` 币种、导入等仍用）。
   */
  const [picking, setPicking] = useState<"source" | "target" | null>(null);
  /**
   * 选项与原来的选择面板一一对应：占位项、游客来源、正式账本；
   * 目标里"与来源相同"的那一项仍保留但不可选（`disabled`），与原实现一致。
   */
  const sourceOptions: readonly InlineChoiceOption[] = [
    { id: "", label: "选择来源账本" },
    ...(guestAvailable ? [{ id: "guest", label: "本机游客账本" }] : []),
    ...sourceBooks.map((book) => ({ id: book.id, label: `正式账本 · ${book.name}` })),
  ];
  const targetOptions: readonly InlineChoiceOption[] = [
    { id: "", label: "选择目标账本" },
    ...soloBooks.map((book) => ({
      id: book.id,
      label: book.name,
      disabled: book.id === sourceKey,
      ...(book.id === sourceKey ? { hint: "就是来源账本，不能选" } : {}),
    })),
  ];

  return (
    <section className="flex flex-col gap-5">
      <p className="text-body-relaxed text-muted">
        来源 B 可以是本机游客账本，也可以是当前账号的另一本正式单人账本。正式账本来源只允许
        B、A 都只有当前账号一个有效成员、且没有待接受邀请或可用分享链接；预览和提交都会重新校验。
        导入后来源 B 的数据不会被删除或清空。
      </p>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">来源账本 B</span>
          <InlineChoice
            label="来源账本 B"
            testId="import-source"
            open={picking === "source"}
            value={sourceKey}
            options={sourceOptions}
            onToggle={() => {
              setPicking((current) => (current === "source" ? null : "source"));
            }}
            onSelect={onChangeSource}
            onClose={() => {
              setPicking(null);
            }}
          />
        </div>
        {guestAvailable || sourceBooks.length > 0 ? null : (
          <p className="mt-2 text-helper-relaxed text-muted">
            本机没有游客账本，也没有可作为来源的其他单人账本。
          </p>
        )}
        {formalSource ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            正式来源只会导入你在预览中确认的记录；不会删除来源 B 的账目，也不会关闭来源账本。
          </p>
        ) : guestAvailable ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            来源游客数据在上传前不会被读取或发送；导入后也不会自动删除。
          </p>
        ) : null}

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-muted">↓</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">目标账本 A</span>
          <InlineChoice
            label="目标账本 A"
            testId="import-target"
            open={picking === "target"}
            value={targetId}
            options={targetOptions}
            onToggle={() => {
              setPicking((current) => (current === "target" ? null : "target"));
            }}
            onSelect={onChangeTarget}
            onClose={() => {
              setPicking(null);
            }}
          />
        </div>

        {formalSource ? (
          <p className="mt-3 text-helper-relaxed text-muted">
            正式来源只能导入另一本现有正式单人账本；不能新建目标账本，也不能选来源自己。
          </p>
        ) : (
          <p className="mt-3 text-helper-relaxed text-muted">
            导入不会新建目标账本。请先在
            <a href="/" className="mx-1 text-brand-dark underline-offset-2 hover:underline">
              账本空间
            </a>
            正常创建一个空账本，再回到这里选择它作为目标。
          </p>
        )}

        {target === null ? null : (
          <p className="mt-3 text-helper-relaxed text-muted">
            导入到「{target.name}」 · {accountLabel}
            {target.bookNumber === null ? "" : ` · 编号 ${target.bookNumber}`}
          </p>
        )}
      </div>

      <Button onClick={onContinue} disabled={!canContinue}>
        查看预览
      </Button>
    </section>
  );
}

function PreviewStep({
  preview,
  conflictCount,
  resolutions,
  onResolve,
  onBack,
  onReview,
  onConfirm,
  needsIncrementalReview,
}: {
  readonly preview: ImportPreview;
  readonly conflictCount: number;
  readonly resolutions: TaxonomyResolutionMap;
  readonly onResolve: (conflict: TaxonomyConflict, action: TaxonomyResolutionAction) => void;
  readonly onBack: () => void;
  readonly onReview: () => void;
  readonly onConfirm: () => void;
  readonly needsIncrementalReview: boolean;
}): React.JSX.Element {
  const { mapping, counts } = preview;
  const hasReview = counts.duplicateGroups > 0 || needsIncrementalReview;
  return (
    <section data-testid="import-preview" className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-helper text-muted">导入方向</p>
        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          <span className="text-helper text-muted">来源 B</span>
          <BookIdentity book={preview.source.identity} />
          <span className="justify-self-center text-muted" aria-hidden="true">
            ↓
          </span>
          <span className="h-px w-full bg-line" aria-hidden="true" />
          <span className="text-helper text-muted">目标 A</span>
          <BookIdentity book={preview.target.identity} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          {preview.source.kind === "guest"
            ? "来源是本机游客账本；导入后本机数据仍会保留。"
            : "来源是正式单人账本；导入后来源 B 的数据仍会保留，不会自动删除或关闭。"}
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="section-title">这次会发生什么</h2>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Metric label="来源" value={`${String(counts.sourceTransactions)} 笔`} />
          <Metric label="无冲突" value={`${String(counts.importableWithoutConflict)} 笔`} />
          <Metric label="重复组" value={`${String(counts.duplicateGroups)} 组`} />
        </div>
        <div className="mt-4 border-t border-line pt-4">
          {preview.totals.length === 0 ? (
            <p className="text-helper-relaxed text-muted">来源没有账目。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {preview.totals.map((total) => (
                <li key={total.currency} className="flex items-baseline justify-between gap-3">
                  <span className="text-helper text-muted">{total.currency}</span>
                  <span className="text-right text-body text-ink">
                    支出 {formatMoney(total.expenseCents, total.currency)} · 收入 {formatMoney(total.incomeCents, total.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {counts.targetTransactions > 0 ? (
            <p className="mt-3 text-helper-relaxed text-muted">
              目标账本已有 {String(counts.targetTransactions)} 条账目；本轮只新增，不会修改或删除它们。
            </p>
          ) : null}
          {counts.sourceSkippedDeleted > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              来源中 {String(counts.sourceSkippedDeleted)} 条已删除的账目不会导入。
            </p>
          ) : null}
        </div>
      </div>

      <details className="rounded-card border border-line bg-surface px-5 py-4 [&::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-body font-medium text-ink">分类、支付方式与标签</span>
          <span className="text-helper text-muted">
            {conflictCount > 0 ? `${String(conflictCount)} 项待确认` : "查看详情"} ›
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <MappingRow label="分类" items={mapping.categories} />
          <MappingRow label="支付方式" items={mapping.paymentMethods} />
          <MappingRow label="标签" items={mapping.tags} />
          {mapping.conflicts.length === 0 ? (
            <p className="text-helper-relaxed text-muted">没有同名但属性不同的对象。</p>
          ) : (
            <ul className="flex flex-col gap-2 pt-1">
              {mapping.conflicts.map((conflict) => (
                <ConflictRow
                  key={`${conflict.type}:${conflict.sourceId}`}
                  conflict={conflict}
                  value={resolutions.get(taxonomyResolutionKey(conflict.type, conflict.sourceId))}
                  onChange={(action) => onResolve(conflict, action)}
                />
              ))}
            </ul>
          )}
        </div>
      </details>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="section-title">可能重复的账目</h2>
            <p className="mt-1 text-helper-relaxed text-muted">
              只比较来源 B 与目标 A 的记录；核对后再决定跳过还是两边都保留。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
            {String(counts.duplicateGroups)} 组
          </span>
        </div>
        {hasReview ? (
          <button
            type="button"
            data-testid="open-review"
            onClick={onReview}
            className="mt-3 flex w-full items-center justify-between rounded-field border border-line bg-canvas px-4 py-3 text-left text-body text-ink transition hover:border-brand/40 hover:bg-brand-soft"
          >
            <span>
              {counts.duplicateGroups > 0
                ? `去核对这 ${String(counts.duplicateGroups)} 组重复项`
                : "去核对此前导入与来源变化"}
            </span>
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </button>
        ) : (
          <p className="mt-3 text-helper-relaxed text-muted">没有发现可能重复的账目。</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {conflictCount > 0 ? (
          <p className="text-helper-relaxed text-muted">请先处理完全部属性冲突，再继续。</p>
        ) : null}
        {hasReview ? (
          <Button onClick={onReview} disabled={conflictCount > 0}>
            {counts.duplicateGroups > 0 ? "去核对可能重复的账目" : "去核对增量变化"}
          </Button>
        ) : (
          <Button onClick={onConfirm} disabled={conflictCount > 0}>
            继续确认
          </Button>
        )}
        <Button variant="secondary" onClick={onBack}>
          重新选择
        </Button>
      </div>
    </section>
  );
}

function BookIdentity({
  book,
}: {
  readonly book: ImportPreview["source"]["identity"];
}): React.JSX.Element {
  return (
    <span className="min-w-0 text-right">
      <span className="block truncate text-body font-medium text-ink">{book.name}</span>
      {book.bookNumber === null ? null : <span className="block text-helper text-muted">编号 {book.bookNumber}</span>}
    </span>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <p className="text-helper text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function MappingRow({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly { readonly targetId: string | null }[];
}): React.JSX.Element {
  const reuse = items.filter((item) => item.targetId !== null).length;
  const create = items.filter((item) => item.targetId === null).length;
  return (
    <div className="flex items-baseline justify-between gap-3 text-body">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">
        复用 {String(reuse)} · 新建 {String(create)}
      </span>
    </div>
  );
}

function ConflictRow({
  conflict,
  value,
  onChange,
}: {
  readonly conflict: TaxonomyConflict;
  readonly value: TaxonomyResolutionAction | undefined;
  readonly onChange: (action: TaxonomyResolutionAction) => void;
}): React.JSX.Element {
  return (
    <li className="rounded-field bg-canvas px-3 py-3 text-sm text-ink">
      <p className="font-medium">
        {taxonomyLabel(conflict.type)}「{conflict.sourceName}」与目标「{conflict.targetName}」同名但属性不同
      </p>
      <p className="mt-1 text-helper-relaxed text-muted">{conflict.message}</p>
      <div className="mt-2 flex gap-2" role="group" aria-label={`处理${conflict.sourceName}冲突`}>
        <button
          type="button"
          onClick={() => onChange("reuse")}
          className={`flex-1 rounded-field border px-3 py-2 text-left text-helper transition ${
            value === "reuse" ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
          }`}
        >
          复用目标对象
        </button>
        <button
          type="button"
          onClick={() => onChange("create")}
          className={`flex-1 rounded-field border px-3 py-2 text-left text-helper transition ${
            value === "create" ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
          }`}
        >
          在目标新建来源副本
        </button>
      </div>
    </li>
  );
}

function taxonomyLabel(type: TaxonomyConflict["type"]): string {
  switch (type) {
    case "category":
      return "分类";
    case "paymentMethod":
      return "支付方式";
    case "tag":
      return "标签";
  }
}

function IncrementalReview({
  statuses,
  summary,
  source,
  target,
  decisions,
  onDecision,
}: {
  readonly statuses: readonly IncrementalSourceStatus[];
  readonly summary: IncrementalPreviewResponse["summary"];
  readonly source: ImportSource;
  readonly target: ImportTarget;
  readonly decisions: ReadonlyMap<string, IncrementalDecisionAction>;
  readonly onDecision: (sourceTransactionId: string, action: IncrementalDecisionAction) => void;
}): React.JSX.Element {
  const labels: Record<IncrementalSourceStatus["status"], string> = {
    new: "新增",
    unchanged: "已导入未变化",
    modified: "来源已修改",
    target_changed: "目标已修改",
    target_deleted: "目标已删除",
    previously_skipped: "此前已跳过",
    previously_skipped_modified: "此前跳过且来源已修改",
    needs_review: "旧导入记录需确认",
  };
  const actionable = statuses.filter(
    (status) =>
      status.status === "modified" ||
      status.status === "target_changed" ||
      status.status === "target_deleted" ||
      status.status === "previously_skipped" ||
      status.status === "previously_skipped_modified" ||
      status.status === "needs_review",
  );
  const legacyCount = statuses.filter((status) => status.legacy).length;
  const categoryName = (id: string) => source.categories.find((item) => item.id === id)?.name ?? "未知分类";
  const targetCategoryName = (id: string) => target.categories.find((item) => item.id === id)?.name ?? "未知分类";
  const facts = (item: ImportSource["transactions"][number] | ImportTarget["transactions"][number], category: string) =>
    `${formatMoney(item.amountCents, item.currency, { withCode: true })} · ${item.occurredLocalDate} · ${category}${item.note === null ? "" : ` · ${item.note}`}`;
  return (
    <section data-testid="incremental-review" className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-4">
      <div>
        <p className="text-body font-medium text-ink">此前导入的核对</p>
        <p className="mt-1 text-helper-relaxed text-muted">
          已导入且未变化的记录默认跳过；来源变化只有在你明确选择后才会更新目标。来源已删除的账目不会删除目标。
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-helper">
        <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">未变化 {String(summary.unchangedCount)}</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand-dark">新增 {String(summary.newCount)}</span>
        {summary.modifiedCount > 0 ? <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">修改 {String(summary.modifiedCount)}</span> : null}
        {summary.targetChangedCount > 0 ? <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">目标变化 {String(summary.targetChangedCount)}</span> : null}
        {summary.targetDeletedCount > 0 ? <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">目标已删 {String(summary.targetDeletedCount)}</span> : null}
        {summary.previouslySkippedCount > 0 ? <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">此前跳过 {String(summary.previouslySkippedCount)}</span> : null}
        {summary.needsReviewCount > 0 ? <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">需确认 {String(summary.needsReviewCount)}</span> : null}
      </div>
      {legacyCount > 0 ? (
        <p className="text-helper-relaxed text-muted">
          有 {String(legacyCount)} 笔旧版本导入没有稳定的来源账本身份，不能确认是否属于当前游客账本；
          默认只保留目标，不会静默覆盖或建立删除关系。
        </p>
      ) : null}
      {actionable.length === 0 ? (
        <p className="text-helper-relaxed text-muted">没有需要逐条处理的来源变化。</p>
      ) : (
        <ul className="divide-y divide-line">
          {actionable.map((status) => {
            const sourceTransaction = source.transactions.find((item) => item.id === status.sourceTransactionId);
            const targetTransaction = target.transactions.find((item) => item.id === status.targetTransactionId);
            const chosen = decisions.get(status.sourceTransactionId) ?? defaultIncrementalAction(status);
            return (
              <li key={status.sourceTransactionId} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-body font-medium text-ink">{labels[status.status]}</p>
                  {status.legacy ? <span className="text-helper text-muted">旧导入记录</span> : null}
                </div>
                {sourceTransaction === undefined ? null : (
                  <p className="text-helper-relaxed text-muted">来源：{facts(sourceTransaction, categoryName(sourceTransaction.categoryId))}</p>
                )}
                {targetTransaction === undefined ? (
                  <p className="text-helper-relaxed text-muted">目标：无对应账目（不会自动创建或删除）</p>
                ) : (
                  <p className="text-helper-relaxed text-muted">目标：{facts(targetTransaction, targetCategoryName(targetTransaction.categoryId))}</p>
                )}
                {status.status === "modified" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDecision(status.sourceTransactionId, "keep_target")}
                      className={`rounded-field border px-3 py-2 text-button ${chosen === "keep_target" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      保留目标
                    </button>
                    <button
                      type="button"
                      disabled={status.targetChanged || status.legacy}
                      onClick={() => onDecision(status.sourceTransactionId, "update_target")}
                      className={`rounded-field border px-3 py-2 text-button disabled:cursor-not-allowed disabled:opacity-40 ${chosen === "update_target" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      用来源更新目标
                    </button>
                    {status.targetChanged ? (
                      <span className="self-center text-helper text-warning-dark">目标已变化，禁止直接覆盖</span>
                    ) : null}
                    {status.legacy ? (
                      <span className="self-center text-helper text-muted">旧记录身份未确认，禁止直接覆盖</span>
                    ) : null}
                  </div>
                ) : null}
                {status.status === "previously_skipped" ||
                status.status === "previously_skipped_modified" ||
                status.status === "needs_review" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDecision(status.sourceTransactionId, "skip")}
                      className={`rounded-field border px-3 py-2 text-button ${chosen === "skip" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      保持跳过
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecision(status.sourceTransactionId, "import")}
                      className={`rounded-field border px-3 py-2 text-button ${chosen === "import" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      本次导入
                    </button>
                  </div>
                ) : null}
                {status.status === "target_changed" || status.status === "target_deleted" ? (
                  <p className="text-helper-relaxed text-muted">
                    为保护已有数据，本次只保留目标，不覆盖、不恢复、不删除；如果你需要处理，请先在目标账本中手动核对。
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SourceRetentionCard({
  result,
  preview,
  jobId,
  onError,
}: {
  readonly result: LedgerImportResult;
  readonly preview: ImportPreview;
  readonly jobId: string | null;
  readonly onError: (message: string) => void;
}): React.JSX.Element {
  const guestBookId = preview.source.kind === "guest" ? preview.source.bookId : null;
  const [guestPreview, setGuestPreview] = useState<GuestCleanupPreviewResponse | null>(null);
  const [guestConfirmOpen, setGuestConfirmOpen] = useState(false);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestMessage, setGuestMessage] = useState<string | null>(null);
  const [guestArchiveCount, setGuestArchiveCount] = useState(0);
  const [disposition, setDisposition] = useState<FormalSourceDisposition | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archived, setArchived] = useState<string | null>(null);

  async function checkGuestCleanup(): Promise<void> {
    if (guestBookId === null) return;
    setGuestBusy(true);
    setGuestMessage(null);
    try {
      const next = await previewGuestCleanup({
        targetBookId: result.targetBook.id,
        guestBookId,
        receiptId: result.importId,
        source: guestSourceOfSource(preview.source),
      });
      setGuestPreview(next);
      setGuestArchiveCount(guestCleanupTransactions(guestDataValue()).length);
      if (next.cleanableCount === 0) {
        setGuestMessage("没有可安全清理的记录；未迁入记录默认保留。");
      }
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setGuestBusy(false);
    }
  }

  async function cleanupGuest(): Promise<void> {
    if (guestPreview === null || guestPreview.cleanableCount === 0) return;
    setGuestBusy(true);
    setGuestMessage(null);
    try {
      const resultOfCleanup = await cleanupMigratedGuestTransactions(guestPreview.cleanableSourceIds);
      setGuestArchiveCount(guestCleanupTransactions(guestDataValue()).length);
      setGuestMessage(
        `已清理 ${String(resultOfCleanup.removed)} 笔已确认迁入的游客记录；来源仍保留 ${String(resultOfCleanup.remaining)} 笔。清理记录保存在本机，可恢复。`,
      );
      setGuestConfirmOpen(false);
      setGuestPreview(null);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setGuestBusy(false);
    }
  }

  async function restoreGuest(): Promise<void> {
    const archivedTransactions = guestCleanupTransactions(guestDataValue());
    if (archivedTransactions.length === 0) return;
    setGuestBusy(true);
    try {
      const restored = await restoreGuestCleanup(archivedTransactions.map((item) => item.id));
      setGuestArchiveCount(guestCleanupTransactions(guestDataValue()).length);
      setGuestMessage(`已恢复 ${String(restored)} 笔清理记录到游客账本。`);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setGuestBusy(false);
    }
  }

  async function checkFormalDisposition(): Promise<void> {
    if (result.sourceBookId === undefined) return;
    setArchiveBusy(true);
    try {
      const next =
        jobId !== null && jobId === result.importId
          ? await getFormalSourceDisposition(jobId)
          : await getFormalSourceDispositionByReceipt(result.importId);
      setDisposition(next);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function archiveFormalSource(): Promise<void> {
    if (disposition === null) return;
    setArchiveBusy(true);
    try {
      await bookLifecycleAction(disposition.sourceBookId, "archive");
      setArchived("来源账本已通过 S13 生命周期弃置；可在归档恢复页面按恢复期限恢复。");
      setArchiveConfirmOpen(false);
      setDisposition(null);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setArchiveBusy(false);
    }
  }

  if (guestBookId === null && result.sourceBookId === undefined) return <></>;

  return (
    <section data-testid="source-retention" className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-4">
      <div>
        <p className="text-body font-medium text-ink">来源安全与清理</p>
        <p className="mt-1 text-helper-relaxed text-muted">
          导入成功不等于可以自动清理来源。这里的所有操作都是独立、手动、默认保留；未迁移记录不会被清理或弃置。
        </p>
      </div>
      {guestBookId === null ? null : (
        <div className="rounded-field border border-line bg-canvas px-4 py-3">
          <p className="text-body text-ink">游客来源账本仍在本机</p>
          <p className="mt-1 text-helper-relaxed text-muted">
            导入不会自动删除游客数据。可以检查哪些记录已确认迁入目标；未迁移、已跳过、已变化或目标校验不通过的记录会保留。
          </p>
          {guestMessage === null ? null : <p className="mt-2 text-helper-relaxed text-warning-dark">{guestMessage}</p>}
          {guestPreview === null ? null : (
            <p className="mt-2 text-helper-relaxed text-muted">
              可清理 {String(guestPreview.cleanableCount)} 笔，保留 {String(guestPreview.retainedCount)} 笔（总来源{" "}
              {String(guestPreview.sourceCount)} 笔）。
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkGuestCleanup()}
              disabled={guestBusy}
              className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
            >
              {guestBusy ? "正在检查…" : "检查可清理的游客记录"}
            </button>
            {guestPreview !== null && guestPreview.cleanableCount > 0 ? (
              <button
                type="button"
                onClick={() => setGuestConfirmOpen(true)}
                disabled={guestBusy}
                className="rounded-field bg-brand px-3 py-2 text-button text-white disabled:opacity-50"
              >
                清理这 {String(guestPreview.cleanableCount)} 笔
              </button>
            ) : null}
            {guestArchiveCount === 0 ? null : (
              <button
                type="button"
                onClick={() => void restoreGuest()}
                disabled={guestBusy}
                className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
              >
                恢复本机清理记录（{String(guestArchiveCount)}）
              </button>
            )}
          </div>
        </div>
      )}

      {result.sourceBookId === undefined ? null : (
        <div className="rounded-field border border-line bg-canvas px-4 py-3">
          <p className="text-body text-ink">正式来源账本默认完整保留</p>
          <p className="mt-1 text-helper-relaxed text-muted">
            只有在导入完成后，你才可以选择是否弃置来源 B。弃置使用 S13 现有归档/恢复/墓碑流程，不会直接删除数据。
          </p>
          {archived === null ? null : <p className="mt-2 text-helper-relaxed text-brand-dark">{archived}</p>}
          {disposition === null ? null : (
            <div className="mt-2 text-helper-relaxed text-muted">
              <p>
                来源 {disposition.sourceBookName}：已确认在目标中的账目 {String(disposition.migratedCount)} 笔，
                未确认迁入 {String(disposition.unmigratedCount)} 笔（总来源 {String(disposition.sourceCount)} 笔）。
              </p>
              <p className="mt-1">{disposition.reason}</p>
              {disposition.archivedAt === null ? null : (
                <p className="mt-1">已归档；自动恢复截止：{disposition.selfRestoreUntil ?? "无"}；计划永久删除：{disposition.scheduledPurgeAt ?? "无"}。</p>
              )}
              {disposition.unmigratedCount > 0 ? (
                <p className="mt-1 text-warning-dark">
                  仍有未确认迁入的来源账目。弃置不会删除它们，但弃置后需要走恢复流程才能查看来源。
                </p>
              ) : null}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkFormalDisposition()}
              disabled={archiveBusy}
              className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
            >
              {archiveBusy ? "正在检查…" : "检查来源账本处置"}
            </button>
            {disposition !== null && disposition.canArchive && archived === null ? (
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(true)}
                disabled={archiveBusy}
                className="rounded-field border border-danger/40 px-3 py-2 text-button text-danger-dark disabled:opacity-50"
              >
                弃置来源账本（不删除数据）
              </button>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={guestConfirmOpen}
        title="清理已迁入的游客记录？"
        description="只清理服务端确认已安全迁入目标的记录；不会清空 IndexedDB，也不会删除未迁移记录。"
        consequences={[
          "本机游客账本中已确认迁入的指定记录会移入本机清理记录，可恢复",
          "未迁移、已跳过、已变化或目标校验不通过的记录会保留",
          "其他游客账本、离线队列、分类/设置不会被清空",
          "重复点击是幂等的；已经清理的记录不会再次处理",
        ]}
        confirmLabel="确认清理已迁入记录"
        busy={guestBusy}
        onCancel={() => {
          if (!guestBusy) setGuestConfirmOpen(false);
        }}
        onConfirm={() => void cleanupGuest()}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        title={
          (disposition?.unmigratedCount ?? 0) > 0
            ? "仍有未确认迁入的来源账目，仍要弃置来源？"
            : "弃置来源账本？"
        }
        description="弃置走 S13 生命周期，不是直接删除数据库记录。"
        consequences={[
          (disposition?.unmigratedCount ?? 0) > 0
            ? `来源中仍有 ${String(disposition?.unmigratedCount ?? 0)} 笔账目没有确认迁入目标；弃置不会删除它们，但之后需要恢复来源才能查看`
            : "来源账本中的账目都能在目标账本中找到",
          "弃置后来源账本仍保留服务端数据，可在 S13 恢复期限内恢复",
          "不会执行永久删除，也不会删除备份",
          "超过恢复期限后，来源会按 S13 生命周期进入计划永久删除；届时不再可恢复",
        ]}
        confirmLabel={(disposition?.unmigratedCount ?? 0) > 0 ? "我确认仍有未迁入记录，弃置来源" : "确认弃置来源"}
        busy={archiveBusy}
        onCancel={() => {
          if (!archiveBusy) setArchiveConfirmOpen(false);
        }}
        onConfirm={() => void archiveFormalSource()}
      />
    </section>
  );
}

function ReviewStep({
  preview,
  groupIndex,
  decisions,
  onPreset,
  onSource,
  onTarget,
  onPrevious,
  onNext,
  onBack,
  onConfirm,
  canConfirm,
  needsReviewGroupIds,
}: {
  readonly preview: ImportPreview;
  readonly groupIndex: number;
  readonly decisions: GroupDecisionMap;
  readonly onPreset: (groupId: string, action: GroupPresetAction) => void;
  readonly onSource: (groupId: string, sourceId: string, handling: SourceHandling) => void;
  readonly onTarget: (groupId: string, targetId: string, handling: TargetHandling) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly canConfirm: boolean;
  readonly needsReviewGroupIds: readonly string[];
}): React.JSX.Element {
  const groups = preview.duplicateGroups;
  const group = groups[groupIndex];
  if (group === undefined) {
    return (
      <section className="flex flex-col gap-3">
        <p className="text-body-relaxed text-muted">没有需要核对的重复组。</p>
        <Button onClick={onConfirm} disabled={!canConfirm}>
          继续确认
        </Button>
        <Button variant="secondary" onClick={onBack}>
          返回预览
        </Button>
      </section>
    );
  }

  const sourceRecords = group.records.filter((record) => record.side === "source");
  const targetRecords = group.records.filter((record) => record.side === "target");
  const decision = decisions.get(group.id);
  const skipped = sourceRecords.filter((record) => sourceHandling(decision, record.transaction.id) === "skip").length;
  const removed = targetRecords.filter((record) => targetHandling(decision, record.transaction.id) === "remove").length;
  const resolved = decisions.has(group.id);
  const needsReview = needsReviewGroupIds.includes(group.id);

  return (
    <section data-testid="import-review" className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">可能重复的账目</h2>
          <p className="mt-1 text-helper-relaxed text-muted">
            来源 {String(group.sourceCount)} 条 · 目标 {String(group.targetCount)} 条
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="上一组"
            onClick={onPrevious}
            disabled={groupIndex === 0}
            className="flex size-8 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            ‹
          </button>
          <span className="min-w-9 text-center text-helper text-muted">
            {groupIndex + 1} / {groups.length}
          </span>
          <button
            type="button"
            aria-label="下一组"
            onClick={onNext}
            disabled={groupIndex === groups.length - 1}
            className="flex size-8 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {needsReview ? (
        <p className="rounded-field border border-danger/30 bg-danger/5 px-3 py-2 text-helper text-danger-dark">
          这一组在重新预览后发生了变化，需要重新核对。
        </p>
      ) : null}

      {isOneToOne(group) ? null : (
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <p className="text-body font-medium text-ink">快捷建议</p>
          <p className="mt-1 text-helper-relaxed text-muted">
            这里只填充下面的逐条选择，不会直接删除任何记录；请核对每一笔 A 的去留。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                ["keep_a", "保留 A", "B 全跳过，A 全保留"],
                ["keep_b", "保留 B", "B 全导入，A 全移除"],
                ["keep_both", "两边都保留", "B 全导入，A 全保留"],
                ["keep_neither", "两边都不保留", "B 全跳过，A 全移除"],
              ] as const
            ).map(([action, label, hint]) => (
              <button
                key={action}
                type="button"
                onClick={() => onPreset(group.id, action)}
                className={`rounded-field border px-3 py-2 text-left text-helper transition ${
                  decision?.action === action
                    ? "border-brand bg-brand-soft text-brand-dark"
                    : "border-line bg-canvas text-muted hover:border-brand/40"
                }`}
              >
                <span className="block font-medium text-ink">{label}</span>
                <span className="mt-0.5 block">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-body font-medium text-ink">
          来源 B
          <span className="ml-2 text-helper font-normal text-muted">导入 / 跳过</span>
        </p>
        <ul className="mt-1 divide-y divide-line">
          {sourceRecords.map((record) => {
            const handling = sourceHandling(decision, record.transaction.id);
            return (
              <li key={record.transaction.id} className="py-3">
                <RecordFacts record={record} />
                <SegmentedChoice
                  label={`来源记录处理：${record.transaction.note ?? record.categoryLabel}`}
                  value={handling}
                  options={[
                    { value: "import", label: "导入" },
                    { value: "skip", label: "跳过" },
                  ]}
                  onChange={(next) => onSource(group.id, record.transaction.id, next as SourceHandling)}
                />
              </li>
            );
          })}
        </ul>

        <div className="my-4 h-px bg-line" />

        <p className="text-body font-medium text-ink">
          目标 A
          <span className="ml-2 text-helper font-normal text-muted">保留 / 移除（软删除）</span>
        </p>
        <ul className="mt-1 divide-y divide-line">
          {targetRecords.map((record) => {
            const handling = targetHandling(decision, record.transaction.id);
            return (
              <li
                key={record.transaction.id}
                className={`py-3 ${handling === "remove" ? "rounded-field bg-danger/5 px-3" : ""}`}
              >
                <RecordFacts record={record} />
                <SegmentedChoice
                  label={`目标记录处理：${record.transaction.note ?? record.categoryLabel}`}
                  value={handling}
                  options={[
                    { value: "keep", label: "保留" },
                    { value: "remove", label: "移除（软删除）", tone: "danger" },
                  ]}
                  onChange={(next) => onTarget(group.id, record.transaction.id, next as TargetHandling)}
                />
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-helper-relaxed text-muted">
          {resolved ? decisionSummary(sourceRecords.length - skipped, skipped, targetRecords.length - removed, removed, group) : "请为每笔来源和目标记录选择处理方式，之后才能继续。"}
        </p>
      </div>

      {removed > 0 ? (
        <p className="text-helper-relaxed text-muted">
          最终确认时会再次列出这 {String(removed)} 笔将被软删除的 A 记录，并要求明确确认。
        </p>
      ) : null}

      <div className="border-t border-line pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPrevious}
            disabled={groupIndex === 0}
            className="flex-1 rounded-field border border-line bg-surface px-4 py-3 text-button-lg font-medium text-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一组
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={groupIndex === groups.length - 1}
            className="flex-1 rounded-field border border-line bg-surface px-4 py-3 text-button-lg font-medium text-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一组
          </button>
        </div>
        <div className="mt-2">
          <Button onClick={onConfirm} disabled={!canConfirm}>
            {canConfirm ? "继续确认" : `还有 ${String(groups.filter((item) => !decisions.has(item.id)).length)} 组未决定`}
          </Button>
        </div>
        <div className="mt-2">
          <Button variant="secondary" onClick={onBack}>
            返回预览
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * 一对一的两笔记录也使用同样的逐条控件：
 * 「导入 / 跳过」×「保留 / 移除」自然构成四种组合，不再渲染四张重复统计的大卡片。
 */
function decisionSummary(
  imported: number,
  skipped: number,
  kept: number,
  removed: number,
  group: ImportPreview["duplicateGroups"][number],
): string {
  if (imported === group.sourceCount && skipped === 0 && removed === 0) {
    return "将导入全部来源记录，目标记录全部保留。";
  }
  if (imported === 0 && kept === 0 && removed === group.targetCount) {
    return "将跳过全部来源记录，并移除全部目标记录。";
  }
  if (imported === 0 && skipped === group.sourceCount && removed === 0) {
    return "将跳过全部来源记录，目标记录全部保留。";
  }
  return `将导入 ${String(imported)} 笔来源记录、跳过 ${String(skipped)} 笔；目标 A 保留 ${String(kept)} 笔、软删除 ${String(removed)} 笔。`;
}

function SegmentedChoice({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly tone?: "danger" }[];
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="mt-2 grid grid-cols-2 gap-1 rounded-field bg-canvas p-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-field px-3 py-2 text-helper font-medium transition ${
              selected
                ? option.tone === "danger"
                  ? "bg-danger/10 text-danger-dark"
                  : "bg-brand-soft text-brand-dark"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RecordFacts({ record }: { readonly record: DuplicateRecord }): React.JSX.Element {
  const transaction = record.transaction;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold tabular-nums text-ink">
          {formatMoney(transaction.amountCents, transaction.currency)}
        </span>
        <span className="shrink-0 text-helper text-muted">
          {transaction.occurredLocalDate} · {formatTimeWithZone(transaction.occurredAt, transaction.occurredTz)}
        </span>
      </div>
      <p className="mt-1 text-helper text-ink">
        {record.categoryLabel}
        {transaction.paymentMethodName === null ? "" : ` · ${transaction.paymentMethodName}`}
      </p>
      {transaction.note === null || transaction.note === "" ? null : (
        <p className="mt-0.5 text-helper text-muted">{transaction.note}</p>
      )}
    </div>
  );
}

function ConfirmStep({
  preview,
  targetIsNew,
  decisions,
  canConfirm,
  submitState,
  result,
  onStart,
  onRetry,
  onBack,
  onFinish,
  onOpenTarget,
}: {
  readonly preview: ImportPreview;
  readonly targetIsNew: boolean;
  readonly decisions: GroupDecisionMap;
  readonly canConfirm: boolean;
  readonly submitState: SubmitState;
  readonly result: LedgerImportResult | null;
  readonly onStart: () => void;
  readonly onRetry: () => void;
  readonly onBack: () => void;
  readonly onFinish: () => void;
  readonly onOpenTarget: (bookId: string) => void;
}): React.JSX.Element {
  const skipped = skippedSourceIds(preview, decisions);
  const removals = removedTargets(preview, decisions);
  const importedTransactions = preview.source.transactions.filter((item) => !skipped.has(item.id));
  const totals = totalsOf(importedTransactions);
  const categories = preview.mapping.categories;
  const payments = preview.mapping.paymentMethods;
  const tags = preview.mapping.tags;
  const reuse = [...categories, ...payments, ...tags].filter((item) => item.targetId !== null).length;
  const create = [...categories, ...payments, ...tags].filter((item) => item.targetId === null).length;

  if (submitState === "success" && result !== null) {
    return (
      <section data-testid="import-result" className="flex flex-col gap-5">
        <div className="rounded-card border border-line bg-surface px-5 py-5">
          <p className="text-helper text-muted">导入完成</p>
          <h2 className="mt-1 text-page-title text-ink">已导入 {String(result.importedCount)} 笔</h2>
          {result.updatedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              并按你的明确选择更新了 {String(result.updatedCount)} 笔已有目标账目。
            </p>
          ) : null}
          <p className="mt-2 text-body-relaxed text-muted">
            到「{result.targetBook.name}」{result.targetBook.bookNumber === null ? "" : ` · 编号 ${result.targetBook.bookNumber}`}
            {result.targetBook.created ? "（这次新建的账本）" : ""}
          </p>
          {result.skippedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">按你的核对选择，跳过了 {String(result.skippedCount)} 笔来源记录。</p>
          ) : null}
          {result.removedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              按你的核对选择，软删除了 {String(result.removedCount)} 笔目标账目；它们可在原账目的历史/恢复入口恢复。
            </p>
          ) : null}
        </div>

        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <h2 className="section-title">对账</h2>
          <ul className="mt-3 flex flex-col gap-2 text-body">
            <li className="flex justify-between gap-3">
              <span className="text-muted">来源记录</span>
              <span className="text-ink">{String(result.sourceCount)} 笔</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted">实际导入</span>
              <span className="text-ink">{String(result.importedCount)} 笔</span>
            </li>
            {result.updatedCount > 0 ? (
              <li className="flex justify-between gap-3">
                <span className="text-muted">更新已有</span>
                <span className="text-ink">{String(result.updatedCount)} 笔</span>
              </li>
            ) : null}
            <li className="flex justify-between gap-3">
              <span className="text-muted">跳过</span>
              <span className="text-ink">{String(result.skippedCount)} 笔</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted">软删除 A</span>
              <span className="text-ink">{String(result.removedCount)} 笔</span>
            </li>
            <li className="flex justify-between gap-3">
              <span className="text-muted">目标账目</span>
              <span className="text-ink">
                {String(result.targetExistingBefore)} → {String(result.targetCountAfter)} 笔
              </span>
            </li>
          </ul>
          {totals.length === 0 ? null : (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-helper text-muted">按币种核对（不会跨币种相加）</p>
              {result.totals.map((total) => (
                <p key={total.currency} className="mt-1 text-body text-ink">
                  {total.currency}：支出 {formatMoney(total.expenseCents, total.currency)} · 收入{" "}
                  {formatMoney(total.incomeCents, total.currency)}
                </p>
              ))}
            </div>
          )}
          <p className="mt-3 text-helper-relaxed text-muted">
            服务器已按实际写入结果核对；来源账本数据仍然保留，不会自动删除。
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={() => onOpenTarget(result.targetBook.id)}>打开目标账本</Button>
          <Button variant="secondary" onClick={onFinish}>
            完成
          </Button>
        </div>
      </section>
    );
  }

  if (submitState === "submitting") {
    return (
      <section className="flex flex-col gap-5">
        <div className="rounded-card border border-line bg-surface px-5 py-6 text-center">
          <div className="mx-auto size-9 animate-spin rounded-full border-2 border-brand-soft border-t-brand" aria-hidden="true" />
          <h2 className="mt-4 text-page-title text-ink">正在导入</h2>
          <p className="mt-2 text-body-relaxed text-muted">
            正在检查目标权限、写入 {String(importedTransactions.length)} 笔账目并对账。请不要关闭页面。
          </p>
          <p className="mt-2 text-helper text-muted">同一任务只会执行一次；网络中断后可用“继续检查结果”确认。</p>
        </div>
      </section>
    );
  }

  if (submitState === "paused" || submitState === "error") {
    return (
      <section className="flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <p className="text-helper text-muted">{submitState === "paused" ? "导入已暂停" : "导入没有完成"}</p>
          <h2 className="mt-1 text-section-title text-ink">
            {submitState === "paused" ? "可以安全重试" : "需要重新核对"}
          </h2>
          <p className="mt-2 text-body-relaxed text-muted">
            {submitState === "paused"
              ? "服务器可能已经完成，也可能还没有执行。重新检查同一个任务编号不会创建第二份账目。"
              : "本轮没有写入任何目标账目。请返回预览重新确认后再开始。"}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {submitState === "paused" ? <Button onClick={onRetry}>继续检查结果</Button> : null}
          <Button variant="secondary" onClick={onBack}>
            返回核对
          </Button>
        </div>
      </section>
    );
  }

  const targetLabel = preview.target.identity.name;
  return (
    <section data-testid="import-confirm" className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-helper text-muted">最终确认</p>
        <h2 className="mt-1 text-section-title text-ink">
          {targetIsNew ? "创建新账本并导入" : `导入到「${targetLabel}」`}
        </h2>
        <p className="mt-2 text-body-relaxed text-muted">
          来源：{preview.source.identity.name} · 目标：{targetLabel}
        </p>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Metric label="将导入" value={`${String(importedTransactions.length)} 笔`} />
          <Metric label="跳过" value={`${String(skipped.size)} 笔`} />
          <Metric label="将软删除" value={`${String(removals.length)} 笔`} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          分类/支付/标签：复用 {String(reuse)} 个 · 新建 {String(create)} 个。同名属性冲突已按你的选择处理。
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="section-title">按币种预览</h2>
        {totals.length === 0 ? (
          <p className="mt-2 text-helper-relaxed text-muted">没有可导入的账目。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {totals.map((total) => (
              <li key={total.currency} className="flex items-baseline justify-between gap-3 text-body">
                <span className="text-muted">{total.currency}</span>
                <span className="text-right text-ink">
                  支出 {formatMoney(total.expenseCents, total.currency)} · 收入 {formatMoney(total.incomeCents, total.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {removals.length === 0 ? (
          <p className="mt-3 text-helper-relaxed text-muted">
            本轮不会删除目标账本 A 的任何已有账目；新账目由服务器分配编号。导入成功后也不会自动删除来源账本的数据。
          </p>
        ) : (
          <details className="mt-3 rounded-field border border-line bg-canvas px-3 py-2">
            <summary className="cursor-pointer text-helper font-medium text-ink">
              将软删除 A 的 {String(removals.length)} 笔记录（展开核对）
            </summary>
            <ul className="mt-2 max-h-48 divide-y divide-line overflow-auto">
              {removals.map((item) => (
                <li key={item.transactionId} className="flex justify-between gap-3 py-2 text-helper">
                  <span className="min-w-0 truncate">
                    {item.occurredLocalDate} · {item.categoryLabel}
                    {item.note === null ? "" : ` · ${item.note}`}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoney(item.amountCents, item.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-helper-relaxed text-muted">
              只会软删除上面这些记录；它们会进入现有删除/恢复入口，不会变成永久删除。来源账本数据不受影响。
            </p>
          </details>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={onStart} disabled={!canConfirm}>
          {removals.length > 0 ? "确认删除并导入" : "开始导入"}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          返回核对
        </Button>
      </div>
    </section>
  );
}
