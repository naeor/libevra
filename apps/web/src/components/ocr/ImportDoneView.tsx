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

import { Trans } from "react-i18next";

import { Button } from "../Button.js";
import { useI18n } from "../../i18n/index.js";
import { formatTimeInZone, localTimeZone } from "../../lib/datetime.js";
import type { OcrImportOutcome } from "../../lib/ocr/import.js";
import {
  importSessionTotals,
  type OcrImportSession,
  type OcrImportSessionBatch,
} from "../../lib/ocr/importSession.js";

export type ImportDoneStatus = "success" | "partial" | "failed";

// 标题与说明按状态取文案：`ocr.done.heading.<status>` / `ocr.done.subtitle.<status>`。

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
  const { t } = useI18n();
  const status = importDoneStatus(outcome);
  const failed = outcome.failed.length;
  const totals = importSessionTotals(session);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-1 flex-col justify-center gap-5 px-6 pt-6 pb-5">
        <header className="flex flex-col items-center gap-2 text-center">
          <StatusMark status={status} />
          <h1 className="text-lg font-semibold text-ink">{t(`ocr.done.heading.${status}`)}</h1>
          {/*
            `w-full` matters: the header centres its children, and a centred flex item
            sizes to its content, so a longer sentence would run off the screen instead
            of wrapping (the partial-import subtitle did exactly that).
          */}
          {/* 1.17.23：全部成功时标题与下面的批次行已经说清楚，不再加一句副标题。 */}
          {status === "success" ? null : (
            <p className={`w-full text-body-relaxed ${SUBTITLE_TONES[status]}`}>
              {t(`ocr.done.subtitle.${status}`)}
            </p>
          )}
        </header>

        {/*
          The cumulative line is the only place this page counts across batches. The toast
          deliberately says nothing about it: one fact, one place.
        */}
        <p className="text-center text-body text-muted">
          <Trans
            i18nKey="ocr.done.session"
            values={{ imported: totals.imported, batches: totals.batches }}
            components={{
              imported: <span className="font-semibold tabular-nums text-ink" />,
              batches: <span className="font-semibold tabular-nums text-ink" />,
            }}
          />
        </p>

        {/*
          ⚠️ S16-A: the batches are a record of what happened, so they are rows in one frame —
          not one shadowed card each. With five batches the old stack was five boxes tall and pushed
          the two buttons' context off the screen; a list keeps every batch's facts and reads in order.
        */}
        <ol className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
          {session.batches.map((batch) => (
            <BatchRow key={batch.batchId} batch={batch} />
          ))}
        </ol>

        {failed === 0 ? null : (
          <button
            type="button"
            onClick={onRetry}
            className="text-helper text-muted underline transition hover:text-ink"
          >
            {t("ocr.done.retryFailed", { count: failed })}
          </button>
        )}
      </div>

      {/*
        Sticky rather than fixed: it keeps the two entry points reachable while the batch
        list scrolls, and it stays in the layout so nothing is covered. Safe-area padding
        lives on the opaque bar itself, matching the bottom bars elsewhere.
      */}
      <div className="sticky bottom-0 border-t border-line bg-surface px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]" data-lv-bottom-bar="">
        {/*
          ⚠️ S16-A: side by side instead of stacked. Two full-width buttons on top of each other
          took ~120px of a phone's height for two choices; one row keeps both large (≥44px) and
          gives the list above more room. The primary action stays on the trailing side.
        */}
        {/* S16：320px 下英文按钮文字可能折成两行，居中排版。 */}
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" className="text-center" onClick={onAgain}>
            {t("ocr.done.scanAgain")}
          </Button>
          <Button className="text-center" onClick={onBackToDetail}>{t("ocr.done.backToEntries")}</Button>
        </div>
      </div>
    </div>
  );
}

function BatchRow({ batch }: { readonly batch: OcrImportSessionBatch }): React.JSX.Element {
  const { t } = useI18n();
  const time = formatTimeInZone(batch.importedAt, localTimeZone());

  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-card-title text-ink">{t("ocr.done.batch", { number: batch.sequence })}</h2>
        {time === "" ? null : (
          <time dateTime={batch.importedAt} className="text-helper text-muted tabular-nums">
            {time}
          </time>
        )}
      </div>

      <p
        className={`text-body tabular-nums ${
          batch.failed > 0 ? "text-warn-dark" : "text-muted"
        }`}
      >
        {t("ocr.done.batchCounts", { succeeded: batch.succeeded, failed: batch.failed })}
      </p>

      {/*
        ⚠️ `pending` is what was written into this device's queue, not a server receipt.
        The sentence names the queue and the automatic delivery so it cannot be read as
        "already on the server".
      */}
      {batch.pending > 0 ? (
        <p className="text-helper-relaxed text-brand-dark">
          {t("ocr.done.batchPending", { count: batch.pending })}
        </p>
      ) : null}

      {batch.failed > 0 ? (
        <p className="text-helper-relaxed text-warn-dark">
          {t("ocr.done.batchFailed", { count: batch.failed })}
        </p>
      ) : null}
    </li>
  );
}

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
