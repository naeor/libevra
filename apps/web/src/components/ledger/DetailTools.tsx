import type { ReactNode } from "react";

import { useI18n } from "../../i18n/index.js";

export function DetailTools({
  sortControl,
  guest,
  selecting,
  onBatch,
  onMore,
  onExitSelection,
}: {
  readonly sortControl: ReactNode;
  readonly guest: boolean;
  readonly selecting: boolean;
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
          {sortControl}
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
