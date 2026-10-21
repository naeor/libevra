import { z } from "zod";

export const MAX_BILL_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_BILL_IMPORT_ROWS = 20_000;
export const BILL_IMPORT_PREVIEW_TTL_MS = 30 * 60 * 1000;
export const billImportCommitRowSchema = z.object({
  id: z.string().uuid(), selected: z.boolean(),
  amount: z.string().max(40), currency: z.string().length(3),
  kind: z.enum(["income", "expense", "unknown"]),
  date: z.string().max(10), time: z.string().max(8).nullable(),
  timezone: z.string().min(1).max(80),
  categoryId: z.string().uuid().nullable(), paymentMethodId: z.string().uuid().nullable(),
  note: z.string().max(2000), tags: z.array(z.string().min(1).max(40)).max(30),
}).strict();
export type BillImportCommitRow = z.infer<typeof billImportCommitRowSchema>;
export const billImportCandidateSchema = billImportCommitRowSchema.extend({
  line: z.number().int().positive(), page: z.number().int().positive().optional(),
  timePrecision: z.enum(["second", "minute", "day"]),
  merchant: z.string(), sourceRef: z.string().nullable(), sourceStatus: z.string(),
  warnings: z.array(z.string()), duplicateIds: z.array(z.string()), identityDuplicate: z.boolean(),
});
export type BillImportCandidate = z.infer<typeof billImportCandidateSchema>;
export const billImportPreviewSchema = z.object({
  previewId: z.string().uuid(), expiresAt: z.string(),
  source: z.enum(["libevra", "wechat", "alipay", "boa"]),
  format: z.enum(["csv", "xlsx", "pdf"]),
  candidates: z.array(billImportCandidateSchema).max(MAX_BILL_IMPORT_ROWS),
  warnings: z.array(z.string()),
  reconciliation: z.object({ ok: z.boolean().nullable(), messages: z.array(z.string()) }),
});
export type BillImportPreview = z.infer<typeof billImportPreviewSchema>;
export const billImportCommitSchema = z.object({
  previewId: z.string().uuid(), rows: z.array(billImportCommitRowSchema).max(MAX_BILL_IMPORT_ROWS),
  acknowledgeWarnings: z.boolean().default(false),
}).strict();
export type BillImportCommit = z.infer<typeof billImportCommitSchema>;
