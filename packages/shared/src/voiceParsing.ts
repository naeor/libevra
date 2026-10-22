import { z } from "zod";

import { transactionTextResultSchema } from "./transactionText.js";

/**
 * What one recording produces: the transcript, the fields the shared semantics
 * core read from it, and the operational timings.
 *
 * ⚠️ **The transcript is part of the answer, not a debugging detail.** The
 * review screen lets the user correct what Whisper heard and re-run the parser
 * on the correction, so the text has to reach the browser unchanged.
 *
 * The flat `amount` / `kind` / `note` / `categoryId` fields are retained for the
 * existing review form; `parsed` is the complete candidate from the same parser
 * the paste entry uses. One parser, two entrances.
 */
export const transcribeResponseSchema = z.object({
  /** What was heard, verbatim. */
  text: z.string(),
  /** Digits as spoken, or null when no amount was said. */
  amount: z.string().nullable(),
  kind: z.enum(["expense", "income"]),
  /** The sentence with the noise removed — a starting note, not a summary. */
  note: z.string(),
  /** A category the sentence sounds like, or `null` when nothing fitted. */
  categoryId: z.string().nullable(),
  /** The words that matched, so the interface can show its reasoning. */
  categoryMatched: z.array(z.string()),
  /** The complete shared-core candidate. */
  parsed: transactionTextResultSchema,
  /** How long the audio was, and how long the transcription took. */
  audioSeconds: z.number(),
  seconds: z.number(),
});

export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;
