import { useEffect } from "react";

import { useI18n } from "../i18n/index.js";

/**
 * A short-lived bar offering to undo the thing that just happened.
 *
 * This is the *second* line of defence. The first is the confirmation dialog
 * before a destructive action; this catches the case where the user confirmed
 * without reading. It is deliberately short-lived — an undo that lingers
 * becomes clutter.
 */
export function UndoBar({
  message,
  actionLabel,
  durationMs = 5000,
  onAction,
  onDismiss,
}: {
  readonly message: string;
  readonly actionLabel?: string;
  readonly durationMs?: number;
  readonly onAction: () => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [durationMs, onDismiss, message]);

  return (
    <div className="fixed inset-x-0 bottom-28 z-50 flex justify-center px-5" data-lv-bottom-bar="">
      <div className="flex w-full max-w-md items-center justify-between gap-4 rounded-field bg-ink px-4 py-3 text-sm text-on-ink shadow-lg">
        <span className="min-w-0">{message}</span>
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 font-medium text-brand-soft transition hover:text-on-ink"
        >
          {actionLabel ?? t("common.action.undo")}
        </button>
      </div>
    </div>
  );
}
