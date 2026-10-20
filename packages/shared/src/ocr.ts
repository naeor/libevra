import { z } from "zod";

/**
 * Screenshot recognition.
 *
 * The shape of a **guess**, not of an entry. Every field can be null, and the
 * interface shows the guess next to the field it belongs to so the user can
 * correct it. Nothing here is ever written straight into the ledger.
 *
 * Two properties matter more than the rest:
 *
 *  * **A field that could not be read is null, never a default.** A wrong
 *    amount gets confirmed; a blank one gets filled in. Guessing 0, or today's
 *    date dressed up as a reading, would produce a plausible entry that is
 *    silently wrong.
 *  * **`warnings` travels with the result.** The interface has to be able to
 *    say *why* a field is empty, or the user is left wondering whether the
 *    screenshot was unreadable or the feature is broken.
 */

/** Which app the screenshot came from, when it can be told. */
export const OCR_CHANNELS = ["WECHAT", "ALIPAY", "BANK"] as const;
export const ocrChannelSchema = z.enum(OCR_CHANNELS);
export type OcrChannel = z.infer<typeof ocrChannelSchema>;

/** Chinese labels, so the interface never shows a raw enum. */
export const OCR_CHANNEL_LABELS: Readonly<Record<OcrChannel, string>> = {
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK: "银行",
};

/**
 * What kind of page a screenshot is (S15-B §4 layer 2).
 *
 * `unknown` is a real answer, not a failure: the recogniser has declined to
 * decide how many transactions the page holds, and the interface asks the user
 * instead of inventing a count.
 */
export const OCR_PAGE_TYPES = ["single-detail", "transaction-list", "unknown"] as const;
export const ocrPageTypeSchema = z.enum(OCR_PAGE_TYPES);
export type OcrPageType = z.infer<typeof ocrPageTypeSchema>;

export const OCR_PAGE_TYPE_LABELS: Readonly<Record<OcrPageType, string>> = {
  "single-detail": "单笔详情",
  "transaction-list": "交易列表",
  unknown: "无法判断",
};

/** The direction of the money. `unknown` must not quietly become `expense`. */
export const OCR_DIRECTIONS = ["expense", "income", "transfer", "unknown"] as const;
export const ocrDirectionSchema = z.enum(OCR_DIRECTIONS);
export type OcrDirection = z.infer<typeof ocrDirectionSchema>;

export const OCR_DIRECTION_LABELS: Readonly<Record<OcrDirection, string>> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  unknown: "方向待确认",
};

/**
 * One reason a candidate field is missing or doubtful. `message` is shown to
 * the user verbatim; `code` is for tests and for deciding what to fix.
 */
export interface OcrIssue {
  readonly code: string;
  readonly message: string;
  readonly field: string | null;
}

export const ocrIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().nullable(),
});

/**
 * One transaction cut out of a screenshot (S15-B layer 3-5).
 *
 * Every field is nullable on purpose: a candidate is a guess, and a missing
 * field is a question for the user rather than a default. `issues` says *why*
 * a field is empty; `isComplete` says whether the candidate has enough to be
 * shown without a mandatory detail visit, and `isQuestionable` says whether the
 * user should look at it. Neither is a claim that the ledger may be written:
 * that only happens after the user confirms the batch.
 */
export interface OcrCandidate {
  readonly candidateId: string;
  readonly imageIndex: number;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly direction: OcrDirection;
  readonly occurredLocalDate: string | null;
  readonly occurredTime: string | null;
  readonly merchant: string | null;
  readonly sourcePlatform: OcrChannel | null;
  readonly account: string | null;
  readonly note: string | null;
  /** The screen's own status wording, or `pending` / `posted`. */
  readonly status: string | null;
  readonly isRefund: boolean;
  /** A transfer is a flag, not a ledger kind: `TransactionKind` has no transfer. */
  readonly isTransfer: boolean;
  readonly serial: string | null;
  readonly issues: readonly OcrIssue[];
  /** Marked by the batch's duplicate detection; never a deletion. */
  readonly duplicateSuspected: boolean;
  readonly duplicateGroupIds: readonly string[];
  readonly isComplete: boolean;
  readonly isQuestionable: boolean;
  /** The recognised lines this candidate was cut from, for the detail screen. */
  readonly rawText: string;
}

export const ocrCandidateSchema = z.object({
  candidateId: z.string(),
  imageIndex: z.number().int(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  direction: ocrDirectionSchema,
  occurredLocalDate: z.string().nullable(),
  occurredTime: z.string().nullable(),
  merchant: z.string().nullable(),
  sourcePlatform: ocrChannelSchema.nullable(),
  account: z.string().nullable(),
  note: z.string().nullable(),
  status: z.string().nullable(),
  isRefund: z.boolean(),
  isTransfer: z.boolean(),
  serial: z.string().nullable(),
  issues: z.array(ocrIssueSchema),
  duplicateSuspected: z.boolean(),
  duplicateGroupIds: z.array(z.string()),
  isComplete: z.boolean(),
  isQuestionable: z.boolean(),
  rawText: z.string().default(""),
});


/**
 * The fields a screenshot can yield.
 *
 * `amount` is a **string** rather than a number: it is text the user is about
 * to confirm or edit, and the currency's precision (the yen has none) is not
 * known until the currency itself is decided.
 */
export interface OcrDraft {
  readonly amount: string | null;
  readonly currency: string;
  readonly occurredLocalDate: string | null;
  readonly occurredTime: string | null;
  readonly kind: "expense" | "income";
  readonly channel: OcrChannel | null;
  readonly counterparty: string | null;
  readonly note: string | null;
  /** Transaction number, used to notice the same screenshot uploaded twice. */
  readonly serial: string | null;
  /** A refund: money coming back, so the direction is income by definition. */
  readonly isRefund: boolean;
  readonly warnings: readonly string[];
}

export const ocrDraftSchema = z.object({
  amount: z.string().nullable(),
  currency: z.string(),
  occurredLocalDate: z.string().nullable(),
  occurredTime: z.string().nullable(),
  kind: z.enum(["expense", "income"]),
  channel: ocrChannelSchema.nullable(),
  counterparty: z.string().nullable(),
  note: z.string().nullable(),
  serial: z.string().nullable(),
  isRefund: z.boolean(),
  warnings: z.array(z.string()),
});

/** One screenshot's outcome. A batch can mix successes and failures. */
export interface OcrItemResult {
  /** Position in the upload, so a result can be matched to its thumbnail. */
  readonly index: number;
  readonly ok: boolean;
  readonly draft: OcrDraft | null;
  readonly error: string | null;
  readonly message: string | null;
  readonly lineCount: number;
  readonly averageConfidence: number;
  readonly seconds: number;
  /**
   * S15-B: what the page looked like, and every transaction cut out of it.
   *
   * These are optional at the wire level (a server from before S15-B returns
   * none of them) and defaulted to an empty answer here, so an old single-entry
   * response still parses and still drives the original review screen.
   */
  readonly pageType: OcrPageType | null;
  readonly layoutLabel: string | null;
  readonly requiresUserChoice: boolean;
  readonly candidates: readonly OcrCandidate[];
  /** Page-level remarks, e.g. "无法判断这是什么页面". */
  readonly warnings: readonly string[];
}

export const ocrItemResultSchema = z.object({
  index: z.number().int(),
  ok: z.boolean(),
  draft: ocrDraftSchema.nullable(),
  error: z.string().nullable(),
  message: z.string().nullable(),
  lineCount: z.number().int(),
  averageConfidence: z.number(),
  seconds: z.number(),
  pageType: ocrPageTypeSchema.nullable().default(null),
  layoutLabel: z.string().nullable().default(null),
  requiresUserChoice: z.boolean().default(false),
  candidates: z.array(ocrCandidateSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export const recognizeResponseSchema = z.object({
  items: z.array(ocrItemResultSchema),
  /** Total wall-clock seconds, so the interface can report an honest figure. */
  seconds: z.number(),
});

export type RecognizeResponse = z.infer<typeof recognizeResponseSchema>;

/** How many screenshots one request may carry. */
export const MAX_RECOGNIZE_IMAGES = 5;
/** Bytes per screenshot. */
export const MAX_RECOGNIZE_BYTES = 10 * 1024 * 1024;
/** Accepted image types. Verified by content, not by the declared type. */
export const RECOGNIZE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
