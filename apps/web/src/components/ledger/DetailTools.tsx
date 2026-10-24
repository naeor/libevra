/**
 * The ledger's top-right tools: 刷新 / 批量操作 / 更多.
 *
 * ⚠️ **导出 moved into 更多, and the reason is how often each one is pressed.** Export is a
 * destination somebody visits rarely and deliberately; batch mode is a thing you reach for while
 * looking at the list. The top row is the space for the second kind. The export screen itself is
 * untouched — 更多 now links to it.
 *
 * Extracted from `DetailPage` so the row can be checked by rendering it: a test can prove that the
 * batch button exists, that export is no longer a top-level tool, and that a guest still sees only
 * 刷新. None of that needs a DOM or a click.
 */
import type { ReactNode } from "react";

import { useI18n } from "../../i18n/index.js";

export function DetailTools({
  refreshing,
  turnKey,
  guest,
  selecting,
  onRefresh,
  onBatch,
  onMore,
  onExitSelection,
}: {
  readonly refreshing: boolean;
  /** Bumped on every refresh, so the one-turn animation reports an event. */
  readonly turnKey: number;
  readonly guest: boolean;
  readonly selecting: boolean;
  readonly onRefresh: () => void;
  readonly onBatch: () => void;
  readonly onMore: () => void;
  readonly onExitSelection: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="detail-tools flex gap-2">
      {selecting ? (
        /**
         * ⚠️ **The exit sits where the tools were**, because that is where the hand already is — and
         * because the bar at the bottom belongs to the action, not to leaving the mode.
         */
        <button
          type="button"
          onClick={onExitSelection}
          aria-label={t("ledger.tools.exitBatch")}
          className="h-9 rounded-full bg-on-brand/20 px-4 text-sm text-on-brand transition hover:bg-on-brand/30 active:bg-on-brand/40"
        >
          {t("common.action.cancel")}
        </button>
      ) : (
        <>
          <ToolButton
            /**
             * ⚠️ **The icon spins while the sync runs, because "slow" and "nothing is happening" are the
             * same thing on screen.** The owner's note was "联网的自动刷新比较慢" — and a slow operation
             * with no sign of activity is indistinguishable from a broken one, which is one of this
             * project's own lessons: **"没有反馈"和"没有生效"在用户看来没有区别.** The spin continues for at
             * least as long as the work does, so the button is never silent.
             */
            icon={<RefreshIcon key={turnKey} spinning={refreshing} />}
            label={t("ledger.tools.refresh")}
            hint={t("ledger.tools.refreshHint")}
            busy={refreshing}
            onClick={onRefresh}
          />
          {guest ? null : (
            <>
              <ToolButton
                icon={<BatchIcon />}
                label={t("ledger.tools.batch")}
                hint={t("ledger.tools.batchHint")}
                onClick={onBatch}
              />
              <ToolButton
                icon={<MoreIcon />}
                label={t("ledger.tools.more")}
                hint={t("ledger.tools.moreHint")}
                onClick={onMore}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A tool in the top corner.
 *
 * An icon, not a word. The first version printed 导出 and 更多 in small text on
 * translucent circles and the owner's note was that they read as speech
 * bubbles rather than tools — a word inside a pill looks like something to
 * read, where a mark inside a circle looks like something to press.
 *
 * With no `onClick` it is disabled and says why, which is the honest state for a
 * tool that does not exist yet — the owner's rule: something that looks ready
 * and does nothing is worse than something that admits it is not.
 */
function ToolButton({
  icon,
  label,
  hint,
  onClick,
  busy,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly hint: string;
  readonly onClick?: () => void;
  /** ⚠️ Shows that the action is running, and blocks a second press. */
  readonly busy?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const disabled = onClick === undefined || busy === true;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-busy={busy === true}
      title={busy === true ? t("ledger.tools.titleBusy", { label }) : t("ledger.tools.title", { label, hint })}
      aria-label={t("ledger.tools.ariaLabel", { label, hint })}
      className={`flex size-9 items-center justify-center rounded-full transition ${
        disabled ? "bg-on-brand/15 text-on-brand/70" : "bg-on-brand/20 text-on-brand hover:bg-on-brand/30 active:bg-on-brand/40"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * A circular arrow, matching the weight and size of the two beside it.
 *
 * ⚠️ **Same stroke, same box, same `size-[18px]` as `BatchIcon` and `MoreIcon`** — the owner asked for the
 * animation and weight to match the other two, and a button that looks subtly different from its neighbours
 * reads as a different kind of control.
 */
function RefreshIcon({ spinning = false }: { readonly spinning?: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      /**
       * ⚠️ **`refresh-turn` on the icon, and the rotation is the whole feedback.** A refresh that takes a
       * second and shows nothing looks like a button that does not work — **and the user then presses it
       * again**, which is why the handler also ignores a second press while one is running.
       */
      className={`size-[18px] ${spinning ? "refresh-turn" : ""}`}
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.6-5.9" strokeLinecap="round" />
      <path d="M20 4v4.5h-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Two ticks in a list: the usual mark for "choose several of these".
 *
 * ⚠️ **A tick list, not a trash can or a pencil.** The button opens a *mode*, and the mode is about
 * choosing rows — which is also why the same mark appears beside a selected row.
 */
function BatchIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="size-[18px]"
      aria-hidden="true"
    >
      <path d="M4.5 7.5 6 9l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 16.5 6 18l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 7.5H20M11.5 16.5H20" strokeLinecap="round" />
    </svg>
  );
}

/** Three dots: anything that does not deserve its own button yet. */
function MoreIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}
