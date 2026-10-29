import { useEffect, useState } from "react";

import { isChineseLocale, useI18n } from "../i18n/index.js";
import { ALL_MONTHS, currentMonth, formatInstant, isAllMonths } from "../lib/datetime.js";

/** 十二个月份按钮，顺序固定；名字在渲染时按当前语言取（见 `monthName`）。 */
const MONTH_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * 月份按钮上的字。
 *
 * ⚠️ 中文界面保留原来的「1 月」写法（与 `formatMonthLabel` 的中文固定格式同一口径，`Intl` 给的是
 * 不带空格的「1月」）；其它语言用 `Intl` 的月份简称（Jan、Feb…）。
 */
function monthName(year: number, index: number): string {
  if (isChineseLocale()) return `${String(index + 1)} 月`; // i18n-ignore：中文界面专用的固定格式（与原来一致）
  return formatInstant(new Date(year, index, 1), { month: "short" });
}

/** 年份标题：中文「2026 年」，其它语言只写数字（由 `Intl` 决定）。 */
function yearLabel(year: number): string {
  if (isChineseLocale()) return `${String(year)} 年`; // i18n-ignore：中文界面专用的固定格式（与原来一致）
  return formatInstant(new Date(year, 0, 1), { year: "numeric" });
}

/**
 * Choosing a month.
 *
 * A bottom sheet rather than a dropdown: on a phone a menu anchored to a small
 * button is a small target with a list that may open off-screen, while a sheet
 * is reachable with a thumb and holds all twelve months at once — which is the
 * point, since the reason to open it is to get to a month the arrows would take
 * several taps to reach.
 *
 * The year steps independently, so going back a year is one tap rather than
 * twelve.
 *
 * `allowAll`（1.17.17，明细页）：底部多一个「全部」，选中后 `month` 为 `ALL_MONTHS`。
 * 此时没有选中的月份，左右箭头只翻看年份、不改选择；点某个月份才离开「全部」。
 */
export function MonthPicker({
  open,
  month,
  onSelect,
  onClose,
  maxMonth,
  allowAll = false,
}: {
  readonly open: boolean;
  readonly month: string;
  readonly onSelect: (month: string) => void;
  readonly onClose: () => void;
  /** Months after this one are shown but cannot be chosen. */
  readonly maxMonth: string;
  /** Offer「全部」(every month) below the grid. */
  readonly allowAll?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const all = isAllMonths(month);
  /** Only used while「全部」is selected: the year being looked at, not a selection. */
  const [browseYear, setBrowseYear] = useState<number | null>(null);

  useEffect(() => {
    setBrowseYear(null);
  }, [open, month]);

  if (!open) return null;

  const year = all ? (browseYear ?? Number(maxMonth.slice(0, 4))) : Number(month.slice(0, 4));

  const step = (delta: number): void => {
    const next = year + delta;
    if (all) {
      setBrowseYear(next);
      return;
    }
    // Keep the month, clamp to something that exists.
    onSelect(`${String(next)}-${month.slice(5, 7)}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={t("ledger.monthPicker.close")}
        onClick={onClose}
        className="absolute inset-0 bg-overlay"
      />

      <div
        role="dialog"
        aria-label={t("ledger.monthPicker.title")}
        className="relative w-full max-w-md rounded-t-sheet bg-surface px-6 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            aria-label={t("ledger.monthPicker.previousYear")}
            onClick={() => {
              step(-1);
            }}
            className="rounded-full px-3 py-2 text-muted transition hover:text-ink"
          >
            ‹
          </button>

          <span className="text-base font-medium tabular-nums text-ink">{yearLabel(year)}</span>

          <button
            type="button"
            aria-label={t("ledger.monthPicker.nextYear")}
            onClick={() => {
              step(1);
            }}
            className="rounded-full px-3 py-2 text-muted transition hover:text-ink"
          >
            ›
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-2">
          {MONTH_INDEXES.map((index) => {
            const name = monthName(year, index);
            const value = `${String(year)}-${String(index + 1).padStart(2, "0")}`;
            const selected = value === month;
            const future = value > maxMonth;

            return (
              <li key={value}>
                <button
                  type="button"
                  disabled={future}
                  aria-pressed={selected}
                  onClick={() => {
                    onSelect(value);
                    onClose();
                  }}
                  className={`w-full rounded-field py-3 text-sm transition ${
                    selected
                      ? "bg-brand text-on-brand"
                      : future
                        ? "text-muted/40"
                        : "bg-canvas text-ink hover:bg-brand-soft"
                  }`}
                >
                  {name}
                </button>
              </li>
            );
          })}
        </ul>

        <div className={`mt-4 grid gap-2 ${allowAll ? "grid-cols-3" : "grid-cols-1"}`}>
          {allowAll ? (
            <button
              type="button"
              aria-pressed={all}
              onClick={() => {
                onSelect(ALL_MONTHS);
                onClose();
              }}
              className={`w-full rounded-field py-3 text-sm transition ${
                all ? "bg-brand text-on-brand" : "bg-canvas text-ink hover:bg-brand-soft"
              }`}
            >
              {t("ledger.monthPicker.all")}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              onSelect(currentMonth());
              onClose();
            }}
            className={`w-full rounded-field bg-brand-soft py-3 text-sm font-medium text-brand-dark transition hover:bg-brand/20 ${
              allowAll ? "col-span-2" : ""
            }`}
          >
            {t("ledger.monthPicker.thisMonth")}
          </button>
        </div>
      </div>
    </div>
  );
}
