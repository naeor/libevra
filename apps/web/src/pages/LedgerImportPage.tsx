import { useEffect, useMemo, useRef, useState } from "react";
import { Trans } from "react-i18next";
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
import { i18n, isChineseLocale, t, useI18n } from "../i18n/index.js";
import type zhLedgerImport from "../i18n/resources/zh-CN/ledgerImport.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { apiFetch, ApiRequestError, errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { formatInstant, formatTimeWithZone } from "../lib/datetime.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
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

/** 顺序即步骤条顺序；显示名在 `ledgerImport.steps.*`，渲染时按当前语言取。 */
const STEP_ITEMS: readonly { readonly id: Step }[] = [
  { id: "select" },
  { id: "preview" },
  { id: "review" },
  { id: "confirm" },
];

/** 服务器任务表里有专门译文的错误码（见 `ledgerImport.jobError.*`）。 */
type JobErrorCode = Exclude<keyof typeof zhLedgerImport.jobError, "generic">;

function isJobErrorCode(code: string): code is JobErrorCode {
  return code !== "" && code !== "generic" && i18n.exists(`ledgerImport.jobError.${code}`);
}

/**
 * 任务表里服务器写下的失败说明（`lastErrorMessage`）在当前语言下怎么显示。
 *
 * 中文界面：与以前一样显示服务器原文。其它语言：先按 `lastErrorCode` 查本模块的译文，再查
 * `errors.api.<code>`，再查 shared 原文对照表；都没有就给一句通用说明——不把中文原文塞进英文界面。
 */
function jobErrorText(job: Pick<ImportJobStatus, "lastErrorCode" | "lastErrorMessage">): string | null {
  const message = job.lastErrorMessage;
  if (message === null) return null;
  if (isChineseLocale()) return message;
  const code = job.lastErrorCode ?? "";
  if (isJobErrorCode(code)) return t(`ledgerImport.jobError.${code}`);
  const apiKey = `errors.api.${code}`;
  if (code !== "" && i18n.exists(apiKey)) return t(apiKey as "errors.api.validation_failed");
  const shared = translateSharedMessage(message);
  if (shared !== message) return shared;
  return t("ledgerImport.jobError.generic");
}

/**
 * 正式来源的处置说明。中文界面显示服务器原文；其它语言按服务器给的结构化字段（能否弃置、
 * 未迁入数量）选择译文，与服务器生成原文的条件完全相同（`apps/api/src/ledger/importCleanup.ts`）。
 */
function dispositionReason(disposition: FormalSourceDisposition): string {
  if (isChineseLocale()) return disposition.reason;
  if (!disposition.canArchive) return t("ledgerImport.retention.reason.blocked");
  return disposition.unmigratedCount === 0
    ? t("ledgerImport.retention.reason.allMigrated")
    : t("ledgerImport.retention.reason.someUnmigrated");
}

/** 一个时刻（ISO）按当前语言显示；没有值时显示「无」。 */
function instantOrNone(value: string | null): string {
  return value === null ? t("ledgerImport.retention.formal.none") : formatInstant(value);
}

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
  const { t, locale } = useI18n();
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
          setSubmitError(t("ledgerImport.message.undone"));
          return;
        } else if (next.status === "undo_failed") {
          setSubmitState("error");
          setSubmitError(jobErrorText(next) ?? t("ledgerImport.message.undoFailed"));
          return;
        } else if (next.status === "paused") {
          setSubmitState("paused");
          setSubmitError(jobErrorText(next));
        } else if (next.status === "failed" || next.status === "cancelled" || next.status === "expired") {
          setSubmitState("error");
          setSubmitError(jobErrorText(next));
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
  const accountLabel =
    user === null
      ? t("ledgerImport.select.accountFallback")
      : user.displayName.trim() === ""
        ? user.username
        : user.displayName;
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
  // ⚠️ 预览里的冲突说明与提示文字在生成时按当前语言取（`lib/ledgerImport/mapping.ts`、`preview.ts`），
  // 所以 `locale` 必须在依赖里：切换语言后重新生成。组 id 由成员 id 决定，已做的决定不受影响。
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
  }, [snapshots, resolutions, incremental, duplicateSettings.settings, suppressedPairKeys, locale]);

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
          if (source === null) throw new Error(t("ledgerImport.message.noGuest"));
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
          setSubmitError(t("ledgerImport.message.resultMismatch"));
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
        throw new Error(t("ledgerImport.message.incrementalUnavailable"));
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
      setSubmitError(t("ledgerImport.message.otherAccount"));
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
      setSubmitError(t("ledgerImport.message.waitExtended"));
    } catch (caught) {
      setSubmitError(errorMessage(caught));
    } finally {
      setJobBusy(false);
    }
  }

  const jobActive = job !== null && submitState !== "success";

  const subtitle =
    step === "select"
      ? t("ledgerImport.subtitle.select")
      : step === "preview"
        ? t("ledgerImport.subtitle.preview")
        : step === "review"
          ? t("ledgerImport.subtitle.review")
          : jobActive
            ? t("ledgerImport.subtitle.jobActive")
            : t("ledgerImport.subtitle.confirm");

  return (
    <InnerPage
      title={t("ledgerImport.title")}
      subtitle={subtitle}
      backTo={backTo}
      onBack={onBack}
      actions={
        <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
          {submitState === "success"
            ? t("ledgerImport.badge.done")
            : sourceIsGuest
              ? t("ledgerImport.badge.guest")
              : sourceIsFormal
                ? t("ledgerImport.badge.formal")
                : t("ledgerImport.badge.choose")}
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
      {recovery === null || recovery.messageId === null ? null : (
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
              setLoadError(t("ledgerImport.message.chooseSource"));
              return;
            }
            if (sourceIsGuest && !guestAvailable) {
              setLoadError(t("ledgerImport.message.noGuest"));
              return;
            }
            if (sourceIsFormal && (targetId === "" || targetIsNew || targetId === sourceKey)) {
              setLoadError(t("ledgerImport.message.formalNeedsTarget"));
              return;
            }
            if (targetId === "") {
              setLoadError(t("ledgerImport.message.chooseTarget"));
              return;
            }
            if (targetIsNew && currentNewName.trim() === "") {
              setLoadError(t("ledgerImport.message.newNameRequired"));
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
        title={t("ledgerImport.removalDialog.title")}
        description={
          preview === null
            ? t("ledgerImport.removalDialog.descriptionFallback")
            : t("ledgerImport.removalDialog.description", {
                removed: t("ledgerImport.count.targetEntries", { count: removedTargets(preview, decisions).length }),
                imported: t("ledgerImport.count.sourceEntries", { count: importedSourceCount(preview, decisions) }),
              })
        }
        consequences={[
          t("ledgerImport.removalDialog.consequence.onlyMarked"),
          t("ledgerImport.removalDialog.consequence.restorable"),
          t("ledgerImport.removalDialog.consequence.sourceKept"),
          t("ledgerImport.removalDialog.consequence.atomic"),
        ]}
        confirmLabel={t("ledgerImport.removalDialog.confirm")}
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
                  {item.occurredLocalDate} · {displayCategoryName(item.categoryLabel)}
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
        title={t("ledgerImport.undoDialog.title")}
        description={t("ledgerImport.undoDialog.description")}
        consequences={[
          t("ledgerImport.undoDialog.consequence.targetReverted"),
          t("ledgerImport.undoDialog.consequence.stateReverted"),
          t("ledgerImport.undoDialog.consequence.othersKept"),
          t("ledgerImport.undoDialog.consequence.failureLocked"),
          t("ledgerImport.undoDialog.consequence.editAfter"),
        ]}
        confirmLabel={t("ledgerImport.undoDialog.confirm")}
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
          {t("ledgerImport.undoDialog.progress", {
            batches: t("ledgerImport.count.batches", { count: job?.nextBatch ?? 0 }),
            added: t("ledgerImport.count.entries", { count: job?.importedCount ?? 0 }),
            updated: t("ledgerImport.count.entries", { count: job?.updatedCount ?? 0 }),
          })}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmConfirmOpen}
        title={t("ledgerImport.finishDialog.title")}
        description={t("ledgerImport.finishDialog.description")}
        consequences={[
          t("ledgerImport.finishDialog.consequence.serverChecks"),
          t("ledgerImport.finishDialog.consequence.removalsApplied"),
          t("ledgerImport.finishDialog.consequence.unlocks"),
          t("ledgerImport.finishDialog.consequence.cleanupAfter"),
          t("ledgerImport.finishDialog.consequence.failureWaits"),
        ]}
        confirmLabel={t("ledgerImport.finishDialog.confirm")}
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

export function StepRail({ step }: { readonly step: Step }): React.JSX.Element {
  const { t } = useI18n();
  const activeIndex = STEP_ITEMS.findIndex((item) => item.id === step);
  // ⚠️ S16：英文四个步骤名约 340px，比 320/375 宽屏的内容区宽；允许换行（中文一行放得下，外观不变）。
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-helper" aria-label={t("ledgerImport.steps.aria")}>
      {STEP_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true" className="h-px w-2 shrink-0 bg-line" /> : null}
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-medium ${
                active ? "bg-brand text-on-brand" : done ? "bg-brand-soft text-brand-dark" : "bg-canvas text-muted"
              }`}
            >
              {index + 1}
            </span>
            <span className={active ? "text-ink" : "text-muted"}>{t(`ledgerImport.steps.${item.id}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function BatchJobPanel({
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
  const { t } = useI18n();
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
          <div className="min-w-0">
            <p className="text-helper text-muted">{t("ledgerImport.job.title")}</p>
            <p className="mt-1 text-body font-medium text-ink">{t(`ledgerImport.job.status.${job.status}`)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-helper text-brand-dark">
            {t("ledgerImport.job.batchBadge", {
              done: job.nextBatch,
              batches: t("ledgerImport.count.batches", { count: job.totalBatches }),
            })}
          </span>
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          {t("ledgerImport.job.progress", {
            done: job.nextBatch,
            batches: t("ledgerImport.count.batches", { count: job.totalBatches }),
            added: t("ledgerImport.count.entries", { count: job.importedCount }),
            updated: t("ledgerImport.count.entries", { count: job.updatedCount }),
            skipped: t("ledgerImport.count.entries", { count: job.skippedCount }),
            total: t("ledgerImport.count.entries", { count: job.sourceCount }),
          })}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${String(percent)}%` }} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.job.lockNote")}</p>
        {job.status === "awaiting_confirmation" ? (
          <p
            className={`mt-2 text-helper-relaxed ${remainingSeconds !== null && remainingSeconds <= 60 ? "text-warning-dark" : "text-muted"}`}
          >
            {remainingSeconds === null
              ? t("ledgerImport.job.waiting")
              : t("ledgerImport.job.countdown", {
                  minutes: Math.floor(remainingSeconds / 60),
                  seconds: remainingSeconds % 60,
                })}
          </p>
        ) : null}
        {job.status === "paused" && remainingSeconds !== null ? (
          <p className="mt-2 text-helper-relaxed text-warning-dark">
            {t("ledgerImport.job.pausedCountdown", { count: remainingSeconds })}
          </p>
        ) : null}
        {job.nextBatch > 0 && (job.status === "paused" || job.status === "failed") ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            {t("ledgerImport.job.undoableBatches", { count: job.nextBatch })}
          </p>
        ) : null}
        {job.status === "undo_failed" ? (
          <p className="mt-2 text-helper-relaxed text-warning-dark">{t("ledgerImport.job.undoFailed")}</p>
        ) : null}
        {job.status === "undone" ? (
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.job.undone")}</p>
        ) : null}
        {job.lastErrorMessage === null ? null : <Alert>{jobErrorText(job)}</Alert>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-field border border-line px-3 py-2 text-button text-muted"
          >
            {t("ledgerImport.job.action.refresh")}
          </button>
          {waiting ? (
            <button
              type="button"
              onClick={onKeepWaiting}
              disabled={busy}
              className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
            >
              {t("ledgerImport.job.action.keepWaiting")}
            </button>
          ) : null}
          {canResume ? (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              className="rounded-field bg-brand px-3 py-2 text-button text-on-brand disabled:opacity-50"
            >
              {busy ? t("ledgerImport.job.action.resuming") : t("ledgerImport.job.action.resume")}
            </button>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-field bg-brand px-3 py-2 text-button text-on-brand disabled:opacity-50"
            >
              {t("ledgerImport.job.action.finish")}
            </button>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              className="rounded-field border border-danger/40 px-3 py-2 text-button text-danger-dark disabled:opacity-50"
            >
              {job.status === "undo_failed" ? t("ledgerImport.job.action.retryUndo") : t("ledgerImport.job.action.undo")}
            </button>
          ) : null}
        </div>
        {job.status === "expired" ? (
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.job.expired")}</p>
        ) : null}
      </div>
    </section>
  );
}

export function PendingTaskBanner({
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
  const { t } = useI18n();
  const task = tasks[0]!;
  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-body font-medium text-ink">{t("ledgerImport.pending.title")}</p>
      <p className="mt-1 text-helper-relaxed text-muted [overflow-wrap:anywhere]">
        {t("ledgerImport.pending.body", { source: task.sourceLabel, target: task.targetLabel })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onResume(task)}
          disabled={busy}
          className="rounded-field bg-brand px-3 py-2 text-button text-on-brand disabled:opacity-50"
        >
          {busy ? t("ledgerImport.checking") : t("ledgerImport.pending.resume")}
        </button>
        <button
          type="button"
          onClick={() => onDrop(task.request.importId)}
          className="rounded-field border border-line px-3 py-2 text-button text-muted"
        >
          {t("ledgerImport.pending.drop")}
        </button>
      </div>
      <p className="mt-2 text-helper text-muted">{t("ledgerImport.pending.dropNote")}</p>
    </section>
  );
}

export function DraftRecoveryNotice({ summary }: { readonly summary: DraftRecoverySummary }): React.JSX.Element {
  const { t } = useI18n();
  // 每个分句自带前导标点（中文「，」「；」/ 英文「; 」），按出现与否依次拼接，句末再加句号。
  const details = [
    t("ledgerImport.recovery.restoredGroups", { count: summary.restoredGroups }),
    summary.resetGroups > 0 ? t("ledgerImport.recovery.resetGroups", { count: summary.resetGroups }) : "",
    summary.restoredConflicts > 0
      ? t("ledgerImport.recovery.restoredConflicts", { count: summary.restoredConflicts })
      : "",
    summary.resetConflicts > 0 ? t("ledgerImport.recovery.resetConflicts", { count: summary.resetConflicts }) : "",
    t("ledgerImport.recovery.end"),
  ].join("");
  return (
    <section className="rounded-card border border-brand/30 bg-brand-soft px-4 py-3">
      <p className="text-body font-medium text-brand-dark">
        {summary.messageId === null ? null : t(`ledgerImport.recovery.message.${summary.messageId}`)}
      </p>
      <p className="mt-1 text-helper-relaxed text-brand-dark/80">{details}</p>
      {summary.needsReviewGroupIds.length === 0 ? null : (
        <p className="mt-1 text-helper text-brand-dark/80">{t("ledgerImport.recovery.highlighted")}</p>
      )}
    </section>
  );
}

export function SelectionStep({
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
  const { t, locale } = useI18n();
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
    { id: "", label: t("ledgerImport.select.sourcePlaceholder") },
    ...(guestAvailable ? [{ id: "guest", label: t("ledgerImport.select.guestOption") }] : []),
    ...sourceBooks.map((book) => ({ id: book.id, label: t("ledgerImport.select.formalOption", { name: book.name }) })),
  ];
  const targetOptions: readonly InlineChoiceOption[] = [
    { id: "", label: t("ledgerImport.select.targetPlaceholder") },
    ...soloBooks.map((book) => ({
      id: book.id,
      label: book.name,
      disabled: book.id === sourceKey,
      ...(book.id === sourceKey ? { hint: t("ledgerImport.select.sameAsSource") } : {}),
    })),
  ];

  return (
    <section className="flex flex-col gap-5">
      {/*
        ⚠️ S16-A: the selection comes first, the rules under it. The paragraph about which ledgers may
        be a source used to sit above both pickers — five lines at 390px — so the first screen was
        mostly explanation and the two choices the step is about started below the fold. The wording
        is unchanged; it is now the step's footnote, next to the button that acts on it.
      */}
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <div className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">{t("ledgerImport.select.sourceLabel")}</span>
          <InlineChoice
            label={t("ledgerImport.select.sourceLabel")}
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
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.select.noSources")}</p>
        )}
        {formalSource ? (
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.select.formalSourceNote")}</p>
        ) : guestAvailable ? (
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.select.guestSourceNote")}</p>
        ) : null}

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-muted">↓</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">{t("ledgerImport.select.targetLabel")}</span>
          <InlineChoice
            label={t("ledgerImport.select.targetLabel")}
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
          <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.select.formalTargetNote")}</p>
        ) : (
          <p className="mt-3 text-helper-relaxed text-muted">
            {/* 中文链接两侧没有空格，靠 mx-1 留白；英文句子本身带空格，不再加外边距。 */}
            <Trans
              i18nKey="ledgerImport.select.createTargetFirst"
              components={{
                link: (
                  <a
                    href="/"
                    className={`${locale === "zh-CN" ? "mx-1 " : ""}text-brand-dark underline-offset-2 hover:underline`}
                  />
                ),
              }}
            />
          </p>
        )}

        {target === null ? null : (
          <p className="mt-3 text-helper-relaxed text-muted [overflow-wrap:anywhere]">
            {target.bookNumber === null
              ? t("ledgerImport.select.importInto", { name: target.name, account: accountLabel })
              : t("ledgerImport.select.importIntoWithNumber", {
                  name: target.name,
                  account: accountLabel,
                  number: target.bookNumber,
                })}
          </p>
        )}
      </div>

      <Button onClick={onContinue} disabled={!canContinue}>
        {t("ledgerImport.select.continue")}
      </Button>

      <p className="text-helper-relaxed text-muted">{t("ledgerImport.select.rules")}</p>
    </section>
  );
}

export function PreviewStep({
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
  const { t } = useI18n();
  const { mapping, counts } = preview;
  const hasReview = counts.duplicateGroups > 0 || needsIncrementalReview;
  return (
    <section data-testid="import-preview" className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-helper text-muted">{t("ledgerImport.preview.direction")}</p>
        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          <span className="text-helper text-muted">{t("ledgerImport.select.sourceLabel")}</span>
          <BookIdentity book={preview.source.identity} />
          <span className="justify-self-center text-muted" aria-hidden="true">
            ↓
          </span>
          <span className="h-px w-full bg-line" aria-hidden="true" />
          <span className="text-helper text-muted">{t("ledgerImport.select.targetLabel")}</span>
          <BookIdentity book={preview.target.identity} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">
          {preview.source.kind === "guest" ? t("ledgerImport.preview.guestNote") : t("ledgerImport.preview.formalNote")}
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="section-title">{t("ledgerImport.preview.whatHappens")}</h2>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Metric
            label={t("ledgerImport.preview.metric.source")}
            value={t("ledgerImport.metricValue.entries", { count: counts.sourceTransactions })}
          />
          <Metric
            label={t("ledgerImport.preview.metric.clean")}
            value={t("ledgerImport.metricValue.entries", { count: counts.importableWithoutConflict })}
          />
          <Metric
            label={t("ledgerImport.preview.metric.groups")}
            value={t("ledgerImport.metricValue.groups", { count: counts.duplicateGroups })}
          />
        </div>
        <div className="mt-4 border-t border-line pt-4">
          {preview.totals.length === 0 ? (
            <p className="text-helper-relaxed text-muted">{t("ledgerImport.preview.noEntries")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {preview.totals.map((total) => (
                <li key={total.currency} className="flex items-baseline justify-between gap-3">
                  <span className="shrink-0 text-helper text-muted">{total.currency}</span>
                  <span className="min-w-0 text-right text-body text-ink">
                    {t("ledgerImport.totals", {
                      expense: formatMoney(total.expenseCents, total.currency),
                      income: formatMoney(total.incomeCents, total.currency),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {counts.targetTransactions > 0 ? (
            <p className="mt-3 text-helper-relaxed text-muted">
              {t("ledgerImport.preview.targetExisting", { count: counts.targetTransactions })}
            </p>
          ) : null}
          {counts.sourceSkippedDeleted > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              {t("ledgerImport.preview.sourceDeleted", { count: counts.sourceSkippedDeleted })}
            </p>
          ) : null}
        </div>
      </div>

      <details className="rounded-card border border-line bg-surface px-5 py-4 [&::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span className="min-w-0 text-body font-medium text-ink">{t("ledgerImport.preview.taxonomyTitle")}</span>
          <span className="shrink-0 text-helper text-muted">
            {conflictCount > 0
              ? t("ledgerImport.preview.pendingConflicts", { count: conflictCount })
              : t("ledgerImport.preview.viewDetails")}{" "}
            ›
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <MappingRow label={t("ledgerImport.preview.mappingLabel.category")} items={mapping.categories} />
          <MappingRow label={t("ledgerImport.preview.mappingLabel.paymentMethod")} items={mapping.paymentMethods} />
          <MappingRow label={t("ledgerImport.preview.mappingLabel.tag")} items={mapping.tags} />
          {mapping.conflicts.length === 0 ? (
            <p className="text-helper-relaxed text-muted">{t("ledgerImport.preview.noConflicts")}</p>
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
          <div className="min-w-0">
            <h2 className="section-title">{t("ledgerImport.preview.duplicatesTitle")}</h2>
            <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.preview.duplicatesNote")}</p>
          </div>
          <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
            {t("ledgerImport.count.groups", { count: counts.duplicateGroups })}
          </span>
        </div>
        {hasReview ? (
          <button
            type="button"
            data-testid="open-review"
            onClick={onReview}
            className="mt-3 flex w-full items-center justify-between gap-3 rounded-field border border-line bg-canvas px-4 py-3 text-left text-body text-ink transition hover:border-brand/40 hover:bg-brand-soft"
          >
            <span className="min-w-0">
              {counts.duplicateGroups > 0
                ? t("ledgerImport.preview.reviewGroups", { count: counts.duplicateGroups })
                : t("ledgerImport.preview.reviewIncremental")}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              ›
            </span>
          </button>
        ) : (
          <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.preview.noDuplicates")}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {conflictCount > 0 ? (
          <p className="text-helper-relaxed text-muted">{t("ledgerImport.preview.resolveConflictsFirst")}</p>
        ) : null}
        {hasReview ? (
          <Button onClick={onReview} disabled={conflictCount > 0}>
            {counts.duplicateGroups > 0
              ? t("ledgerImport.preview.reviewDuplicatesButton")
              : t("ledgerImport.preview.reviewIncrementalButton")}
          </Button>
        ) : (
          <Button onClick={onConfirm} disabled={conflictCount > 0}>
            {t("ledgerImport.preview.continue")}
          </Button>
        )}
        <Button variant="secondary" onClick={onBack}>
          {t("ledgerImport.preview.chooseAgain")}
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
  const { t } = useI18n();
  return (
    <span className="min-w-0 text-right">
      <span className="block truncate text-body font-medium text-ink">{book.name}</span>
      {book.bookNumber === null ? null : (
        <span className="block text-helper text-muted">{t("ledgerImport.bookNumber", { number: book.bookNumber })}</span>
      )}
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
  const { t } = useI18n();
  const reuse = items.filter((item) => item.targetId !== null).length;
  const create = items.filter((item) => item.targetId === null).length;
  return (
    <div className="flex items-baseline justify-between gap-3 text-body">
      <span className="min-w-0 text-muted">{label}</span>
      <span className="shrink-0 text-right text-ink">{t("ledgerImport.preview.mappingRow", { reuse, create })}</span>
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
  const { t } = useI18n();
  const sourceName = taxonomyDisplayName(conflict.type, conflict.sourceName);
  return (
    <li className="rounded-field bg-canvas px-3 py-3 text-sm text-ink">
      <p className="font-medium [overflow-wrap:anywhere]">
        {t("ledgerImport.conflict.title", {
          type: t(`ledgerImport.conflict.type.${conflict.type}`),
          source: sourceName,
          target: taxonomyDisplayName(conflict.type, conflict.targetName),
        })}
      </p>
      <p className="mt-1 text-helper-relaxed text-muted">{conflict.message}</p>
      <div className="mt-2 flex gap-2" role="group" aria-label={t("ledgerImport.conflict.aria", { name: sourceName })}>
        <button
          type="button"
          onClick={() => onChange("reuse")}
          className={`min-w-0 flex-1 rounded-field border px-3 py-2 text-left text-helper transition ${
            value === "reuse" ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
          }`}
        >
          {t("ledgerImport.conflict.reuse")}
        </button>
        <button
          type="button"
          onClick={() => onChange("create")}
          className={`min-w-0 flex-1 rounded-field border px-3 py-2 text-left text-helper transition ${
            value === "create" ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-surface text-muted"
          }`}
        >
          {t("ledgerImport.conflict.create")}
        </button>
      </div>
    </li>
  );
}

/** 冲突对象名只用于显示：预置分类 / 支付方式按当前语言显示，其余原样。 */
function taxonomyDisplayName(type: TaxonomyConflict["type"], name: string): string {
  switch (type) {
    case "category":
      return displayCategoryName(name);
    case "paymentMethod":
      return displayPaymentMethodName(name);
    case "tag":
      return name;
  }
}

export function IncrementalReview({
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
  const { t } = useI18n();
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
  // 分类名只用于显示：预置分类按当前语言显示；找不到时显示「未知分类」。
  const categoryName = (id: string) => {
    const name = source.categories.find((item) => item.id === id)?.name;
    return name === undefined ? t("ledgerImport.incremental.unknownCategory") : displayCategoryName(name);
  };
  const targetCategoryName = (id: string) => {
    const name = target.categories.find((item) => item.id === id)?.name;
    return name === undefined ? t("ledgerImport.incremental.unknownCategory") : displayCategoryName(name);
  };
  const facts = (item: ImportSource["transactions"][number] | ImportTarget["transactions"][number], category: string) =>
    `${formatMoney(item.amountCents, item.currency, { withCode: true })} · ${item.occurredLocalDate} · ${category}${item.note === null ? "" : ` · ${item.note}`}`;
  return (
    <section data-testid="incremental-review" className="flex flex-col gap-4 rounded-card border border-line bg-surface px-5 py-4">
      <div>
        <p className="text-body font-medium text-ink">{t("ledgerImport.incremental.title")}</p>
        <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.incremental.note")}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-helper">
        <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">
          {t("ledgerImport.incremental.chip.unchanged", { number: summary.unchangedCount })}
        </span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand-dark">
          {t("ledgerImport.incremental.chip.new", { number: summary.newCount })}
        </span>
        {summary.modifiedCount > 0 ? (
          <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">
            {t("ledgerImport.incremental.chip.modified", { number: summary.modifiedCount })}
          </span>
        ) : null}
        {summary.targetChangedCount > 0 ? (
          <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">
            {t("ledgerImport.incremental.chip.targetChanged", { number: summary.targetChangedCount })}
          </span>
        ) : null}
        {summary.targetDeletedCount > 0 ? (
          <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">
            {t("ledgerImport.incremental.chip.targetDeleted", { number: summary.targetDeletedCount })}
          </span>
        ) : null}
        {summary.previouslySkippedCount > 0 ? (
          <span className="rounded-full bg-canvas px-2.5 py-1 text-muted">
            {t("ledgerImport.incremental.chip.previouslySkipped", { number: summary.previouslySkippedCount })}
          </span>
        ) : null}
        {summary.needsReviewCount > 0 ? (
          <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning-dark">
            {t("ledgerImport.incremental.chip.needsReview", { number: summary.needsReviewCount })}
          </span>
        ) : null}
      </div>
      {legacyCount > 0 ? (
        <p className="text-helper-relaxed text-muted">{t("ledgerImport.incremental.legacy", { count: legacyCount })}</p>
      ) : null}
      {actionable.length === 0 ? (
        <p className="text-helper-relaxed text-muted">{t("ledgerImport.incremental.noChanges")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {actionable.map((status) => {
            const sourceTransaction = source.transactions.find((item) => item.id === status.sourceTransactionId);
            const targetTransaction = target.transactions.find((item) => item.id === status.targetTransactionId);
            const chosen = decisions.get(status.sourceTransactionId) ?? defaultIncrementalAction(status);
            return (
              <li key={status.sourceTransactionId} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-body font-medium text-ink">{t(`ledgerImport.incremental.status.${status.status}`)}</p>
                  {status.legacy ? (
                    <span className="shrink-0 text-helper text-muted">{t("ledgerImport.incremental.legacyBadge")}</span>
                  ) : null}
                </div>
                {sourceTransaction === undefined ? null : (
                  <p className="text-helper-relaxed text-muted [overflow-wrap:anywhere]">
                    {t("ledgerImport.incremental.sourceFacts", {
                      facts: facts(sourceTransaction, categoryName(sourceTransaction.categoryId)),
                    })}
                  </p>
                )}
                {targetTransaction === undefined ? (
                  <p className="text-helper-relaxed text-muted">{t("ledgerImport.incremental.noTarget")}</p>
                ) : (
                  <p className="text-helper-relaxed text-muted [overflow-wrap:anywhere]">
                    {t("ledgerImport.incremental.targetFacts", {
                      facts: facts(targetTransaction, targetCategoryName(targetTransaction.categoryId)),
                    })}
                  </p>
                )}
                {status.status === "modified" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onDecision(status.sourceTransactionId, "keep_target")}
                      className={`rounded-field border px-3 py-2 text-button ${chosen === "keep_target" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      {t("ledgerImport.incremental.keepTarget")}
                    </button>
                    <button
                      type="button"
                      disabled={status.targetChanged || status.legacy}
                      onClick={() => onDecision(status.sourceTransactionId, "update_target")}
                      className={`rounded-field border px-3 py-2 text-button disabled:cursor-not-allowed disabled:opacity-40 ${chosen === "update_target" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      {t("ledgerImport.incremental.updateTarget")}
                    </button>
                    {status.targetChanged ? (
                      <span className="self-center text-helper text-warning-dark">
                        {t("ledgerImport.incremental.targetChangedLocked")}
                      </span>
                    ) : null}
                    {status.legacy ? (
                      <span className="self-center text-helper text-muted">{t("ledgerImport.incremental.legacyLocked")}</span>
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
                      {t("ledgerImport.incremental.keepSkipped")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecision(status.sourceTransactionId, "import")}
                      className={`rounded-field border px-3 py-2 text-button ${chosen === "import" ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}
                    >
                      {t("ledgerImport.incremental.importNow")}
                    </button>
                  </div>
                ) : null}
                {status.status === "target_changed" || status.status === "target_deleted" ? (
                  <p className="text-helper-relaxed text-muted">{t("ledgerImport.incremental.protectNote")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SourceRetentionCard({
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
  const { t } = useI18n();
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
        setGuestMessage(t("ledgerImport.retention.guest.nothingToClean"));
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
        t("ledgerImport.retention.guest.cleaned", {
          removed: t("ledgerImport.count.guestEntries", { count: resultOfCleanup.removed }),
          remaining: t("ledgerImport.count.entries", { count: resultOfCleanup.remaining }),
        }),
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
      setGuestMessage(t("ledgerImport.retention.guest.restored", { count: restored }));
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
      setArchived(t("ledgerImport.retention.formal.archived"));
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
        <p className="text-body font-medium text-ink">{t("ledgerImport.retention.title")}</p>
        <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.retention.intro")}</p>
      </div>
      {guestBookId === null ? null : (
        <div className="rounded-field border border-line bg-canvas px-4 py-3">
          <p className="text-body text-ink">{t("ledgerImport.retention.guest.title")}</p>
          <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.retention.guest.note")}</p>
          {guestMessage === null ? null : <p className="mt-2 text-helper-relaxed text-warning-dark">{guestMessage}</p>}
          {guestPreview === null ? null : (
            <p className="mt-2 text-helper-relaxed text-muted">
              {t("ledgerImport.retention.guest.preview", {
                cleanable: t("ledgerImport.count.entries", { count: guestPreview.cleanableCount }),
                retained: t("ledgerImport.count.entries", { count: guestPreview.retainedCount }),
                total: t("ledgerImport.count.entries", { count: guestPreview.sourceCount }),
              })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkGuestCleanup()}
              disabled={guestBusy}
              className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
            >
              {guestBusy ? t("ledgerImport.checking") : t("ledgerImport.retention.guest.check")}
            </button>
            {guestPreview !== null && guestPreview.cleanableCount > 0 ? (
              <button
                type="button"
                onClick={() => setGuestConfirmOpen(true)}
                disabled={guestBusy}
                className="rounded-field bg-brand px-3 py-2 text-button text-on-brand disabled:opacity-50"
              >
                {t("ledgerImport.retention.guest.clean", { count: guestPreview.cleanableCount })}
              </button>
            ) : null}
            {guestArchiveCount === 0 ? null : (
              <button
                type="button"
                onClick={() => void restoreGuest()}
                disabled={guestBusy}
                className="rounded-field border border-line px-3 py-2 text-button text-muted disabled:opacity-50"
              >
                {t("ledgerImport.retention.guest.restore", { number: guestArchiveCount })}
              </button>
            )}
          </div>
        </div>
      )}

      {result.sourceBookId === undefined ? null : (
        <div className="rounded-field border border-line bg-canvas px-4 py-3">
          <p className="text-body text-ink">{t("ledgerImport.retention.formal.title")}</p>
          <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.retention.formal.note")}</p>
          {archived === null ? null : <p className="mt-2 text-helper-relaxed text-brand-dark">{archived}</p>}
          {disposition === null ? null : (
            <div className="mt-2 text-helper-relaxed text-muted">
              <p className="[overflow-wrap:anywhere]">
                {t("ledgerImport.retention.formal.counts", {
                  name: disposition.sourceBookName,
                  migrated: t("ledgerImport.count.entries", { count: disposition.migratedCount }),
                  unmigrated: t("ledgerImport.count.entries", { count: disposition.unmigratedCount }),
                  total: t("ledgerImport.count.entries", { count: disposition.sourceCount }),
                })}
              </p>
              <p className="mt-1">{dispositionReason(disposition)}</p>
              {disposition.archivedAt === null ? null : (
                <p className="mt-1">
                  {t("ledgerImport.retention.formal.archivedInfo", {
                    restoreUntil: instantOrNone(disposition.selfRestoreUntil),
                    purgeAt: instantOrNone(disposition.scheduledPurgeAt),
                  })}
                </p>
              )}
              {disposition.unmigratedCount > 0 ? (
                <p className="mt-1 text-warning-dark">{t("ledgerImport.retention.formal.unmigratedWarning")}</p>
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
              {archiveBusy ? t("ledgerImport.checking") : t("ledgerImport.retention.formal.check")}
            </button>
            {disposition !== null && disposition.canArchive && archived === null ? (
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(true)}
                disabled={archiveBusy}
                className="rounded-field border border-danger/40 px-3 py-2 text-button text-danger-dark disabled:opacity-50"
              >
                {t("ledgerImport.retention.formal.archive")}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={guestConfirmOpen}
        title={t("ledgerImport.retention.guestDialog.title")}
        description={t("ledgerImport.retention.guestDialog.description")}
        consequences={[
          t("ledgerImport.retention.guestDialog.consequence.movedToArchive"),
          t("ledgerImport.retention.guestDialog.consequence.othersKept"),
          t("ledgerImport.retention.guestDialog.consequence.nothingWiped"),
          t("ledgerImport.retention.guestDialog.consequence.noRepeat"),
        ]}
        confirmLabel={t("ledgerImport.retention.guestDialog.confirm")}
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
            ? t("ledgerImport.retention.archiveDialog.titleUnmigrated")
            : t("ledgerImport.retention.archiveDialog.title")
        }
        description={t("ledgerImport.retention.archiveDialog.description")}
        consequences={[
          (disposition?.unmigratedCount ?? 0) > 0
            ? t("ledgerImport.retention.archiveDialog.consequence.unmigrated", {
                count: disposition?.unmigratedCount ?? 0,
              })
            : t("ledgerImport.retention.archiveDialog.consequence.allMigrated"),
          t("ledgerImport.retention.archiveDialog.consequence.kept"),
          t("ledgerImport.retention.archiveDialog.consequence.noPurge"),
          t("ledgerImport.retention.archiveDialog.consequence.purgeLater"),
        ]}
        confirmLabel={
          (disposition?.unmigratedCount ?? 0) > 0
            ? t("ledgerImport.retention.archiveDialog.confirmUnmigrated")
            : t("ledgerImport.retention.archiveDialog.confirm")
        }
        busy={archiveBusy}
        onCancel={() => {
          if (!archiveBusy) setArchiveConfirmOpen(false);
        }}
        onConfirm={() => void archiveFormalSource()}
      />
    </section>
  );
}

export function ReviewStep({
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
  const { t } = useI18n();
  const groups = preview.duplicateGroups;
  const group = groups[groupIndex];
  if (group === undefined) {
    return (
      <section className="flex flex-col gap-3">
        <p className="text-body-relaxed text-muted">{t("ledgerImport.review.noGroups")}</p>
        <Button onClick={onConfirm} disabled={!canConfirm}>
          {t("ledgerImport.review.continue")}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          {t("ledgerImport.review.backToPreview")}
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
        <div className="min-w-0">
          <h2 className="section-title">{t("ledgerImport.review.title")}</h2>
          <p className="mt-1 text-helper-relaxed text-muted">
            {t("ledgerImport.review.counts", {
              source: t("ledgerImport.count.records", { count: group.sourceCount }),
              target: t("ledgerImport.count.records", { count: group.targetCount }),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={t("ledgerImport.review.previousGroup")}
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
            aria-label={t("ledgerImport.review.nextGroup")}
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
          {t("ledgerImport.review.changed")}
        </p>
      ) : null}

      {isOneToOne(group) ? null : (
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <p className="text-body font-medium text-ink">{t("ledgerImport.review.quickTitle")}</p>
          <p className="mt-1 text-helper-relaxed text-muted">{t("ledgerImport.review.quickNote")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["keep_a", "keep_b", "keep_both", "keep_neither"] as const).map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onPreset(group.id, action)}
                className={`min-w-0 rounded-field border px-3 py-2 text-left text-helper transition ${
                  decision?.action === action
                    ? "border-brand bg-brand-soft text-brand-dark"
                    : "border-line bg-canvas text-muted hover:border-brand/40"
                }`}
              >
                <span className="block font-medium text-ink">{t(`ledgerImport.review.preset.${action}.label`)}</span>
                <span className="mt-0.5 block">{t(`ledgerImport.review.preset.${action}.hint`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-body font-medium text-ink">
          {t("ledgerImport.review.sourceHeading")}
          <span className="ml-2 text-helper font-normal text-muted">{t("ledgerImport.review.sourceChoices")}</span>
        </p>
        <ul className="mt-1 divide-y divide-line">
          {sourceRecords.map((record) => {
            const handling = sourceHandling(decision, record.transaction.id);
            return (
              <li key={record.transaction.id} className="py-3">
                <RecordFacts record={record} />
                <SegmentedChoice
                  label={t("ledgerImport.review.sourceAria", {
                    name: record.transaction.note ?? displayCategoryName(record.categoryLabel),
                  })}
                  value={handling}
                  options={[
                    { value: "import", label: t("ledgerImport.review.option.import") },
                    { value: "skip", label: t("ledgerImport.review.option.skip") },
                  ]}
                  onChange={(next) => onSource(group.id, record.transaction.id, next as SourceHandling)}
                />
              </li>
            );
          })}
        </ul>

        <div className="my-4 h-px bg-line" />

        <p className="text-body font-medium text-ink">
          {t("ledgerImport.review.targetHeading")}
          <span className="ml-2 text-helper font-normal text-muted">{t("ledgerImport.review.targetChoices")}</span>
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
                  label={t("ledgerImport.review.targetAria", {
                    name: record.transaction.note ?? displayCategoryName(record.categoryLabel),
                  })}
                  value={handling}
                  options={[
                    { value: "keep", label: t("ledgerImport.review.option.keep") },
                    { value: "remove", label: t("ledgerImport.review.option.remove"), tone: "danger" },
                  ]}
                  onChange={(next) => onTarget(group.id, record.transaction.id, next as TargetHandling)}
                />
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-helper-relaxed text-muted">
          {resolved
            ? decisionSummary(sourceRecords.length - skipped, skipped, targetRecords.length - removed, removed, group)
            : t("ledgerImport.review.chooseEach")}
        </p>
      </div>

      {removed > 0 ? (
        <p className="text-helper-relaxed text-muted">
          {t("ledgerImport.review.removalReminder", { count: removed })}
        </p>
      ) : null}

      <div className="border-t border-line pt-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPrevious}
            disabled={groupIndex === 0}
            className="min-w-0 flex-1 rounded-field border border-line bg-surface px-4 py-3 text-button-lg font-medium text-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("ledgerImport.review.previousShort")}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={groupIndex === groups.length - 1}
            className="min-w-0 flex-1 rounded-field border border-line bg-surface px-4 py-3 text-button-lg font-medium text-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("ledgerImport.review.nextShort")}
          </button>
        </div>
        <div className="mt-2">
          <Button onClick={onConfirm} disabled={!canConfirm}>
            {canConfirm
              ? t("ledgerImport.review.continue")
              : t("ledgerImport.review.undecided", { count: groups.filter((item) => !decisions.has(item.id)).length })}
          </Button>
        </div>
        <div className="mt-2">
          <Button variant="secondary" onClick={onBack}>
            {t("ledgerImport.review.backToPreview")}
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
    return t("ledgerImport.review.summary.importAllKeepAll");
  }
  if (imported === 0 && kept === 0 && removed === group.targetCount) {
    return t("ledgerImport.review.summary.skipAllRemoveAll");
  }
  if (imported === 0 && skipped === group.sourceCount && removed === 0) {
    return t("ledgerImport.review.summary.skipAllKeepAll");
  }
  return t("ledgerImport.review.summary.mixed", {
    imported: t("ledgerImport.count.entries", { count: imported }),
    skipped: t("ledgerImport.count.entries", { count: skipped }),
    kept: t("ledgerImport.count.entries", { count: kept }),
    removed: t("ledgerImport.count.entries", { count: removed }),
  });
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
        {displayCategoryName(record.categoryLabel)}
        {transaction.paymentMethodName === null ? "" : ` · ${displayPaymentMethodName(transaction.paymentMethodName)}`}
      </p>
      {transaction.note === null || transaction.note === "" ? null : (
        <p className="mt-0.5 text-helper text-muted">{transaction.note}</p>
      )}
    </div>
  );
}

export function ConfirmStep({
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
  const { t } = useI18n();
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
          <p className="text-helper text-muted">{t("ledgerImport.result.eyebrow")}</p>
          <h2 className="mt-1 text-page-title text-ink">
            {t("ledgerImport.result.imported", { count: result.importedCount })}
          </h2>
          {result.updatedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              {t("ledgerImport.result.updated", { count: result.updatedCount })}
            </p>
          ) : null}
          <p className="mt-2 text-body-relaxed text-muted [overflow-wrap:anywhere]">
            {result.targetBook.bookNumber === null
              ? t("ledgerImport.result.into", { name: result.targetBook.name })
              : t("ledgerImport.result.intoWithNumber", {
                  name: result.targetBook.name,
                  number: result.targetBook.bookNumber,
                })}
            {result.targetBook.created ? t("ledgerImport.result.createdSuffix") : ""}
          </p>
          {result.skippedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              {t("ledgerImport.result.skipped", { count: result.skippedCount })}
            </p>
          ) : null}
          {result.removedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">
              {t("ledgerImport.result.removed", { count: result.removedCount })}
            </p>
          ) : null}
        </div>

        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <h2 className="section-title">{t("ledgerImport.result.checkTitle")}</h2>
          <ul className="mt-3 flex flex-col gap-2 text-body">
            <ResultRow
              label={t("ledgerImport.result.row.source")}
              value={t("ledgerImport.count.entries", { count: result.sourceCount })}
            />
            <ResultRow
              label={t("ledgerImport.result.row.imported")}
              value={t("ledgerImport.count.entries", { count: result.importedCount })}
            />
            {result.updatedCount > 0 ? (
              <ResultRow
                label={t("ledgerImport.result.row.updated")}
                value={t("ledgerImport.count.entries", { count: result.updatedCount })}
              />
            ) : null}
            <ResultRow
              label={t("ledgerImport.result.row.skipped")}
              value={t("ledgerImport.count.entries", { count: result.skippedCount })}
            />
            <ResultRow
              label={t("ledgerImport.result.row.removed")}
              value={t("ledgerImport.count.entries", { count: result.removedCount })}
            />
            <ResultRow
              label={t("ledgerImport.result.row.target")}
              value={t("ledgerImport.result.targetChange", {
                before: result.targetExistingBefore,
                after: t("ledgerImport.count.entries", { count: result.targetCountAfter }),
              })}
            />
          </ul>
          {totals.length === 0 ? null : (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-helper text-muted">{t("ledgerImport.result.byCurrency")}</p>
              {result.totals.map((total) => (
                <p key={total.currency} className="mt-1 text-body text-ink">
                  {t("ledgerImport.result.currencyTotals", {
                    currency: total.currency,
                    expense: formatMoney(total.expenseCents, total.currency),
                    income: formatMoney(total.incomeCents, total.currency),
                  })}
                </p>
              ))}
            </div>
          )}
          <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.result.serverChecked")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={() => onOpenTarget(result.targetBook.id)}>{t("ledgerImport.result.openTarget")}</Button>
          <Button variant="secondary" onClick={onFinish}>
            {t("ledgerImport.result.done")}
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
          <h2 className="mt-4 text-page-title text-ink">{t("ledgerImport.confirm.submittingTitle")}</h2>
          <p className="mt-2 text-body-relaxed text-muted">
            {t("ledgerImport.confirm.submittingBody", { count: importedTransactions.length })}
          </p>
          <p className="mt-2 text-helper text-muted">{t("ledgerImport.confirm.submittingNote")}</p>
        </div>
      </section>
    );
  }

  if (submitState === "paused" || submitState === "error") {
    return (
      <section className="flex flex-col gap-4">
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <p className="text-helper text-muted">
            {submitState === "paused" ? t("ledgerImport.confirm.pausedEyebrow") : t("ledgerImport.confirm.errorEyebrow")}
          </p>
          <h2 className="mt-1 text-section-title text-ink">
            {submitState === "paused" ? t("ledgerImport.confirm.pausedTitle") : t("ledgerImport.confirm.errorTitle")}
          </h2>
          <p className="mt-2 text-body-relaxed text-muted">
            {submitState === "paused" ? t("ledgerImport.confirm.pausedBody") : t("ledgerImport.confirm.errorBody")}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {submitState === "paused" ? <Button onClick={onRetry}>{t("ledgerImport.confirm.checkResult")}</Button> : null}
          <Button variant="secondary" onClick={onBack}>
            {t("ledgerImport.confirm.backToReview")}
          </Button>
        </div>
      </section>
    );
  }

  const targetLabel = preview.target.identity.name;
  return (
    <section data-testid="import-confirm" className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-helper text-muted">{t("ledgerImport.confirm.finalTitle")}</p>
        <h2 className="mt-1 text-section-title text-ink [overflow-wrap:anywhere]">
          {targetIsNew
            ? t("ledgerImport.confirm.createAndImport")
            : t("ledgerImport.confirm.importInto", { name: targetLabel })}
        </h2>
        <p className="mt-2 text-body-relaxed text-muted [overflow-wrap:anywhere]">
          {t("ledgerImport.confirm.route", { source: preview.source.identity.name, target: targetLabel })}
        </p>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Metric
            label={t("ledgerImport.confirm.metric.import")}
            value={t("ledgerImport.metricValue.entries", { count: importedTransactions.length })}
          />
          <Metric
            label={t("ledgerImport.confirm.metric.skip")}
            value={t("ledgerImport.metricValue.entries", { count: skipped.size })}
          />
          <Metric
            label={t("ledgerImport.confirm.metric.remove")}
            value={t("ledgerImport.metricValue.entries", { count: removals.length })}
          />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.confirm.taxonomy", { reuse, create })}</p>
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="section-title">{t("ledgerImport.confirm.byCurrency")}</h2>
        {totals.length === 0 ? (
          <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.confirm.nothingToImport")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {totals.map((total) => (
              <li key={total.currency} className="flex items-baseline justify-between gap-3 text-body">
                <span className="shrink-0 text-muted">{total.currency}</span>
                <span className="min-w-0 text-right text-ink">
                  {t("ledgerImport.totals", {
                    expense: formatMoney(total.expenseCents, total.currency),
                    income: formatMoney(total.incomeCents, total.currency),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {removals.length === 0 ? (
          <p className="mt-3 text-helper-relaxed text-muted">{t("ledgerImport.confirm.noRemovals")}</p>
        ) : (
          <details className="mt-3 rounded-field border border-line bg-canvas px-3 py-2">
            <summary className="cursor-pointer text-helper font-medium text-ink">
              {t("ledgerImport.confirm.removalsSummary", { count: removals.length })}
            </summary>
            <ul className="mt-2 max-h-48 divide-y divide-line overflow-auto">
              {removals.map((item) => (
                <li key={item.transactionId} className="flex justify-between gap-3 py-2 text-helper">
                  <span className="min-w-0 truncate">
                    {item.occurredLocalDate} · {displayCategoryName(item.categoryLabel)}
                    {item.note === null ? "" : ` · ${item.note}`}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoney(item.amountCents, item.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-helper-relaxed text-muted">{t("ledgerImport.confirm.removalsNote")}</p>
          </details>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={onStart} disabled={!canConfirm}>
          {removals.length > 0 ? t("ledgerImport.confirm.deleteAndImport") : t("ledgerImport.confirm.start")}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          {t("ledgerImport.confirm.backToReview")}
        </Button>
      </div>
    </section>
  );
}

/** 对账表的一行：标签可换行，数量不换行。 */
function ResultRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <li className="flex justify-between gap-3">
      <span className="min-w-0 text-muted">{label}</span>
      <span className="shrink-0 text-ink">{value}</span>
    </li>
  );
}
