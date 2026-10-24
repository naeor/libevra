import { decimalsFor, formatMinor, parseAmountToMinor } from "@libellum/shared";

import { currentLocale, t } from "../i18n/index.js";

/**
 * Display and input helpers for money.
 *
 * Amounts stay integers all the way through; this file is one of only two
 * places that turns them into something a person reads (the other is the
 * amount field on the entry screen). Both consult `decimalsFor`, because the
 * yen has no decimal places and a yen amount shown as `¥1000.00` would be
 * both wrong and confusing.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "JP¥",
  HKD: "HK$",
  GBP: "£",
};

/** 有本地化名称的币种；名称本身在各语言的 `i18n/resources/<语言>/format.ts`。 */
const NAMED_CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD", "GBP"] as const;
type NamedCurrency = (typeof NAMED_CURRENCIES)[number];

function isNamedCurrency(currency: string): currency is NamedCurrency {
  return (NAMED_CURRENCIES as readonly string[]).includes(currency);
}

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? "";
}

/** `人民币` / `Chinese yuan`；不认识的币种显示代码本身。 */
export function currencyName(currency: string): string {
  return isNamedCurrency(currency) ? t(`format.currency.${currency}`) : currency;
}

interface Separators {
  readonly group: string;
  readonly decimal: string;
}

const separatorCache = new Map<string, Separators>();

/** 当前语言的千分位与小数点符号（取自 `Intl`，缓存）。 */
export function numberSeparators(locale: string = currentLocale()): Separators {
  const cached = separatorCache.get(locale);
  if (cached !== undefined) return cached;
  let group = ",";
  let decimal = ".";
  try {
    for (const part of new Intl.NumberFormat(locale).formatToParts(12345.6)) {
      if (part.type === "group") group = part.value;
      if (part.type === "decimal") decimal = part.value;
    }
  } catch {
    /* 保持默认 */
  }
  const separators = { group, decimal };
  separatorCache.set(locale, separators);
  return separators;
}

function groupThousands(value: string, separator: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * `1234` + `CNY` becomes `¥12.34`; `1000` + `JPY` becomes `JP¥1,000`.
 *
 * `withCode` appends the ISO code, which is what makes a screen showing two
 * currencies unambiguous — ¥ alone could be yuan or yen.
 */
export function formatMoney(
  minor: number,
  currency: string,
  options: { withCode?: boolean } = {},
): string {
  const plain = formatMinor(minor, decimalsFor(currency));
  const negative = plain.startsWith("-");
  const [whole = "0", fraction] = (negative ? plain.slice(1) : plain).split(".");
  // 数字仍由整数最小单位精确换算（formatMinor），这里只决定分组符与小数点怎么写。
  const { group, decimal } = numberSeparators();

  const body =
    fraction === undefined
      ? `${currencySymbol(currency)}${groupThousands(whole, group)}`
      : `${currencySymbol(currency)}${groupThousands(whole, group)}${decimal}${fraction}`;

  return `${negative ? "-" : ""}${body}${options.withCode === true ? ` ${currency}` : ""}`;
}

/** `1234` becomes `12.34`, and `1000` JPY becomes `1000` — for an input field. */
export function minorToInput(minor: number, currency: string): string {
  return minor === 0 ? "" : formatMinor(minor, decimalsFor(currency));
}

/** The placeholder an empty amount field shows, matching the currency. */
export function amountPlaceholder(currency: string): string {
  return decimalsFor(currency) === 0 ? "0" : "0.00";
}

/** Parse what the user typed, honouring the currency's precision. */
export function parseAmountInput(input: string, currency: string): number {
  return parseAmountToMinor(input, decimalsFor(currency));
}
