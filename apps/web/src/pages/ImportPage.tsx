import type { BillImportCandidate, BillImportPreview, ImportReport } from "@libellum/shared";
import { useRef, useState, type DragEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import {
  BillCommitBar,
  BillDoneView,
  BillDuplicateSection,
  BillFileSummary,
  BillFilterRow,
  BillParsingCard,
  BillPickCard,
  BillRowCard,
  BillSummaryPanel,
  billItemsById,
} from "../components/import/BillImportViews.js";
import { InnerPage } from "../components/Layouts.js";
import { ApiRequestError, errorMessage } from "../lib/api.js";
import {
  BILL_SOURCE_LABELS,
  billRowProblem,
  commitBill,
  previewBill,
  recheckBill,
} from "../lib/billImport.js";
import {
  BILL_IMPORT_ACCEPT,
  billAcknowledgementReasons,
  billCommitCheck,
  billDuplicateGroups,
  billFileProblem,
  billFilterCounts,
  billFilterRows,
  billHistoryDuplicates,
  billReportView,
  billRowNotes,
  billRowStatus,
  type BillImportFilter,
} from "../lib/billImportUi.js";
import { localTimeZone } from "../lib/datetime.js";
import { formatMoney, parseAmountInput } from "../lib/format.js";
import { fetchTemplate, useLedgerMeta, useMoneyInvalidator } from "../lib/queries.js";
import { deliverFile } from "../lib/share.js";

/**
 * 账单导入 V2：选文件 → 服务端识别 → 概览核对 → 批量入账。
 *
 * 和旧版（只认 Libevra 自己导出的 CSV、整批要么全成功要么全失败）的区别：
 *
 *  * **格式由服务端按内容识别**（微信 XLSX / 支付宝 CSV / BOA PDF / Libevra CSV），
 *    前端不按文件名猜；
 *  * **先预览再写入**：`previewBill` 拿到逐笔候选，用户在概览里筛选、保留/跳过、
 *    展开改字段，`recheckBill` 重算疑似重复，最后 `commitBill` 一次写入；
 *  * **判重只有一处**：文件内重复与历史账目重复都由服务端统一判重，前端只展示与选择，
 *    绝不自动取消勾选、绝不删除/合并已有账目；
 *  * **身份重复与内容重复分开**：`identityDuplicate`（来源身份已存在）默认不选、不可选；
 *    `duplicateIds`（疑似重复）只提示。
 *
 * ⚠️ **没有独立的 /import/review 路由**：契约里没有“按 previewId 重新取预览”的读接口，
 * 预览只存在于当前页面的内存里。刷新或从别处深链进来只会回到选文件状态——这是有意的，
 * 避免出现“看起来能恢复、实际上预览已过期”的半状态。
 *
 * ⚠️ **入口语义不能变**（见 `ImportPage.entry.test.tsx`）：
 *
 *  * 中央 `+` 菜单用 `/import?from=nav`；这一来路隐藏「← 返回导出」，深链回退到明细 `/`；
 *  * 旧 `/export → /import` 链路保留 `/export` 作为回退，并保留「← 返回导出」；
 *  * 账本设置的目标模式（`/books/:bookId/settings/import`）始终显示目标账本横幅与编号。
 */

const PAGE_SIZE = 100;

type Step =
  | { readonly name: "choose" }
  | { readonly name: "parsing" }
  | { readonly name: "review"; readonly preview: BillImportPreview }
  | { readonly name: "done"; readonly preview: BillImportPreview; readonly report: ImportReport };

type Busy = null | "preview" | "commit" | "recheck";

/** The target ledger, when the route names one — **the whole point of the banner**. */
interface ImportTarget {
  /** ⚠️ `名称（编号）`, because two ledgers can share a name. */
  readonly label: string;
  readonly failure: string | null;
}

export function ImportPage(): React.JSX.Element {
  const { bookId } = useParams<{ bookId?: string }>();

  return bookId === undefined ? <ImportForCurrentLedger /> : <ImportForBook bookId={bookId} />;
}

function ImportForCurrentLedger(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  /** The central `+` menu opens this route with `?from=nav` — see the note at the top. */
  const fromMenu = searchParams.get("from") === "nav";

  return (
    <ImportView
      backTo={fromMenu ? "/" : "/export"}
      exportTo="/export"
      doneTo="/"
      doneLabel="回到明细"
      hideExportLink={fromMenu}
    />
  );
}

function ImportForBook({ bookId }: { readonly bookId: string }): React.JSX.Element {
  const meta = useLedgerMeta(bookId);

  const name = meta.data?.book.name ?? null;
  const bookNumber = meta.data?.book.bookNumber ?? null;
  const label = name === null ? "正在读取账本……" : bookNumber === null ? name : `${name}（${bookNumber}）`;

  return (
    /**
     * ⚠️ **Keyed by the ledger**: a half-finished review (or a file already chosen) must not carry
     * over if the address is edited to another ledger — writing the right file into the wrong book
     * is the most expensive mistake this screen can make.
     */
    <ImportView
      key={bookId}
      bookId={bookId}
      backTo={`/books/${bookId}/settings`}
      exportTo={`/books/${bookId}/settings/export`}
      doneTo={`/books/${bookId}/settings`}
      doneLabel="回到账本设置"
      target={{ label, failure: meta.isError ? errorMessage(meta.error) : null }}
    />
  );
}

function ImportView({
  bookId,
  backTo,
  exportTo,
  doneTo,
  doneLabel,
  target,
  hideExportLink = false,
}: {
  /** Target ledger; `undefined` means "the ledger this device is in". */
  readonly bookId?: string;
  /** Deep-link fallback for the frame's 返回. Target mode lands on 账本设置. */
  readonly backTo: string;
  /** Where 「← 返回导出」 goes — the export screen of the same ledger. */
  readonly exportTo: string;
  /** Where the done screen's 「完成」 goes. */
  readonly doneTo: string;
  readonly doneLabel: string;
  /** Present only when the address names a ledger; name **and** number are shown. */
  readonly target?: ImportTarget;
  /** ⚠️ Hide the legacy export shortcut when opened from the central `+` menu. */
  readonly hideExportLink?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  /** 逐笔字段校验的缓存：编辑一笔不会重算另外几万笔。 */
  const problemCache = useRef(new WeakMap<BillImportCandidate, string | null>());

  const duplicateSettings = useDuplicateDetectionSettings();
  const meta = useLedgerMeta(bookId ?? "");
  const invalidateMoney = useMoneyInvalidator(bookId);

  const [step, setStep] = useState<Step>({ name: "choose" });
  /** Kept outside the step so a failed preview can still name the file it failed on. */
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [filter, setFilter] = useState<BillImportFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  /** 编辑过字段但还没重新检查：底部会出现「重新检查重复」。 */
  const [dirty, setDirty] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const failure = target?.failure ?? null;

  function problemOf(item: BillImportCandidate): string | null {
    const cached = problemCache.current.get(item);
    if (cached !== undefined) return cached;
    const problem = billRowProblem(item);
    problemCache.current.set(item, problem);
    return problem;
  }

  const preview = step.name === "review" || step.name === "done" ? step.preview : null;
  const items = preview?.candidates ?? [];
  const counts = billFilterCounts(items, problemOf);
  const filtered = billFilterRows(items, filter, problemOf);
  const visible = filtered.slice(0, visibleCount);
  const groups = billDuplicateGroups(items);
  const history = billHistoryDuplicates(items);
  const itemsById = preview === null ? new Map<string, BillImportCandidate>() : billItemsById(preview);
  const ackReasons = preview === null ? [] : billAcknowledgementReasons(preview);
  const problemsById = new Map(items.map((item) => [item.id, problemOf(item)]));
  const check =
    preview === null ? null : billCommitCheck(items, preview, acknowledged, problemsById);

  const categories = meta.data?.categories ?? [];
  const paymentMethods = meta.data?.paymentMethods ?? [];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const paymentNames = new Map(paymentMethods.map((method) => [method.id, method.name]));

  function moneyText(item: BillImportCandidate): string {
    try {
      return formatMoney(parseAmountInput(item.amount, item.currency), item.currency);
    } catch {
      return item.amount.trim() === "" ? "金额待填写" : item.amount;
    }
  }

  function openPicker(): void {
    // `value` is reset in the input's onChange, so picking the same file twice still fires.
    fileInput.current?.click();
  }

  function resetToChoose(): void {
    setStep({ name: "choose" });
    setFile(null);
    setFilter("all");
    setExpandedId(null);
    setAcknowledged(false);
    setDirty(false);
    setVisibleCount(PAGE_SIZE);
    setConfirmOpen(false);
  }

  async function downloadTemplate(): Promise<void> {
    setTemplateBusy(true);
    setError(null);
    try {
      /** ⚠️ The template is per ledger: headings are the same, but the request names the target. */
      const template = await fetchTemplate(bookId);
      await deliverFile(template.fileName, template.mimeType, template.bytes);
    } catch (caught) {
      setError(`模板下载失败：${errorMessage(caught)}`);
    } finally {
      setTemplateBusy(false);
    }
  }

  async function startPreview(picked: File): Promise<void> {
    const problem = billFileProblem(picked);
    if (problem !== null) {
      setError(problem);
      return;
    }

    setError(null);
    setFile(picked);
    setStep({ name: "parsing" });
    setBusy("preview");

    try {
      const next = await previewBill(
        picked,
        bookId ?? "",
        duplicateSettings.settings,
        localTimeZone(),
      );
      setStep({ name: "review", preview: next });
      setFilter("all");
      setExpandedId(null);
      setAcknowledged(false);
      setDirty(false);
      setVisibleCount(PAGE_SIZE);
    } catch (caught) {
      /**
       * A thrown `ApiRequestError` means the API answered with a readable problem
       * (unsupported format, too many rows, …). Anything else means the browser
       * never reached the API at all — usually the local server is not running.
       *
       * Saying “没能识别这个文件” for the latter was misleading: the file was fine
       * and the parser never received it. Name the actual next step instead.
       */
      setError(
        caught instanceof ApiRequestError
          ? `没能识别这个文件：${errorMessage(caught)}`
          : `没能识别这个文件：连不上本地服务。这个文件本身不一定有问题，请先启动本地 API（项目根目录运行 pnpm dev），刷新页面后重试。（${errorMessage(caught)}）`,
      );
      setStep({ name: "choose" });
    } finally {
      setBusy(null);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped !== undefined) void startPreview(dropped);
  }

  /**
   * 改一笔。只替换这一笔的对象（其余保持引用），这样 `problemOf` 的 WeakMap 缓存继续命中。
   * 勾选状态单独走 `toggle`，不算“改过字段”，不会触发“重新检查重复”的提示。
   */
  function patchCandidate(id: string, patch: Partial<BillImportCandidate>, markDirty = true): void {
    if (step.name !== "review") return;
    setStep({
      name: "review",
      preview: {
        ...step.preview,
        candidates: step.preview.candidates.map((candidate) =>
          candidate.id === id ? { ...candidate, ...patch } : candidate,
        ),
      },
    });
    if (markDirty) setDirty(true);
  }

  async function runRecheck(): Promise<void> {
    if (step.name !== "review") return;

    setBusy("recheck");
    setError(null);
    try {
      const next = await recheckBill(step.preview, bookId ?? "", duplicateSettings.settings);
      setStep({ name: "review", preview: next });
      setDirty(false);
    } catch (caught) {
      setError(`重新检查失败：${errorMessage(caught)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runCommit(previewToCommit: BillImportPreview): Promise<void> {
    setConfirmOpen(false);
    setBusy("commit");
    setError(null);
    try {
      const report = await commitBill(previewToCommit, bookId ?? "", acknowledged);
      // 写入成功后刷新明细与汇总；目标账本不是当前账本时这个 invalidator 什么也不做。
      await invalidateMoney();
      setStep({ name: "done", preview: previewToCommit, report });
    } catch (caught) {
      setError(`导入没有完成：${errorMessage(caught)}`);
      // 预览还留着，可以直接再试；后端按来源身份幂等，不会重复写入。
      setStep((current) =>
        current.name === "done" ? current : { name: "review", preview: previewToCommit },
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <InnerPage
      title="导入账单"
      subtitle="微信、支付宝、银行结单都可以。先识别，核对后再写入。"
      backTo={backTo}
    >
      {error === null ? null : <Alert>{error}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}

      {/**
       * ⚠️ **The target is stated before anything is chosen, not after.** A person who opened the
       * wrong ledger's settings must be able to notice it here — with the number, not only the name.
       */}
      {target === undefined ? null : (
        <div className="flex flex-col gap-1 rounded-field bg-brand-soft px-4 py-3 text-brand-dark">
          <p className="text-body font-medium">导入到「{target.label}」</p>
          <p className="text-helper-relaxed">请先确认这是你要写入的账本。下面的文件会写进这本账。</p>
        </div>
      )}

      {/**
       * ⚠️ `sr-only`, never `hidden`/`display:none`: iOS Safari ignores programmatic clicks on an
       * input that is not rendered. One input serves 选择 / 更换 in every step.
       */}
      <input
        ref={fileInput}
        type="file"
        accept={BILL_IMPORT_ACCEPT}
        aria-label="选择账单文件"
        className="sr-only"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          // Reset so choosing the same file twice still fires a change.
          event.target.value = "";
          if (picked !== undefined) void startPreview(picked);
        }}
      />

      {step.name === "choose" ? (
        <section className="flex flex-col gap-4">
          {file === null ? (
            <BillPickCard
              busy={busy === "preview"}
              disabled={failure !== null}
              dragging={dragging}
              onPick={openPicker}
              onDragOver={(event) => {
                event.preventDefault();
                if (busy === null) setDragging(true);
              }}
              onDragLeave={() => {
                setDragging(false);
              }}
              onDrop={onDrop}
              template={{ busy: templateBusy, onDownload: () => void downloadTemplate() }}
            />
          ) : (
            <>
              <BillFileSummary
                fileName={file.name}
                fileSize={file.size}
                formatLabel={null}
                sourceLabel={null}
                busy={busy !== null}
                onChange={openPicker}
                onClear={resetToChoose}
              />
              <p className="text-helper-relaxed text-muted">换一个文件会重新识别，之前的勾选不会带过去。</p>
            </>
          )}

          {hideExportLink ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                void navigate(exportTo);
              }}
            >
              ← 返回导出
            </Button>
          )}
        </section>
      ) : null}

      {step.name === "parsing" && file !== null ? (
        <BillParsingCard fileName={file.name} fileSize={file.size} />
      ) : null}

      {step.name === "review" ? (
        <section className="flex flex-col gap-4">
          {file === null ? null : (
            <BillFileSummary
              fileName={file.name}
              fileSize={file.size}
              formatLabel={step.preview.format.toUpperCase()}
              sourceLabel={BILL_SOURCE_LABELS[step.preview.source]}
              busy={busy !== null}
              onChange={openPicker}
              onClear={resetToChoose}
            />
          )}

          {ackReasons.length === 0 ? null : (
            <div className="flex flex-col gap-1 rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-warn-dark">
              <p className="text-body font-medium">这份文件有需要你先了解的情况</p>
              <ul className="flex flex-col gap-1">
                {ackReasons.map((reason) => (
                  <li key={reason}>⚠ {reason}</li>
                ))}
              </ul>
              {step.preview.reconciliation.ok === false ? (
                <p>确认无误后，请在底部勾选「我已了解上面的提示」再导入；已有账目不会被改动。</p>
              ) : null}
            </div>
          )}

          {step.preview.reconciliation.ok === true ? (
            <p className="text-helper text-muted">对账：文件里的合计与明细一致。</p>
          ) : null}

          <BillSummaryPanel
            counts={counts}
            selectedCount={counts.selected}
            readCount={items.length}
            identitySkipped={counts.identity}
          />

          <BillFilterRow
            filter={filter}
            counts={counts}
            onSelect={(next) => {
              setFilter(next);
              setVisibleCount(PAGE_SIZE);
            }}
          />

          {filter === "all" || filter === "duplicate" ? (
            <BillDuplicateSection
              groups={groups.slice(0, 20)}
              history={history}
              itemsById={itemsById}
              moneyText={moneyText}
              busy={busy !== null}
              onToggle={(id, selected) => {
                patchCandidate(id, { selected }, false);
              }}
            />
          ) : null}

          <section aria-label="逐笔记录" className="flex flex-col gap-3">
            {visible.length === 0 ? (
              <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-helper text-muted">
                这个筛选下没有记录。
              </p>
            ) : null}

            {visible.map((item) => {
              const status = billRowStatus(item, problemOf(item));
              const historyIds =
                history.find((entry) => entry.candidateId === item.id)?.ids ?? [];
              return (
                <BillRowCard
                  key={item.id}
                  item={item}
                  status={status}
                  notes={billRowNotes(item, problemOf(item), historyIds)}
                  moneyText={moneyText(item)}
                  categoryName={item.categoryId === null ? null : (categoryNames.get(item.categoryId) ?? null)}
                  paymentName={
                    item.paymentMethodId === null
                      ? null
                      : (paymentNames.get(item.paymentMethodId) ?? null)
                  }
                  expanded={expandedId === item.id}
                  busy={busy !== null}
                  categories={categories}
                  paymentMethods={paymentMethods}
                  onToggle={(selected) => {
                    patchCandidate(item.id, { selected }, false);
                  }}
                  onExpand={() => {
                    setExpandedId(expandedId === item.id ? null : item.id);
                  }}
                  onPatch={(patch) => {
                    patchCandidate(item.id, patch);
                  }}
                />
              );
            })}
          </section>

          {filtered.length > visible.length ? (
            <Button
              variant="secondary"
              onClick={() => {
                setVisibleCount(visibleCount + PAGE_SIZE);
              }}
            >
              显示更多（还有 {String(filtered.length - visible.length)} 笔）
            </Button>
          ) : null}

          {groups.length > 20 ? (
            <p className="text-helper text-muted">
              疑似重复共 {String(groups.length)} 组，这里只列出前 20 组；用「疑似重复」筛选可以逐条查看。
            </p>
          ) : null}

          {/* ⚠️ 固定底栏会盖住最后一笔，这里留出等高空白（`InnerPage` 的 padding 不归本页）。 */}
          <div aria-hidden="true" className="h-44" />
        </section>
      ) : null}

      {step.name === "review" && check !== null ? (
        <BillCommitBar
          importableCount={check.importableCount}
          selectedCount={check.selectedCount}
          blockers={check.blockers}
          needsAcknowledgement={check.needsAcknowledgement}
          acknowledged={acknowledged}
          busy={busy !== null}
          dirty={dirty}
          rechecking={busy === "recheck"}
          onAcknowledge={setAcknowledged}
          onConfirm={() => {
            setConfirmOpen(true);
          }}
          onCancel={resetToChoose}
          onRecheck={() => void runRecheck()}
        />
      ) : null}

      {step.name === "done" ? (
        <BillDoneView
          view={billReportView(
            step.report,
            step.preview,
            billFilterCounts(step.preview.candidates, problemOf).selected,
          )}
          fileRef={step.report.fileRef ?? null}
          exportedFileRef={step.report.exportedFileRef ?? null}
          targetLabel={target?.label ?? null}
          doneLabel={doneLabel}
          busy={busy !== null}
          onDone={() => {
            resetToChoose();
            void navigate(doneTo);
          }}
          onAgain={resetToChoose}
          onRetry={() => {
            if (step.name === "done") void runCommit(step.preview);
          }}
        />
      ) : null}

      {/* The confirmation the owner asked for: say how many rows, and what happens, before writing. */}
      <ConfirmDialog
        open={confirmOpen}
        title="确认导入"
        description="会把这批选中的记录写入账本，写入后可以在明细里逐笔查看。"
        confirmLabel={
          busy === "commit" || check === null ? "正在导入…" : `开始导入 ${String(check.importableCount)} 笔`
        }
        cancelLabel="再看看"
        // Not `danger`: importing adds records. A red confirm button would say "this deletes something".
        tone="default"
        busy={busy === "commit"}
        onCancel={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          if (step.name === "review") void runCommit(step.preview);
        }}
        consequences={
          step.name === "review"
            ? [
                `文件：${file?.name ?? "已选文件"}`,
                ...(target === undefined ? [] : [`导入到：「${target.label}」`]),
                `可导入 ${String(check?.importableCount ?? 0)} 笔；跳过 ${String(counts.excluded)} 笔${
                  counts.identity === 0 ? "" : `（其中来源已存在 ${String(counts.identity)} 笔）`
                }。`,
                `疑似重复 ${String(counts.duplicate)} 笔：只提示，不会删除或改动账本里已有的记录。`,
                ...ackReasons.slice(0, 5).map((reason) => `已确认：${reason}`),
                "已存在的来源会被跳过，不会重复写入；同一份文件再次导入也不会多出账目。",
              ]
            : []
        }
      />
    </InnerPage>
  );
}
