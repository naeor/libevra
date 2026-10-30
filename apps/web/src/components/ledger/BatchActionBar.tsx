import { useI18n } from "../../i18n/index.js";
import type { BatchSummary } from "./batch.js";

/**
 * The bar batch mode puts at the bottom, in the place the navigation normally occupies.
 *
 * ⚠️ **It replaces the bottom navigation rather than stacking on top of it.**
 *
 * The owner's constraint was that the bar must not collide with `BottomNav`, its raised 记账 button,
 * or the safe area. A second bar above the navigation would need to know the navigation's height to
 * avoid the button that deliberately overhangs it — a number that would then have to be kept in step
 * with another file this work is not allowed to touch. **During selection the screen has one job, and
 * it is not switching tabs.**
 *
 * ⚠️ **The safe area is handled here, in the same form the navigation uses**
 * (`pb-[env(safe-area-inset-bottom)]`), so a phone with a home indicator does not put the buttons
 * under it.
 *
 * ⚠️ **The result of the last run is reported in this bar, not in a toast.** This is the bar the
 * action came from, it stays on screen, and a summary that can be missed is how a partial failure
 * becomes a silent one.
 */
export function BatchActionBar({
  selectedCount,
  blockedReason,
  busy,
  summary,
  onEdit,
  onDelete,
}: {
  readonly selectedCount: number;
  /** Why writing is not possible, or `null`. The buttons are disabled and this is shown. */
  readonly blockedReason: string | null;
  readonly busy: boolean;
  readonly summary: BatchSummary | null;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const disabled = selectedCount === 0 || blockedReason !== null || busy;

  return (
    <div className="relative z-10 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" data-lv-bottom-bar="">
      <div className="mx-auto w-full max-w-md px-6 pt-3">
        {summary === null ? null : (
          <div
            role="status"
            aria-live="polite"
            className="mb-2 rounded-field bg-canvas px-3 py-2 text-helper-relaxed"
          >
            <p className="text-ink">{summary.message}</p>

            {summary.failures.length === 0 ? null : (
              <ul className="mt-1 list-disc pl-5 text-muted">
                {summary.failures.slice(0, 3).map((failure) => (
                  <li key={failure.id}>{failure.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/*
          S16：英文比中文长，这一行在 320px 上可能放不下「已选 N 条」+ 两个按钮，所以允许换行
          （按钮整体落到下一行，不会被挤压或重叠）。
        */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto min-w-0 text-sm text-ink">{t("ledger.batch.selectedCount", { count: selectedCount })}</span>

          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            className="rounded-field bg-brand-soft px-4 py-2.5 text-sm font-medium text-brand-dark transition hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t("ledger.batch.edit")}
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="rounded-field bg-danger px-4 py-2.5 text-sm font-medium text-on-danger transition hover:bg-danger-dark disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t("ledger.batch.delete")}
          </button>
        </div>

        <p className="mt-1 pb-3 text-helper text-muted">
          {blockedReason ?? (selectedCount === 0 ? t("ledger.batch.selectFirst") : null)}
        </p>
      </div>
    </div>
  );
}
