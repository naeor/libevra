import type { PendingAttachment } from "./attachments.js";
import type { BillImportCandidate, ImportReport } from "@libellum/shared";

export interface AttachmentTarget { id: string; label: string }
export interface AttachmentDraftLink {
  scope: string;
  targets: AttachmentTarget[];
  resolved: Record<string, string>;
}

export function captureDraftsFor(files: readonly PendingAttachment[], ownerId: string, bookId: string, scope: string): PendingAttachment[] {
  return files.filter(file => file.ownerId === ownerId && file.bookId === bookId && file.draftLink?.scope === scope && file.entryIds.length === 0)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function billAttachmentMapping(candidates: readonly BillImportCandidate[], report: ImportReport): Record<string, string> {
  if (!report.ok) return {};
  const skipped = new Set([...report.skippedLines, ...report.errors.map(row => row.line)]);
  return Object.fromEntries(candidates.filter(row => row.selected && !row.identityDuplicate && !skipped.has(row.line)).map(row => [row.id, row.id]));
}

/** 未保存的候选 ID 只用于本机关联，不能作为服务器账目 ID 上传。 */
export function resolveAttachmentDraft(file: PendingAttachment, saved: Readonly<Record<string, string>>): PendingAttachment {
  if (!file.draftLink || file.entryIds.length > 0) return file;
  const resolved = { ...file.draftLink.resolved };
  for (const target of file.draftLink.targets) if (saved[target.id]) resolved[target.id] = saved[target.id]!;
  const ids = file.draftLink.targets.map(target => resolved[target.id]);
  return { ...file, draftLink: { ...file.draftLink, resolved },
    entryIds: ids.length > 0 && ids.every((id): id is string => !!id) ? [...new Set(ids)] : [] };
}

/** 文件可跨多笔共用；数量和大小限制分别对每笔计算。 */
export function captureAttachmentLimit(files: readonly PendingAttachment[], limits: { fileBytes: number; entryFiles: number; entryBytes: number }): boolean {
  const totals = new Map<string, { count: number; bytes: number }>();
  for (const file of files) {
    if (file.blob.size <= 0 || file.blob.size > limits.fileBytes) return false;
    for (const id of new Set(file.draftLink?.targets.map(target => target.id) ?? ["entry"])) {
      const total = totals.get(id) ?? { count: 0, bytes: 0 };
      total.count++; total.bytes += file.blob.size; totals.set(id, total);
      if (total.count > limits.entryFiles || total.bytes > limits.entryBytes) return false;
    }
  }
  return true;
}
