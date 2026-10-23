import { CURRENCIES, type Currency } from "@libellum/shared";
import { useState } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { errorMessage } from "../lib/api.js";
import { currencyName } from "../lib/format.js";
import { useUpdatePreferences } from "../lib/queries.js";
import { Alert } from "./Alert.js";
import { ChevronIcon } from "./Icons.js";

/**
 * **The building blocks of the settings screens.**
 *
 * ⚠️ **These live in `components/` because both the settings home and the 记账偏好
 * sub-page use them**, and the default currency in particular must be **one
 * implementation, not two** — see `useDefaultCurrency` below. A second copy of
 * the currency control is how the two screens would come to disagree about which
 * currency is selected.
 */

// ---------------------------------------------------------------------------
// Default currency — one hook, one source of truth
// ---------------------------------------------------------------------------

/** Everything a currency control needs, whichever screen is drawing it. */
export interface DefaultCurrency {
  /** The currency in force **right now** — see `currentCurrency` below. */
  readonly current: Currency;
  /** A PATCH is in flight; every pill is disabled while it is. */
  readonly pending: boolean;
  /** The last PATCH succeeded, for the small 已保存 note. */
  readonly saved: boolean;
  /** The PATCH's error, already turned into a sentence. */
  readonly error: string | null;
  choose(option: Currency): void;
}

/**
 * **Which default currency is in force, as a pure function.**
 *
 * ⚠️ **The PATCH's own answer wins over `AuthProvider`'s state, and that ordering
 * is the fix for S13-E 8.4.** Saving used to show 「已保存。」 while the **old**
 * currency stayed highlighted, because `useAuth().user` is React state refreshed
 * only on start-up, window focus or a 60-second poll — while the PATCH writes the
 * `["me"]` query cache, which **no component subscribes to**. The answer the server
 * just gave is the freshest fact on screen, so it is read first; `reload()` then
 * writes that same answer into the one `user` state so 明细／分析／导出 agree too.
 *
 * ⚠️ **Nothing here stores a second copy of the user.** This is a derivation, and
 * `undefined` from the mutation simply falls through to the session state and then
 * to the server's documented default.
 *
 * Exported as a function so the ordering can be tested without hooks or a DOM.
 */
export function currentCurrency(
  user: { readonly defaultCurrency: Currency } | null,
  patched: Currency | undefined,
): Currency {
  return patched ?? user?.defaultCurrency ?? "CNY";
}

/**
 * The default currency and the one way to change it.
 *
 * ⚠️ **Mounted by both the settings home and `/settings/preferences`.** The two
 * screens are never visible at the same time, and neither keeps its own copy:
 * `current` is derived from the mutation answer and `AuthProvider`, and `saved`
 * is a flag about the last action, not a second currency value.
 */
export function useDefaultCurrency(): DefaultCurrency {
  const { user, reload } = useAuth();
  const preferences = useUpdatePreferences();
  const [saved, setSaved] = useState(false);

  return {
    current: currentCurrency(user, preferences.data?.user.defaultCurrency),
    pending: preferences.isPending,
    saved,
    error: preferences.isError ? errorMessage(preferences.error) : null,
    choose: (option) => {
      setSaved(false);
      preferences.mutate(
        { defaultCurrency: option },
        {
          onSuccess: () => {
            setSaved(true);
            // The same answer the UI already used, written into the one user state.
            void reload();
          },
        },
      );
    },
  };
}

/**
 * **The compact currency picker, shared by the settings home and 记账偏好.**
 *
 * ⚠️ **The six currencies are the shared list, not a local copy** — 人民币 / 美元 /
 * 欧元 / 日元 / 港币 / 英镑, exactly `CURRENCIES`. The requirement was that every
 * one of them stays choosable from the home screen; the control simply does not
 * get a section of its own there.
 *
 * ⚠️ **Nothing here navigates.** The pills call `value.choose` and nothing else,
 * and the card's own button is a **sibling** of this control rather than its
 * parent — see `SettingsCategoryCard`. That is what keeps "change currency" from
 * ever being "open 记账偏好".
 */
export function CurrencyQuickPick({
  value,
  hint,
}: {
  readonly value: DefaultCurrency;
  /** A longer explanation, used on the sub-page; the home passes none. */
  readonly hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {/**
       * ⚠️ **`aria-pressed`, not a radio group.** The pills are buttons that save
       * on press — a radio would promise a form and a submit button that do not
       * exist. `aria-pressed` lets a screen reader say which one is in force.
       */}
      <div role="group" aria-label="默认币种" className="flex flex-wrap gap-2">
        {CURRENCIES.map((option) => {
          const selected = value.current === option;

          return (
            <button
              key={option}
              type="button"
              data-currency={option}
              aria-pressed={selected}
              disabled={value.pending}
              onClick={() => {
                value.choose(option);
              }}
              /**
               * ⚠️ **`min-h-11` is the 44 px touch target**, and the pills are the
               * smallest controls in the settings screens — exactly where a missed
               * tap is most likely on a phone.
               */
              className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm transition-colors disabled:opacity-45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft ${
                selected
                  ? "bg-brand text-white hover:bg-brand-dark"
                  : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {currencyName(option)}
            </button>
          );
        })}
      </div>

      {hint === undefined ? null : <p className="text-helper-relaxed text-muted">{hint}</p>}
      {value.error === null ? null : <Alert tone="error">{value.error}</Alert>}
      {value.saved && !value.pending ? <p className="text-helper text-brand-dark">已保存。</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards and rows
// ---------------------------------------------------------------------------

/**
 * **A category card on the settings home: title, grey description, arrow — the whole
 * card is one control.**
 *
 * ⚠️ **The default-currency quick control is deliberately *not* rendered inside this
 * card.** It is a sibling that the home puts *below* the card, so:
 *
 *  * **the whole card is clickable** — there is no dead lower region;
 *  * **changing the currency can never open 记账偏好** — the pills are not descendants
 *    of the card's `<button>`, so no bubbling and no `stopPropagation` trick is
 *    involved. Nesting an interactive control inside a button is invalid HTML, fires
 *    the outer navigation on every tap, and leaves a screen reader unable to tell the
 *    two actions apart.
 *
 * ⚠️ **Deliberately quiet.** White surface, hairline border, the shared card radius;
 * the only colour is the title's ink and the arrow's green. The previous settings
 * screen was a long column of framed groups and the point of this refactor is
 * **fewer, shorter screens** — not louder ones.
 */
export function SettingsCategoryCard({
  title,
  description,
  to,
  onOpen,
}: {
  readonly title: string;
  readonly description: string;
  /** Where the card goes; also the stable `data-section` hook the tests use. */
  readonly to: string;
  readonly onOpen: (to: string) => void;
}): React.JSX.Element {
  return (
    /**
     * ⚠️ **S16-A：分类现在是一组列表里的一行，外框由设置首页的 `ListGroup` 统一画。** 原来六张分类各自
     * 一张卡片，首页因此是六个等大的白框，"哪些是一类"只能靠读文字判断。整张卡可点、币种快选不在
     * 按钮里面这两条规则都没有变——只是行与行之间从卡片间距变成了贯通的分隔线。
     */
    <button
      type="button"
      data-section={to}
      onClick={() => {
        onOpen(to);
      }}
      className="flex min-h-13 w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-canvas focus-visible:bg-brand-soft focus-visible:outline-none active:bg-brand-soft/60"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-card-title text-ink">{title}</span>
        <span className="text-helper-relaxed text-muted">{description}</span>
      </span>
      <ChevronIcon direction="right" className="size-4 shrink-0 text-muted/70" />
    </button>
  );
}

export function SettingsToggle({
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** Stable hook for tests; rendered on the switch button. */
  readonly testId?: string;
}): React.JSX.Element {
  return (
    <div className={`flex justify-between gap-4 ${hint === undefined ? "items-center" : "items-start"}`}>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-card-title text-ink">{label}</span>
        {hint === undefined ? null : (
          <span className="text-helper-relaxed text-muted">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        {...(testId === undefined ? {} : { "data-testid": testId })}
        onClick={() => {
          onChange(!checked);
        }}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-45 ${
          checked ? "bg-brand" : "bg-line"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export interface SettingsRow {
  readonly label: string;
  readonly hint?: string;
  readonly to?: string;
}

/**
 * A list of rows inside one frame; `to` absent means "not available yet".
 *
 * ⚠️ **A missing address says 「后续开放」 instead of disappearing.** That rule comes
 * from the audit: a feature that is not built is a stated fact, and a row that
 * vanishes is something the user has to wonder about. **A row that *has* an address
 * must actually go there** — that is the other half of the same rule.
 */
export function SettingsRowList({
  rows,
  onNavigate,
}: {
  readonly rows: readonly SettingsRow[];
  readonly onNavigate: (to: string) => void;
}): React.JSX.Element {
  return (
    <ul className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
      {rows.map((row) => (
        <li key={row.label}>
          <button
            type="button"
            disabled={row.to === undefined}
            onClick={() => {
              if (row.to !== undefined) onNavigate(row.to);
            }}
            className="flex min-h-13 w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors enabled:hover:bg-canvas enabled:focus-visible:bg-brand-soft enabled:focus-visible:outline-none enabled:active:bg-brand-soft/60 disabled:cursor-default"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className={`text-card-title ${row.to === undefined ? "text-muted" : "text-ink"}`}>
                {row.label}
              </span>
              {row.hint ? <span className="text-helper-relaxed text-muted">{row.hint}</span> : null}
            </span>
            {/**
              * ⚠️ 还没开放的项是一行**说明**，不是一个坏掉的按钮：右侧写「后续开放」，没有箭头。
              */}
            {row.to === undefined ? (
              <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-helper text-muted">后续开放</span>
            ) : (
              <ChevronIcon direction="right" className="size-4 text-muted/70" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
