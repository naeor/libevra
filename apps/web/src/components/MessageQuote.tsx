/**
 * **留言里的引用：一条留言可以「关于」某笔账或某次修改，而大多数留言仍然不带引用。**
 *
 * 所有者把定位说得很清楚：*"引用必须是可选的。绝大多数时候，用户仍然应该像现在一样直接留言，不必选择
 * 账目，也不必操作任何引用功能。"* 所以这里只做两件很轻的事 —— 一条能取消的引用卡片，和一个小得
 * 不会占据视野的选择面板；**没有任何一步是发留言的必经之路**。
 *
 * ⚠️ **引用卡片画的是服务器写的快照，不是现场重新查账目**（`apps/api/src/ledger/quotes.ts`）。
 * 引用一次历史修改时，卡片必须永远说当时那一句「¥86 → ¥68」——即使这笔账后来又被改过。**卡片若
 * 从实时数据组装，就会悄悄改写用户引用的历史事实。**
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";

import type {
  MessageReferenceView,
  QuotedTransactionSnapshot,
  QuoteEventTargetView,
  QuoteTargetView,
} from "@libellum/shared";
import { UNCATEGORISED_NAME } from "@libellum/shared";

import { historyChangeText } from "./HistoryList.js";
import { CloseIcon } from "./Icons.js";
import { isChineseLocale, useI18n } from "../i18n/index.js";
import { formatMoney } from "../lib/format.js";
import { displayCategoryName } from "../lib/presetNames.js";
import { useQuoteTargets } from "../lib/queries.js";

/**
 * 快照里的标题/分类名是**显示用文本**：备注原样显示，分类名（含「暂无分类」兜底）按界面语言翻译。
 * ⚠️ 只作用于显示，不写回任何请求或数据。
 */
function quoteTitle(snapshot: QuotedTransactionSnapshot): string {
  return snapshot.note === null ? displayCategoryName(snapshot.title) : snapshot.title;
}

function quoteCategory(categoryName: string | null): string {
  return displayCategoryName(categoryName ?? UNCATEGORISED_NAME);
}

/**
 * 一张引用卡片。
 *
 * - 普通留言不带引用（`reference` 为 `null`），什么都不会渲染。
 * - 目标被删除 / 无权访问时仍显示历史快照，并标一句「已删除或不可访问」——**不是报错，也不清空整页**。
 * - `onRemove` 只出现在编辑区：发送前的引用可以取消；已发送的引用不可改。
 */
export function QuoteReferenceCard({
  reference,
  onRemove,
  href,
}: {
  readonly reference: MessageReferenceView;
  readonly onRemove?: (() => void) | undefined;
  /** 已发送留言里点击跳转到账目详情；不存在或不可用时可不传。 */
  readonly href?: string | undefined;
}): React.JSX.Element {
  const { t: tr } = useI18n();
  const unavailable = !reference.available;
  const snapshot = reference.snapshot;

  const card = (
    <span
      className={`flex min-w-0 flex-col gap-0.5 rounded-field px-2.5 py-1.5 ${
        unavailable ? "border border-dashed border-line bg-canvas/40" : "border border-line bg-canvas/70"
      }`}
    >
      {snapshot.kind === "transaction" ? (
        <>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-helper text-ink">{quoteTitle(snapshot)}</span>
            <span className="shrink-0 text-helper font-medium tabular-nums text-ink">
              {formatMoney(Number(snapshot.amountCents), snapshot.currency)}
            </span>
          </span>
          <span className="flex min-w-0 items-baseline gap-2 text-micro text-muted">
            {snapshot.code === null ? null : <span className="shrink-0 font-mono">{snapshot.code}</span>}
            <span className="truncate">{quoteCategory(snapshot.categoryName)}</span>
          </span>
        </>
      ) : (
        <>
          <span className="text-helper text-ink">
            {isChineseLocale()
              ? snapshot.summary
              : `${snapshot.actorName ?? tr("ledger.history.someone")} ${tr(
                  `ledger.history.verb.${snapshot.eventKind}`,
                )}${snapshot.transactionSeq === null ? "" : ` #${String(snapshot.transactionSeq).padStart(6, "0")}`}`}
          </span>
          {snapshot.changes.length === 0 ? null : (
            <span className="truncate text-micro text-muted">
              {[...snapshot.changes.slice(0, 2)].map(historyChangeText).join(" · ")}
            </span>
          )}
        </>
      )}

      {unavailable ? <span className="text-micro text-muted">{tr("collab.messages.quoteUnavailable")}</span> : null}
    </span>
  );

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {href === undefined ? (
        <span className="min-w-0 flex-1">{card}</span>
      ) : (
        <Link
          to={href}
          aria-label={tr("collab.messages.quoteOpen")}
          className="min-w-0 flex-1 rounded-field transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring"
        >
          {card}
        </Link>
      )}

      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={tr("collab.messages.quoteRemove")}
          title={tr("collab.messages.quoteRemove")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink"
        >
          <CloseIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/**
 * **选择引用对象：最近的几笔账，或最近几次修改。**
 *
 * ⚠️ **只有两栏、各几条，没有筛选器和第二次页面。** 所有者怕的是 *"为了一个小功能引入庞大的记录浏览器"*；
 * 引用通常发生在「刚才那笔」附近，所以这里就用服务器给的最近 8 条，读不到再说读不到。
 *
 * ⚠️ **修改栏不列「添加了」事件**：账目本身就在旁边一栏，重复列出同一个动作只会让人挑错地方。
 * 「修改历史」在引用的语境里就是**改过 / 删过 / 恢复过**。
 */
export function pickableEvents(
  events: readonly QuoteEventTargetView[],
): readonly QuoteEventTargetView[] {
  return events.filter((row) => row.snapshot.eventKind !== "created");
}

export function QuotePickerSheet({
  onPick,
  onClose,
}: {
  readonly onPick: (view: MessageReferenceView) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t: tr } = useI18n();
  const targets = useQuoteTargets();
  const [tab, setTab] = useState<"transactions" | "events">("transactions");

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const transactions = targets.data?.transactions ?? [];
  const events = pickableEvents(targets.data?.events ?? []);
  const rows = tab === "transactions" ? transactions : events;

  function pick(target: QuoteTargetView): void {
    onPick({ kind: target.kind, id: target.id, available: true, snapshot: target.snapshot });
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr("collab.messages.quoteSheetTitle")}
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="flex max-h-[78dvh] w-full max-w-md flex-col rounded-t-sheet bg-surface shadow-sheet sm:max-h-[70dvh] sm:rounded-card"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 text-section-title text-ink">{tr("collab.messages.quoteSheetTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("collab.messages.quoteSheetClose")}
            className="flex size-10 items-center justify-center rounded-full text-muted transition hover:bg-brand-soft hover:text-ink"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="shrink-0 px-4 pt-3">
          <div className="flex rounded-field bg-canvas p-1 text-helper">
            {(
              [
                ["transactions", tr("collab.messages.quoteTabTransactions")],
                ["events", tr("collab.messages.quoteTabEvents")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                }}
                className={`flex-1 rounded-field px-3 py-1.5 transition ${
                  tab === value ? "bg-surface font-medium text-ink shadow-sm" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {targets.isPending ? (
            <p className="px-4 py-6 text-body text-muted">{tr("collab.messages.quoteLoading")}</p>
          ) : null}
          {targets.isError ? (
            <p className="px-4 py-6 text-body text-muted">{tr("collab.messages.quoteFailed")}</p>
          ) : null}

          {targets.isSuccess && rows.length === 0 ? (
            <p className="px-4 py-6 text-body-relaxed text-muted">
              {tab === "transactions"
                ? tr("collab.messages.quoteEmptyTransactions")
                : tr("collab.messages.quoteEmptyEvents")}
            </p>
          ) : null}

          <ul className="flex flex-col">
            {tab === "transactions"
              ? transactions.map((target) => (
                  <li key={target.id}>
                    <button
                      type="button"
                      onClick={() => {
                        pick(target);
                      }}
                      className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left transition last:border-b-0 hover:bg-brand-soft/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">{quoteTitle(target.snapshot)}</span>
                        <span className="mt-0.5 flex items-baseline gap-2 text-micro text-muted">
                          {target.snapshot.code === null ? null : (
                            <span className="font-mono">{target.snapshot.code}</span>
                          )}
                          <span className="truncate">{quoteCategory(target.snapshot.categoryName)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-helper font-medium tabular-nums text-ink">
                        {formatMoney(Number(target.snapshot.amountCents), target.snapshot.currency)}
                      </span>
                    </button>
                  </li>
                ))
              : events.map((target) => (
                  <li key={target.id}>
                    <button
                      type="button"
                      onClick={() => {
                        pick(target);
                      }}
                      className="flex w-full flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left transition last:border-b-0 hover:bg-brand-soft/40"
                    >
                      <span className="truncate text-body text-ink">
                        {isChineseLocale()
                          ? target.snapshot.summary
                          : `${target.snapshot.actorName ?? tr("ledger.history.someone")} ${tr(
                              `ledger.history.verb.${target.snapshot.eventKind}`,
                            )}${
                              target.snapshot.transactionSeq === null
                                ? ""
                                : ` #${String(target.snapshot.transactionSeq).padStart(6, "0")}`
                            }`}
                      </span>
                      {target.snapshot.changes.length === 0 ? null : (
                        <span className="truncate text-micro text-muted">
                          {[...target.snapshot.changes.slice(0, 2)].map(historyChangeText).join(" · ")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
          </ul>
        </div>

        <p className="shrink-0 border-t border-line px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] text-micro text-muted">
          {tr("collab.messages.quoteSheetHint")}
        </p>
      </div>
    </div>
  );
}
