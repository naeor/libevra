/**
 * 游客附件：原件存在本机，不放进账目 blob。
 *
 * 存储方案：复用独立库 `libevra-attachments-v1`（`lib/pendingAttachments.ts`），`ownerId` 用**游客 id**，
 * `bookId` 用**游客账本 id**，`entryIds` 是关联的账目 id。理由：
 * - 记账页附件区（暂存草稿 → 保存账目后关联）已经按 `ownerId` 工作，游客只需换 owner，不用写第二套；
 * - 库的结构不变，不需要升级库版本；
 * - 与游客库 `libellum-guest` 分开，写附件不会重写账目 blob，也不会碰账号数据（账号 owner 是用户 id，互不相交）；
 * - 这个库本来就是“待上传原件”：转正式账号时（1.19.97，`attachmentMigration.ts`）按 (游客账本 id, 账目 id) 取出原件，
 *   复制一份给登录用户的上传队列。
 *
 * 每个附件可取到：id、游客 id（ownerId）、游客账本 id（bookId）、账目 id 列表（entryIds）、文件名（name）、
 * 媒体类型（blob.type）、大小（blob.size）、创建时间（createdAt，毫秒）。
 *
 * 清理：清除游客数据、清除全部本机数据、删除游客账本时都会清掉（见 `cleanup.ts`、`workspace.ts`）。
 */
import { t } from "../../i18n/index.js";
import { formatStorageBytes } from "@libellum/shared";
import { UserFacingError } from "../api.js";
import {
  clearClosedAccountAttachments,
  pendingAttachments,
  removePendingAttachment,
  savePendingAttachment,
  updatePendingAttachment,
  type PendingAttachment,
} from "../pendingAttachments.js";
import { uuidV7 } from "../uuid.js";

/** 与登录用户相同的限制（服务器默认值 `apps/api/src/ledger/storage.ts`：单文件 100 MB、每笔 10 个、每笔 200 MB）。 */
export const GUEST_ATTACHMENT_LIMITS = { fileBytes: 100_000_000, entryFiles: 10, entryBytes: 200_000_000 } as const;

/** 没有关联账目的草稿超过这个时间视为遗弃（记账页没保存就离开）。 */
export const GUEST_DRAFT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface GuestAttachment {
  readonly id: string;
  readonly guestId: string;
  readonly guestBookId: string;
  readonly entryIds: readonly string[];
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
  readonly blob: Blob;
}

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", heic: "image/heic", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
};

/** 浏览器没给类型时按扩展名补一个，预览与下载依赖它。 */
export function guestMediaType(name: string, type: string): string {
  if (type) return type;
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

export function toGuestAttachment(file: PendingAttachment): GuestAttachment {
  return {
    id: file.id, guestId: file.ownerId, guestBookId: file.bookId, entryIds: file.entryIds, name: file.name,
    mediaType: guestMediaType(file.name, file.blob.type), sizeBytes: file.blob.size, createdAt: file.createdAt, blob: file.blob,
  };
}

/** 这个游客某本账（省略则全部）已关联账目的附件；还没关联账目的草稿不算。新的在前。 */
export async function listGuestAttachments(guestId: string, bookId?: string): Promise<GuestAttachment[]> {
  if (!guestId) return [];
  return (await pendingAttachments(guestId))
    .filter((file) => file.ownerId === guestId && file.entryIds.length > 0 && (bookId === undefined || file.bookId === bookId))
    .map(toGuestAttachment)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

/** 本机附件占用（含未关联的草稿）。 */
export async function guestAttachmentUsage(guestId: string, bookId?: string): Promise<{ count: number; bytes: number }> {
  if (!guestId) return { count: 0, bytes: 0 };
  const files = (await pendingAttachments(guestId)).filter((file) => file.ownerId === guestId && (bookId === undefined || file.bookId === bookId));
  return { count: files.length, bytes: files.reduce((sum, file) => sum + file.blob.size, 0) };
}

export interface LocalSpace { readonly usage: number | null; readonly quota: number | null; readonly available: number | null }

/** `navigator.storage.estimate()`；浏览器不提供时全是 null。 */
export async function localSpace(): Promise<LocalSpace> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (!estimate) return { usage: null, quota: null, available: null };
    const usage = estimate.usage ?? null, quota = estimate.quota ?? null;
    return { usage, quota, available: usage !== null && quota !== null ? Math.max(0, quota - usage) : null };
  } catch { return { usage: null, quota: null, available: null }; }
}

/** 空间不足时如实报错；估算不可用时放行（真正写不进去由保存时的错误兜底）。 */
export async function assertLocalRoom(bytes: number): Promise<void> {
  const space = await localSpace();
  if (space.available !== null && space.available < bytes) {
    throw new UserFacingError(t("attachments.guest.noRoom", { need: formatStorageBytes(bytes), available: formatStorageBytes(space.available) }));
  }
}

/** 单文件与单账目限制；`existing` 是这些账目上已有的附件。返回错误文案，通过为 null。 */
export function guestLimitError(existing: readonly GuestAttachment[], size: number, entryIds: readonly string[]): string | null {
  const limits = GUEST_ATTACHMENT_LIMITS;
  const message = t("attachments.limits", { file: formatStorageBytes(limits.fileBytes), count: limits.entryFiles, entry: formatStorageBytes(limits.entryBytes) });
  if (size <= 0 || size > limits.fileBytes) return message;
  for (const entryId of entryIds) {
    const own = existing.filter((file) => file.entryIds.includes(entryId));
    if (own.length + 1 > limits.entryFiles || own.reduce((sum, file) => sum + file.sizeBytes, 0) + size > limits.entryBytes) return message;
  }
  return null;
}

function writeError(error: unknown): Error {
  const name = (error as { name?: string } | null)?.name;
  const reason = name === "QuotaExceededError" ? t("attachments.guest.quotaReason") : error instanceof Error ? error.message : String(error);
  return new Error(t("attachments.guest.saveFailed", { reason }));
}

/** 给已有账目加一个附件。限制或空间不足时抛出可读错误，已存的附件不动。 */
export async function addGuestAttachment(input: { guestId: string; bookId: string; entryIds: readonly string[]; file: File }): Promise<GuestAttachment> {
  const { guestId, bookId, entryIds, file } = input;
  const existing = await listGuestAttachments(guestId, bookId);
  const limit = guestLimitError(existing, file.size, entryIds);
  if (limit !== null) throw new Error(limit);
  await assertLocalRoom(file.size);
  const type = guestMediaType(file.name, file.type);
  const blob = type === file.type ? file : new Blob([file], { type });
  const row: PendingAttachment = { id: uuidV7(), ownerId: guestId, bookId, entryIds: [...entryIds], name: file.name, blob, createdAt: Date.now(), error: null };
  try { await savePendingAttachment(row); } catch (error) { throw writeError(error); }
  return toGuestAttachment(row);
}

/** 删除一个附件（游客直接永久删除，界面有确认框）。 */
export async function removeGuestAttachment(guestId: string, id: string): Promise<void> {
  await removePendingAttachment({ id, ownerId: guestId });
}

/**
 * 这些账目被永久删除时：只被它们引用的附件一并删除，还关联别的账目的附件只去掉这些关联。
 * （目前游客界面没有“永久删除账目”，软删除保留附件；此函数供将来的永久删除 / 清空已删除使用。）
 */
export async function removeGuestEntryAttachments(guestId: string, bookId: string, entryIds: readonly string[]): Promise<number> {
  const gone = new Set(entryIds);
  let touched = 0;
  for (const file of await pendingAttachments(guestId)) {
    if (file.ownerId !== guestId || file.bookId !== bookId || !file.entryIds.some((id) => gone.has(id))) continue;
    const left = file.entryIds.filter((id) => !gone.has(id));
    touched += 1;
    if (left.length === 0) await removePendingAttachment({ id: file.id, ownerId: guestId });
    else await updatePendingAttachment(file, { entryIds: left });
  }
  return touched;
}

/** 删除游客账本时：这本账的全部附件（含草稿）。 */
export async function removeGuestBookAttachments(guestId: string, bookId: string): Promise<number> {
  let removed = 0;
  for (const file of await pendingAttachments(guestId)) {
    if (file.ownerId !== guestId || file.bookId !== bookId) continue;
    await removePendingAttachment({ id: file.id, ownerId: guestId });
    removed += 1;
  }
  return removed;
}

/** 清除游客数据：这个游客的全部附件。 */
export async function removeAllGuestAttachments(guestId: string): Promise<void> {
  await clearClosedAccountAttachments(guestId);
}

/** 清掉遗弃的草稿（记账页选了文件没保存账目）。 */
export async function pruneStaleGuestDrafts(guestId: string, now: number = Date.now()): Promise<number> {
  let removed = 0;
  for (const file of await pendingAttachments(guestId)) {
    if (file.ownerId === guestId && file.entryIds.length === 0 && now - file.createdAt > GUEST_DRAFT_MAX_AGE_MS) {
      await removePendingAttachment({ id: file.id, ownerId: guestId });
      removed += 1;
    }
  }
  return removed;
}
