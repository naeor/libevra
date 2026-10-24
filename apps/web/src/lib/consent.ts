import type { LegalDocument, MajorAnnouncement } from "@libellum/shared";

import { t } from "../i18n/index.js";
import { ApiRequestError, apiFetch } from "./api.js";

export interface RequiredLegalDocument extends LegalDocument {
  readonly contentHash: string;
  readonly accepted: boolean;
}

export interface MajorAnnouncementView extends MajorAnnouncement {}

export interface ConsentStatus {
  readonly requiredDocuments: readonly RequiredLegalDocument[];
  readonly missingDocumentIds: readonly string[];
  readonly majorAnnouncement: MajorAnnouncementView | null;
}

/** Public endpoint used by registration before an account exists. */
export async function fetchRequiredLegalDocuments(): Promise<readonly (LegalDocument & { contentHash: string })[]> {
  const response = await apiFetch<{ documents: readonly (LegalDocument & { contentHash: string })[] }>(
    "/legal/documents",
  );
  return response.documents;
}

export async function fetchConsentStatus(): Promise<ConsentStatus> {
  return apiFetch<ConsentStatus>("/account/consent");
}

export async function acceptAgreement(document: LegalDocument & { contentHash: string }): Promise<void> {
  await apiFetch<unknown>("/account/agreements/accept", {
    method: "POST",
    body: {
      documentId: document.id,
      documentVersion: document.version,
      contentHash: document.contentHash,
    },
  });
}

export async function acknowledgeMajorAnnouncement(
  announcement: MajorAnnouncement,
  action: "acknowledged" | "opened_details" | "dismissed",
): Promise<void> {
  await apiFetch<unknown>(`/account/major-announcements/${announcement.id}/ack`, {
    method: "POST",
    body: { version: announcement.version, action },
  });
}

/** The account-level JSON export is a file download, not a JSON API response. */
export async function fetchAccountExport(): Promise<{ fileName: string; bytes: Uint8Array }> {
  const response = await fetch("/api/v1/account/export", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    let code = "account_export_failed";
    // 兜底说明在出错时按当前语言取；服务器给了原文就用原文（`errorMessage()` 再按语言处理）。
    let message = t("account.data.exportFailed");
    try {
      const parsed = (await response.json()) as { code?: string; message?: string };
      code = parsed.code ?? code;
      message = parsed.message ?? message;
    } catch {
      // Keep the generic message.
    }
    throw new ApiRequestError(response.status, code, message);
  }

  return {
    fileName: "libevra-account-export.json",
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}
