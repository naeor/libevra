import type { ImportReport } from "@libellum/shared";
import {
  describeDuplicateMatch,
  groupDuplicatePairs,
  normalizeNotDuplicatePair,
  type DuplicatePairResult,
  type Transaction,
} from "@libellum/shared";
import { useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useDuplicateDetectionSettings } from "../components/DuplicateDetectionSettings.js";
import { InnerPage } from "../components/Layouts.js";
import { errorMessage } from "../lib/api.js";
import { duplicateBookId, fetchImportReview } from "../lib/duplicateReview.js";
import { formatMoney } from "../lib/format.js";
import { createNotDuplicateRelations } from "../lib/notDuplicateRelations.js";
import { fetchTemplate, useImportEntries, useLedgerMeta } from "../lib/queries.js";
import { deliverFile } from "../lib/share.js";

/**
 * Import historical entries from a CSV.
 *
 * The shape of this screen follows from one decision made on the server: an
 * import either writes **every** valid row or **none** of them. So there is no
 * partial state to report and no "23 of 40 rows imported" to explain — the
 * outcome is a report the user reads, and then either they fix the file or the
 * entries are there.
 *
 * Two things the owner asked for and the server now guarantees, surfaced here
 * rather than left in a log: a rejected file names **which line** and **which
 * column**, and a file that has already been imported is recognised instead of
 * being imported twice.
 *
 * ⚠️ **S13-E 之后这一页也能从账本设置进入：`/books/:bookId/settings/import`。**
 * 导入是**写**操作，写错账本的代价最大且最不明显（文件看起来完全正常），所以目标模式：
 *
 *  * 用 `useLedgerMeta(bookId)` 把**目标账本的名字和编号**显示在页面上，并且写进确认对话框；
 *  * `useImportEntries(bookId)` 让整个请求点名那本账；
 *  * 「下载模板」也带 `bookId`（模板按账本生成表头，不是同一个文件）；
 *  * 导出 / 返回都回 `/books/:bookId/settings`。
 *
 * ⚠️ **当前账本模式有两条来路，不能混为一条：**
 *
 *  * 旧的 `/export` → `/import` 链路一个字都没改：深链回退是 `/export`，页内仍保留
 *    「← 返回导出」这个属于导出上下文的次级链接。
 *  * 中央 `+` 菜单的「导入账单」带 `?from=nav`（见 `BottomNav.tsx`）：它是从当前页面
 *    打开的，头部「返回」按历史回退；深链/刷新的回退是**明细页 `/`**，而那个
 *    导出上下文专用的「← 返回导出」链接在这一来路下隐藏，避免看起来像"返回"却横跳导出。
 */

type Step =
  | { readonly name: "choose" }
  | { readonly name: "confirm"; readonly file: File }
  | { readonly name: "report"; readonly report: ImportReport };

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
  const importEntries = useImportEntries();
  const [searchParams] = useSearchParams();
  /** The central `+` menu opens this route with `?from=nav` — see the note at the top. */
  const fromMenu = searchParams.get("from") === "nav";

  return (
    <ImportView
      importEntries={importEntries}
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
  const importEntries = useImportEntries(bookId);

  const name = meta.data?.book.name ?? null;
  const bookNumber = meta.data?.book.bookNumber ?? null;
  const label = name === null ? "正在读取账本……" : bookNumber === null ? name : `${name}（${bookNumber}）`;

  return (
    /**
     * ⚠️ **Keyed by the ledger**: a half-finished step (or a file already chosen) must not carry over
     * if the address is edited to another ledger — the whole risk this screen guards against is
     * writing the right file into the wrong book.
     */
    <ImportView
      key={bookId}
      importEntries={importEntries}
      backTo={`/books/${bookId}/settings`}
      exportTo={`/books/${bookId}/settings/export`}
      doneTo={`/books/${bookId}/settings`}
      doneLabel="回到账本设置"
      bookId={bookId}
      target={{ label, failure: meta.isError ? errorMessage(meta.error) : null }}
    />
  );
}

function ImportView({
  importEntries,
  backTo,
  exportTo,
  doneTo,
  doneLabel,
  bookId,
  target,
  hideExportLink = false,
}: {
  readonly importEntries: ReturnType<typeof useImportEntries>;
  /**
   * The frame's back fallback for a deep link. **Target mode lands on 账本设置**, which is the parent
   * this screen was opened from; the legacy current-ledger screen keeps `/export`, exactly as before.
   * The central `+` entry passes `?from=nav`, whose fallback is 明细 (`/`).
   */
  readonly backTo: string;
  /** Where 「← 返回导出」 goes — the export screen of the same ledger. */
  readonly exportTo: string;
  /** Where the report's 「完成」 button goes. */
  readonly doneTo: string;
  readonly doneLabel: string;
  /** ⚠️ Named only in target mode — the template download carries it too. */
  readonly bookId?: string;
  /** ⚠️ Present only when the address names a ledger; its name **and** number are shown. */
  readonly target?: ImportTarget;
  /**
   * ⚠️ **Hide the legacy export shortcut when this page was opened from the central `+` menu.**
   * That link is a child of the `/export` context, not of the reader's current page; keeping it
   * visible there reads like a "back" that jumps to an unrelated screen.
   */
  readonly hideExportLink?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>({ name: "choose" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const failure = target?.failure ?? null;

  async function downloadTemplate(): Promise<void> {
    setError(null);
    try {
      /** ⚠️ The template is per ledger: headings are the same, but the request names the target. */
      const file = await fetchTemplate(bookId);
      await deliverFile(file.fileName, file.mimeType, file.bytes);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function run(file: File): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const report = await importEntries.mutateAsync(file);
      setStep({ name: "report", report });
    } catch (caught) {
      setError(errorMessage(caught));
      setStep({ name: "choose" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <InnerPage
      title="导入历史账"
      subtitle="用导出的文件或模板填写，逐行校验通过后才会写入。任何一行有问题，整批都不会写入。"
      backTo={backTo}
    >
      {error === null ? null : <Alert>{error}</Alert>}
      {failure === null ? null : <Alert>{failure}</Alert>}

      {/**
        * ⚠️ **The target is stated before anything is chosen, not after.** A person who opened the
        * wrong ledger's settings must be able to notice it here — with the number, not only the
        * name, because two ledgers can be called the same thing.
        */}
      {target === undefined ? null : (
        <div className="flex flex-col gap-1 rounded-field bg-brand-soft px-4 py-3 text-brand-dark">
          <p className="text-body font-medium">导入到「{target.label}」</p>
          <p className="text-helper-relaxed">请先确认这是你要写入的账本。下面的文件会整批写进这本账。</p>
        </div>
      )}

      {step.name === "choose" ? (
        <section className="flex flex-col gap-4">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="选择 CSV 文件"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file twice still fires a change —
              // otherwise a corrected file re-picked after a failure looks like
              // nothing happened.
              event.target.value = "";
              if (file !== undefined) setStep({ name: "confirm", file });
            }}
          />

          <Button
            onClick={() => {
              fileInput.current?.click();
            }}
            disabled={busy || failure !== null}
          >
            选择 CSV 文件
          </Button>

          <Button variant="secondary" onClick={() => void downloadTemplate()} disabled={failure !== null}>
            下载模板
          </Button>

          <div className="rounded-field bg-brand-soft px-4 py-3 text-helper-relaxed text-brand-dark">
            <p className="font-medium">关于判重</p>
            <p className="mt-1">
              文件里带的「流水编号」如果这个账本已经有了，那一行会被跳过，并在报告里写出来。
              同一个文件再导入一次不会产生重复记录。
            </p>
            <p className="mt-2">
              没有这几列的外部文件也能导入，但那时无法判重，可能产生重复。
            </p>
          </div>

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

      {step.name === "report" ? (
        <Report
          report={step.report}
          bookId={bookId ?? null}
          doneLabel={doneLabel}
          onDone={() => {
            setStep({ name: "choose" });
            void navigate(doneTo);
          }}
          onAgain={() => {
            setStep({ name: "choose" });
          }}
        />
      ) : null}

      {/* The confirmation the owner asked for: say how many rows, and what will
          happen, before anything is written. */}
      <ConfirmDialog
        open={step.name === "confirm"}
        title="确认导入"
        description="会先校验整个文件，通过后才写入这本账。"
        confirmLabel={busy ? "正在导入…" : "开始导入"}
        cancelLabel="取消"
        // Not `danger`: importing adds records. A red confirm button would say
        // "this deletes something", which is the opposite of what it does.
        tone="default"
        busy={busy}
        onCancel={() => {
          setStep({ name: "choose" });
        }}
        onConfirm={() => {
          if (step.name === "confirm") void run(step.file);
        }}
        consequences={[
          `文件：${step.name === "confirm" ? step.file.name : ""}`,
          /** ⚠️ Named again at the moment it matters most. */
          ...(target === undefined ? [] : [`导入到：「${target.label}」`]),
          "逐行校验通过后才会写入；任何一行有问题，整批都不会写入。",
          "已经在账本里的记录会被跳过，不会重复。",
        ]}
      />
    </InnerPage>
  );
}

/**
 * What happened, in the order a person needs it.
 *
 * A rejected file gets every problem listed — not the first one — because fixing
 * a spreadsheet one error per attempt is miserable. The line numbers are the
 * file's own, so they can be found by opening it.
 */
function Report({
  report,
  bookId,
  doneLabel,
  onDone,
  onAgain,
}: {
  readonly report: ImportReport;
  /** ⚠️ 只有点名账本时才拿得到 id；老入口（当前账本）由 `duplicateBookId()` 兜底。 */
  readonly bookId: string | null;
  readonly doneLabel: string;
  readonly onDone: () => void;
  readonly onAgain: () => void;
}): React.JSX.Element {
  if (!report.ok) {
    return (
      <section className="flex flex-col gap-4">
        <Alert>
          没有写入任何数据：文件里有 {String(report.errors.length)} 处问题，全部改好之后再导入一次。
        </Alert>

        <ul className="overflow-hidden rounded-field border border-line bg-surface">
          {report.errors.slice(0, 50).map((problem) => (
            <li
              key={`${String(problem.line)}-${problem.column ?? ""}`}
              className="flex gap-3 border-b border-line px-4 py-3 text-sm last:border-b-0"
            >
              <span className="shrink-0 font-mono text-helper text-muted">第 {problem.line} 行</span>
              <span className="text-ink">
                {problem.column === null ? "" : `${problem.column}：`}
                {problem.message}
              </span>
            </li>
          ))}
        </ul>

        {report.errors.length > 50 ? (
          <p className="text-helper text-muted">
            只显示了前 50 处，还有 {String(report.errors.length - 50)} 处。
          </p>
        ) : null}

        <Button onClick={onAgain}>换一个文件</Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <Alert tone="success">
        已导入 {String(report.importedCount)} 条记录。
        {report.skippedCount > 0 ? `另有 ${String(report.skippedCount)} 条已经存在，已跳过。` : ""}
      </Alert>

      <dl className="overflow-hidden rounded-field border border-line bg-surface">
        <Row label="文件里的数据行" value={`${String(report.rowCount)} 条`} />
        <Row label="写入" value={`${String(report.importedCount)} 条`} />
        <Row label="跳过（已存在）" value={`${String(report.skippedCount)} 条`} />
        {report.fileRef === undefined ? null : (
          <Row label="导入编号" value={report.fileRef} mono />
        )}
        {report.exportedFileRef === null || report.exportedFileRef === undefined ? null : (
          <Row label="来自这次导出" value={report.exportedFileRef} mono />
        )}
      </dl>

      <p className="text-helper-relaxed text-muted">
        导入编号是这次导入的标识，写进了这批每一笔记录里，日后可以据此追溯它们是从哪个文件来的。
      </p>

      {report.importedCount > 0 && report.fileRef !== undefined ? (
        <ImportDuplicateCheck bookId={bookId} importRef={report.fileRef} />
      ) : null}

      <Button onClick={onDone}>{doneLabel}</Button>
      <Button variant="secondary" onClick={onAgain}>
        再导入一个文件
      </Button>
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-body text-muted">{label}</dt>
      <dd className={`text-body text-ink ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * 批量导入之后的疑似重复检查（S15-E4）。
 *
 * ⚠️ **复查的目标是“这一批”，不是“整本账”。** 用导入编号点名这一批，服务端拿它和历史
 * 比对，界面只负责分组展示 —— 判重规则仍然只有 `duplicateDetection.ts` 那一份。
 *
 * ⚠️ **不自动跳过、不自动删除。** 已经写入的账目不会因为这次检查而消失；这里只回答
 * “其中哪些看起来和账本里已有的记录是同一笔”，让用户自己决定，并且只有明确点
 * “不是同一笔”才会留下一条关系。
 *
 * 为什么不是导入前检查：CSV 导入是服务端整批校验、整批写入，浏览器手里没有行数据；
 * 把文件再解析一遍就会多出第二套解析口径。
 */
function ImportDuplicateCheck({
  bookId,
  importRef,
}: {
  readonly bookId: string | null;
  readonly importRef: string;
}): React.JSX.Element {
  const duplicateSettings = useDuplicateDetectionSettings();
  const [state, setState] = useState<
    | { readonly phase: "idle" }
    | { readonly phase: "running" }
    | {
        readonly phase: "done";
        readonly pairs: readonly DuplicatePairResult[];
        readonly entries: readonly Transaction[];
        readonly checked: number;
        readonly truncated: boolean;
      }
    | { readonly phase: "error"; readonly message: string }
  >({ phase: "idle" });
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [busyPairKey, setBusyPairKey] = useState<string | null>(null);

  function targetBook(): string {
    return bookId ?? duplicateBookId();
  }

  async function run(): Promise<void> {
    if (!duplicateSettings.settings.enabled) return;
    setState({ phase: "running" });
    try {
      const target = targetBook();
      if (target === "") throw new Error("找不到当前账本，无法检查这批导入。");
      const result = await fetchImportReview(target, importRef, duplicateSettings.settings);
      setState({ phase: "done", ...result });
    } catch (caught) {
      setState({ phase: "error", message: errorMessage(caught) });
    }
  }

  async function markNotDuplicate(pair: DuplicatePairResult): Promise<void> {
    const normalized = normalizeNotDuplicatePair(pair.leftId, pair.rightId);
    if (!normalized.ok) return;
    setBusyPairKey(pair.pairKey);
    try {
      await createNotDuplicateRelations(targetBook(), {
        pairs: [
          {
            transactionIdA: normalized.pair.transactionAId,
            transactionIdB: normalized.pair.transactionBId,
          },
        ],
        decisionSource: "import_review",
      });
      setResolved((current) => new Set([...current, pair.pairKey]));
    } catch (caught) {
      setState({ phase: "error", message: `「不是同一笔」没有记住：${errorMessage(caught)}` });
    } finally {
      setBusyPairKey(null);
    }
  }

  const done = state.phase === "done" ? state : null;
  const groups = groupDuplicatePairs(
    (done?.pairs ?? []).filter((pair) => !resolved.has(pair.pairKey)),
  );
  const entriesById = new Map((done?.entries ?? []).map((entry) => [entry.id, entry]));

  return (
    <section className="flex flex-col gap-3 rounded-field border border-line bg-surface px-4 py-3">
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">这批导入有没有和旧记录重复？</p>
        <p className="text-helper text-muted">
          按当前设置检查这一批与账本历史；只提示，不跳过、不删除、不合并已经写入的记录。
          {duplicateSettings.settings.enabled ? "" : "（重复提醒已关闭，需要先到设置里打开。）"}
        </p>
      </div>

      <Button
        variant="secondary"
        disabled={state.phase === "running" || !duplicateSettings.settings.enabled}
        onClick={() => void run()}
      >
        {state.phase === "running" ? "正在检查…" : "检查这批导入"}
      </Button>

      {state.phase === "error" ? <Alert>{state.message}</Alert> : null}

      {done === null ? null : groups.length === 0 ? (
        <p className="text-helper text-muted">
          没有发现符合当前规则的疑似重复（已检查 {String(done.checked)} 条）。
          {done.truncated ? "本次达到单次上限，结果可能不完整。" : ""}
        </p>
      ) : (
        <>
          <p className="text-helper text-muted">
            检查了 {String(done.checked)} 条，发现 {String(groups.length)} 组疑似重复。
            {done.truncated ? "本次达到单次上限，结果可能不完整。" : ""}
          </p>
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <li key={group.key} className="flex flex-col gap-2 rounded-field bg-canvas px-3 py-2">
                {group.ids.map((id) => {
                  const entry = entriesById.get(id);
                  return (
                    <p key={id} className="flex items-baseline justify-between gap-3 text-body">
                      <span className="truncate">
                        {entry?.note?.trim() === "" || entry?.note == null ? "（无备注）" : entry.note}
                      </span>
                      <span className="shrink-0 text-muted">
                        {entry === undefined
                          ? ""
                          : `${entry.occurredLocalDate} · ${formatMoney(entry.amountCents, entry.currency)}`}
                      </span>
                    </p>
                  );
                })}
                {group.pairs.map((pair) => (
                  <div key={pair.pairKey} className="flex items-center justify-between gap-3">
                    <p className="text-helper text-muted">{describeDuplicateMatch(pair)}</p>
                    <button
                      type="button"
                      disabled={busyPairKey === pair.pairKey}
                      onClick={() => void markNotDuplicate(pair)}
                      className="shrink-0 text-helper text-brand-dark underline disabled:opacity-45"
                    >
                      {busyPairKey === pair.pairKey ? "正在记录…" : "不是同一笔"}
                    </button>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
