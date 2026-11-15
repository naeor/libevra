/**
 * 账单导入判重的**服务器数据来源**。
 *
 * 判重规则与提示在 `packages/shared/src/billParsers/duplicates.ts`（1.19.96 起服务器与游客本机导入共用一份）；
 * 这里只把规则需要的四类数据换成 Prisma 查询——条件、字段、排序、上限与 1.19.95 的 `detectDuplicates`
 * 内联查询逐字相同（`billImportReviewFixes.test.ts` 检查 `findMany` 的条件）。
 */
import {
  detectBillDuplicates,
  type BillDuplicateResult,
  type BillDuplicateSource,
} from "@libellum/shared/billParsers";
import type { BillImportCandidate, DuplicateDetectionSettings } from "@libellum/shared";
import type { PrismaClient } from "../db.js";

export interface DuplicateDetectionInput {
  readonly prisma: PrismaClient; readonly bookId: string;
  readonly candidates: BillImportCandidate[]; readonly settings: DuplicateDetectionSettings;
  readonly timezone: string; readonly checkCandidateIds?: boolean;
}
export type DuplicateDetectionResult = BillDuplicateResult;

function iso(date: Date): string { return date.toISOString().slice(0, 10); }

function prismaSource(prisma: PrismaClient, bookId: string): BillDuplicateSource {
  return {
    async sourceRefs(refs) {
      const existing = await prisma.transaction.findMany({
        where: { bookId, sourceNamespace: "", sourceRef: { in: [...refs] } },
        select: { id: true, sourceRef: true, seq: true, occurredLocalDate: true, deletedAt: true },
      });
      return existing.map((row) => ({
        id: row.id, sourceRef: row.sourceRef, seq: row.seq,
        occurredLocalDate: iso(row.occurredLocalDate), deleted: row.deletedAt ? true : false,
      }));
    },
    async transactionIds(ids) {
      return prisma.transaction.findMany({
        where: { bookId, id: { in: [...ids] } },
        select: { id: true, seq: true },
      });
    },
    async tags() {
      return prisma.tag.findMany({
        where: { bookId }, select: { id: true, name: true },
      });
    },
    async history(query) {
      const existing = await prisma.transaction.findMany({
        where: {
          bookId, deletedAt: null,
          ...(query.amountCents === null ? {} : { amountCents: { in: query.amountCents.map((value) => BigInt(value)) } }),
          ...(query.kinds === null ? {} : { kind: { in: [...query.kinds] } }),
          ...(query.currencies === null ? {} : { currency: { in: [...query.currencies] } }),
          ...(query.dateRange === null ? {} : { occurredLocalDate: {
            gte: new Date(query.dateRange.from + "T00:00:00Z"), lte: new Date(query.dateRange.to + "T00:00:00Z"),
          } }),
        },
        select: { id: true, seq: true, kind: true, amountCents: true, currency: true, occurredAt: true,
          occurredLocalDate: true, categoryId: true, paymentMethodId: true, note: true,
          tags: { select: { tagId: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take: query.limit,
      });
      return existing.map((row) => ({
        id: row.id, seq: row.seq, kind: row.kind, amountCents: Number(row.amountCents), currency: row.currency,
        occurredAt: row.occurredAt.toISOString(), occurredLocalDate: iso(row.occurredLocalDate),
        categoryId: row.categoryId, paymentMethodId: row.paymentMethodId, note: row.note,
        tagIds: row.tags.map((tag) => tag.tagId),
      }));
    },
  };
}

/** 身份去重独立于设置；只比较候选-候选/候选-历史，绝不比较历史-历史。 */
export async function detectDuplicates(input: DuplicateDetectionInput): Promise<DuplicateDetectionResult> {
  return detectBillDuplicates({
    bookId: input.bookId,
    candidates: input.candidates,
    settings: input.settings,
    checkCandidateIds: input.checkCandidateIds,
    source: prismaSource(input.prisma, input.bookId),
  });
}
