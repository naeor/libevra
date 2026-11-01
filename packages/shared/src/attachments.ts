/** 云端容量统一使用十进制字节单位。 */
export const ATTACHMENT_CHUNK_BYTES = 1_048_576;
export interface AttachmentView {
  id: string; bookId: string; name: string; mediaType: string; sizeBytes: number;
  receivedBytes: number; state: "uploading" | "ready"; uploaderId: string; uploaderName: string;
  createdAt: string; deletedAt: string | null; canDelete: boolean;
  entries: { id: string; seq: number; deleted: boolean }[];
}
export interface StorageLimits {
  accountBytes: number; bookBytes: number; fileBytes: number; entryBytes: number; entryFiles: number;
}
export interface AccountStorageView {
  bytes: number; limit: number; ownBytes: number; overLimit: boolean;
  books: { id: string; name: string; bytes: number; limit: number; shared: boolean; archived: boolean }[];
}
export interface BookStorageView {
  bytes: number; limit: number; reservedBytes: number; attachmentBytes: number;
  recoverableBytes: number; attachmentCount: number; limits: StorageLimits;
}
export interface EntryChangeNoticeView {
  id: string; bookId: string; eventId: string; createdAt: string; readAt: string | null;
  transactionId: string | null; transactionSeq: number | null; actorName: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  entry: { note?: string | null; currency?: string; amountCents?: string } | null;
}
export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${Math.max(0, Math.round(bytes))} B`;
}
