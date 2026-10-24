import { UNCATEGORISED_NAME, type Transaction } from "@libellum/shared";

import { useI18n } from "../../i18n/index.js";
import { formatTimeWithZone } from "../../lib/datetime.js";
import { formatMoney } from "../../lib/format.js";
import { displayCategoryName, displayPaymentMethodName } from "../../lib/presetNames.js";

/**
 * One entry in the ledger's list, with the selection state batch mode adds.
 *
 * ⚠️ **The row keeps one job — "activate this entry" — and the caller decides what that means.**
 * Outside batch mode it opens the detail screen (or the conflict choice); inside it toggles the
 * tick. Duplicating the row for the two modes would let them drift, and the drift would show up as
 * a row that navigates while the checkbox is showing.
 *
 * ⚠️ **Two colours, two meanings: green for "not saved yet", red for "not deleted yet".**
 *
 * The owner's first request was colour on its own terms — "离线状态下新建出来的记账底色要
 * 特殊一些…换成浅红色之类的，用来提醒用户，现在还没被备份到服务器" — and when the deletion
 * side arrived he split it: **"删除印记变为 1 时背景变成淡红色——之前的断网新增账单背景就得
 * 改一下了，改成淡绿色吧."**
 *
 * | Row | Colour | What the user needs to know |
 * |---|---|---|
 * | **已删除，服务器还不知道** | **淡红** | it is **still on the server** — the delete has not happened there yet |
 * | **已新建，服务器还不知道** | **淡绿** | it is **only on this device** — it is not backed up yet |
 *
 * A single warning colour for both would say "something is unsynced" and stop, **when the thing
 * the user has to do about each one is opposite**: one needs the entry to disappear elsewhere,
 * the other needs it to appear elsewhere.
 *
 * ⚠️ **A deleted row is never rendered at all** in practice — the deletion is applied to the merged
 * list before this point. The red state stays supported because an entry can be deleted while visible.
 */
export function LedgerEntryRow({
  entry,
  selecting,
  selected,
  pending,
  conflicted,
  deleted,
  onActivate,
}: {
  readonly entry: Transaction;
  readonly selecting: boolean;
  readonly selected: boolean;
  readonly pending: boolean;
  readonly conflicted: boolean;
  readonly deleted: boolean;
  readonly onActivate: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  /** 分类与支付方式只在**显示**时换成当前语言的预置名；数据本身不变。 */
  const categoryLabel = displayCategoryName(entry.categoryIsSystem ? UNCATEGORISED_NAME : entry.categoryName);
  const toneClass = deleted
    ? "bg-danger-soft line-through decoration-danger/40"
    : conflicted
      ? "bg-warn-soft"
      : pending
        ? "bg-brand-soft"
        : "";

  return (
    <li className={toneClass === "" ? undefined : toneClass}>
      <button
        type="button"
        onClick={onActivate}
        /**
         * ⚠️ **`aria-pressed` only exists in batch mode.** A normal row is a link to an entry, not a
         * toggle; announcing it as an unpressed toggle would be a lie about what pressing it does.
         */
        aria-pressed={selecting ? selected : undefined}
        aria-label={
          selecting
            ? t("ledger.row.selectionLabel", {
                state: selected ? t("ledger.row.selected") : t("ledger.row.unselected"),
                category: categoryLabel,
                amount: formatMoney(entry.amountCents, entry.currency),
              })
            : undefined
        }
        className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left transition last:border-b-0 hover:bg-canvas"
      >
        {selecting ? <SelectionBox selected={selected} /> : null}

        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-line text-xs font-semibold text-category-ink">
          {entry.categoryIsSystem ? "—" : categoryLabel.slice(0, 1)}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">
            {categoryLabel}
            {entry.note ? <span className="text-muted"> · {entry.note}</span> : null}
          </span>
          <span className="truncate text-xs text-muted">
            {formatTimeWithZone(entry.occurredAt, entry.occurredTz)}
            {entry.paymentMethodName ? ` · ${displayPaymentMethodName(entry.paymentMethodName)}` : ""}
          </span>
        </span>

        <span
          className={`shrink-0 text-sm font-medium tabular-nums ${
            entry.kind === "expense" ? "text-ink" : "text-brand-dark"
          }`}
        >
          {entry.kind === "expense" ? "-" : "+"}
          {formatMoney(entry.amountCents, entry.currency)}
        </span>
      </button>
    </li>
  );
}

/**
 * The tick on the left of a row.
 *
 * ⚠️ **Decorative, because the row button is the control.** Nesting a real `<input type="checkbox">`
 * inside a `<button>` would make two focusable controls for one action, and the outer one would eat
 * the inner one's taps. `aria-hidden` here plus `aria-pressed` on the button keeps one control and
 * one announcement.
 */
function SelectionBox({ selected }: { readonly selected: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-selected={selected ? "true" : "false"}
      className={`flex size-5 shrink-0 items-center justify-center rounded-[6px] border text-micro font-semibold transition ${
        selected ? "border-brand bg-brand text-on-brand" : "border-line bg-surface text-transparent"
      }`}
    >
      ✓
    </span>
  );
}
