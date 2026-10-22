/**
 * The shared transaction-semantics core.
 *
 * Voice and paste are two ways in, not two parsers. They differ only in how the
 * text reaches this module — Whisper's transcript, or text the user pasted — and
 * everything after that is the same work: find the real amount, decide the
 * currency and direction, read the date, recognise the merchant and payment
 * method, and suggest a category from the ledger's own list.
 *
 * Two rules matter more than the individual heuristics:
 *
 *  * **Never invent a field.** A missing field is a question for the user. A
 *    plausible wrong field is a transaction that gets saved without anyone
 *    noticing, which is the failure this whole feature exists to avoid.
 *  * **A weak guess is labelled a guess.** `fieldStatus` is how the review screen
 *    knows whether it may quietly prefill (confirmed/suggested) or must ask
 *    (ambiguous/missing). The statuses are part of the result, not a UI after-
 *    thought, because "how sure are we" is information the parser has and the
 *    caller would otherwise have to re-derive.
 *
 * The amount grammar itself is shared with `speech.ts` rather than copied: the
 * spoken amount reader already handles Chinese numerals, 块五, 元五角, dates that
 * must not become prices, and the "which number is the price" scoring. This
 * module adds currency/label/structured-text reasoning on top of those candidates.
 */
import { z } from "zod";

import { cleanNote, findAmountCandidates, findSpokenAmount, type AmountCandidate } from "./speech.js";
import { currencySchema, transactionKindSchema } from "./ledger.js";
import type { Currency, TransactionKind } from "./ledger.js";
import { matchCategory, type CategoryCandidate } from "./categoryMatch.js";
import { chineseNumeralToDigits } from "./chineseNumerals.js";

/** How much trust a field deserves. */
export type FieldStatus = "confirmed" | "suggested" | "missing" | "ambiguous";

/** One reason a field is missing or uncertain, in words the review screen shows. */
export interface TransactionIssue {
  readonly code: string;
  readonly field: "amount" | "currency" | "kind" | "date" | "time" | "merchant" | "category" | "payment" | "text";
  readonly message: string;
  readonly severity: "warning" | "ambiguous";
}

/** The state of every field, so the UI can decide what to ask about. */
export interface TransactionFieldStatus {
  readonly amount: FieldStatus;
  readonly currency: FieldStatus;
  readonly kind: FieldStatus;
  readonly date: FieldStatus;
  readonly time: FieldStatus;
  readonly merchant: FieldStatus;
  readonly category: FieldStatus;
  readonly payment: FieldStatus;
}

/** A transaction candidate read out of one piece of text. */
export interface TransactionTextResult {
  readonly amount: string | null;
  readonly currency: Currency | null;
  readonly kind: TransactionKind;
  readonly occurredLocalDate: string | null;
  readonly occurredTime: string | null;
  readonly merchant: string | null;
  readonly paymentMethod: string | null;
  readonly categoryId: string | null;
  readonly categoryMatched: readonly string[];
  /** What was said/pasted, with the amount and noise removed. */
  readonly note: string;
  readonly issues: readonly TransactionIssue[];
  readonly status: TransactionFieldStatus;
  /** `structured` is a copied payment/bank detail; `natural` is a sentence. */
  readonly source: "structured" | "natural";
  /** True when the text clearly holds more than one transaction. */
  readonly multipleTransactions: boolean;
}

export interface ParseTransactionTextOptions {
  readonly categories?: readonly CategoryCandidate[];
  /** The user's local clock. Relative dates are computed from this, never UTC. */
  readonly now?: Date;
}

/**
 * The wire shape of a parsed candidate.
 *
 * Kept beside the interface because the voice endpoint returns it verbatim to
 * the browser, and the browser must be able to re-run the same parser on edited
 * text. Validation here makes a stale client fail loudly instead of showing
 * fields the API never read.
 */
export const fieldStatusSchema = z.enum(["confirmed", "suggested", "missing", "ambiguous"]);

export const transactionIssueSchema = z.object({
  code: z.string(),
  field: z.enum(["amount", "currency", "kind", "date", "time", "merchant", "category", "payment", "text"]),
  message: z.string(),
  severity: z.enum(["warning", "ambiguous"]),
});

export const transactionFieldStatusSchema = z.object({
  amount: fieldStatusSchema,
  currency: fieldStatusSchema,
  kind: fieldStatusSchema,
  date: fieldStatusSchema,
  time: fieldStatusSchema,
  merchant: fieldStatusSchema,
  category: fieldStatusSchema,
  payment: fieldStatusSchema,
});

export const transactionTextResultSchema = z.object({
  amount: z.string().nullable(),
  currency: currencySchema.nullable(),
  kind: transactionKindSchema,
  occurredLocalDate: z.string().nullable(),
  occurredTime: z.string().nullable(),
  merchant: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryMatched: z.array(z.string()),
  note: z.string(),
  issues: z.array(transactionIssueSchema),
  status: transactionFieldStatusSchema,
  source: z.enum(["structured", "natural"]),
  multipleTransactions: z.boolean(),
});

/** Longest-first so 人民币 is not read as 人民 + 币 and 美元 is not just 元. */
const CURRENCY_MARKERS: readonly { readonly words: readonly string[]; readonly currency: Currency }[] = [
  // Generic yuan words are included, but `detectCurrency` matches the longest
  // marker first — otherwise 美元 would be read as 元 and become CNY.
  { words: ["人民币", "CNY", "RMB", "￥", "¥", "块钱", "元", "块", "圆"], currency: "CNY" },
  { words: ["美元", "美金", "USD", "$"], currency: "USD" },
  { words: ["欧元", "EUR", "€"], currency: "EUR" },
  { words: ["英镑", "GBP", "£"], currency: "GBP" },
  { words: ["港币", "港元", "HKD", "HK$"], currency: "HKD" },
  { words: ["日元", "日币", "JPY", "円"], currency: "JPY" },
];

/** Payment methods, canonicalised for the form. Longest-first matters (微信支付). */
const PAYMENT_MARKERS: readonly { readonly words: readonly string[]; readonly label: string }[] = [
  { words: ["微信支付", "微信零钱", "微信"], label: "微信" },
  { words: ["支付宝", "余额宝"], label: "支付宝" },
  { words: ["信用卡", "贷记卡"], label: "信用卡" },
  { words: ["储蓄卡", "借记卡", "银行卡", "银联", "云闪付"], label: "银行卡" },
  { words: ["花呗"], label: "花呗" },
  { words: ["白条"], label: "白条" },
  { words: ["Apple Pay", "apple pay"], label: "Apple Pay" },
  { words: ["现金"], label: "现金" },
];

/** Words that mark money coming in. Checked before expense words. */
const INCOME_MARKERS = [
  "收到",
  "收款",
  "入账",
  "到账",
  "收入",
  "工资",
  "发工资",
  "报销",
  "退款",
  "退了",
  "退回",
  "分红",
  "利息",
  "奖金",
  "红包",
  "转给我",
  "给我转",
  "转入",
];

/** Words that mark money going out when no income marker is present. */
const EXPENSE_MARKERS = [
  "花了",
  "花掉",
  "花费",
  "支出",
  "付了",
  "付款",
  "支付",
  "买了",
  "买",
  "消费",
  "交了",
  "充值",
  "转给",
  "转账",
  "扣款",
  "扣费",
];

/** Labels whose numbers are never the actual transaction amount. */
const EXCLUDED_LABELS = [
  "原价",
  "原金额",
  "优惠",
  "折扣",
  "满减",
  "立减",
  "积分",
  "余额",
  "订单号",
  "订单编号",
  "交易单号",
  "交易号",
  "流水号",
  "单号",
  "编号",
  "卡号",
  "尾号",
  "手机号",
  "数量",
  "人数",
  "件数",
  "笔数",
  "折扣率",
];

/**
 * Labels that *do* mean the actual amount, strongest first.
 *
 * `实付` wins over `交易金额`: a payment detail can carry both, and the money
 * that left the account is the one the entry should record. `原价` and `优惠` are
 * deliberately absent — they are in `EXCLUDED_LABELS` instead.
 */
const ACTUAL_AMOUNT_LABELS = [
  "实付",
  "实际支付",
  "实际付款",
  "付款金额",
  "支付金额",
  "交易金额",
  "消费金额",
  "收款金额",
  "退款金额",
  "金额",
];

const CURRENCY_SYMBOLS = ["¥", "￥", "$", "€", "£"] as const;

/** A range in the original text that must not be treated as the amount. */
interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** One amount read, before it becomes the result's amount field. */
interface AmountRead {
  readonly value: string | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly status: FieldStatus;
  readonly currency: Currency | null;
  readonly currencyStatus: FieldStatus;
  readonly reason: string | null;
  readonly alternatives: readonly string[];
}

/** The date/time pair read from text. */
interface DateRead {
  readonly date: string | null;
  readonly time: string | null;
  readonly dateStatus: FieldStatus;
  readonly timeStatus: FieldStatus;
  readonly matched: string | null;
  readonly issue: TransactionIssue | null;
}

/** A value captured from a `label：value` line. */
interface LabelValue {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Read one transaction out of text.
 *
 * This is the only entry point voice and paste need. The caller decides how the
 * text was produced; this decides what it means.
 */
export function parseTransactionText(
  text: string,
  options: ParseTransactionTextOptions = {},
): TransactionTextResult {
  const original = text.trim();
  const now = options.now ?? new Date();
  const categories = options.categories ?? [];
  const source: TransactionTextResult["source"] = looksStructured(original) ? "structured" : "natural";
  const issues: TransactionIssue[] = [];

  const amountRead = readAmount(original);
  const dateRead = readDate(original, now);
  const kindRead = readKind(original, amountRead);
  const currency = amountRead.currency ?? detectCurrency(original)?.currency ?? "CNY";
  const currencyStatus: FieldStatus =
    amountRead.currencyStatus !== "missing"
      ? amountRead.currencyStatus
      : detectCurrency(original) === null
        ? "suggested"
        : "confirmed";
  const paymentRead = readLabelledValue(original, ["支付方式", "付款方式", "支付渠道"]) ?? null;
  const merchantRead =
    readLabelledValue(original, ["商户名称", "商户", "交易对方", "收款方", "收款人", "商家", "对方"]) ??
    readNaturalMerchant(original);
  const paymentMethod = paymentRead?.value ?? detectPayment(original);
  const merchant = merchantRead?.value !== undefined && !isPaymentWord(merchantRead.value)
    ? merchantRead.value
    : null;

  if (amountRead.status === "ambiguous") {
    issues.push({
      code: "amount_ambiguous",
      field: "amount",
      message:
        amountRead.alternatives.length > 1
          ? `文中出现多个可能的金额（${amountRead.alternatives.join("、")}），请选择实际金额。`
          : "金额无法唯一确定，请核对。",
      severity: "ambiguous",
    });
  } else if (amountRead.value === null) {
    issues.push({
      code: "amount_missing",
      field: "amount",
      message: amountRead.reason ?? "没有找到明确的交易金额，请手动填写。",
      severity: "warning",
    });
  }

  if (dateRead.issue !== null) issues.push(dateRead.issue);
  if (kindRead.status !== "confirmed") {
    issues.push({
      code: "kind_suggested",
      field: "kind",
      message: "没有明确的收支方向，已按支出预填，请核对。",
      severity: "warning",
    });
  }
  if (/转给|转账给|转钱给|转给朋友/.test(original) && kindRead.kind === "expense") {
    issues.push({
      code: "transfer_suspected",
      field: "category",
      message: "这笔看起来是转账，分类需要你确认，未按普通购物处理。",
      severity: "warning",
    });
  }
  if (/退款|退回|退了/.test(original)) {
    issues.push({
      code: "refund_detected",
      field: "kind",
      message: "识别到退款，收支方向已按收入处理，请核对。",
      severity: "warning",
    });
  }
  if (currency === "CNY" && amountRead.currencyStatus === "missing" && detectCurrency(original) === null) {
    issues.push({
      code: "currency_inferred",
      field: "currency",
      message: "没有看到币种，已按人民币预填，请核对。",
      severity: "warning",
    });
  }

  const matchedText = amountRead.start === null
    ? original
    : original.slice(0, Math.max(0, amountRead.start)) + " " + original.slice(Math.min(original.length, amountRead.end ?? original.length));
  const note = cleanNote(matchedText).trim();

  const rawCategory = categories.length === 0 ? null : matchCategory(original, categories, kindRead.kind);
  const category =
    rawCategory === null || shouldSuppressGenericIncomeCategory(original, rawCategory.id, categories)
      ? null
      : rawCategory;
  if (category === null && original !== "") {
    issues.push({
      code: "category_none",
      field: "category",
      message: "没有足够依据判断分类，请手动选择。",
      severity: "warning",
    });
  }

  const multipleTransactions = detectMultiple(original);

  return {
    amount: amountRead.value,
    currency,
    kind: kindRead.kind,
    occurredLocalDate: dateRead.date,
    occurredTime: dateRead.time,
    merchant,
    paymentMethod,
    categoryId: category?.id ?? null,
    categoryMatched: category?.matched ?? [],
    note,
    issues,
    status: {
      amount: amountRead.status,
      currency: currencyStatus,
      kind: kindRead.status,
      date: dateRead.dateStatus,
      time: dateRead.timeStatus,
      merchant: merchant === null ? "missing" : merchantRead !== null ? "confirmed" : "suggested",
      category: category === null ? "missing" : "suggested",
      payment: paymentMethod === null ? "missing" : paymentRead !== null ? "confirmed" : "suggested",
    },
    source,
    multipleTransactions,
  };
}

/**
 * Split text that clearly contains several transactions and parse each part.
 *
 * Only **explicit** separators are used — a blank line, a horizontal rule, or a
 * numbered/bulleted line. A long paragraph with several amounts is intentionally
 * *not* split: guessing there is how two purchases become one wrong transaction.
 * Callers that only support one entry can use `parseTransactionText` and show the
 * `multipleTransactions` warning instead.
 */
export function parseTransactionTexts(
  text: string,
  options: ParseTransactionTextOptions = {},
): readonly TransactionTextResult[] {
  return splitTransactionTexts(text).map((chunk) => parseTransactionText(chunk, options));
}

/**
 * The parts of a pasted text that are safe to treat as separate transactions.
 *
 * Exported so a screen can keep the **source text for each candidate**. The
 * user must be able to check a row against the lines it came from; handing only
 * the parsed fields to the review screen would lose the one piece of evidence
 * that makes a wrong split visible.
 *
 * Only explicit separators are honoured — see `parseTransactionTexts`.
 */
export function splitTransactionTexts(text: string): readonly string[] {
  return splitExplicitChunks(text);
}

/** Whether the text looks like a copied payment/bank detail rather than a sentence. */
export function looksStructured(text: string): boolean {
  return (
    /(?:微信支付|支付宝|银行|交易详情|交易成功|支付成功|付款成功|订单详情|账单详情)/.test(text) ||
    /(?:实付|付款金额|支付金额|交易金额|商户|交易对方|支付方式|交易时间|订单号)[：:]/.test(text) ||
    text.includes("\n")
  );
}

/** Whether the text clearly contains more than one transaction. */
export function hasMultipleTransactions(text: string): boolean {
  return detectMultiple(text);
}

function splitExplicitChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  const byRule = trimmed.split(/\n\s*(?:-{3,}|—{3,}|\*{3,})\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (byRule.length > 1) return byRule;

  const byBlankLine = trimmed.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  // A blank line can also be layout inside one copied payment detail ("交易详情"
  // on one line, fields after an empty line). Only treat it as a transaction
  // separator when at least two parts independently contain an amount; otherwise
  // the whole block is one record and the parser can see all of its labels.
  if (byBlankLine.length > 1 && byBlankLine.filter((part) => findAmountCandidates(part).length > 0).length >= 2) {
    return byBlankLine;
  }

  return [trimmed];
}

function detectMultiple(text: string): boolean {
  const chunks = splitExplicitChunks(text);
  if (chunks.length > 1) {
    return chunks.filter((chunk) => findSpokenAmount(chunk)?.value !== undefined).length > 1;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length < 2) return false;

  // A numbered list of transactions ("1. …", "2. …") is explicit enough.
  const numbered = lines.filter((line) => /^(?:\d+[.、)）]|[-*•])\s*/.test(line));
  if (numbered.length >= 2 && numbered.filter((line) => findSpokenAmount(line) !== null).length >= 2) {
    return true;
  }

  return false;
}

/**
 * Read the amount, preferring labelled actual amounts over bare numbers.
 *
 * The order is deliberate:
 *  1. A labelled actual amount (`实付`, `付款金额`, …) is the answer, even when
 *     the text also contains 原价 / 优惠 / 余额.
 *  2. Otherwise the shared candidate scorer is used, with numbers belonging to
 *     excluded labels removed and currency/verb context added.
 *  3. If two strong candidates cannot be separated, the amount is ambiguous and
 *     the review screen asks instead of choosing one.
 */
function readAmount(text: string): AmountRead {
  const currency = detectCurrency(text);

  const labelled = readLabelledAmount(text);
  if (labelled !== null) {
    return {
      value: labelled.value,
      start: labelled.start,
      end: labelled.end,
      status: "confirmed",
      currency: currency?.currency ?? null,
      currencyStatus: currency === null ? "missing" : currency.status,
      reason: null,
      alternatives: [],
    };
  }

  const excluded = excludedRanges(text);
  const candidates = findAmountCandidates(text).filter((candidate) => !insideAny(candidate.start, excluded));

  if (candidates.length === 0) {
    return {
      value: null,
      start: null,
      end: null,
      status: "missing",
      currency: currency?.currency ?? null,
      currencyStatus: currency === null ? "missing" : currency.status,
      reason: "没有找到明确的交易金额，请手动填写。",
      alternatives: [],
    };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreAmountCandidate(text, candidate) }))
    .sort((a, b) => b.score - a.score || b.candidate.start - a.candidate.start);

  const best = scored[0]!;
  const second = scored[1];
  const ambiguous =
    second !== undefined &&
    second.candidate.value !== best.candidate.value &&
    best.score - second.score <= 10 &&
    (best.score >= 500 || second.score >= 500);

  if (ambiguous) {
    return {
      value: null,
      start: null,
      end: null,
      status: "ambiguous",
      currency: currency?.currency ?? null,
      currencyStatus: currency === null ? "missing" : currency.status,
      reason: "文中出现多个可能的金额，请选择实际金额。",
      alternatives: [...new Set(scored.slice(0, 4).map((entry) => entry.candidate.value))],
    };
  }

  const marker = detectCurrency(text);
  return {
    value: best.candidate.value,
    start: best.candidate.start,
    end: best.candidate.end,
    status: best.score >= 1000 ? "confirmed" : "suggested",
    currency: marker?.currency ?? null,
    currencyStatus: marker === null ? "missing" : marker.status,
    reason: null,
    alternatives: [],
  };
}

/** A number next to an actual-amount label, e.g. `实付 ¥28.50`. */
function readLabelledAmount(text: string): { readonly value: string; readonly start: number; readonly end: number } | null {
  const found: { readonly value: string; readonly start: number; readonly end: number; readonly rank: number }[] = [];

  for (const [rank, label] of ACTUAL_AMOUNT_LABELS.entries()) {
    const pattern = new RegExp(
      `${label}\\s*[：:]?\\s*(?:人民币|CNY|RMB)?\\s*(?:[¥￥$€£]\\s*)?(\\d{1,9}(?:\\.\\d{1,2})?)`,
      "g",
    );
    for (const match of text.matchAll(pattern)) {
      const value = match[1];
      if (value === undefined) continue;
      const start = (match.index ?? 0) + match[0].lastIndexOf(value);
      found.push({ value, start, end: start + value.length, rank });
    }
  }

  if (found.length === 0) return null;

  // A labelled actual amount wins over a generic `金额`; within a label, the
  // first occurrence is the one the payment detail leads with.
  found.sort((a, b) => a.rank - b.rank || a.start - b.start);
  const best = found[0]!;

  return { value: best.value, start: best.start, end: best.end };
}

/** Ranges occupied by numbers that belong to excluded labels. */
function excludedRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  for (const label of EXCLUDED_LABELS) {
    const pattern = new RegExp(`${label}\\s*[：:]?`, "g");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const afterLabel = start + match[0].length;
      // The value follows the label, usually within a few characters. Include
      // both the label and the number so a bare digit inside it is filtered out.
      const window = text.slice(afterLabel, Math.min(text.length, afterLabel + 28));
      const number = /\d{1,12}(?:\.\d{1,2})?/.exec(window);
      if (number !== null) {
        ranges.push({ start, end: afterLabel + (number.index ?? 0) + number[0].length });
      }
    }
  }
  return ranges;
}

function insideAny(index: number, ranges: readonly TextRange[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/** Add the context the speaker/paster gave the number, beyond its digits. */
function scoreAmountCandidate(text: string, candidate: AmountCandidate): number {
  let score = candidate.score;
  const before = text.slice(Math.max(0, candidate.start - 12), candidate.start);
  const after = text.slice(candidate.end, Math.min(text.length, candidate.end + 10));

  const currencyAfter = currencyMarkerAt(text, candidate.end);
  if (currencyAfter !== null) score += 1000;
  if (currencySymbolBefore(text, candidate.start)) score += 1000;

  if (/(?:实付|实际支付|付款金额|支付金额|消费金额|花费|花了|付了|付款|支付|消费|买了|买|收入|收到|退款|到账|转账|转给|扣款|扣费)\s*[：:]?\s*$/.test(before)) {
    score += 60;
  }
  if (/^\s*(?:元|块|块钱|人民币|美元|美金|欧元|英镑|港币|日元)/.test(after)) score += 200;
  if (/^\s*(?:折|%|％)/.test(after)) score -= 300;
  if (/(?:订单|单号|流水|编号|余额|积分|原价|优惠|折扣|尾号|卡号|手机号|数量|人数|件数)\s*[：:]?\s*$/.test(before)) {
    score -= 1000;
  }

  // A number with no money unit after it is a weaker candidate than one with a
  // unit, but still better than nothing ("买菜六十四").
  return score;
}

function currencyMarkerAt(text: string, index: number): string | null {
  let at = index;
  while (at < text.length && (text[at] === " " || text[at] === "　")) at += 1;
  for (const marker of CURRENCY_MARKERS) {
    for (const word of marker.words) {
      if (text.startsWith(word, at)) return word;
    }
  }
  return null;
}

function currencySymbolBefore(text: string, index: number): boolean {
  let at = index - 1;
  while (at >= 0 && (text[at] === " " || text[at] === "　")) at -= 1;
  if (at < 0) return false;
  return CURRENCY_SYMBOLS.some((symbol) => text[at] === symbol);
}

/** Which currency a text mentions, if any. */
function detectCurrency(text: string): { readonly currency: Currency; readonly status: FieldStatus } | null {
  const hits: { readonly currency: Currency; readonly word: string; readonly at: number }[] = [];

  for (const marker of CURRENCY_MARKERS) {
    for (const word of marker.words) {
      let at = text.indexOf(word);
      while (at !== -1) {
        hits.push({ currency: marker.currency, word, at });
        at = text.indexOf(word, at + word.length);
      }
    }
  }

  if (hits.length === 0) return null;

  // `美元` must beat the `元` it contains; `人民币` must beat `元`. Longest word
  // wins, and for equally long markers the earlier one in the text wins.
  hits.sort((a, b) => b.word.length - a.word.length || a.at - b.at);
  const best = hits[0]!;

  // A bare ¥/￥ is common in copied detail text; it is still an explicit
  // symbol, but ￥ is used for both yuan and yen, so it is a suggestion.
  return {
    currency: best.currency,
    status: best.word === "¥" || best.word === "￥" ? "suggested" : "confirmed",
  };
}

/** Direction words, with income checked first. */
function readKind(text: string, amount: AmountRead): { readonly kind: TransactionKind; readonly status: FieldStatus } {
  if (/(?:收到|收款|入账|到账|退款|退回|工资|报销|奖金|利息|分红)/.test(text)) {
    return { kind: "income", status: "confirmed" };
  }
  if (/(?:花了|花掉|花费|支出|付了|付款|支付|买了|买|消费|交了|充值|转给|转账|扣款|扣费)/.test(text)) {
    return { kind: "expense", status: "confirmed" };
  }
  if (/-/.test(text) && amount.value !== null) return { kind: "expense", status: "suggested" };
  return { kind: "expense", status: "suggested" };
}

/**
 * Brands the owner is likely to say without 在/去/到 ("今天中午麦当劳花了").
 * This is a recognition aid, not a category table: the category still comes from
 * the ledger's own categories through `matchCategory`.
 */
const KNOWN_MERCHANTS = [
  "麦当劳",
  "肯德基",
  "星巴克",
  "瑞幸",
  "蜜雪冰城",
  "喜茶",
  "奈雪",
  "海底捞",
  "必胜客",
  "汉堡王",
  "华莱士",
  "塔斯汀",
  "茶百道",
  "古茗",
  "沪上阿姨",
  "Uber Eats",
  "美团",
  "饿了么",
  "滴滴",
] as const;

/** Find a `label：value` pair, ignoring empty values and values that are just punctuation. */
function readLabelledValue(text: string, labels: readonly string[]): LabelValue | null {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[：:]\\s*([^\\n，,；;。]{1,40})`);
    const match = pattern.exec(text);
    if (match === null) continue;
    const value = (match[1] ?? "").trim();
    if (value === "" || /^[\d.,，\s¥￥$€£-]+$/.test(value)) continue;
    const start = (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
    return { value, start, end: start + value.length };
  }
  return null;
}

/** Recognise a merchant from natural language, never from a payment-method word. */
function readNaturalMerchant(text: string): { readonly value: string; readonly start: number; readonly end: number } | null {
  // A known brand is the strongest merchant evidence and does not need a
  // preposition: "今天中午麦当劳花了 28.5".
  const known = KNOWN_MERCHANTS
    .map((name) => ({ name, at: text.indexOf(name) }))
    .filter((hit) => hit.at !== -1)
    .sort((a, b) => b.name.length - a.name.length || a.at - b.at)[0];
  if (known !== undefined) {
    return { value: known.name, start: known.at, end: known.at + known.name.length };
  }

  const patterns: readonly RegExp[] = [
    /在\s*([\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9 .&'’_-]{0,29}?)\s*(?:花|消费|买|吃|付|点|用|充值)/,
    /(?:去|到)\s*([\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9 .&'’_-]{0,29}?)\s*(?:花|消费|买|吃|打车|坐|加油)/,
    /(?:给|向)\s*([\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9 .&'’_-]{0,19}?)\s*(?:转|付|还)/,
    /([A-Za-z][A-Za-z0-9 .&'’_-]{1,29})\s*(?:消费|花费|买|付)/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const value = (match[1] ?? "").trim();
    if (value === "" || isPaymentWord(value) || /^\d+$/.test(value)) continue;
    return { value, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length };
  }
  return null;
}

/** Detect a payment method from natural language, without treating it as a merchant. */
function detectPayment(text: string): string | null {
  for (const marker of PAYMENT_MARKERS) {
    if (marker.words.some((word) => text.includes(word))) return marker.label;
  }
  return null;
}

function isPaymentWord(value: string): boolean {
  return PAYMENT_MARKERS.some((marker) => marker.words.some((word) => value === word || value.startsWith(`${word}：`)));
}

/**
 * A refund/transfer is income, but it is not a salary. The shared matcher sees
 * the generic word 收到 and votes for any income category, including 工资; that
 * is the exact wrong conclusion the owner warned about. Only a category that is
 * itself about refunds/transfers may be suggested in that case.
 */
function shouldSuppressGenericIncomeCategory(
  text: string,
  categoryId: string,
  categories: readonly CategoryCandidate[],
): boolean {
  if (!/(?:退款|退回|转了|转账|转给|转钱|还款|转给我|给我转)/.test(text)) return false;
  const name = categories.find((category) => category.id === categoryId)?.name ?? "";
  return !/(?:退款|退回|报销|还款|转账|红包)/.test(name);
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

/** Read a local date/time, refusing to turn an unspecified time into noon. */
function readDate(text: string, now: Date): DateRead {
  const date = readLocalDate(text, now);
  const time = readLocalTime(text);

  if (date === null && time === null) {
    return { date: null, time: null, dateStatus: "missing", timeStatus: "missing", matched: null, issue: null };
  }

  const issues: TransactionIssue[] = [];
  if (date !== null && date.status !== "confirmed") {
    issues.push({
      code: "date_inferred",
      field: "date",
      message: date.reason,
      severity: "warning",
    });
  }
  if (time === null && /(?:上午|下午|中午|晚上|凌晨|早上|傍晚|夜里)/.test(text)) {
    issues.push({
      code: "time_missing",
      field: "time",
      message: "只听到大致时段，没有具体时间；时间留空，请按需要补充。",
      severity: "warning",
    });
  }

  return {
    date: date?.value ?? null,
    time: time?.value ?? null,
    dateStatus: date?.status ?? "missing",
    timeStatus: time?.status ?? "missing",
    matched: date?.matched ?? null,
    issue: issues[0] ?? null,
  };
}

interface LocalDateRead {
  readonly value: string;
  readonly status: FieldStatus;
  readonly reason: string;
  readonly matched: string;
}

function readLocalDate(text: string, now: Date): LocalDateRead | null {
  // Longest first: 大前天 contains 前天, so it must be checked before it.
  const relative: readonly { readonly words: readonly string[]; readonly days: number; readonly status: FieldStatus }[] = [
    { words: ["大前天", "大前日", "大前晚"], days: -3, status: "confirmed" },
    {
      words: ["今天", "今日", "今早", "今晚", "今儿"],
      days: 0,
      status: "confirmed",
    },
    {
      words: ["昨天", "昨日", "昨晚", "昨早", "昨儿"],
      days: -1,
      status: "confirmed",
    },
    { words: ["前天", "前日", "前晚"], days: -2, status: "confirmed" },
  ];

  for (const item of relative) {
    const word = item.words.find((candidate) => text.includes(candidate));
    if (word !== undefined) {
      return { value: shiftLocalDate(now, item.days), status: item.status, reason: "", matched: word };
    }
  }

  // 上周五 / 上周五晚上. Weekday 0 is Sunday, matching Date#getDay.
  const lastWeek = /上周([一二三四五六日天])/.exec(text);
  if (lastWeek !== null) {
    const weekday = chineseWeekday(lastWeek[1] ?? "");
    if (weekday !== null) {
      return {
        value: lastWeekday(now, weekday),
        status: "confirmed",
        reason: "",
        matched: lastWeek[0],
      };
    }
  }

  // 本周五 / 这周五.
  const thisWeek = /(?:本周|这周|这个星期)([一二三四五六日天])/.exec(text);
  if (thisWeek !== null) {
    const weekday = chineseWeekday(thisWeek[1] ?? "");
    if (weekday !== null) {
      return {
        value: thisWeekday(now, weekday),
        status: "suggested",
        reason: "只说了星期，已按本周计算，请核对日期。",
        matched: thisWeek[0],
      };
    }
  }

  // 2026年10月8日 / 2026-10-08 / 2026/10/08.
  const full = /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?/.exec(text);
  if (full !== null) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    const day = Number(full[3]);
    if (isValidDate(year, month, day)) {
      return {
        value: formatLocalDate(new Date(year, month - 1, day)),
        status: "confirmed",
        reason: "",
        matched: full[0],
      };
    }
  }

  // 十月八日 / 十月八号, the form Whisper emits for clearly spoken dates.
  const chineseMonthDay = /([一二两三四五六七八九十]{1,3})\s*月\s*([一二两三四五六七八九十]{1,3})\s*[日号]/.exec(text);
  if (chineseMonthDay !== null) {
    const monthText = chineseNumeralToDigits(chineseMonthDay[1] ?? "");
    const dayText = chineseNumeralToDigits(chineseMonthDay[2] ?? "");
    if (monthText !== null && dayText !== null && !monthText.includes(".") && !dayText.includes(".")) {
      const month = Number(monthText);
      const day = Number(dayText);
      if (isValidDate(now.getFullYear(), month, day)) {
        let year = now.getFullYear();
        const candidate = new Date(year, month - 1, day);
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (candidate.getTime() > now.getTime() + oneWeek) year -= 1;
        if (isValidDate(year, month, day)) {
          return {
            value: formatLocalDate(new Date(year, month - 1, day)),
            status: "suggested",
            reason: "没有说明年份，已按当前年份推算，请核对日期。",
            matched: chineseMonthDay[0],
          };
        }
      }
    }
  }

  // 10月8日 / 10月8号. No year: use the current year, but if that lands in the
  // future by more than a week, assume the user means last year. Either way the
  // field is a suggestion, never presented as a certainty.
  const monthDay = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text);
  if (monthDay !== null) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (isValidDate(now.getFullYear(), month, day)) {
      let year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (candidate.getTime() > now.getTime() + oneWeek) year -= 1;
      if (isValidDate(year, month, day)) {
        return {
          value: formatLocalDate(new Date(year, month - 1, day)),
          status: "suggested",
          reason: "没有说明年份，已按当前年份推算，请核对日期。",
          matched: monthDay[0],
        };
      }
    }
  }

  return null;
}

function readLocalTime(text: string): { readonly value: string; readonly status: FieldStatus; readonly matched: string } | null {
  // 晚上八点 / 下午3点半 / 10:30 / 10点30分. The period is optional; without it
  // the hour is still an explicit time, but only "suggested" is honest.
  const pattern =
    /(上午|下午|中午|晚上|凌晨|早上|傍晚|夜里)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:点|时|:|：)\s*(\d{1,2}|[一二三四五六七八九十]{1,2})?\s*(?:分|半)?/;
  const match = pattern.exec(text);
  if (match === null) return null;

  const period = match[1] ?? "";
  const hourValue = parseClockNumber(match[2] ?? "");
  if (hourValue === null) return null;

  let hour = hourValue;
  if (/(?:下午|晚上|傍晚|夜里)/.test(period) && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  if (hour > 23) return null;

  let minute = 0;
  const minuteText = match[3];
  if (minuteText !== undefined) {
    const parsed = parseClockNumber(minuteText);
    if (parsed === null || parsed > 59) return null;
    minute = parsed;
  } else if (/半/.test(match[0])) {
    minute = 30;
  }

  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const explicitPeriod = /^(?:上午|下午|中午|晚上|凌晨|早上|傍晚|夜里)$/.test(period);
  // `10:30` is digital clock notation, so the hour is already unambiguous even
  // without 上午/下午. A bare `8点` is not: it could be morning or evening.
  const digitalClock = /[:：]/.test(match[0]);
  return {
    value,
    status: explicitPeriod || digitalClock || hour >= 13 ? "confirmed" : "suggested",
    matched: match[0],
  };
}

function parseClockNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = chineseNumeralToDigits(text);
  if (digits === null || digits.includes(".")) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

function chineseWeekday(character: string): number | null {
  const map: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  return map[character] ?? null;
}

/** The date of `weekday` in the ISO week before `now`'s week. */
function lastWeekday(now: Date, weekday: number): string {
  const monday = startOfIsoWeek(now);
  const target = new Date(monday);
  target.setDate(monday.getDate() - 7 + (weekday === 0 ? 6 : weekday - 1));
  return formatLocalDate(target);
}

/** The date of `weekday` in `now`'s ISO week. */
function thisWeekday(now: Date, weekday: number): string {
  const monday = startOfIsoWeek(now);
  const target = new Date(monday);
  target.setDate(monday.getDate() + (weekday === 0 ? 6 : weekday - 1));
  return formatLocalDate(target);
}

function startOfIsoWeek(now: Date): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - offset);
  return date;
}

function shiftLocalDate(now: Date, days: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
