import {
  formalSourceDispositionSchema,
  guestCleanupPreviewResponseSchema,
  type FormalSourceDisposition,
  type GuestImportSource,
  type GuestCleanupPreviewResponse,
} from "@libellum/shared";

import { apiFetch } from "../api.js";

export async function previewGuestCleanup(input: {
  readonly targetBookId: string;
  readonly guestBookId: string;
  readonly receiptId: string;
  readonly source: GuestImportSource;
}): Promise<GuestCleanupPreviewResponse> {
  const raw = await apiFetch<unknown>("/ledger-imports/guest-cleanup-preview", {
    method: "POST",
    body: input,
    timeoutMs: 120_000,
  });
  return guestCleanupPreviewResponseSchema.parse(raw);
}

export async function getFormalSourceDisposition(jobId: string): Promise<FormalSourceDisposition> {
  const raw = await apiFetch<unknown>(`/ledger-imports/jobs/${jobId}/source-disposition`, {
    timeoutMs: 30_000,
  });
  return formalSourceDispositionSchema.parse(raw);
}

export async function getFormalSourceDispositionByReceipt(
  receiptId: string,
): Promise<FormalSourceDisposition> {
  const raw = await apiFetch<unknown>(`/ledger-imports/${receiptId}/source-disposition`, {
    timeoutMs: 30_000,
  });
  return formalSourceDispositionSchema.parse(raw);
}
