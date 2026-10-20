/**
 * The bar that appears above the list once batch mode starts.
 *
 * ⚠️ **"Select all" is scoped in words, not left to a tooltip.** The list is filtered and paginated,
 * so the only honest meaning of 全选 is "everything that is loaded right now" — and the owner's
 * instruction was to write that on the screen rather than explain it afterwards: 全选已加载的 N 条.
 *
 * ⚠️ **A notice line exists because a filter change clears the selection.** Silently dropping ticks
 * looks like a bug; explaining it in place — "筛选变了，已清空选择" — is the difference between a
 * rule and an accident.
 */
export function SelectionBar({
  selectedCount,
  loadedCount,
  allSelected,
  notice,
  onToggleAll,
}: {
  readonly selectedCount: number;
  readonly loadedCount: number;
  readonly allSelected: boolean;
  readonly notice: string | null;
  readonly onToggleAll: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-3 rounded-field bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">选择账目</h2>
        <span className="text-helper text-muted">已选 {selectedCount} 条</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onToggleAll}
          disabled={loadedCount === 0}
          aria-pressed={allSelected}
          className="text-helper font-medium text-brand-dark transition hover:underline disabled:opacity-45 disabled:hover:no-underline"
        >
          {allSelected ? "取消全选" : `全选已加载的 ${String(loadedCount)} 条`}
        </button>

        <span className="text-micro text-muted">只勾选当前筛选下已加载的账目，不会扩大到整本账</span>
      </div>

      {notice === null ? null : (
        <p role="status" className="mt-2 text-helper-relaxed text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
