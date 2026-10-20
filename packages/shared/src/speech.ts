/**
 * Turning a spoken sentence into the fields of an entry.
 *
 * ⚠️ **Deliberately a separate module from recognition.** The owner asked for the
 * split, and his reasoning is the right one: what is hard is the *recognition*,
 * and what is easy to get subtly wrong is this — turning "嗯，午饭 38 块" into an
 * amount, a kind and a note. Keeping them apart means the engine behind the first
 * can be swapped (whisper.cpp, the browser's own speech engine, a hosted API)
 * without touching the second, and this half can be tested with typed text.
 *
 * Two rules shape everything here:
 *
 *  * **Nothing is invented.** If the sentence has no amount, this reports no
 *    amount. A guess that fills a field the user did not say is worse than an
 *    empty field, because an empty field gets filled and a wrong one gets saved.
 *  * **The note is what was said**, minus the noise words — not a summary. The
 *    user can read it back and see whether they were heard correctly.
 */
import { z } from "zod";

import { matchCategory, type CategoryCandidate } from "./categoryMatch.js";
import { chineseNumeralToDigits, isNumeralChar } from "./chineseNumerals.js";

/**
 * Words that mark the number before them as money, **longest first**.
 *
 * Longest first so 「块钱」 is read as one marker rather than 「块」 followed by a
 * stray 钱, and 「欧元」 is not read as 「元」 with an 欧 in front.
 */
const CURRENCY_WORDS = ["人民币", "美元", "美金", "港币", "日元", "欧元", "块钱", "元", "块", "圆"] as const;

/**
 * Currency words the jiao/fen part can follow: 「四十二块五」, 「42 元 5 角」.
 *
 * ⚠️ **Foreign currencies score as an amount but are left in the note.** The
 * entry this feeds has no currency field, so removing 「美元」 from
 * 「12 美元，信用卡支付」 would leave an amount of `12` beside a note that no
 * longer says which dollars — and the entry's default reads as yuan.
 */
const YUAN_WORDS: ReadonlySet<string> = new Set(["元", "块", "块钱", "圆"]);

/** The characters that mean "half a yuan" when they follow a digit. */
const JIAO_UNITS: ReadonlySet<string> = new Set(["角", "毛"]);

/**
 * Units that make a number a **date or a time**, never a price.
 *
 * ⚠️ This is the fix for the owner's report: 「9 月 21 日餐饮花费 88 元」 used to
 * put **9** in the amount field because the digits pattern took the first number
 * it saw, and 「10 月 8 日……四十二块五」 put the **5** of the jiao in — the date
 * numbers are not prices and a fraction is not the amount.
 */
const DATE_UNITS: ReadonlySet<string> = new Set(["月", "日", "号", "年", "时", "点", "分", "秒", "天"]);

/** Mirrors chineseNumerals' run cap: a sentence's numeral run is never longer. */
const MAX_CHINESE_RUN = 24;

/** One number the sentence could mean as the amount, and how to read it. */
interface AmountCandidate {
  /** Digits as they will be put in the amount field. */
  readonly value: string;
  /** Where the amount starts in the sentence. */
  readonly start: number;
  /** Where it ends, exclusive — the currency word included where it goes with it. */
  readonly end: number;
  /** Higher wins. A number next to a currency word beats a bare one. */
  readonly score: number;
}

/** Words that mean income rather than spending. */
const INCOME_WORDS = [
  "收到",
  "收入",
  "入账",
  "到账",
  "工资",
  "发工资",
  "报销",
  "退款",
  "退了",
  "退款到账",
  "分红",
  "利息",
  "红包",
  "转给我",
  "给我转",
];

/** Words that mean spending. */
const EXPENSE_WORDS = ["花了", "花掉", "支出", "付了", "付款", "买了", "买", "消费", "交了", "充值"];

/**
 * Noise at the edges of a spoken sentence.
 *
 * The owner asked for these specifically — "备注里可以去掉一些语气词，比如'嗯'、'啊'
 * 在句首或句尾" — and the placement matters as much as the list: a 啊 in the
 * middle of a sentence is part of what somebody said, while the same character at
 * the front is the sound of somebody starting to talk.
 */
const FILLERS = [
  "嗯",
  "啊",
  "呃",
  "唉",
  "诶",
  "哎",
  "哦",
  "噢",
  "那个",
  "就是",
  "然后",
  "这个",
  "我说",
  "帮我",
  "给我",
  "记一笔",
  "记账",
  "记一下",
];

export interface SpokenEntry {
  /** Digits as spoken, e.g. `"38"` or `"38.5"`. Null when no amount was heard. */
  readonly amount: string | null;
  readonly kind: "expense" | "income";
  /** What was said, with the noise removed. */
  readonly note: string;
}

/**
 * Read a spoken sentence.
 *
 * Returns what it found and nothing more. The caller puts `amount` in the amount
 * field, `note` in the note field, and leaves the rest to the user — which is the
 * point of returning a plain object rather than a form.
 */
export function parseSpokenEntry(spoken: string): SpokenEntry {
  const original = spoken.trim();

  const kind: "expense" | "income" = INCOME_WORDS.some((word) => original.includes(word))
    ? "income"
    : EXPENSE_WORDS.some((word) => original.includes(word))
      ? "expense"
      : "expense"; // Spending is the common case; the kind control is one tap away.

  /**
   * The amount, and then the same text with it taken out.
   *
   * Taken out because the amount is a *field*, not part of the description: a
   * note reading "午饭 38 块" next to an amount of 38 says the number twice, and
   * the second copy is the one that goes stale when the amount is corrected.
   *
   * ⚠️ **Every number in the sentence is a candidate, and they are scored.**
   *
   * The owner's report was not that one number was misread but that the *wrong*
   * number was read: 「9 月 21 日餐饮花费 88 元」 became `9` (the month) and
   * 「10 月 8 日……四十二块五」 became `5` (the jiao), because the old code took
   * the first digits it found and the Chinese branch took the first numeral run
   * with a money word after it. Scoring instead of ordering means a date number
   * simply is not a candidate, and a number with a currency word after it beats
   * a bare one — see `findSpokenAmount`.
   */
  const amount = findSpokenAmount(original);
  const withoutAmount =
    amount === null ? original : original.slice(0, amount.start) + " " + original.slice(amount.end);

  return { amount: amount?.value ?? null, kind, note: cleanNote(withoutAmount) };
}

/**
 * Which of the numbers in a sentence is the amount.
 *
 * Four rules, in order of how much they decide:
 *
 *  1. **A number followed by a month/day/hour unit is not a price.** 月 日 号 年
 *     时 点 分 秒 天 are the units of when something happened; a number next to
 *     one is a date, and returning no amount is right where returning the date
 *     would be a plausible-looking wrong number.
 *  2. **A number next to a currency word wins.** 「88 元」 is the amount in a
 *     sentence that also says 「9 月 21 日」.
 *  3. **A jiao/fen part joins the yuan before it**: 「四十二块五」 is 42.5, not 42
 *     and not 5, and 「42 元 5 角」 is the same amount said with digits.
 *  4. Otherwise the longer number wins, and among equals the later one — the
 *     price tends to come after the description ("买了三个苹果 25").
 *
 * Nothing is invented: a sentence with no eligible number returns `null`.
 */
function findSpokenAmount(text: string): AmountCandidate | null {
  const candidates = [...findChineseAmountCandidates(text), ...findDigitAmountCandidates(text)];

  let best: AmountCandidate | null = null;

  for (const candidate of candidates) {
    const isBetter =
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.start > best.start);

    if (isBetter) best = candidate;
  }

  return best;
}

/** Numbers written in Chinese numerals (三十八, 叁佰捌拾) that could be the amount. */
function findChineseAmountCandidates(text: string): AmountCandidate[] {
  const found: AmountCandidate[] = [];
  let index = 0;

  while (index < text.length) {
    if (!isNumeralChar(text[index] ?? "")) {
      index += 1;
      continue;
    }

    let end = index;
    while (end < text.length && end - index < MAX_CHINESE_RUN && isNumeralChar(text[end] ?? "")) {
      end += 1;
    }

    const run = text.slice(index, end);
    const value = chineseNumeralToDigits(run);

    /**
     * `三点` is a time and a run ending in the decimal point is half a number;
     * both are skipped rather than read as a number that was never said.
     */
    const readable = !run.startsWith("点") && !run.startsWith("點") && !run.endsWith("点") && !run.endsWith("點");

    if (value !== null && readable) {
      const candidate = readChineseAmountCandidate(text, index, end, value);
      if (candidate !== null) found.push(candidate);
    }

    index = end;
  }

  return found;
}

/** Turn one Chinese numeral run into a candidate, or reject it as a date. */
function readChineseAmountCandidate(
  text: string,
  start: number,
  end: number,
  value: string,
): AmountCandidate | null {
  const after = skipSpaces(text, end);
  const currency = CURRENCY_WORDS.find((word) => text.startsWith(word, after));

  if (currency !== undefined) {
    const markerEnd = after + currency.length;

    // A fraction only follows a whole number: 三点五元 is already 3.5.
    if (YUAN_WORDS.has(currency) && !value.includes(".")) {
      const fraction = readFraction(text, markerEnd, true);
      if (fraction !== null) {
        return { value: `${value}.${fraction.digits}`, start, end: fraction.end, score: 1000 + value.length };
      }
    }

    // Foreign currency stays in the note — see YUAN_WORDS.
    return {
      value,
      start,
      end: YUAN_WORDS.has(currency) ? markerEnd : end,
      score: 1000 + value.length,
    };
  }

  // 「五毛」 with no yuan word is 0.5, not 5.
  if (JIAO_UNITS.has(text[end] ?? "") && /^[1-9]$/.test(value)) {
    return { value: `0.${value}`, start, end: end + 1, score: 500 + value.length };
  }

  if (DATE_UNITS.has(text[after] ?? "")) return null;

  return { value, start, end, score: value.length };
}

/** Numbers written in digits (38, 38.5, 12000) that could be the amount. */
function findDigitAmountCandidates(text: string): AmountCandidate[] {
  const found: AmountCandidate[] = [];

  for (const match of text.matchAll(/\d{1,9}(?:\.\d{1,2})?/g)) {
    const start = match.index ?? 0;
    const amount = match[0];
    const end = start + amount.length;
    const after = skipSpaces(text, end);
    const currency = CURRENCY_WORDS.find((word) => text.startsWith(word, after));

    if (currency !== undefined) {
      const markerEnd = after + currency.length;

      if (YUAN_WORDS.has(currency) && !amount.includes(".")) {
        const fraction = readFraction(text, markerEnd, true);

        if (fraction !== null) {
          found.push({ value: `${amount}.${fraction.digits}`, start, end: fraction.end, score: 1000 + amount.length });
        } else {
          found.push({ value: amount, start, end: markerEnd, score: 1000 + amount.length });
        }
        continue;
      }

      // Foreign currency stays in the note — see YUAN_WORDS.
      found.push({ value: amount, start, end: YUAN_WORDS.has(currency) ? markerEnd : end, score: 1000 + amount.length });
      continue;
    }

    // 「5 角」 with no yuan word is 0.5, not 5.
    if (JIAO_UNITS.has(text[after] ?? "") && /^[1-9]$/.test(amount)) {
      found.push({ value: `0.${amount}`, start, end: after + 1, score: 500 + amount.length });
      continue;
    }

    if (DATE_UNITS.has(text[after] ?? "")) continue;

    found.push({ value: amount, start, end, score: amount.length });
  }

  return found;
}

/**
 * Read the jiao/fen part said after a yuan word.
 *
 * Three shapes are understood, because they are the three ways people say it:
 * 「块五」 / 「块零五」 (no unit characters), 「元五角」, and 「元五角三分」.
 * Returns the fraction as digits — `"5"` or `"53"` — and how much text it used.
 */
function readFraction(text: string, from: number, allowBare: boolean): { readonly digits: string; readonly end: number } | null {
  const at = skipSpaces(text, from);
  const first = readDigit(text, at);
  if (first === null) return null;

  // 「块零五」 — the zero is said out loud, and means five fen rather than five jiao.
  if (first.digit === "0") {
    const fen = readDigit(text, first.end);
    return fen === null ? null : { digits: `0${fen.digit}`, end: fen.end };
  }

  const unit = text[first.end];

  if (unit !== undefined && JIAO_UNITS.has(unit)) {
    const afterJiao = first.end + 1;
    const fen = readDigit(text, afterJiao);
    if (fen !== null && text[fen.end] === "分") {
      return { digits: `${first.digit}${fen.digit}`, end: fen.end + 1 };
    }
    return { digits: first.digit, end: afterJiao };
  }

  if (unit === "分") {
    return { digits: `0${first.digit}`, end: first.end + 1 };
  }

  /**
   * 「块五」 — the bare form only when nothing separates it from the yuan word.
   * Allowing a space would read 「38 块 5 个」 as 38.5.
   */
  if (allowBare && at === from) return { digits: first.digit, end: first.end };

  return null;
}

/** One digit, arabic or Chinese, at `index`. */
function readDigit(text: string, index: number): { readonly digit: string; readonly end: number } | null {
  const character = text[index];
  if (character === undefined) return null;

  if (character >= "0" && character <= "9") return { digit: character, end: index + 1 };

  const value = chineseNumeralToDigits(character);
  return value !== null && value.length === 1 ? { digit: value, end: index + 1 } : null;
}

/** Where the next non-space character is. Whisper writes 「38 元」 with a space. */
function skipSpaces(text: string, from: number): number {
  let at = from;
  while (at < text.length && (text[at] === " " || text[at] === "　")) at += 1;
  return at;
}


/**
 * Read a spoken sentence, including which category it sounds like.
 *
 * A separate function rather than an extra parameter on `parseSpokenEntry`, so
 * that the pure sentence-reading stays testable without a category list — and so
 * that a caller with no categories to offer (a script, a test, the first sync
 * before the ledger has loaded) has something to call.
 *
 * `categoryId` is `null` when nothing matched. **That is not a failure**: the
 * category field is one tap away, and a wrong guess that looks plausible is worse
 * than an empty field the user fills in.
 */
export function parseSpokenEntryWithCategory(
  spoken: string,
  categories: readonly CategoryCandidate[],
): SpokenEntry & { readonly categoryId: string | null; readonly categoryMatched: readonly string[] } {
  const entry = parseSpokenEntry(spoken);
  const match = matchCategory(spoken, categories, entry.kind);

  return {
    ...entry,
    categoryId: match?.id ?? null,
    categoryMatched: match?.matched ?? [],
  };
}

/**
 * Strip the noise from around a spoken note.
 *
 * Edges only, and repeatedly: "嗯，那个，午饭" needs both pass to come off, and a
 * single pass would leave "那个，午饭". Commas left dangling by a removal are
 * dropped, because "，" on its own is what makes a cleaned-up note look broken.
 */
export function cleanNote(text: string): string {
  let note = text;

  for (let pass = 0; pass < 8; pass += 1) {
    const before = note;
    note = stripEdges(note);

    if (note === before) break;
  }

  return collapsePunctuation(joinDateUnits(note));
}

/**
 * Keep a date together.
 *
 * Whisper writes 「10 月 8 日」 with spaces, and the rule below turns spaces into
 * commas; applied blindly it produced a note reading 「10，月，8，日在超市花了」.
 * Joining a number to the unit that follows it — and that unit to the number
 * after it — leaves 「10月8日在超市花了」, which is what was said.
 */
function joinDateUnits(text: string): string {
  return text
    .replace(/([上下午晚早凌晨])\s+(?=\d)/g, "$1")
    .replace(/(\d)\s+(?=[月日号年时点分秒])/g, "$1")
    .replace(/([月日号年时点分秒])\s+(?=\d)/g, "$1");
}

/** One pass of edge-stripping. */
function stripEdges(text: string): string {
  let note = text.trim();

  // Punctuation is trimmed first so a filler behind a comma is still at an edge:
  // "，嗯，午饭" has 嗯 at the front once the comma goes.
  note = note.replace(/^[\s,，。、；;:：!！?？~～]+/, "").replace(/[\s,，。、；;:：!！?？~～]+$/, "");

  for (const filler of FILLERS) {
    if (note.startsWith(filler)) {
      note = note.slice(filler.length);
    }
    if (note.endsWith(filler)) {
      note = note.slice(0, -filler.length);
    }
  }

  return note;
}

/**
 * Tidy the punctuation left behind.
 *
 * The owner's rule, in his words: "周围有很多逗号时可以去掉". Runs of separators
 * become one, and separators at the edges go — a note is a phrase, and it should
 * not begin or end with the pause that used to be around something removed.
 */
function collapsePunctuation(text: string): string {
  return text
    .replace(/[\s,，]+/g, "，")
    .replace(/，{2,}/g, "，")
    .replace(/^，|，$/g, "")
    .replace(/[。、；;:：!！?？]+$/g, "")
    .trim();
}

/**
 * How long one recording may be.
 *
 * The owner's figure: **thirty seconds per segment**. Long enough for a sentence
 * about a purchase with a note attached, short enough that the upload stays small
 * and the transcription stays quick — whisper's cost grows with the audio, and a
 * two-minute recording would make somebody wait for a result they could have said
 * in five seconds.
 *
 * Enforced in the interface (the recorder stops itself) *and* on the server,
 * because a limit that only exists in the browser is a limit somebody can skip.
 */
export const MAX_SPEECH_SECONDS = 30;

/** Roughly what thirty seconds of browser audio weighs, with room to spare. */
export const MAX_SPEECH_BYTES = 2 * 1024 * 1024;

/**
 * What one recording produces.
 *
 * The transcription **and** the fields read out of it. Both, rather than only the
 * fields, because the owner asked for the text to be visible and editable — that
 * is the whole trust mechanism here: somebody who can see "午饭 38" can tell
 * whether they were heard correctly, where somebody shown only a filled-in form
 * cannot tell whether the machine guessed.
 *
 * `amount`, `kind` and `note` are what `parseSpokenEntry` read: a starting point
 * for the review form, never a decision. Nothing is saved by this endpoint.
 */
export const transcribeResponseSchema = z.object({
  /** What was heard, verbatim. */
  text: z.string(),
  /** Digits as spoken, or null when no amount was said. */
  amount: z.string().nullable(),
  kind: z.enum(["expense", "income"]),
  /** The sentence with the noise removed — a starting note, not a summary. */
  note: z.string(),
  /**
   * A category the sentence sounds like, or `null` when nothing fitted.
   *
   * `null` is not a failure: the category field is one tap away, and a wrong guess
   * that looks plausible is worse than an empty field.
   */
  categoryId: z.string().nullable(),
  /**
   * The words that matched, so the interface can show its reasoning.
   *
   * "听到「午饭」，已选：餐饮" — the same principle as showing the transcript: a
   * field the app filled in silently is a field the user cannot check.
   */
  categoryMatched: z.array(z.string()),
  /** How long the audio was, and how long the transcription took. */
  audioSeconds: z.number(),
  seconds: z.number(),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

/**
 * Whether the text is worth offering as an entry at all.
 *
 * A recording of silence produces an empty string, and whisper answers a
 * non-speech sound with a bracketed marker such as `[BLANK_AUDIO]` or `(字幕:…)`.
 * Offering to file one of those as a note would be offering to save nonsense, so
 * they are recognised and dropped rather than shown.
 */
export function isSpeechless(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;

  // Whisper's own annotations, in both bracket styles it uses.
  if (/^[[(【][^\])】]*[\])】]$/.test(trimmed)) return true;

  // Nothing but punctuation.
  return /^[\s,，。、；;:：!！?？~～\-—…]+$/.test(trimmed);
}
