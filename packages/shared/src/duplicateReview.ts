import { z } from "zod";
import { recoverDuplicateDetectionSettings, type DuplicateDetectionSettings } from "./duplicateDetection.js";
export const duplicateRulesSchema = z.object({
  enabled: z.boolean().optional(), timeWindowSeconds: z.number().int().min(1).max(2592000).optional(),
  matchCategory: z.boolean().optional(), matchPaymentMethod: z.boolean().optional(),
  matchAmount: z.boolean().optional(), matchCurrency: z.boolean().optional(), matchKind: z.boolean().optional(),
  matchTime: z.boolean().optional(), matchMerchant: z.boolean().optional(), matchNote: z.boolean().optional(), matchTags: z.boolean().optional(),
}).strict().transform((value): DuplicateDetectionSettings => recoverDuplicateDetectionSettings(value).settings);
export const duplicateCandidateSchema = z.object({
  id: z.string().min(1).max(128), bookId: z.string().min(1).max(128),
  kind: z.enum(["expense", "income", "transfer", "unknown"]), amountCents: z.number().int().safe().nullable(),
  currency: z.string().max(8).nullable(), occurredAt: z.string().max(64).nullable(),
  occurredAtPrecision: z.enum(["second", "minute", "day"]).optional(),
  occurredLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  categoryId: z.string().max(128).nullable(), paymentMethodId: z.string().max(128).nullable(),
  merchant: z.string().max(500).nullable().optional(), note: z.string().max(2000).nullable().optional(),
  tagIds: z.array(z.string().max(128)).max(100).optional(),
});
export const duplicateCandidatesRequestSchema = z.object({
  candidates: z.array(duplicateCandidateSchema).max(100), settings: duplicateRulesSchema.optional(),
});
export const duplicateReviewRequestSchema = z.object({
  afterSeq: z.number().int().nonnegative().default(0),
  throughSeq: z.number().int().nonnegative().optional(),
  settings: duplicateRulesSchema.optional(),
});
