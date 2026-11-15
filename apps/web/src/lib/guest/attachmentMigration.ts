/**
 * 1.19.97 · 游客账本转正式账号时，附件随账目一起上传。
 *
 * 时机：导入任务**确认之后**（`confirmed` / `completed`，结果里有“来源账目 → 正式账目”的对应表）。确认之前账本
 * 处于导入锁定中，服务器拒绝写附件；撤销的导入也不应该带走附件。
 *
 * 做法：把要迁的游客附件**复制**进登录用户的“待上传原件”队列（与记账页加附件同一个库 `libevra-attachments-v1`，
 * owner 换成用户 id、账本换成目标账本、账目换成正式账目 id），由全局的 `AttachmentTransfers` 在后台上传——断网、
 * 刷新、离开本页都会继续，失败会自动重试。游客自己的原件不动：游客账本仍完整，直到用户自己清理或删除那本游客账。
 *
 * 只迁关联账目已经迁入的附件：结果里 `imported`（新建）与 `updated`（覆盖更新）的账目。被当作重复跳过、保留目标等
 * 没有迁入的账目，它们的附件留在本机游客账本（界面会说明有几个）。一个附件关联多笔账目时，只挂到迁入的那几笔上。
 *
 * 不会重复：正式附件的 id 由“用户、目标账本、游客附件 id、正式账目 id”算出（UUID v8）。同一个附件再迁一次得到同一个
 * id——队列里已有就跳过；服务器上已经有同 id、同内容的附件时，上传接口直接返回它（见 `routes/attachments.ts`）。
 * 每次导入只自动加入队列一次（本机记录在 localStorage，键含导入回执 id）。
 */
import { formatStorageBytes, type AccountStorageView, type BookStorageView, type LedgerImportResult } from "@libellum/shared";

import { t } from "../../i18n/index.js";
import { apiFetch, UserFacingError } from "../api.js";
import { pendingAttachments, savePendingAttachment, type PendingAttachment } from "../pendingAttachments.js";
import { assertLocalRoom, listGuestAttachments, type GuestAttachment } from "./attachments.js";

export interface GuestAttachmentMigrationItem {
  readonly attachment: GuestAttachment;
  /** 正式账本里这个附件的 id；同一个附件、同样的目标重复迁移得到同一个 id。 */
  readonly remoteId: string;
  readonly targetEntryIds: readonly string[];
}

export interface GuestAttachmentMigrationPlan {
  readonly items: readonly GuestAttachmentMigrationItem[];
  /** 关联的账目一个都没有迁入的附件数：留在本机游客账本。 */
  readonly leftBehind: number;
  readonly bytes: number;
}

/** 本机记下的“这次导入的附件已加入上传队列”。 */
export interface GuestAttachmentMigrationRecord {
  readonly userId: string;
  readonly targetBookId: string;
  readonly guestBookId: string;
  readonly ids: readonly string[];
  readonly leftBehind: number;
  readonly bytes: number;
  readonly queuedAt: string;
}

/** `libevra.` 前缀：属于“清除本机全部数据”的范围；键里带用户 id，注销账号时按用户清掉（`deviceStorageKeys.ts`）。 */
export const ATTACHMENT_MIGRATION_RECORD_PREFIX = "libevra.guest-attachment-migration:";

function recordKey(userId: string, importId: string): string {
  return `${ATTACHMENT_MIGRATION_RECORD_PREFIX}${userId}:${importId}`;
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readAttachmentMigrationRecord(userId: string, importId: string): GuestAttachmentMigrationRecord | null {
  try {
    const raw = storage()?.getItem(recordKey(userId, importId));
    if (raw === null || raw === undefined) return null;
    const parsed = JSON.parse(raw) as Partial<GuestAttachmentMigrationRecord>;
    if (parsed.userId !== userId || typeof parsed.targetBookId !== "string" || !Array.isArray(parsed.ids)) return null;
    return parsed as GuestAttachmentMigrationRecord;
  } catch {
    return null;
  }
}

function writeAttachmentMigrationRecord(importId: string, record: GuestAttachmentMigrationRecord): void {
  try {
    storage()?.setItem(recordKey(record.userId, importId), JSON.stringify(record));
  } catch {
    // 记录写不进去只会让下次打开本页时再加入一次队列；同一个 id 会被跳过，不会重复上传。
  }
}

/** 由若干字符串算出一个稳定的 UUID（v8：SHA-256 前 16 字节，填上版本与变体位）。 */
export async function stableAttachmentId(parts: readonly string[]): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u0000"))));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 按导入结果算出要迁哪些附件、各挂到哪些正式账目上。只读。 */
export async function planGuestAttachmentMigration(input: {
  readonly userId: string;
  readonly guestId: string;
  readonly guestBookId: string;
  readonly result: Pick<LedgerImportResult, "targetBook" | "imported" | "updated">;
}): Promise<GuestAttachmentMigrationPlan> {
  const targetOf = new Map<string, string>();
  for (const item of [...input.result.imported, ...input.result.updated]) {
    targetOf.set(item.sourceTransactionId, item.targetTransactionId);
  }
  const items: GuestAttachmentMigrationItem[] = [];
  let leftBehind = 0;
  for (const attachment of await listGuestAttachments(input.guestId, input.guestBookId)) {
    const targetEntryIds = [
      ...new Set(attachment.entryIds.map((id) => targetOf.get(id)).filter((id): id is string => id !== undefined)),
    ].sort();
    if (targetEntryIds.length === 0) {
      leftBehind += 1;
      continue;
    }
    const remoteId = await stableAttachmentId([
      "guest-attachment-migration-v1",
      input.userId,
      input.result.targetBook.id,
      attachment.id,
      ...targetEntryIds,
    ]);
    items.push({ attachment, remoteId, targetEntryIds });
  }
  // 与附件总览一致：旧的在前上传，界面上的“已上传”按时间先后增长。
  items.sort((left, right) => left.attachment.createdAt - right.attachment.createdAt);
  return { items, leftBehind, bytes: items.reduce((sum, item) => sum + item.attachment.sizeBytes, 0) };
}

/**
 * 正式账号里还剩多少空间（账号与目标账本取较小者）。读不到时返回 null——不因为一次读失败挡住迁移，
 * 真超额时服务器会逐个拒绝并在队列里显示原因。
 */
async function remainingCloudSpace(targetBookId: string): Promise<number | null> {
  try {
    const [account, book] = await Promise.all([
      apiFetch<AccountStorageView>("/storage"),
      apiFetch<BookStorageView>(`/books/${targetBookId}/storage`),
    ]);
    return Math.max(0, Math.min(account.limit - account.bytes, book.limit - book.bytes - book.reservedBytes));
  } catch {
    return null;
  }
}

/**
 * 把计划里的附件加入登录用户的上传队列，并在本机记下这次导入已经处理过。返回这次新加入的个数。
 *
 * 云端空间或本机空间不够时抛出可读错误，一个都不加入（不留下“传了一半又一直失败”的队列）。
 */
export async function queueGuestAttachmentMigration(input: {
  readonly importId: string;
  readonly userId: string;
  readonly guestBookId: string;
  readonly plan: GuestAttachmentMigrationPlan;
  readonly targetBookId: string;
}): Promise<number> {
  const { plan } = input;
  const queued = new Set((await pendingAttachments(input.userId)).map((file) => file.id));
  const todo = plan.items.filter((item) => !queued.has(item.remoteId));
  const bytes = todo.reduce((sum, item) => sum + item.attachment.sizeBytes, 0);
  if (todo.length > 0) {
    const cloud = await remainingCloudSpace(input.targetBookId);
    if (cloud !== null && cloud < bytes) {
      throw new UserFacingError(
        t("attachments.guest.migrationNoCloudRoom", { need: formatStorageBytes(bytes), available: formatStorageBytes(cloud) }),
      );
    }
    try {
      await assertLocalRoom(bytes);
    } catch (error) {
      throw error instanceof UserFacingError ? error : new UserFacingError(t("attachments.guest.quotaReason"));
    }
  }
  let added = 0;
  for (const item of todo) {
    const row: PendingAttachment = {
      id: item.remoteId,
      ownerId: input.userId,
      bookId: input.targetBookId,
      entryIds: [...item.targetEntryIds],
      name: item.attachment.name,
      blob: item.attachment.blob,
      createdAt: Date.now(),
      error: null,
    };
    try {
      await savePendingAttachment(row);
      added += 1;
    } catch (error) {
      // 另一个标签页刚加入了同一个 id：视为已在队列中。其它错误（例如本机空间写满）照常报出。
      if ((error as { name?: string } | null)?.name !== "ConstraintError") {
        throw new UserFacingError(t("attachments.guest.saveFailed", { reason: t("attachments.guest.quotaReason") }));
      }
    }
  }
  writeAttachmentMigrationRecord(input.importId, {
    userId: input.userId,
    targetBookId: input.targetBookId,
    guestBookId: input.guestBookId,
    ids: plan.items.map((item) => item.remoteId),
    leftBehind: plan.leftBehind,
    bytes: plan.bytes,
    queuedAt: new Date().toISOString(),
  });
  return added;
}

export interface GuestAttachmentMigrationProgress {
  readonly total: number;
  /** 已从队列中消失（上传完成）的个数。 */
  readonly uploaded: number;
  /** 仍在队列中、上一次尝试出错的个数与其中一条原因。 */
  readonly failed: number;
  readonly error: string | null;
}

/** 这次导入的附件上传到哪儿了：队列里还剩几个、有没有出错。 */
export async function attachmentMigrationProgress(record: GuestAttachmentMigrationRecord): Promise<GuestAttachmentMigrationProgress> {
  const wanted = new Set(record.ids);
  const waiting = (await pendingAttachments(record.userId)).filter((file) => wanted.has(file.id));
  const failed = waiting.filter((file) => file.error !== null);
  return {
    total: record.ids.length,
    uploaded: record.ids.length - waiting.length,
    failed: failed.length,
    error: failed[0]?.error ?? null,
  };
}
