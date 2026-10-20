/**
 * 「批量识别结果」概览页（S15-B B3）。
 *
 * 数据来自 `lib/ocr/batchStore.ts` 的 sessionStorage 批次，不再有演示数据。
 * 页面职责（设计方向 §3.3）：
 *  - 顶部汇总本次识别/待核对/可导入/可能重复/无效；
 *  - 卡片只读，点「查看详情」进入单笔编辑；
 *  - 用户只核对有问题的项；最后**一次**确认，才逐条走既有本地写入/离线队列；
 *  - 确认前零写入；页面只调用 `createEntry`，没有新的批量保存接口。
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { OcrOverview } from "../components/ocr/OcrOverview.js";
import { errorMessage } from "../lib/api.js";
import { assignImportIds, batchBelongsToBook, refreshDuplicateMarks, withoutBatchItems } from "../lib/ocr/batch.js";
import { clearBatch, loadBatch, saveBatch } from "../lib/ocr/batchStore.js";
import { findSuspectedDuplicates } from "../lib/ocr/duplicates.js";
import {
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
import { useBooks, useLedger } from "../lib/queries.js";
import { uuidV7 } from "../lib/uuid.js";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<OcrImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = ledger.data?.categories ?? [];
  const paymentMethods = ledger.data?.paymentMethods ?? [];
  const tags = ledger.data?.tags ?? [];
  const currentBookId = ledger.data?.book.id ?? null;
  const role = books.data?.books.find((book) => book.id === currentBookId)?.role ?? null;

  const items = batch?.items ?? [];
  const counts = countBatchItems(items);
  const visibleItems = filterBatchItems(items, filter, source, direction);
  const sources = useMemo(
    () => [...new Set(items.map((item) => item.sourcePlatform).filter((value) => value !== null))],
    [items],
  );
  const duplicateGroups = useMemo(() => findSuspectedDuplicates(items), [items]);
  const blockers = useMemo(() => (batch === null ? [] : findImportBlockers(batch)), [batch]);

  const wrongBook = batch !== null && !batchBelongsToBook(batch, currentBookId);
  const disabledReason = importDisabledReason({
    batch,
    validCount: counts.valid,
    blockers,
    wrongBook,
    readOnly,
    isViewer: role === "viewer",
  });

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
      subtitle="先看到识别出的全部交易，只核对有疑问的，最后统一确认。"
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
            filter={filter}
            onFilterChange={setFilter}
            source={source}
            onSourceChange={setSource}
            direction={direction}
            onDirectionChange={setDirection}
            sources={sources}
            duplicateGroups={duplicateGroups}
            categories={categories}
            paymentMethods={paymentMethods}
            tags={tags}
            onOpenDetail={openDetail}
            note={
              wrongBook
                ? "这批识别结果属于另一本账本：可以查看，但不能导入。请切回生成批次时的账本。"
                : "批次只保存在当前标签页的临时存储里；确认导入前不会写入账本。"
            }
          />

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
            {disabledReason === null ? (
              <p className="text-body-relaxed text-muted">
                确认后将逐条写入当前账本（复用本地写入/离线队列与幂等）。共 {counts.valid} 笔。
              </p>
            ) : (
              <p className="text-body-relaxed text-warning-dark">{disabledReason}</p>
            )}

            {blockers.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {blockers.slice(0, 5).map((blocker) => (
                  <li key={blocker.candidateId} className="text-helper-relaxed text-warning-dark">
                    ⚠ {blocker.label}：{blocker.reason}
                  </li>
                ))}
                {blockers.length > 5 ? (
                  <li className="text-helper text-muted">还有 {blockers.length - 5} 笔，请进详情核对。</li>
                ) : null}
              </ul>
            ) : null}

            <Button
              disabled={disabledReason !== null || importing}
              onClick={() => {
                setConfirmOpen(true);
              }}
            >
              {importing ? "正在导入…" : `确认导入 ${String(counts.valid)} 笔`}
            </Button>

            <Button
              variant="ghost"
              disabled={importing}
              onClick={() => {
                setCancelOpen(true);
              }}
            >
              取消这次识别
            </Button>
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`确认导入 ${String(counts.valid)} 笔？`}
        description="导入后会逐条写入当前账本。确认前没有任何账本写入。"
        consequences={[
          `其中 ${String(counts.confirmed)} 笔无需修改，${String(counts.pending)} 笔曾被标记为待核对。`,
          counts.duplicates > 0
            ? `可能包含 ${String(counts.duplicates)} 笔疑似重复；系统不会自动合并或删除，是否都保留由你决定。`
            : "没有疑似重复。",
          counts.invalid > 0 ? `已标记无效的 ${String(counts.invalid)} 笔不会导入。` : "",
          "离线时先写入本机队列，联网后自动投递；不会显示成云端已保存。",
        ].filter((line) => line !== "")}
        confirmLabel={`确认导入 ${String(counts.valid)} 笔`}
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
