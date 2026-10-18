import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ledgerImportResultSchema,
  type LedgerImportRequest,
  type LedgerImportResult,
} from "@libellum/shared";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { apiFetch, ApiRequestError, errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { formatTimeWithZone } from "../lib/datetime.js";
import { DEFAULT_BOOK_NAME } from "@libellum/shared";
import { useBooks } from "../lib/queries.js";
import {
  buildNewImportTarget,
  hasLocalGuestIdentity,
  isSoloImportBook,
  loadBookImportTarget,
  loadGuestImportSource,
} from "../lib/ledgerImport/sources.js";
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
  type DuplicateAction,
  type DuplicateDecisionMap,
} from "../lib/ledgerImport/submit.js";
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

function skippedSourceIds(preview: ImportPreview, decisions: DuplicateDecisionMap): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const group of preview.duplicateGroups) {
    if (decisions.get(group.id) !== "keep_a") continue;
    for (const record of group.records) {
      if (record.side === "source") ids.add(record.transaction.id);
    }
  }
  return ids;
}

export function LedgerImportPage(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const step = parseStep(search.get("step"));
  const targetId = search.get("target") ?? "";
  const sourceKey = search.get("source") ?? "";
  const targetIsNew = targetId === "new";
  const currentNewName = search.get("newName") ?? DEFAULT_BOOK_NAME;
  const requestedGroup = parseGroup(search.get("group"));

  const books = useBooks();
  const [snapshots, setSnapshots] = useState<{ source: ImportSource; target: ImportTarget } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, TaxonomyResolutionAction>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, DuplicateAction>>(new Map());
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<LedgerImportResult | null>(null);
  const [pendingTasks, setPendingTasks] = useState<readonly PendingImportTask[]>([]);
  const [resumeBusy, setResumeBusy] = useState(false);
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

  const soloBooks = useMemo<readonly ImportBookOption[]>(() => {
    return (books.data?.books ?? []).filter((book) => isSoloImportBook(book)).map((book) => ({ ...book }));
  }, [books.data]);

  const target = soloBooks.find((book) => book.id === targetId) ?? null;
  const accountLabel = user === null ? "正式账号" : user.displayName.trim() === "" ? user.username : user.displayName;
  const guestAvailable = useMemo(() => hasLocalGuestIdentity(), []);
  const backTo = target === null ? "/start" : `/books/${target.id}/settings`;
  const preview = useMemo(() => {
    if (snapshots === null) return null;
    return buildImportPreview(snapshots.source, snapshots.target, resolutions as TaxonomyResolutionMap);
  }, [snapshots, resolutions]);

  const groups = preview?.duplicateGroups ?? [];
  const groupIndex = groups.length === 0 ? 0 : Math.min(requestedGroup, groups.length - 1);
  const currentGroup = groups[groupIndex] ?? null;
  const conflictCount = preview === null ? 0 : unresolvedConflicts(preview, resolutions);
  const unresolvedGroups = preview === null ? 0 : unresolvedDuplicateGroups(preview, decisions);
  const canConfirm = preview !== null && conflictCount === 0 && unresolvedGroups === 0;
  const lastRequest = useRef<LedgerImportRequest | null>(null);

  function patchSearch(patch: Record<string, string | undefined>, replace = false): void {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setSearch(next, { replace });
  }

  function goStep(next: Step): void {
    setSubmitError(null);
    patchSearch({ step: next, group: undefined });
  }

  function changeTarget(next: string): void {
    setSnapshots(null);
    setLoadError(null);
    setSubmitError(null);
    patchSearch({
      target: next === "" ? undefined : next,
      source: sourceKey === "" ? undefined : sourceKey,
      step: "select",
      group: undefined,
      newName: next === "new" ? currentNewName : undefined,
    }, true);
  }

  function changeSource(next: string): void {
    setSnapshots(null);
    setLoadError(null);
    patchSearch({
      target: targetId === "" ? undefined : targetId,
      source: next === "" ? undefined : next,
      step: "select",
      group: undefined,
    }, true);
  }

  /** 读取预览；新目标账本使用与服务器默认账本一致的合成快照。 */
  useEffect(() => {
    if (step === "select" || user === null) return;
    if (sourceKey !== "guest" || !guestAvailable) return;
    if (targetId === "" || (targetIsNew && currentNewName.trim() === "")) return;
    const alreadyLoaded =
      snapshots !== null &&
      snapshots.source.kind === "guest" &&
      (targetIsNew
        ? snapshots.target.bookId === "new" && snapshots.target.identity.name === currentNewName.trim()
        : snapshots.target.bookId === targetId);
    if (alreadyLoaded) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const source = await loadGuestImportSource();
        if (source === null) throw new Error("本机没有可用的游客账本。");
        const targetSnapshot = targetIsNew
          ? buildNewImportTarget(currentNewName)
          : await loadBookImportTarget(targetId);
        if (cancelled) return;
        setSnapshots({ source, target: targetSnapshot });
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
  }, [step, user, sourceKey, guestAvailable, targetId, targetIsNew, currentNewName, snapshots]);

  /** 指向不完整步骤的地址回到选择，避免空白页。 */
  useEffect(() => {
    if (step !== "select" && (sourceKey !== "guest" || targetId === "" || user === null)) {
      patchSearch({ step: "select", group: undefined }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sourceKey, targetId, user]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step, requestedGroup]);

  function onBack(): void {
    if (submitState === "submitting") return;
    if (step === "confirm") {
      if (result !== null) {
        void navigate(backTo);
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
    void navigate(backTo);
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

  function chooseDecision(groupId: string, action: DuplicateAction): void {
    setDecisions((previous) => {
      const next = new Map(previous);
      next.set(groupId, action);
      return next;
    });
    setSubmitError(null);
  }

  async function runSubmit(
    request: LedgerImportRequest,
    labels: { targetLabel: string; sourceLabel: string },
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
        request.duplicateGroups
          .filter((group) => group.action === "keep_a")
          .flatMap((group) => group.sourceIds),
      );
      const expectedSkipped = requestSkipped.size;
      const expectedImported = request.source.transactions.length - expectedSkipped;
      const expectedTotals = totalsOf(
        request.source.transactions.filter((item) => !requestSkipped.has(item.id)),
      );
      if (
        parsed.importedCount !== expectedImported ||
        parsed.skippedCount !== expectedSkipped ||
        parsed.targetCountAfter !== parsed.targetExistingBefore + parsed.importedCount ||
        JSON.stringify(parsed.totals) !== JSON.stringify(expectedTotals)
      ) {
        setSubmitError("服务器已完成提交，但回执与本地预期不一致。请先截图保留本页，然后打开目标账本核对；不要重复提交。");
        setResult(parsed);
        setSubmitState("error");
        return;
      }
      setResult(parsed);
      setSubmitState("success");
      const task = loadPendingTasks().find((item) => item.request.importId === request.importId);
      if (task !== undefined) setPendingTasks([task, ...pendingTasks.filter((item) => item.request.importId !== task.request.importId)]);
      // 保留本地任务日志直到用户明确完成/离开，刷新后还能凭同一 importId 找回回执。
      savePendingTask({
        userId: user?.id ?? "",
        request,
        targetLabel: labels.targetLabel,
        sourceLabel: labels.sourceLabel,
        createdAt: new Date().toISOString(),
      });
    } catch (caught) {
      if (!mounted.current) return;
      const message = errorMessage(caught);
      const code = caught instanceof ApiRequestError ? caught.code : "";
      if (
        code === "source_changed" ||
        code === "target_changed" ||
        code === "already_imported" ||
        code.startsWith("taxonomy_") ||
        code.startsWith("decision_") ||
        code === "duplicate_"
      ) {
        removePendingTask(request.importId);
        setPendingTasks((previous) => previous.filter((item) => item.request.importId !== request.importId));
        setSubmitError(message);
        setSubmitState("error");
        return;
      }
      setSubmitError(message);
      setSubmitState("paused");
    }
  }

  async function handleSubmit(): Promise<void> {
    if (preview === null || !canConfirm || submitState !== "idle") return;
    setSubmitState("submitting");
    const importId = newId();
    const targetLabel = preview.target.identity.name;
    const sourceLabel = preview.source.identity.name;
    try {
      const request = await buildLedgerImportRequest({
        importId,
        preview,
        targetIsNew,
        resolutions,
        decisions,
      });
      savePendingTask({
        userId: user?.id ?? "",
        request,
        targetLabel,
        sourceLabel,
        createdAt: new Date().toISOString(),
      });
      setPendingTasks((previous) => [
        { userId: user?.id ?? "", request, targetLabel, sourceLabel, createdAt: new Date().toISOString() },
        ...previous,
      ]);
      await runSubmit(request, { targetLabel, sourceLabel });
    } catch (caught) {
      setSubmitError(errorMessage(caught));
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
        source: "guest",
        newName: requestTarget.kind === "new" ? requestTarget.name : undefined,
      });
      await runSubmit(task.request, { targetLabel: task.targetLabel, sourceLabel: task.sourceLabel });
    } finally {
      setResumeBusy(false);
    }
  }

  function dropTask(importId: string): void {
    removePendingTask(importId);
    setPendingTasks((previous) => previous.filter((item) => item.request.importId !== importId));
  }

  const subtitle =
    step === "select"
      ? "把本机游客账本导入到正式账号的账本。先确认来源和目标。"
      : step === "preview"
        ? "确认方向、映射和重复候选。预览和核对都不会修改任何账本。"
        : step === "review"
          ? "逐组决定如何处理可能重复的账目。本轮不会删除目标账本里的任何记录。"
          : "确认最终摘要后才会真正写入。来源游客数据会保留。";

  return (
    <InnerPage
      title="导入账本"
      subtitle={subtitle}
      backTo={backTo}
      onBack={onBack}
      actions={
        <span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">
          {submitState === "success" ? "已完成" : "游客来源"}
        </span>
      }
    >
      <StepRail step={step} />

      {pendingTasks.length === 0 || submitState === "success" ? null : (
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
      {submitError === null ? null : <Alert>{submitError}</Alert>}

      {books.isSuccess && step === "select" ? (
        <SelectionStep
          targetId={targetId}
          target={target}
          targetIsNew={targetIsNew}
          newName={currentNewName}
          soloBooks={soloBooks}
          guestAvailable={guestAvailable}
          sourceKey={sourceKey}
          accountLabel={accountLabel}
          onChangeTarget={changeTarget}
          onChangeSource={changeSource}
          onChangeNewName={(name) => patchSearch({ newName: name }, true)}
          onContinue={() => {
            if (targetId === "" || sourceKey !== "guest" || !guestAvailable) {
              setLoadError("请选择目标账本，并把本机游客账本作为来源。");
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

      {step === "preview" && !loading && loadError === null && preview !== null ? (
        <PreviewStep
          preview={preview}
          conflictCount={conflictCount}
          resolutions={resolutions}
          onResolve={chooseResolution}
          onBack={() => goStep("select")}
          onReview={() => patchSearch({ step: "review", group: "0" })}
          onConfirm={() => goStep("confirm")}
        />
      ) : null}

      {step === "review" && !loading && loadError === null && preview !== null ? (
        <ReviewStep
          preview={preview}
          groupIndex={groupIndex}
          decisions={decisions}
          onChoose={chooseDecision}
          onPrevious={() => {
            if (groupIndex > 0) patchSearch({ group: String(groupIndex - 1) }, true);
          }}
          onNext={() => {
            if (groupIndex < groups.length - 1) patchSearch({ group: String(groupIndex + 1) }, true);
          }}
          onBack={() => goStep("preview")}
          onConfirm={() => goStep("confirm")}
          canConfirm={canConfirm}
        />
      ) : null}

      {step === "confirm" && preview !== null && !loading && loadError === null ? (
        <ConfirmStep
          preview={preview}
          targetIsNew={targetIsNew}
          decisions={decisions}
          canConfirm={canConfirm}
          submitState={submitState}
          result={result}
          onStart={() => void handleSubmit()}
          onRetry={() => {
            const request = lastRequest.current ?? loadPendingTasks().find((item) => item.userId === user?.id)?.request;
            if (request === undefined) {
              setSubmitState("idle");
              return;
            }
            void runSubmit(request, {
              targetLabel: preview.target.identity.name,
              sourceLabel: preview.source.identity.name,
            });
          }}
          onBack={() => goStep(groups.length > 0 ? "review" : "preview")}
          onFinish={() => {
            if (result !== null) dropTask(result.importId);
            void navigate(backTo);
          }}
          onOpenTarget={(bookId) => {
            if (result !== null) dropTask(result.importId);
            void navigate(`/books/${bookId}`);
          }}
        />
      ) : null}

      {step === "confirm" && (preview === null || loading) ? <SkeletonRows rows={4} /> : null}
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

function SelectionStep({
  targetId,
  target,
  targetIsNew,
  newName,
  soloBooks,
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
  readonly guestAvailable: boolean;
  readonly sourceKey: string;
  readonly accountLabel: string;
  readonly onChangeTarget: (next: string) => void;
  readonly onChangeSource: (next: string) => void;
  readonly onChangeNewName: (next: string) => void;
  readonly onContinue: () => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-5">
      <p className="text-body-relaxed text-muted">
        本轮只支持把本机游客账本导入正式账号。来源游客数据在上传前不会被读取或发送；导入后也不会自动删除。
      </p>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <label className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">来源账本 B</span>
          <select
            data-testid="import-source"
            value={sourceKey}
            onChange={(event) => onChangeSource(event.target.value)}
            className="w-full rounded-field border border-line bg-surface px-4 py-3 text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
          >
            <option value="">选择来源账本</option>
            {guestAvailable ? <option value="guest">本机游客账本</option> : null}
          </select>
        </label>
        {guestAvailable ? null : (
          <p className="mt-2 text-helper-relaxed text-muted">本机没有游客账本；请先在游客模式记几笔。</p>
        )}

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-muted">↓</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-body font-medium text-ink">目标账本 A</span>
          <select
            data-testid="import-target"
            value={targetId}
            onChange={(event) => onChangeTarget(event.target.value)}
            className="w-full rounded-field border border-line bg-surface px-4 py-3 text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
          >
            <option value="">选择目标账本</option>
            {soloBooks.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
            <option value="new">＋ 新建正式账本</option>
          </select>
        </label>

        {targetIsNew ? (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-helper text-muted">新账本名称</span>
            <input
              data-testid="import-new-name"
              value={newName}
              onChange={(event) => onChangeNewName(event.target.value)}
              maxLength={40}
              className="rounded-field border border-line bg-surface px-4 py-3 text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
            />
          </label>
        ) : null}

        {targetIsNew ? (
          <p className="mt-3 text-helper-relaxed text-muted">
            新账本会和导入一起创建；如果中途失败，不会留下半本账。
          </p>
        ) : target === null ? null : (
          <p className="mt-3 text-helper-relaxed text-muted">
            导入到「{target.name}」 · {accountLabel}
            {target.bookNumber === null ? "" : ` · 编号 ${target.bookNumber}`}
          </p>
        )}
      </div>

      <Button onClick={onContinue} disabled={!guestAvailable}>
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
}: {
  readonly preview: ImportPreview;
  readonly conflictCount: number;
  readonly resolutions: TaxonomyResolutionMap;
  readonly onResolve: (conflict: TaxonomyConflict, action: TaxonomyResolutionAction) => void;
  readonly onBack: () => void;
  readonly onReview: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const { mapping, counts } = preview;
  return (
    <section data-testid="import-preview" className="flex flex-col gap-5">
      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-helper text-muted">导入方向</p>
        <div className="mt-2 flex flex-col gap-2">
          <BookLine label="来源 B" book={preview.source.identity} />
          <div className="flex items-center gap-2 px-1 text-muted" aria-hidden="true">
            <span className="h-px w-6 bg-line" />
            <span>↓</span>
          </div>
          <BookLine label="目标 A" book={preview.target.identity} />
        </div>
        <p className="mt-3 text-helper-relaxed text-muted">来源是本机游客账本；导入后本机数据仍会保留。</p>
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
        {counts.duplicateGroups > 0 ? (
          <button
            type="button"
            data-testid="open-review"
            onClick={onReview}
            className="mt-3 flex w-full items-center justify-between rounded-field border border-line bg-canvas px-4 py-3 text-left text-body text-ink transition hover:border-brand/40 hover:bg-brand-soft"
          >
            <span>逐组核对这 {String(counts.duplicateGroups)} 组</span>
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
        {counts.duplicateGroups > 0 ? (
          <Button onClick={onReview} disabled={conflictCount > 0}>
            去核对可能重复的账目
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

function BookLine({
  label,
  book,
}: {
  readonly label: string;
  readonly book: ImportPreview["source"]["identity"];
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-helper text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block truncate text-body font-medium text-ink">{book.name}</span>
        {book.bookNumber === null ? null : <span className="block text-helper text-muted">编号 {book.bookNumber}</span>}
      </span>
    </div>
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

function ReviewStep({
  preview,
  groupIndex,
  decisions,
  onChoose,
  onPrevious,
  onNext,
  onBack,
  onConfirm,
  canConfirm,
}: {
  readonly preview: ImportPreview;
  readonly groupIndex: number;
  readonly decisions: DuplicateDecisionMap;
  readonly onChoose: (groupId: string, action: DuplicateAction) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly canConfirm: boolean;
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
  const choice = decisions.get(group.id);
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

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <RecordSection side="source" label="来源 B" records={sourceRecords} />
        <div className="my-4 h-px bg-line" />
        <RecordSection side="target" label="目标 A" records={targetRecords} />
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <p className="text-body font-medium text-ink">这一组怎么处理？</p>
        <p className="mt-1 text-helper-relaxed text-muted">本轮两种选择都不会删除 A 里的任何记录。</p>
        <div className="mt-3 flex flex-col gap-2">
          <DecisionOption
            selected={choice === "keep_a"}
            title="保留 A，跳过来源"
            description={`目标 A 不变；这组的 ${String(group.sourceCount)} 条来源记录不会导入。`}
            onClick={() => onChoose(group.id, "keep_a")}
          />
          <DecisionOption
            selected={choice === "keep_both"}
            title="两边都保留"
            description={`目标 A 不变；这组的 ${String(group.sourceCount)} 条来源记录会追加导入。`}
            onClick={() => onChoose(group.id, "keep_both")}
          />
        </div>
      </div>

      <p className="text-helper-relaxed text-muted">
        当前只支持「保留 A / 两边都保留」；删除 A 记录的选择留到后续阶段，本轮不会提供。
      </p>

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
            {canConfirm ? "继续确认" : `还有 ${String(groups.length - decisions.size)} 组未决定`}
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

function DecisionOption({
  selected,
  title,
  description,
  onClick,
}: {
  readonly selected: boolean;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-field border px-4 py-3 text-left transition ${
        selected ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand/40"
      }`}
    >
      <span className="flex items-center gap-2 text-body font-medium text-ink">
        <span
          aria-hidden="true"
          className={`flex size-4 items-center justify-center rounded-full border ${
            selected ? "border-brand bg-brand text-white" : "border-line"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
        {title}
      </span>
      <span className="mt-1 block pl-6 text-helper-relaxed text-muted">{description}</span>
    </button>
  );
}

function RecordSection({
  side,
  label,
  records,
}: {
  readonly side: DuplicateRecord["side"];
  readonly label: string;
  readonly records: readonly DuplicateRecord[];
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-helper ${
            side === "source" ? "bg-brand-soft text-brand-dark" : "bg-canvas text-muted"
          }`}
        >
          {label}
        </span>
        <span className="text-helper text-muted">{records.length} 条</span>
      </div>
      <ul className="divide-y divide-line">
        {records.map((record) => (
          <DuplicateRecordView key={record.transaction.id} record={record} />
        ))}
      </ul>
    </section>
  );
}

function DuplicateRecordView({ record }: { readonly record: DuplicateRecord }): React.JSX.Element {
  const transaction = record.transaction;
  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold tabular-nums text-ink">
          {formatMoney(transaction.amountCents, transaction.currency)}
        </span>
        <span className="shrink-0 text-helper text-muted">
          {transaction.occurredLocalDate} · {formatTimeWithZone(transaction.occurredAt, transaction.occurredTz)}
        </span>
      </div>
      <p className="mt-1 text-body text-ink">
        {record.categoryLabel}
        {transaction.paymentMethodName === null ? "" : ` · ${transaction.paymentMethodName}`}
      </p>
      {record.tagLabels.length === 0 ? null : (
        <p className="mt-1 text-helper text-muted">标签：{record.tagLabels.join("、")}</p>
      )}
      {transaction.note === null || transaction.note === "" ? null : (
        <p className="mt-1 text-helper-relaxed text-muted">{transaction.note}</p>
      )}
    </li>
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
  readonly decisions: DuplicateDecisionMap;
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
          <p className="mt-2 text-body-relaxed text-muted">
            到「{result.targetBook.name}」{result.targetBook.bookNumber === null ? "" : ` · 编号 ${result.targetBook.bookNumber}`}
            {result.targetBook.created ? "（这次新建的账本）" : ""}
          </p>
          {result.skippedCount > 0 ? (
            <p className="mt-1 text-helper-relaxed text-muted">按你的核对选择，跳过了 {String(result.skippedCount)} 笔来源记录。</p>
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
            <li className="flex justify-between gap-3">
              <span className="text-muted">跳过</span>
              <span className="text-ink">{String(result.skippedCount)} 笔</span>
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
            服务器已按实际写入结果核对；本机游客数据仍然保留，不会自动删除。
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
          <Metric label="复用对象" value={`${String(reuse)} 个`} />
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
        <p className="mt-3 text-helper-relaxed text-muted">
          本轮不会删除目标账本 A 的任何已有账目；新账目由服务器分配编号。导入成功后也不会自动删除游客数据。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button onClick={onStart} disabled={!canConfirm}>
          开始导入
        </Button>
        <Button variant="secondary" onClick={onBack}>
          返回核对
        </Button>
      </div>
    </section>
  );
}
