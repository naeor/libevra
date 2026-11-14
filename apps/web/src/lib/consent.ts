import type { LegalDocument, MajorAnnouncement } from "@libellum/shared";

import { t } from "../i18n/index.js";
import { ApiRequestError, apiFetch } from "./api.js";
import { consentStatusKey } from "./deviceStorageKeys.js";

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

/**
 * **最近一次的同意状态，记在本机**（1.19.81，所有者 2026-11-15：“不同意就不能正常的再去记账了……写得死一点，
 * 不要留下太明显的用户可以跳过的地方”）。
 *
 * 门禁原来在状态取回之前与取回失败（离线、网络抖动）时一律放行，“服务器仍会把关”——但本应用离线优先，离线时照样能记账。
 * 现在记下这个账号最近一次的状态：已知还有没同意的协议时，打开应用就立即挡住，取回失败也不放行；只有从来没有取到过、
 * 或最近一次是“全部已同意”时，才按原来的方式放行。只存协议列表与缺哪几份（公告不存，不会因为缓存重播），随账号清理。
 */
export function readRememberedConsent(userId: string): ConsentStatus | null {
  try {
    const raw = globalThis.localStorage?.getItem(consentStatusKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentStatus>;
    if (!Array.isArray(parsed.requiredDocuments) || !Array.isArray(parsed.missingDocumentIds)) return null;
    return { requiredDocuments: parsed.requiredDocuments, missingDocumentIds: parsed.missingDocumentIds, majorAnnouncement: null };
  } catch {
    return null;
  }
}

export function rememberConsent(userId: string, status: ConsentStatus): void {
  try {
    globalThis.localStorage?.setItem(consentStatusKey(userId), JSON.stringify({ requiredDocuments: status.requiredDocuments, missingDocumentIds: status.missingDocumentIds }));
  } catch {
    /** 存储不可用（隐私模式等）：只是少了离线时的保护，门禁照常按取回的状态工作。 */
  }
}

/** 已知还有没同意的协议（只有这时才用记下的状态挡住）。 */
export function rememberedMissing(userId: string): ConsentStatus | null {
  const remembered = readRememberedConsent(userId);
  return remembered !== null && remembered.missingDocumentIds.length > 0 ? remembered : null;
}

