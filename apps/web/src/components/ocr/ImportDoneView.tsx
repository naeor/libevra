/**
 * 导入完成页（S15-B）：成功 / 部分成功 / 全失败后的状态，替代原来的 `ImportOutcomeView`。
 *
 * 页面职责只有三件：**说清结果**、**简洁展示成果**、**给出两个入口**。
 *
 *  * 没有左上「返回」：完成页是会话的终点，「返回明细」就是唯一的离开方式；浏览器
 *    后退/手势仍然正常，因为它只是普通的导航，没有重定向或重复提交。
 *  * 没有右上「重新识别」：它和「再识别一批」是同一件事，留一个就够。
 *  * 累计数字来自 `importSession.ts`，本批数字来自真实 `outcome`；`pending` 一律写成
 *    “在本机排队，联网后自动同步”，绝不写成服务器已保存。
 *
 * 视觉沿用 `EntrySaved.tsx` 的完成页语言：居中的状态图标 + `text-lg font-semibold`
 * 标题，下面才是信息。移动端首屏要能看到本批结果和两个按钮，所以标题克制、卡片紧凑，
 * 按钮组贴底（sticky）而不是堆在长列表后面。
 */

import { Button } from "../Button.js";
import { formatTimeInZone, localTimeZone } from "../../lib/datetime.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import {
  importSessionTotals,
  type OcrImportSession,
  type OcrImportSessionBatch,
} from "../../lib/ocr/importSession.js";

export type ImportDoneStatus = "success" | "partial" | "failed";

const HEADINGS: Record<ImportDoneStatus, string> = {
  success: "全部导入成功",
  partial: "部分导入成功",
  failed: "导入失败",
};

const SUBTITLES: Record<ImportDoneStatus, string> = {
  success: "批次已处理完，账目已写入当前账本。",
  partial: "成功的已经写入账本；失败的仍留在批次里，可以重试。",
  failed: "这一批没有账目写入账本，批次仍保留。",
};

const SUBTITLE_TONES: Record<ImportDoneStatus, string> = {
  success: "text-muted",
  partial: "text-warn-dark",
  failed: "text-danger",
};

/**
 * 结果状态。纯函数：`succeeded === 0` 才是全失败——只要有一笔写进去，就不能说全失败，
 * 也不能因为失败存在就说全成功。
 */
export function importDoneStatus(outcome: OcrImportOutcome): ImportDoneStatus {
  if (outcome.succeeded.length === 0) return "failed";
  return outcome.failed.length > 0 ? "partial" : "success";
}

export function ImportDoneView({
  outcome,
  session,
  onBackToDetail,
  onAgain,
  onRetry,
}: {
  readonly outcome: OcrImportOutcome;
  /** 已经把本批追加进去的会话。 */
  readonly session: OcrImportSession;
  /** 结束会话并进入当前账本明细（`/`）。 */
  readonly onBackToDetail: () => void;
  /** 进入新一批识别（`/scan`），保留会话。 */
  readonly onAgain: () => void;
  /** 回到批次列表处理仍失败的笔（不结束会话）。 */
  readonly onRetry: () => void;
}): React.JSX.Element {
  const status = importDoneStatus(outcome);
  const failed = outcome.failed.length;
  const totals = importSessionTotals(session);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center gap-5 px-6 pt-6 pb-5">
        <header className="flex flex-col items-center gap-2 text-center">
          <StatusMark status={status} />
          <h1 className="text-lg font-semibold text-ink">{HEADINGS[status]}</h1>
          {/*
            `w-full` matters: the header centres its children, and a centred flex item
            sizes to its content, so a longer sentence would run off the screen instead
            of wrapping (the partial-import subtitle did exactly that).
          */}
          <p className={`w-full text-body-relaxed ${SUBTITLE_TONES[status]}`}>
            {SUBTITLES[status]}
          </p>
        </header>

        {/*
          The cumulative line is the only place this page counts across batches. The toast
          deliberately says nothing about it: one fact, one place.
        */}
        <p className="text-center text-body text-muted">
          本次会话累计导入{" "}
          <span className="tabular-nums text-ink">{totals.imported}</span> 笔 · 共{" "}
          <span className="tabular-nums text-ink">{totals.batches}</span> 批
        </p>

        <div className="flex flex-col gap-2.5">
          {session.batches.map((batch) => (
            <BatchCard key={batch.batchId} batch={batch} />
          ))}
        </div>

        {failed === 0 ? null : (
          <button
            type="button"
            onClick={onRetry}
            className="text-helper text-muted underline transition hover:text-ink"
          >
            返回批次处理 {failed} 笔失败
          </button>
        )}
      </div>

      {/*
        Sticky rather than fixed: it keeps the two entry points reachable while the batch
        list scrolls, and it stays in the layout so nothing is covered. Safe-area padding
        lives on the opaque bar itself, matching the bottom bars elsewhere.
      */}
      <div className="sticky bottom-0 border-t border-line bg-surface px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex flex-col gap-2">
          <Button onClick={onBackToDetail}>返回明细</Button>
          <Button variant="secondary" onClick={onAgain}>
            再识别一批
          </Button>
        </div>
      </div>
    </div>
  );
}

function BatchCard({ batch }: { readonly batch: OcrImportSessionBatch }): React.JSX.Element {
  const time = formatTimeInZone(batch.importedAt, localTimeZone());

  return (
    <article className="flex flex-col gap-1 rounded-card border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-card-title text-ink">第 {batch.sequence} 批</h2>
        {time === "" ? null : (
          <time dateTime={batch.importedAt} className="text-helper text-muted">
            {time}
          </time>
        )}
      </div>

      <p
        className={`text-helper-relaxed tabular-nums ${
          batch.failed > 0 ? "text-warn-dark" : "text-muted"
        }`}
      >
        成功 {batch.succeeded} · 失败 {batch.failed}
      </p>

      {/*
        ⚠️ `pending` is what was written into this device's queue, not a server receipt.
        The sentence names the queue and the automatic delivery so it cannot be read as
        "already on the server".
      */}
      {batch.pending > 0 ? (
        <p className="text-helper-relaxed text-brand-dark">
          其中 {batch.pending} 笔已在本机排队，联网后自动同步
        </p>
      ) : null}

      {batch.failed > 0 ? (
        <p className="text-helper-relaxed text-warn-dark">
          失败的 {batch.failed} 笔仍留在批次里，可重试。
        </p>
      ) : null}
    </article>
  );
}

/**
 * 状态图标：成功用品牌绿，部分成功用既有 warning 语义色，全失败用 danger。
 * 用 SVG 而不是 emoji，和 `EntrySaved.tsx` 的 CheckMark 同一套画法。
 */
function StatusMark({ status }: { readonly status: ImportDoneStatus }): React.JSX.Element {
  const circle =
    status === "success" ? "fill-brand-soft" : status === "partial" ? "fill-warn-soft" : "fill-danger-soft";
  const stroke =
    status === "success" ? "stroke-brand" : status === "partial" ? "stroke-warn-dark" : "stroke-danger";

  return (
    <svg width="56" height="56" viewBox="0 0 104 104" aria-hidden="true">
      <circle cx="52" cy="52" r="48" className={circle} />
      {status === "success" ? (
        <path
          d="M34 54 L46 66 L70 40"
          fill="none"
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={stroke}
        />
      ) : status === "partial" ? (
        <>
          <path
            d="M52 28 V62"
            fill="none"
            strokeWidth={7}
            strokeLinecap="round"
            className={stroke}
          />
          <path d="M52 75 V76" fill="none" strokeWidth={7} strokeLinecap="round" className={stroke} />
        </>
      ) : (
        <path
          d="M38 38 L66 66 M66 38 L38 66"
          fill="none"
          strokeWidth={7}
          strokeLinecap="round"
          className={stroke}
        />
      )}
    </svg>
  );
}
