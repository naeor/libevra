import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS, duplicateCandidatesRequestSchema, duplicateReviewRequestSchema,
  duplicatePairKey, evaluateDuplicatePair, type DuplicateCandidateFields, type DuplicateDetectionSettings,
  type DuplicatePairResult, type Transaction,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../db.js";
import { loadRelationTransactions, relationView } from "../ledger/notDuplicateRelations.js";
import { badRequest } from "../lib/errors.js";

export function candidateFromTransaction(entry: Transaction, bookId: string): DuplicateCandidateFields {
  return { id: entry.id, bookId, kind: entry.kind, amountCents: entry.amountCents, currency: entry.currency,
    occurredAt: entry.occurredAt, occurredLocalDate: entry.occurredLocalDate,
    categoryId: entry.categoryId, paymentMethodId: entry.paymentMethodId, note: entry.note,
    tagIds: entry.tags.map(t => t.id) };
}

/** SQL narrowing follows enabled rules; strict resource limits are reported, never hidden. */
export function duplicateWhere(bookId: string, c: DuplicateCandidateFields, settings: DuplicateDetectionSettings) {
  const instant = c.occurredAtPrecision !== "day" && c.occurredAt ? Date.parse(c.occurredAt) : NaN;
  return {
    bookId, deletedAt: null,
    ...(settings.matchKind !== false && (c.kind === "income" || c.kind === "expense") ? { kind: c.kind } : {}),
    ...(settings.matchAmount !== false && c.amountCents !== null ? { amountCents: BigInt(c.amountCents) } : {}),
    ...(settings.matchCurrency !== false && c.currency ? { currency: c.currency } : {}),
    ...(settings.matchTime !== false ? Number.isFinite(instant) ? {
      occurredAt: { gte: new Date(instant - settings.timeWindowSeconds * 1000), lte: new Date(instant + settings.timeWindowSeconds * 1000) },
    } : c.occurredLocalDate ? { occurredLocalDate: new Date(c.occurredLocalDate + "T00:00:00Z") } : {} : {}),
  };
}
export async function suppressConfirmed(prisma: PrismaClient, bookId: string, pairs: readonly DuplicatePairResult[]) {
  if (!pairs.length) return [];
  const ids = [...new Set(pairs.flatMap(p => [p.leftId, p.rightId]))].filter(id => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return [...pairs];
  const relations = await prisma.transactionNotDuplicateRelation.findMany({ where: {
    bookId, revokedAt: null, transactionAId: { in: ids }, transactionBId: { in: ids },
  } });
  const transactions = await loadRelationTransactions(prisma, bookId, ids);
  const ignored = new Set(relations.filter(r => relationView(r, { transactions }).effective).map(r => duplicatePairKey(r.transactionAId, r.transactionBId)));
  return pairs.filter(p => !ignored.has(p.pairKey));
}

export function registerDuplicateReviewRoutes<Row>(app: FastifyInstance, options: {
  prisma: PrismaClient; requireRead: (request: FastifyRequest) => Promise<void>;
  include: { category: { select: { id: true; name: true; isSystem: true } }; paymentMethod: { select: { id: true; name: true } }; tags: { include: { tag: { select: { id: true; name: true; color: true } } } } };
  toDto: (row: Row) => Transaction;
}) {
  const { prisma, requireRead, include, toDto } = options;
  const dto = (row: unknown) => toDto(row as Row);
  app.post("/api/v1/transactions/duplicates/candidates", { preHandler: requireRead }, async request => {
    const body = duplicateCandidatesRequestSchema.parse(request.body);
    const bookId = request.book!.bookId;
    if (body.candidates.some(c => c.bookId !== bookId)) throw badRequest("book_mismatch", "候选记录不属于当前账本。");
    const settings = body.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;
    if (!settings.enabled) return { pairs: [], history: [], truncated: false };
    const history = new Map<string, Transaction>(); const pairs = new Map<string, DuplicatePairResult>();
    let truncated = false;
    for (let i = 0; i < body.candidates.length; i++) {
      const c = body.candidates[i]!;
      for (let j = i + 1; j < body.candidates.length; j++) {
        const result = evaluateDuplicatePair(c, body.candidates[j]!, settings);
        if (result.matched && c.id !== body.candidates[j]!.id) pairs.set(result.pairKey, result);
      }
      const rows = await prisma.transaction.findMany({ where: duplicateWhere(bookId, c, settings), include, orderBy: { seq: "asc" }, take: 1001 });
      if (rows.length > 1000) truncated = true;
      for (const row of rows.slice(0, 1000)) {
        const entry = dto(row); if (entry.id === c.id) continue;
        const result = evaluateDuplicatePair(c, candidateFromTransaction(entry, bookId), settings);
        if (result.matched) { pairs.set(result.pairKey, result); history.set(entry.id, entry); }
      }
    }
    return { pairs: await suppressConfirmed(prisma, bookId, [...pairs.values()]), history: [...history.values()], truncated };
  });
  app.post("/api/v1/transactions/duplicates/review", { preHandler: requireRead }, async request => {
    const body = duplicateReviewRequestSchema.parse(request.body);
    const bookId = request.book!.bookId; const settings = body.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;
    if (!settings.enabled) return { pairs: [], entries: [], processed: 0, total: 0, nextSeq: null, throughSeq: 0, truncated: false };
    const maximum = body.throughSeq ?? (await prisma.transaction.aggregate({ where: { bookId }, _max: { seq: true } }))._max.seq ?? 0;
    const total = await prisma.transaction.count({ where: { bookId, deletedAt: null, seq: { lte: maximum } } });
    const rows = await prisma.transaction.findMany({ where: { bookId, deletedAt: null, seq: { gt: body.afterSeq, lte: maximum } }, include, orderBy: { seq: "asc" }, take: 26 });
    const entries = new Map<string, Transaction>(); const pairs: DuplicatePairResult[] = []; let truncated = false;
    for (const row of rows.slice(0, 25)) {
      const entry = dto(row); const c = candidateFromTransaction(entry, bookId);
      const others = await prisma.transaction.findMany({ where: { ...duplicateWhere(bookId, c, settings), seq: { gt: row.seq, lte: maximum } }, include, orderBy: { seq: "asc" }, take: 501 });
      if (others.length > 500) truncated = true;
      for (const other of others.slice(0, 500)) {
        const b = dto(other); const pair = evaluateDuplicatePair(c, candidateFromTransaction(b, bookId), settings);
        if (pair.matched) { pairs.push(pair); entries.set(entry.id, entry); entries.set(b.id, b); }
      }
    }
    const visible = await suppressConfirmed(prisma, bookId, pairs);
    return { pairs: visible, entries: [...entries.values()], total, processed: Math.min(rows.length, 25),
      nextSeq: rows.length > 25 ? rows[24]!.seq : null, throughSeq: maximum, truncated };
  });
}
