import { useEffect, useState } from "react";

import { BottomSheet } from "./BottomSheet.js";
import { DesktopPopover } from "../desktop/DesktopPopover.js";
import type { MonthAvailability } from "../lib/monthAvailability.js";
import { ChevronIcon } from "./Icons.js";

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
 * `allowAll`（明细页）：底部多一个「全部」，选中后 `month` 为 `ALL_MONTHS`。
 * 左右箭头始终只翻看年份、不改选择；点某个月份才提交选择。
 */
export function MonthPicker({
  open,
  month,
  onSelect,
  onClose,
  maxMonth,
  allowAll = false,
  availability,
  loading = false,
  statusNote,
  year: controlledYear,
  onYearChange,
  anchor,
}: {
  readonly open: boolean;
  readonly month: string;
  readonly onSelect: (month: string) => void;
  readonly onClose: () => void;
  /** Months after this one are shown but cannot be chosen. */
  readonly maxMonth: string;
  /** Offer「全部」(every month) below the grid. */
  readonly allowAll?: boolean;
  readonly availability?: MonthAvailability;
  readonly loading?: boolean;
  readonly statusNote?: string;
  readonly year?: number;
  readonly onYearChange?: (year: number) => void;
  /** 桌面端锚定月份入口；触屏端继续使用底部面板。 */
  readonly anchor?: React.RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const all = isAllMonths(month);
  /** 翻页只浏览年份，点击月份才修改页面选择。 */
  const [browseYear, setBrowseYear] = useState<number | null>(null);

  useEffect(() => {
    setBrowseYear(null);
  }, [open, month]);

  if (!open) return null;

  const year = controlledYear ?? browseYear ?? Number((all ? maxMonth : month).slice(0, 4));

  const step = (delta: number): void => {
    const next = year + delta;
    setBrowseYear(next);
    onYearChange?.(next);
  };
  const disabled = (value: string): boolean => value > maxMonth || availability?.[value] === false || (loading && availability?.[value] !== true);

  /**
   * 月份内容：电脑版锚定弹层与触屏底部面板共用。`close` 是各自的关闭入口——底部面板是模板外壳的关闭
   * （先播放退场再卸载），电脑版弹层直接关闭并把焦点还给月份入口。
   */
  const body = (close: () => void) => {
    const choose = (value: string): void => {
      if (disabled(value)) return;
      onSelect(value);
      close();
      anchor?.current?.focus({ preventScroll: true });
    };
    return <>
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            aria-label={t("ledger.monthPicker.previousYear")}
            disabled={year <= 1}
            onClick={() => {
              step(-1);
            }}
            className="rounded-full px-3 py-2 text-muted transition hover:text-ink disabled:opacity-30"
          >
            <ChevronIcon direction="left" />
          </button>

          <span className="text-base font-medium tabular-nums text-ink">{yearLabel(year)}</span>

          <button
            type="button"
            aria-label={t("ledger.monthPicker.nextYear")}
            disabled={year >= Number(maxMonth.slice(0, 4))}
            onClick={() => {
              step(1);
            }}
            className="rounded-full px-3 py-2 text-muted transition hover:text-ink disabled:opacity-30"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-2">
          {MONTH_INDEXES.map((index) => {
            const name = monthName(year, index);
            const value = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
            const selected = value === month;
            const unavailable = disabled(value);

            return (
              <li key={value}>
                <button
                  type="button"
                  disabled={unavailable}
                  title={availability?.[value] === false ? t("ledger.monthPicker.empty") : undefined}
                  aria-pressed={selected}
                  onClick={() => {
                    choose(value);
                  }}
                  className={`w-full rounded-field py-3 text-sm transition ${
                    unavailable
                      ? "text-muted/40 cursor-not-allowed"
                      : selected
                      ? "bg-brand text-on-brand"
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
                close();
                anchor?.current?.focus({ preventScroll: true });
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
            disabled={disabled(currentMonth())}
            onClick={() => {
              choose(currentMonth());
            }}
            className={`w-full rounded-field bg-brand-soft py-3 text-sm font-medium text-brand-dark transition hover:bg-brand/20 disabled:bg-canvas disabled:text-muted/40 disabled:cursor-not-allowed ${
              allowAll ? "col-span-2" : ""
            }`}
          >
            {t("ledger.monthPicker.thisMonth")}
          </button>
        </div>
        {statusNote ? <p role="status" className="mt-3 text-helper-relaxed text-muted">{statusNote}</p> : null}
    </>;
  };

  if (anchor !== undefined) {
    const close = (): void => { onClose(); anchor.current?.focus({ preventScroll: true }); };
    return (
      <DesktopPopover anchor={anchor} label={t("ledger.monthPicker.title")} placement="bottom-start" width={320} onClose={onClose}>
        <div className="p-3">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-4">
            <span className="text-section-title text-ink">{t("ledger.monthPicker.title")}</span>
            <button type="button" aria-label={t("ledger.monthPicker.close")} className="rounded-field px-3 py-2 text-muted hover:bg-canvas" onClick={close}>×</button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">{body(onClose)}</div>
        </div>
      </DesktopPopover>
    );
  }
  /**
   * ⚠️ **S18（审查 U04）：焦点进入月份选择、Esc 关闭、关闭后回到触发它的月份按钮。** 大屏工作区里按工作区
   * 宽度变成居中的小对话框（`wide="pane"`：`lv-sheet*`，见 `workspace.css`），窄工作区与手机上仍是底部面板。
   * 弹出面板模板（1.19.58）：T1 列表，标题行与右上角 ×、下拉关闭、遮罩都由外壳负责；月份网格的选中样式不变。
   * 1.19.63 内容优先：按内容档（最高到大档），整张月份网格一次露出。
   */
  return (
    <BottomSheet label={t("ledger.monthPicker.title")} title={t("ledger.monthPicker.title")} wide="pane"
      bodyClassName="px-6 pt-1 pb-6" onClose={onClose}>
      {(close) => body(close)}
    </BottomSheet>
  );
}
