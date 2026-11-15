import {
  formalSourceDispositionSchema,
  guestCleanupPreviewResponseSchema,
  type FormalSourceDisposition,
  type GuestImportSource,
  type GuestCleanupPreviewResponse,
} from "@libellum/shared";

import { apiFetch } from "../api.js";
import { withGuestSource } from "./sourceUpload.js";

export async function previewGuestCleanup(input: {
  readonly targetBookId: string;
  readonly guestBookId: string;
  readonly receiptId: string;
  readonly source: GuestImportSource;
}): Promise<GuestCleanupPreviewResponse> {
  const { source, ...rest } = input;
  // 1.19.97：大的游客来源用分段上传的暂存（预览时传过的那份通常还在，不会重传）。
  return withGuestSource(source, async (reference) =>
    guestCleanupPreviewResponseSchema.parse(
      await apiFetch<unknown>("/ledger-imports/guest-cleanup-preview", {
        method: "POST",
        body: { ...rest, ...reference },
        timeoutMs: 120_000,
      }),
    ),
  );
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
