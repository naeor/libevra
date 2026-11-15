/**
 * 1.19.97 · 游客来源分段上传（浏览器端）。
 *
 * 账本导入原来把整本游客账本作为来源快照随一次请求上传：schema 最多 5000 笔，增量预览接口的请求体还受服务器
 * 1 MiB 的默认限制——实际上两三千笔的游客账本就迁不过去。现在来源大于 {@link INLINE_SOURCE_MAX_BYTES} 或超过
 * 5000 笔时，先按 {@link SOURCE_UPLOAD_PART_TRANSACTIONS} 笔一段上传到服务器暂存（服务器拼好后重新计算指纹核对），
 * 增量预览、导入任务、清理预览只带暂存 id；小的来源仍随请求上传，与以前完全相同。
 *
 * 服务器端见 `apps/api/src/ledger/importSourceUpload.ts`。暂存 24 小时后由服务器删除；导入任务创建时已把来源复制
 * 进任务，之后的批次、确认、撤销都不依赖暂存。
 */
import {
  MAX_IMPORT_TRANSACTIONS,
  MAX_STAGED_IMPORT_TRANSACTIONS,
  SOURCE_UPLOAD_PART_TRANSACTIONS,
  fingerprintGuestSource,
  sourceUploadStatusSchema,
  type GuestImportSource,
  type SourceUploadStatus,
} from "@libellum/shared";

import { t } from "../../i18n/index.js";
import { apiFetch, ApiRequestError, UserFacingError } from "../api.js";
import { uuidV7 } from "../uuid.js";

/** 随请求上传的来源超过这个字节数就改为分段上传（服务器多数接口的请求体上限是 1 MiB，留一半余量）。 */
export const INLINE_SOURCE_MAX_BYTES = 512 * 1024;

/** 来源的引用：要么随请求上传，要么是已分段上传的暂存 id。直接展开进请求体。 */
export type GuestSourceReference = { readonly source: GuestImportSource } | { readonly sourceUploadId: string };

/** 这几种错误说明暂存已经不能用（过期、被新的取代、换了账号）：重新上传一次再试。 */
const STALE_UPLOAD_CODES = new Set([
  "source_upload_missing",
  "source_upload_expired",
  "source_upload_forbidden",
  "source_upload_incomplete",
]);

/** 本页会话内已上传好的暂存：来源指纹 → 暂存 id。预览和提交用同一份来源时不必重复上传。 */
const uploaded = new Map<string, string>();

export function isStaleSourceUpload(error: unknown): boolean {
  return error instanceof ApiRequestError && STALE_UPLOAD_CODES.has(error.code);
}

/** 来源随请求上传时的大致字节数（UTF-8 JSON）。 */
export function sourceByteLength(source: GuestImportSource): number {
  return new TextEncoder().encode(JSON.stringify(source)).length;
}

export function needsStagedUpload(source: GuestImportSource): boolean {
  return source.transactions.length > MAX_IMPORT_TRANSACTIONS || sourceByteLength(source) > INLINE_SOURCE_MAX_BYTES;
}

/** 网络抖动、超时、服务器 5xx：同一段可以安全重传（服务器按内容判断是不是同一段）。 */
function retryable(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 0 || error.status >= 500);
}

async function withRetry<T>(send: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
}

function partsOf<T>(items: readonly T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < items.length; start += size) parts.push(items.slice(start, start + size));
  return parts;
}

export interface UploadProgress {
  readonly sentParts: number;
  readonly totalParts: number;
}

/**
 * 把一份游客来源分段上传到服务器暂存，返回暂存 id。
 *
 * 同一份来源（同一指纹）在本页会话内只上传一次；服务器那边如果已有同一份 `ready` 的暂存，也会直接复用。
 * 同一本游客账本的上传在各标签页之间串行进行（Web Locks），两个标签页同时迁移同一本账时第二个会直接复用第一个的结果。
 */
export async function uploadGuestSource(
  source: GuestImportSource,
  options: { readonly onProgress?: (progress: UploadProgress) => void; readonly partSize?: number } = {},
): Promise<string> {
  if (source.transactions.length > MAX_STAGED_IMPORT_TRANSACTIONS) {
    throw new UserFacingError(
      t("ledgerImport.message.guestTooLarge", { count: source.transactions.length, limit: MAX_STAGED_IMPORT_TRANSACTIONS }),
    );
  }
  const guestBookId = source.guestBookId;
  if (guestBookId === undefined) throw new UserFacingError(t("ledgerImport.submitError.missingGuestSource"));
  const fingerprint = await fingerprintGuestSource(source);
  const known = uploaded.get(fingerprint);
  if (known !== undefined) return known;

  const run = async (): Promise<string> => {
    const again = uploaded.get(fingerprint);
    if (again !== undefined) return again;
    const { transactions, ...header } = source;
    const parts = partsOf(transactions, options.partSize ?? SOURCE_UPLOAD_PART_TRANSACTIONS);
    let status: SourceUploadStatus = sourceUploadStatusSchema.parse(
      await withRetry(() =>
        apiFetch<unknown>("/ledger-imports/source-uploads", {
          method: "POST",
          body: {
            uploadId: uuidV7(),
            sourceFingerprint: fingerprint,
            transactionCount: transactions.length,
            partCount: parts.length,
            header: { ...header, guestBookId },
          },
          timeoutMs: 60_000,
        }),
      ),
    );
    if (status.status !== "ready") {
      const uploadId = status.uploadId;
      const received = new Set(status.receivedParts);
      let sent = received.size;
      options.onProgress?.({ sentParts: sent, totalParts: parts.length });
      for (const [index, part] of parts.entries()) {
        if (received.has(index)) continue;
        await withRetry(() =>
          apiFetch<unknown>(`/ledger-imports/source-uploads/${uploadId}/parts/${String(index)}`, {
            method: "POST",
            body: { transactions: part },
            timeoutMs: 120_000,
          }),
        );
        sent += 1;
        options.onProgress?.({ sentParts: sent, totalParts: parts.length });
      }
      status = sourceUploadStatusSchema.parse(
        await withRetry(() =>
          apiFetch<unknown>(`/ledger-imports/source-uploads/${uploadId}/complete`, { method: "POST", timeoutMs: 120_000 }),
        ),
      );
    }
    uploaded.set(fingerprint, status.uploadId);
    return status.uploadId;
  };

  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks === undefined ? run() : locks.request(`ledger-import-source-upload:${guestBookId}`, run);
}

/** 忘掉这份来源的暂存（服务器说它已不可用时）。 */
export async function forgetGuestSourceUpload(source: GuestImportSource): Promise<void> {
  uploaded.delete(await fingerprintGuestSource(source));
}

/** 仅测试用：清空本页会话的暂存记录。 */
export function resetGuestSourceUploadsForTest(): void {
  uploaded.clear();
}

/**
 * 用合适的方式把游客来源交给一个请求：小的随请求上传，大的先分段上传再带暂存 id。
 * 暂存在两步之间过期或被取代时，自动重新上传一次再发。
 */
export async function withGuestSource<T>(
  source: GuestImportSource,
  send: (reference: GuestSourceReference) => Promise<T>,
  options: { readonly onProgress?: (progress: UploadProgress) => void } = {},
): Promise<T> {
  if (!needsStagedUpload(source)) return send({ source });
  const first = await uploadGuestSource(source, options);
  try {
    return await send({ sourceUploadId: first });
  } catch (error) {
    if (!isStaleSourceUpload(error)) throw error;
    await forgetGuestSourceUpload(source);
    return send({ sourceUploadId: await uploadGuestSource(source, options) });
  }
}
