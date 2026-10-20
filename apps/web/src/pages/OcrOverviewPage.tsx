/**
 * 「批量识别结果」概览页（S15-B B3）。
 *
 * 数据来自 `lib/ocr/batchStore.ts` 的 sessionStorage 批次，不再有演示数据。
 * 页面职责（设计方向 §3.3）：
 *  - 顶部一行数字（识别总数/待核对/疑似重复/可导入），其余口径收进「详情」；
 *  - 卡片只读，点「查看详情」进入单笔编辑；筛选保留状态、来源、方向三种，来源与方向
 *    收进折叠面板；
 *  - 用户只核对有问题的项；最后**一次**确认，才逐条走既有本地写入/离线队列；
 *  - 确认前零写入；页面只调用 `createEntry`，没有新的批量保存接口。
 *
 * 分类候选按**批次所属账本**读取（`useLedgerMeta`）：批次可能来自另一本账，拿当前账本
 * 的分类去联想或显示都是跨账本串味。批次属于别的账时只读、不导入，也不写联想结果。
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { OcrImportBar, OcrOverview } from "../components/ocr/OcrOverview.js";
import { errorMessage } from "../lib/api.js";
import { assignImportIds, batchBelongsToBook, refreshDuplicateMarks, withoutBatchItems } from "../lib/ocr/batch.js";
import { clearBatch, loadBatch, saveBatch } from "../lib/ocr/batchStore.js";
import { applyCategorySuggestions } from "../lib/ocr/category.js";
import { findSuspectedDuplicates } from "../lib/ocr/duplicates.js";
import {
  countImportableItems,
  findImportBlockers,
  type OcrImportBlocker,
  type OcrImportOutcome,
} from "../lib/ocr/import.js";
import { executeImport } from "../lib/ocr/importExecution.js";
import {
  countBatchItems,
  filterBatchItems,
  type OcrBatch,
  type OcrDirectionFilter,
  type OcrOverviewFilter,
  type OcrSourceFilter,
} from "../lib/ocr/types.js";
import { createEntry as createLocally, localEntry } from "../lib/offline/write.js";
import { useSharedLedgerOfflineReadOnly } from "../lib/offline/writePolicy.js";
import { useBooks, useLedger, useLedgerMeta } from "../lib/queries.js";
import { uuidV7 } from "../lib/uuid.js";

/**
 * 列底空白：固定操作条不盖住最后一笔。
 *
 * 操作条自身已经让出安全区（`OcrImportBar`），这里再留出条高 + 余量，滚动到底时最后
 * 一张卡片完整可见。`InnerPage` 的 `py-8` 不归本页所有，所以不在那里加。
 */
const BOTTOM_BAR_CLEARANCE = "h-44";

export function OcrOverviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const ledger = useLedger();
  const books = useBooks();
  const { readOnly } = useSharedLedgerOfflineReadOnly();

  const [batch, setBatch] = useState<OcrBatch | null>(() => {
    const stored = loadBatch();
    // Recompute rather than trusting the stored marks: an edit could have been
    // made by a previous build, and the user must never see a stale duplicate.
    return stored === null ? null : refreshDuplicateMarks(stored).batch;
  });
  const [filter, setFilter] = useState<OcrOverviewFilter>("all");
  const [source, setSource] = useState<OcrSourceFilter>("all");
  const [direction, setDirection] = useState<OcrDirectionFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<OcrImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = batch?.items ?? [];
  const currentBookId = ledger.data?.book.id ?? null;
  const role = books.data?.books.find((book) => book.id === currentBookId)?.role ?? null;
  const wrongBook = batch !== null && !batchBelongsToBook(batch, currentBookId);

  /**
   * 批次所属账本的分类/支付方式/标签。批次有 `bookId` 就按它读；没有（旧批次/无账本
   * 上下文）用 `""`，即当前账本。
   *
   * ⚠️ 批次属于另一本账时不回退到当前账本的分类：那会把 A 账的分类名显示在 B 账的
   * 候选上，也会让联想拿到错误的候选集。宁可显示“未分类”，也不跨账本串味。
   */
  const batchBookId = batch?.bookId ?? "";
  const bookMeta = useLedgerMeta(batchBookId);
  const categories =
    bookMeta.data?.categories ?? (wrongBook ? undefined : ledger.data?.categories) ?? [];
  const paymentMethods =
    bookMeta.data?.paymentMethods ?? (wrongBook ? undefined : ledger.data?.paymentMethods) ?? [];
  const tags = bookMeta.data?.tags ?? (wrongBook ? undefined : ledger.data?.tags) ?? [];

  /**
   * 分类联想：把“交易对象/备注文字 → 本账本已有分类”的匹配写进批次草稿，并标来源
   * `inferred`。纯函数在 `lib/ocr/category.ts`，这里只负责在分类列表就绪后应用一次。
   *
   * 幂等：已经推断过或用户选过的项 `categoryId` 非空，`applyCategorySuggestions` 返回
   * `null`，不会再次写状态。存储写入失败只影响“下次进详情还能不能看到建议”，不改账本。
   */
  useEffect(() => {
    if (batch === null || wrongBook || categories.length === 0) return;

    const suggested = applyCategorySuggestions(batch.items, categories);
    if (suggested === null) return;

    const updated: OcrBatch = { ...batch, items: suggested };
    saveBatch(updated);
    setBatch(updated);
  }, [batch, categories, wrongBook]);

  const counts = countBatchItems(items);
  const importableCount = countImportableItems(items);
  const visibleItems = filterBatchItems(items, filter, source, direction);
  const sources = useMemo(
    () => [...new Set(items.map((item) => item.sourcePlatform).filter((value) => value !== null))],
    [items],
  );
  const duplicateGroups = useMemo(() => findSuspectedDuplicates(items), [items]);
  const blockers = useMemo(() => (batch === null ? [] : findImportBlockers(batch)), [batch]);
  const unresolvedPages =
    batch?.pages.filter((page) => page.pageType === "unknown").length ?? 0;

  const disabledReason = importDisabledReason({
    batch,
    validCount: counts.valid,
    blockers,
    wrongBook,
    readOnly,
    isViewer: role === "viewer",
  });

  /**
   * 批次级风险提示。压缩页面时**不能**压掉它们：属于别的账本、有截图没切出候选，
   * 都会让“看到的总数”和“实际的截图”对不上。
   */
  const warnings: string[] = [];
  if (wrongBook) {
    warnings.push("这批识别结果属于另一本账本：可以查看，但不能导入。请切回生成批次时的账本。");
  }
  if (unresolvedPages > 0) {
    warnings.push(
      `另有 ${String(unresolvedPages)} 张截图无法判断页面类型，没有生成候选；需要时请单独上传并按单笔/多笔处理。`,
    );
  }

  function openDetail(candidateId: string): void {
    void navigate(`/ocr/overview/${encodeURIComponent(candidateId)}`);
  }

  function cancelBatch(): void {
    clearBatch();
    setBatch(null);
    setOutcome(null);
    void navigate("/scan");
  }

  async function confirmImport(): Promise<void> {
    if (batch === null) return;

    setConfirmOpen(false);
    setImporting(true);
    setError(null);

    try {
      /**
       * ⚠️ **Ids are minted once, here, and written down before the first write.**
       *
       * If a retry generated new ids, the server's idempotency key would not
       * recognise the earlier attempt and the ledger would gain duplicates. If
       * the storage write fails, the import is cancelled rather than proceeding
       * with ids that a refresh could not reuse.
       */
      const assigned = assignImportIds(batch, uuidV7);
      if (!saveBatch(assigned)) {
        setError("无法把固定的幂等 id 写入浏览器存储，已取消导入。请检查隐私模式/存储空间后重试。");
        return;
      }
      setBatch(assigned);

      const result = await executeImport(
        assigned,
        async (input) => {
          const written = await createLocally(input, localEntry(input, ledger.data));
          return { pending: written.pending };
        },
        errorMessage,
      );

      if (result.blockers.length > 0) {
        // The button is disabled when blockers exist; reaching here means the
        // batch changed underneath the screen. Refuse instead of skipping a row.
        setError(`有 ${String(result.blockers.length)} 笔还不能导入，请先核对或标记无效。`);
        return;
      }

      const succeededIds = result.succeeded.map((entry) => entry.candidateId);

      if (result.failed.length === 0) {
        clearBatch();
        setBatch(null);
      } else {
        // Delivered items leave the batch; failed ones stay, with their fixed
        // ids, so retrying is safe and the summary can say exactly what remains.
        const remaining = withoutBatchItems(assigned, succeededIds);
        saveBatch(remaining);
        setBatch(remaining);
      }

      setOutcome(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  return (
    <InnerPage
      title="批量识别结果"
      subtitle="只核对有疑问的；确认前不写账本。"
      backTo="/scan"
      actions={
        <Button
          variant="secondary"
          fullWidth={false}
          onClick={() => {
            void navigate("/scan");
          }}
        >
          重新识别
        </Button>
      }
    >
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {outcome !== null ? (
        <ImportOutcomeView
          outcome={outcome}
          remaining={batch?.items.length ?? 0}
          onBackToBatch={() => {
            setOutcome(null);
          }}
          onLedger={() => {
            void navigate("/");
          }}
          onAgain={() => {
            void navigate("/scan");
          }}
        />
      ) : batch === null ? (
        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 className="text-section-title text-ink">没有待核对的批次</h2>
          <p className="text-body-relaxed text-muted">
            这次识别结果已经清除（确认导入成功、取消，或换了一个标签页）。可以重新上传截图，或直接手动记账。
          </p>
          <Button
            onClick={() => {
              void navigate("/scan");
            }}
          >
            去上传截图
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void navigate("/add");
            }}
          >
            直接手动记账
          </Button>
        </section>
      ) : (
        <>
          <OcrOverview
            items={visibleItems}
            counts={counts}
            importableCount={importableCount}
            filter={filter}
            onFilterChange={setFilter}
            source={source}
            onSourceChange={setSource}
            direction={direction}
            onDirectionChange={setDirection}
            filtersOpen={filtersOpen}
            onToggleFilters={() => {
              setFiltersOpen((open) => !open);
            }}
            sources={sources}
            duplicateGroups={duplicateGroups}
            categories={categories}
            paymentMethods={paymentMethods}
            tags={tags}
            onOpenDetail={openDetail}
            warnings={warnings}
            note="批次只保存在当前标签页的临时存储里，关掉标签页就消失；确认导入前不会写入账本。"
          />

          {/* 固定操作条不占文档流，这里补出等高空白，最后一笔不会被挡住。 */}
          <div aria-hidden="true" className={BOTTOM_BAR_CLEARANCE} />

          <OcrImportBar
            importableCount={importableCount}
            blockedReason={disabledReason}
            blockers={blockers}
            busy={importing}
            onConfirm={() => {
              setConfirmOpen(true);
            }}
            onCancel={() => {
              setCancelOpen(true);
            }}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`确认导入 ${String(importableCount)} 笔？`}
        description="导入后会逐条写入当前账本。确认前没有任何账本写入。"
        consequences={[
          `其中 ${String(counts.confirmed)} 笔无需修改，${String(counts.pending)} 笔曾被标记为待核对。`,
          counts.duplicates > 0
            ? `可能包含 ${String(counts.duplicates)} 笔疑似重复；系统不会自动合并或删除，是否都保留由你决定。`
            : "没有疑似重复。",
          counts.invalid > 0 ? `已标记无效的 ${String(counts.invalid)} 笔不会导入。` : "",
          "离线时先写入本机队列，联网后自动投递；不会显示成云端已保存。",
        ].filter((line) => line !== "")}
        confirmLabel={`确认导入 ${String(importableCount)} 笔`}
        tone="default"
        busy={importing}
        onConfirm={() => {
          void confirmImport();
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="取消这次识别？"
        description="这批识别结果只会从当前标签页清除，不会影响账本。"
        consequences={["已导入的账目不受影响。", "取消后需要重新上传截图才能再次核对。"]}
        confirmLabel="放弃并返回"
        cancelLabel="继续核对"
        onConfirm={cancelBatch}
        onCancel={() => {
          setCancelOpen(false);
        }}
      />
    </InnerPage>
  );
}

/**
 * Why the confirm button must be disabled, or `null` when it may be pressed.
 *
 * Exported because this is the screen's safety decision and it is worth testing
 * without a browser: a disabled button with no reason is indistinguishable from
 * a broken one, and an enabled button over a write the server will refuse is
 * worse.
 */
export function importDisabledReason({
  batch,
  validCount,
  blockers,
  wrongBook,
  readOnly,
  isViewer,
}: {
  readonly batch: OcrBatch | null;
  readonly validCount: number;
  readonly blockers: readonly OcrImportBlocker[];
  readonly wrongBook: boolean;
  readonly readOnly: boolean;
  readonly isViewer: boolean;
}): string | null {
  if (batch === null) return "没有待导入的批次。";
  if (wrongBook) return "这批识别结果属于另一本账本，不能导入。请切回原账本。";
  if (readOnly) return "当前离线，共享账本暂时只能查看；恢复网络后才能导入。";
  if (isViewer) return "你在本账本中是只读成员，不能导入账目。";
  if (validCount === 0) return "没有可导入的笔数（可能都已标记无效）。";
  if (blockers.length > 0) {
    return `还有 ${String(blockers.length)} 笔不能导入（${blockers[0]?.reason ?? ""}），请先核对或标记无效。`;
  }
  return null;
}

function ImportOutcomeView({
  outcome,
  remaining,
  onBackToBatch,
  onLedger,
  onAgain,
}: {
  readonly outcome: OcrImportOutcome;
  readonly remaining: number;
  readonly onBackToBatch: () => void;
  readonly onLedger: () => void;
  readonly onAgain: () => void;
}): React.JSX.Element {
  const pending = outcome.succeeded.filter((entry) => entry.pending).length;
  const delivered = outcome.succeeded.length - pending;

  return (
    <section aria-label="导入结果" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 className="text-section-title text-ink">导入结果</h2>
      <p className="text-body text-ink">
        成功 {outcome.succeeded.length} / 失败 {outcome.failed.length}（共尝试 {outcome.attempted} 笔）
      </p>

      {pending > 0 ? (
        <Alert tone="info">
          其中 {pending} 笔已在本机排队，联网后自动投递；另有 {delivered} 笔已同步到服务器。
        </Alert>
      ) : null}

      {outcome.failed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-body-relaxed text-warning-dark">
            以下 {outcome.failed.length} 笔没有写入，仍留在批次里（剩余 {remaining} 笔）：
          </p>
          <ul className="flex flex-col gap-1">
            {outcome.failed.map((failure) => (
              <li key={failure.candidateId} className="text-helper-relaxed text-warning-dark">
                ⚠ {failure.label}：{failure.reason}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={onBackToBatch}>
            返回概览重试
          </Button>
        </div>
      ) : (
        <p className="text-helper-relaxed text-muted">全部成功，批次已清除。</p>
      )}

      <Button onClick={onLedger}>查看明细</Button>
      <Button variant="ghost" onClick={onAgain}>
        再识别一批
      </Button>
    </section>
  );
}
