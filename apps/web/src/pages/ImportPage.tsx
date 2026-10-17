import type { ImportReport } from "@libellum/shared";
import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { InnerPage } from "../components/Layouts.js";
import { errorMessage } from "../lib/api.js";
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
 * ⚠️ **当前账本模式（旧的 `/export` → `/import`）行为一个字都没改。**
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

  return (
    <ImportView
      importEntries={importEntries}
      backTo="/export"
      exportTo="/export"
      doneTo="/"
      doneLabel="回到明细"
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
}: {
  readonly importEntries: ReturnType<typeof useImportEntries>;
  /**
   * The frame's back fallback for a deep link. **Target mode lands on 账本设置**, which is the parent
   * this screen was opened from; the current-ledger screen keeps `/export`, exactly as before.
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

          <Button
            variant="ghost"
            onClick={() => {
              void navigate(exportTo);
            }}
          >
            ← 返回导出
          </Button>
        </section>
      ) : null}

      {step.name === "report" ? (
        <Report
          report={step.report}
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
  doneLabel,
  onDone,
  onAgain,
}: {
  readonly report: ImportReport;
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
