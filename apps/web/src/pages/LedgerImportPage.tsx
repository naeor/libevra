import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { formatTimeWithZone } from "../lib/datetime.js";
import {
  hasLocalGuestIdentity,
  isSoloImportBook,
  loadBookImportSource,
  loadBookImportTarget,
  loadGuestImportSource,
} from "../lib/ledgerImport/sources.js";
import { buildImportPreview } from "../lib/ledgerImport/preview.js";
import type {
  DuplicateRecord,
  ImportBookOption,
  ImportPreview,
  TaxonomyConflict,
} from "../lib/ledgerImport/types.js";
import { useBooks } from "../lib/queries.js";

/**
 * S14-D D1 · 导入向导。
 *
 * 页面只做三件事：**选择来源/目标 → 预览 → 只读核对可能重复的账目**。
 * 写入、冲突决定与最终提交属于后续阶段，这里没有可点击的假操作。
 *
 * ⚠️ **状态在 URL 里**：`step / target / source / group` 都写入地址栏，刷新和浏览器返回后
 * 能回到同一页、同一组。它不是本地临时状态，否则刷新后向导会无声地退回第一步。
 */
type Step = "select" | "preview" | "review";

const STEP_ITEMS = [
  { id: "select" as const, label: "选择" },
  { id: "preview" as const, label: "预览" },
  { id: "review" as const, label: "核对" },
];

function parseStep(value: string | null): Step {
  return value === "preview" || value === "review" ? value : "select";
}

function parseGroup(value: string | null): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

export function LedgerImportPage(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const step = parseStep(search.get("step"));
  const targetId = search.get("target") ?? "";
  const sourceKey = search.get("source") ?? "";
  const requestedGroup = parseGroup(search.get("group"));

  const books = useBooks();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestAvailable = useMemo(() => hasLocalGuestIdentity(), []);

  const soloBooks = useMemo<readonly ImportBookOption[]>(() => {
    return (books.data?.books ?? []).filter((book) => isSoloImportBook(book)).map((book) => ({ ...book }));
  }, [books.data]);

  const target = soloBooks.find((book) => book.id === targetId) ?? null;
  const targetOptions = soloBooks;
  const sourceOptions = soloBooks.filter((book) => book.id !== targetId);
  const accountLabel = user === null ? "正式账号" : user.displayName.trim() === "" ? user.username : user.displayName;
  const backTo = target === null ? "/start" : `/books/${target.id}/settings`;

  function patchSearch(patch: Record<string, string | undefined>, replace = false): void {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    setSearch(next, { replace });
  }

  function goStep(next: Step): void {
    setError(null);
    patchSearch({ step: next, group: undefined });
  }

  function changeTarget(next: string): void {
    setPreview(null);
    setError(null);
    patchSearch({
      target: next === "" ? undefined : next,
      source: next === sourceKey ? undefined : sourceKey,
      step: "select",
      group: undefined,
    }, true);
  }

  function changeSource(next: string): void {
    setPreview(null);
    setError(null);
    patchSearch({
      target: targetId === "" ? undefined : targetId,
      source: next === "" ? undefined : next,
      step: "select",
      group: undefined,
    }, true);
  }

  /** 进入预览/核对后按地址重新读取一次；返回预览时复用已加载的同一份快照。 */
  useEffect(() => {
    if (step === "select" || targetId === "" || sourceKey === "") return;
    const alreadyMatches =
      preview !== null &&
      preview.target.bookId === targetId &&
      (sourceKey === "guest"
        ? preview.source.kind === "guest"
        : preview.source.kind === "book" && preview.source.bookId === sourceKey);
    if (alreadyMatches) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);

    void (async () => {
      try {
        const targetSnapshot = await loadBookImportTarget(targetId);
        const sourceSnapshot =
          sourceKey === "guest" ? await loadGuestImportSource() : await loadBookImportSource(sourceKey);
        if (sourceSnapshot === null) throw new Error("本机没有可用的游客账本。");
        if (sourceSnapshot.kind === "book" && sourceSnapshot.bookId === targetSnapshot.bookId) {
          throw new Error("来源账本和目标账本不能是同一本。");
        }
        if (!cancelled) setPreview(buildImportPreview(sourceSnapshot, targetSnapshot));
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, targetId, sourceKey, preview]);

  /** 地址里指向不完整的步骤时回到选择，而不是停在空白页。 */
  useEffect(() => {
    if (step !== "select" && (targetId === "" || sourceKey === "")) {
      patchSearch({ step: "select", group: undefined }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, targetId, sourceKey]);

  /** 步骤或重复组变化时回到顶部；核对组切换不应停在上一组的滚动位置。 */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step, requestedGroup]);

  const groups = preview?.duplicateGroups ?? [];
  const groupIndex = groups.length === 0 ? 0 : Math.min(requestedGroup, groups.length - 1);
  const currentGroup = groups[groupIndex] ?? null;

  function onBack(): void {
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

  const subtitle =
    step === "select"
      ? "从一本账导入到另一本。先确认来源和目标。"
      : step === "preview"
        ? "确认方向和范围。预览不会修改任何账本。"
        : "逐组查看来源和目标中可能重复的账目。";

  return (
    <InnerPage
      title="导入账本"
      subtitle={subtitle}
      backTo={backTo}
      onBack={onBack}
      actions={<span className="rounded-full bg-canvas px-2.5 py-1 text-helper text-muted">仅预览</span>}
    >
      <StepRail step={step} />

      {books.isPending ? <SkeletonRows rows={3} /> : null}
      {books.isError ? <Alert>{errorMessage(books.error)}</Alert> : null}
      {error === null ? null : <Alert>{error}</Alert>}

      {books.isSuccess && step === "select" ? (
        <SelectionStep
          targetId={targetId}
          target={target}
          targetOptions={targetOptions}
          sourceKey={sourceKey}
          sourceOptions={sourceOptions}
          guestAvailable={guestAvailable}
          accountLabel={accountLabel}
          onChangeTarget={changeTarget}
          onChangeSource={changeSource}
          onContinue={() => {
            if (targetId === "" || sourceKey === "") {
              setError("请选择来源账本 B 和目标账本 A。");
              return;
            }
            setError(null);
            goStep("preview");
          }}
        />
      ) : null}

      {step !== "select" && loading ? <SkeletonRows rows={5} /> : null}

      {step === "preview" && !loading && error === null && preview !== null ? (
        <PreviewStep
          preview={preview}
          accountLabel={accountLabel}
          onBack={() => goStep("select")}
          onReview={() => patchSearch({ step: "review", group: "0" })}
        />
      ) : null}

      {step === "review" && !loading && error === null && preview !== null ? (
        <ReviewStep
          preview={preview}
          groupIndex={groupIndex}
          onPrevious={() => {
            if (groupIndex > 0) patchSearch({ group: String(groupIndex - 1) }, true);
          }}
          onNext={() => {
            if (groupIndex < groups.length - 1) patchSearch({ group: String(groupIndex + 1) }, true);
          }}
          onBack={() => goStep("preview")}
        />
      ) : null}
    </InnerPage>
  );
}

/** 三步进度：只表达位置，不承载操作。 */
function StepRail({ step }: { readonly step: Step }): React.JSX.Element {
  const activeIndex = STEP_ITEMS.findIndex((item) => item.id === step);
  return (
    <ol className="flex items-center gap-2 px-1 text-helper" aria-label="导入步骤">
      {STEP_ITEMS.map((item, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-2">
            {index > 0 ? <span aria-hidden="true" className="h-px w-3 shrink-0 bg-line" /> : null}
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-medium ${
                active
                  ? "bg-brand text-white"
                  : done
                    ? "bg-brand-soft text-brand-dark"
                    : "bg-canvas text-muted"
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

function SelectionStep({
  targetId,
  target,
  targetOptions,
  sourceKey,
  sourceOptions,
  guestAvailable,
  accountLabel,
  onChangeTarget,
  onChangeSource,
  onContinue,
}: {
  readonly targetId: string;
  readonly target: ImportBookOption | null;
  readonly targetOptions: readonly ImportBookOption[];
  readonly sourceKey: string;
  readonly sourceOptions: readonly ImportBookOption[];
  readonly guestAvailable: boolean;
  readonly accountLabel: string;
  readonly onChangeTarget: (next: string) => void;
  readonly onChangeSource: (next: string) => void;
  readonly onContinue: () => void;
}): React.JSX.Element {
  const hasSources = guestAvailable || sourceOptions.length > 0;
  return (
    <section className="flex flex-col gap-5">
      <p className="text-body-relaxed text-muted">
        导入只会把来源账本的内容复制到目标账本，来源账本本身不会被修改。
      </p>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <BookChoice
          label="来源账本 B"
          hint="从哪本账读取数据"
          value={sourceKey}
          onChange={onChangeSource}
          placeholder="选择来源账本"
        >
          {guestAvailable ? <option value="guest">本机游客账本</option> : null}
          {sourceOptions.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}
            </option>
          ))}
        </BookChoice>

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-muted">↓</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <BookChoice
          label="目标账本 A"
          hint="数据会写入这里"
          value={targetId}
          onChange={onChangeTarget}
          placeholder="选择目标账本"
        >
          {targetOptions.map((book) => (
            <option key={book.id} value={book.id}>
              {book.name}
            </option>
          ))}
        </BookChoice>

        {target === null ? null : (
          <p className="mt-4 text-helper-relaxed text-muted">
            导入到「{target.name}」 · {accountLabel}
            {target.bookNumber === null ? "" : ` · 编号 ${target.bookNumber}`}
          </p>
        )}
        {sourceKey === "guest" ? (
          <p className="mt-2 text-helper-relaxed text-muted">
            来源是本机游客账本；不会上传游客身份，导入后也不会自动删除本机数据。
          </p>
        ) : null}
      </div>

      {hasSources ? null : (
        <p className="text-helper-relaxed text-muted">
          没有可用的来源账本。导入来源必须是本机游客账本，或你本人拥有的另一本单人正式账本。
        </p>
      )}

      <Button onClick={onContinue} disabled={!hasSources}>
        查看预览
      </Button>
    </section>
  );
}

/**
 * 目标下拉的选项：目标必须是一本「本人拥有的单人账本」，所以和来源共用同一批单人账本；
 * 来源下拉已经排除了当前目标，目标下拉保留全部单人账本。
 */
function BookChoice({
  label,
  hint,
  value,
  onChange,
  placeholder,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium text-ink">{label}</span>
        <span className="text-helper text-muted">{hint}</span>
      </span>
      <select
        data-testid={label.includes("来源") ? "import-source" : "import-target"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-field border border-line bg-surface px-4 py-3 text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft"
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
    </label>
  );
}

function PreviewStep({
  preview,
  accountLabel,
  onBack,
  onReview,
}: {
  readonly preview: ImportPreview;
  readonly accountLabel: string;
  readonly onBack: () => void;
  readonly onReview: () => void;
}): React.JSX.Element {
  const { mapping, counts } = preview;
  const conflictCount = mapping.conflicts.length;
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
        <p className="mt-3 text-helper-relaxed text-muted">所属账号：{accountLabel}</p>
        {preview.source.kind === "guest" ? (
          <p className="mt-1 text-helper-relaxed text-muted">来源是本机游客账本，导入后本机数据仍会保留。</p>
        ) : null}
      </div>

      <div className="rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="section-title">这次会发生什么</h2>
        <div className="mt-4 grid grid-cols-3 divide-x divide-line">
          <Metric label="来源" value={`${String(counts.sourceTransactions)} 笔`} />
          <Metric label="可导入" value={`${String(counts.importableWithoutConflict)} 笔`} />
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
              目标账本已有 {String(counts.targetTransactions)} 条账目；本次只新增，不会修改它们。
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
          <MappingRow
            label="分类"
            reuse={mapping.counts.categories.reuse}
            create={mapping.counts.categories.create}
            conflict={mapping.counts.categories.conflict}
          />
          <MappingRow
            label="支付方式"
            reuse={mapping.counts.paymentMethods.reuse}
            create={mapping.counts.paymentMethods.create}
            conflict={mapping.counts.paymentMethods.conflict}
          />
          <MappingRow
            label="标签"
            reuse={mapping.counts.tags.reuse}
            create={mapping.counts.tags.create}
            conflict={mapping.counts.tags.conflict}
          />
          {conflictCount === 0 ? (
            <p className="text-helper-relaxed text-muted">没有同名但属性不同的对象。</p>
          ) : (
            <ul className="flex flex-col gap-2 pt-1">
              {mapping.conflicts.map((conflict) => (
                <ConflictRow key={`${conflict.type}:${conflict.sourceId}`} conflict={conflict} />
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
              只比较来源 B 与目标 A 的记录，来源内部或目标内部不会互相判定。
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
            <span>逐组查看这 {String(counts.duplicateGroups)} 组</span>
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
          </button>
        ) : (
          <p className="mt-3 text-helper-relaxed text-muted">没有发现可能重复的账目。</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
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
        {book.bookNumber === null ? null : (
          <span className="block text-helper text-muted">编号 {book.bookNumber}</span>
        )}
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
  reuse,
  create,
  conflict,
}: {
  readonly label: string;
  readonly reuse: number;
  readonly create: number;
  readonly conflict: number;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-body">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">
        复用 {String(reuse)} · 新建 {String(create)}
        {conflict > 0 ? <span className="text-brand-dark"> · 待确认 {String(conflict)}</span> : null}
      </span>
    </div>
  );
}

function ConflictRow({ conflict }: { readonly conflict: TaxonomyConflict }): React.JSX.Element {
  return (
    <li className="rounded-field bg-canvas px-3 py-3 text-sm text-ink">
      <p className="font-medium">
        {taxonomyLabel(conflict.type)}「{conflict.sourceName}」与目标「{conflict.targetName}」同名但属性不同
      </p>
      <p className="mt-1 text-helper-relaxed text-muted">{conflict.message}</p>
    </li>
  );
}

function ReviewStep({
  preview,
  groupIndex,
  onPrevious,
  onNext,
  onBack,
}: {
  readonly preview: ImportPreview;
  readonly groupIndex: number;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const groups = preview.duplicateGroups;
  const group = groups[groupIndex];
  if (group === undefined) {
    return (
      <section className="flex flex-col gap-3">
        <p className="text-body-relaxed text-muted">没有可以核对的重复组。</p>
        <Button variant="secondary" onClick={onBack}>
          返回预览
        </Button>
      </section>
    );
  }

  const sourceRecords = group.records.filter((record) => record.side === "source");
  const targetRecords = group.records.filter((record) => record.side === "target");

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

      <p className="text-helper-relaxed text-muted">
        当前只能查看核对，不会处理或删除任何账目。
      </p>

      <div className="mt-1 border-t border-line pt-3">
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
      </div>
    </section>
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
