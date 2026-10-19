import type {
  FormalSourceDisposition,
  GuestImportSource,
  GuestCleanupPreviewResponse,
} from "@libellum/shared";
import { fingerprintImportSourceRecord } from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { loadSoloImportBook } from "./importSolo.js";
import { loadExistingImportTarget } from "./importTarget.js";
import { sourceNamespaceOf } from "./importIncremental.js";
import { getBookLifecycle } from "../lifecycle/book.js";

export async function previewGuestCleanup(
  prisma: PrismaClient,
  userId: string,
  input: {
    readonly targetBookId: string;
    readonly guestBookId: string;
    readonly receiptId: string;
    readonly source: GuestImportSource;
  },
): Promise<GuestCleanupPreviewResponse> {
  if (input.source.guestBookId !== input.guestBookId) {
    throw badRequest("guest_book_identity_mismatch", "游客来源身份与清理请求不一致，不能清理。");
  }
  const receipt = await prisma.ledgerImport.findUnique({ where: { id: input.receiptId } });
  if (receipt === null) throw notFound("import_receipt_missing", "找不到服务端的导入成功回执。");
  if (receipt.userId !== userId) throw forbidden("import_forbidden", "这个导入回执不属于当前账号。");
  if (receipt.targetBookId !== input.targetBookId) {
    throw badRequest("cleanup_target_mismatch", "导入回执与目标账本不一致。");
  }
  // The target must still be a live solo ledger; an archived/deleted target is not a safe cleanup baseline.
  await loadExistingImportTarget(prisma, userId, input.targetBookId);
  const namespace = sourceNamespaceOf(null, input.guestBookId);
  const sourceIds = input.source.transactions.map((item) => item.id);
  if (sourceIds.length === 0) {
    return {
      targetBookId: input.targetBookId,
      guestBookId: input.guestBookId,
      cleanableSourceIds: [],
      cleanableCount: 0,
      retainedCount: 0,
      sourceCount: 0,
    };
  }
  const states = await prisma.ledgerImportSourceState.findMany({
    where: {
      targetBookId: input.targetBookId,
      sourceBookKey: `guest:${input.guestBookId}`,
      sourceTransactionId: { in: sourceIds },
    },
  });
  const stateById = new Map(states.map((state) => [state.sourceTransactionId, state]));
  const targetRows = await prisma.transaction.findMany({
    where: {
      bookId: input.targetBookId,
      deletedAt: null,
      sourceNamespace: namespace,
      sourceRef: { in: sourceIds },
    },
    select: { id: true, sourceRef: true, version: true },
  });
  const targetByRef = new Map(targetRows.map((row) => [row.sourceRef ?? "", row]));
  const cleanableSourceIds: string[] = [];
  for (const transaction of input.source.transactions) {
    const state = stateById.get(transaction.id);
    const targetRow = targetByRef.get(transaction.id);
    if (state === undefined || targetRow === undefined) continue;
    if (state.decision !== "imported" || state.targetTransactionId !== targetRow.id) continue;
    if (state.targetVersion === null || state.targetVersion !== targetRow.version) continue;
    if (state.sourceFingerprint !== (await fingerprintImportSourceRecord(input.source, transaction.id))) continue;
    cleanableSourceIds.push(transaction.id);
  }
  return {
    targetBookId: input.targetBookId,
    guestBookId: input.guestBookId,
    cleanableSourceIds,
    cleanableCount: cleanableSourceIds.length,
    retainedCount: input.source.transactions.length - cleanableSourceIds.length,
    sourceCount: input.source.transactions.length,
  };
}

/**
 * D5 phase 3: small D4 imports have a `ledger_imports` receipt but no job row.
 * This variant builds the same source disposition from the successful receipt.
 */
export async function getFormalSourceDispositionByReceipt(
  prisma: PrismaClient,
  userId: string,
  receiptId: string,
): Promise<FormalSourceDisposition> {
  const receipt = await prisma.ledgerImport.findUnique({ where: { id: receiptId } });
  if (receipt === null) throw notFound("import_receipt_missing", "找不到服务端的导入成功回执。");
  if (receipt.userId !== userId) throw forbidden("import_forbidden", "这个导入回执不属于当前账号。");
  const result = (receipt.result ?? {}) as { sourceBookId?: unknown };
  const sourceBookId = typeof result.sourceBookId === "string" ? result.sourceBookId : null;
  if (sourceBookId === null) {
    throw badRequest("formal_source_required", "这次导入没有正式账本来源。");
  }
  const source = await loadSoloImportBook(prisma, userId, sourceBookId, "来源");
  const targetRows = await prisma.transaction.findMany({
    where: {
      bookId: receipt.targetBookId,
      deletedAt: null,
      sourceNamespace: sourceBookId,
      sourceRef: { not: null },
    },
    select: { sourceRef: true },
  });
  const migrated = new Set(targetRows.map((row) => row.sourceRef).filter((id): id is string => id !== null));
  const sourceIds = source.snapshot.transactions.map((row) => row.id);
  const unmigratedCount = sourceIds.filter((id) => !migrated.has(id)).length;
  const lifecycle = await getBookLifecycle(prisma, sourceBookId, userId);
  return {
    jobId: receiptId,
    sourceBookId,
    sourceBookName: source.name,
    targetBookId: receipt.targetBookId,
    sourceCount: sourceIds.length,
    migratedCount: sourceIds.length - unmigratedCount,
    unmigratedCount,
    canArchive: lifecycle.canArchive,
    archivedAt: lifecycle.archivedAt,
    selfRestoreUntil: lifecycle.selfRestoreUntil,
    scheduledPurgeAt: lifecycle.scheduledPurgeAt,
    pendingRecovery: lifecycle.pendingRecoveryRequest !== null,
    reason:
      lifecycle.canArchive
        ? unmigratedCount === 0
          ? "来源账本当前满足 S13 弃置条件，且所有来源账目都能在目标账本中找到。弃置后仍可在恢复期限内恢复。"
          : "来源账本当前满足 S13 弃置条件，但仍有账目没有迁入目标账本；弃置不会删除它们，但查看来源需要恢复操作。"
        : "来源账本当前不满足 S13 弃置条件（可能已有协作者、可用邀请/分享链接、已归档或待恢复请求）。",
  };
}

/**
 * D5 phase 3: after a completed formal import job, show source B migration and lifecycle safety.
 * This function never archives or deletes anything.
 */
export async function getFormalSourceDisposition(
  prisma: PrismaClient,
  userId: string,
  jobId: string,
): Promise<FormalSourceDisposition> {
  const job = await prisma.ledgerImportJob.findUnique({ where: { id: jobId } });
  if (job === null) throw notFound("import_job_missing", "找不到这个导入任务。");
  if (job.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
  if (job.sourceKind !== "book" || job.sourceBookId === null) {
    throw badRequest("formal_source_required", "只有正式账本来源才有来源账本处置信息。");
  }
  if (job.status !== "completed") {
    throw conflict("import_job_not_completed", "只有已完成的导入任务才能查看来源账本处置信息。");
  }
  const source = await loadSoloImportBook(prisma, userId, job.sourceBookId, "来源");
  const targetRows = await prisma.transaction.findMany({
    where: {
      bookId: job.targetBookId,
      deletedAt: null,
      sourceNamespace: job.sourceBookId,
      sourceRef: { not: null },
    },
    select: { sourceRef: true },
  });
  const migrated = new Set(targetRows.map((row) => row.sourceRef).filter((id): id is string => id !== null));
  const sourceIds = source.snapshot.transactions.map((row) => row.id);
  const unmigratedCount = sourceIds.filter((id) => !migrated.has(id)).length;
  const lifecycle = await getBookLifecycle(prisma, job.sourceBookId, userId);
  return {
    jobId: job.id,
    sourceBookId: job.sourceBookId,
    sourceBookName: source.name,
    targetBookId: job.targetBookId,
    sourceCount: sourceIds.length,
    migratedCount: sourceIds.length - unmigratedCount,
    unmigratedCount,
    canArchive: lifecycle.canArchive,
    archivedAt: lifecycle.archivedAt,
    selfRestoreUntil: lifecycle.selfRestoreUntil,
    scheduledPurgeAt: lifecycle.scheduledPurgeAt,
    pendingRecovery: lifecycle.pendingRecoveryRequest !== null,
    reason:
      lifecycle.canArchive
        ? unmigratedCount === 0
          ? "来源账本当前满足 S13 弃置条件，且所有来源账目都能在目标账本中找到。弃置后仍可在恢复期限内恢复。"
          : "来源账本当前满足 S13 弃置条件，但仍有账目没有迁入目标账本；弃置不会删除它们，但查看来源需要恢复操作。"
        : "来源账本当前不满足 S13 弃置条件（可能已有协作者、可用邀请/分享链接、已归档或待恢复请求）。",
  };
}
