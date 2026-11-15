import { recordEvent } from "../ledger/events.js";
import { assertStorageGrowth, lockBookStorage } from "../ledger/storage.js";
import { createHash, randomUUID } from "node:crypto";

import {
  MAX_BILL_IMPORT_ROWS,
  importReportSchema,
  newImportRef,
  type BillImportCandidate,
  type BillImportCommitRow,
  type BillImportPreview,
  type DuplicateDetectionSettings,
  type ImportReport,
  type ImportRowError,
} from "@libellum/shared";
import {
  BILL_IMPORT_TAG_COLOR,
  BILL_REVIEW_MESSAGES,
  BillReviewError,
  buildBillPreview,
  commitRowsAreStale,
  mergeBillRows,
  mergeWarnings,
  parseBillFile,
  resolveBillRow,
  rowsToInsert,
  skippedLinesOf,
  systemCategoryByKind,
  withResolveWarnings,
  type BillBookData,
  type BillResolveResult,
  type ResolvedBillRow,
} from "@libellum/shared/billParsers";

import { allocateTransactionSeq } from "../ledger/transactionSeq.js";
import { badRequest, conflict, gone } from "../lib/errors.js";
import type { PrismaClient } from "../db.js";
import type { PreviewCache, PreviewRecord } from "./cache.js";
import { detectDuplicates } from "./duplicates.js";
import { DocumentExtractError, type DocumentExtractor } from "./extractor.js";
import {
  BillParseError,
  type ExtractedDocument,
  type ParseContext,
  type ParsedBill,
} from "./types.js";

export interface PreviewInput {
  readonly userId: string;
  readonly bookId: string;
  readonly buffer: Buffer;
  readonly settings: DuplicateDetectionSettings;
  readonly timezone: string;
}

export interface RecheckInput {
  readonly userId: string;
  readonly bookId: string;
  readonly previewId: string;
  readonly rows: readonly BillImportCommitRow[];
  readonly settings: DuplicateDetectionSettings;
}

export interface CommitInput {
  readonly userId: string;
  readonly bookId: string;
  readonly previewId: string;
  /** 最后一次预览/recheck 的 revision；缺失或不一致都拒绝，避免用旧核对结果提交。 */
  readonly previewRevision: number;
  readonly rows: readonly BillImportCommitRow[];
  readonly acknowledgeWarnings: boolean;
}

export interface ImportServiceOptions {
  readonly prisma: PrismaClient;
  readonly extractor: DocumentExtractor;
  readonly cache: PreviewCache;
}

/**
 * 1.19.96：解析、判重规则、合并核对字段、逐笔校验都在 `@libellum/shared/billParsers`（游客本机导入共用一份）；
 * 这里只剩数据库读写、预览缓存与提交事务。行为与 1.19.95 相同（见 `test/billImportParsers.test.ts`、
 * `test/billImportReviewFixes.test.ts` 与 shared 的等价性测试）。
 */
type BookData = BillBookData;
type ResolvedRow = ResolvedBillRow;
type ResolveResult = BillResolveResult;

function previewOf(record: PreviewRecord): BillImportPreview {
  return {
    previewId: record.previewId,
    expiresAt: new Date(record.expiresAt).toISOString(),
    revision: record.revision,
    source: record.source,
    format: record.format,
    candidates: record.candidates,
    warnings: record.warnings,
    reconciliation: record.reconciliation,
  };
}

/**
 * 预览/核对/提交的核心。
 *
 * 预览只解析与判重，不写账；提交只接受用户对“已解析候选”的选择与可编辑字段，
 * 金额、日期等可核对修正；来源身份与定位始终来自服务端原始解析。
 */
export class BillImportService {
  /**
   * recheck / commit 共享的串行队列。预览记录是进程内可变对象，若两个请求分别
   * 重检和提交，异步窗口里 revision/candidates 可能在“校验通过”和“真正落库”之间被改写。
   * 队列只串行同一进程内的 recheck+commit（解析和预览生成不经过它），代价很小。
   */
  private operationChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: ImportServiceOptions) {}

  private get prisma(): PrismaClient {
    return this.options.prisma;
  }

  private get cache(): PreviewCache {
    return this.options.cache;
  }

  private async loadBookData(bookId: string): Promise<BookData> {
    const [categories, paymentMethods] = await Promise.all([
      this.prisma.category.findMany({
        where: { bookId },
        select: { id: true, name: true, kind: true, parentId:true, isArchived: true, isSystem: true },
      }),
      this.prisma.paymentMethod.findMany({
        where: { bookId },
        select: { id: true, name: true, isArchived: true },
      }),
    ]);

    return {
      categories: categories.map((category) => ({
        parentId:category.parentId,
        id: category.id,
        name: category.name,
        kind: category.kind,
        isArchived: category.isArchived,
      })),
      paymentMethods: paymentMethods.map((method) => ({
        id: method.id,
        name: method.name,
        isArchived: method.isArchived,
      })),
      systemCategoryByKind: systemCategoryByKind(categories),
    };
  }

  private async extractOrThrow(buffer: Buffer): Promise<ExtractedDocument> {
    try {
      return await this.options.extractor.extract(buffer);
    } catch (error) {
      if (error instanceof DocumentExtractError) {
        throw new BillParseError(error.code, error.message);
      }
      throw error;
    }
  }

  private async parseFile(
    buffer: Buffer,
    context: ParseContext,
  ): Promise<ParsedBill> {
    // 分派规则在 shared 的 `parseBillFile`；XLSX / PDF 的文本抽取仍是服务器上的 Python 子进程。
    return parseBillFile(buffer, context, (bytes) => this.extractOrThrow(bytes as Buffer));
  }

  async preview(input: PreviewInput): Promise<BillImportPreview> {
    const fingerprint = createHash("sha256").update(input.buffer).digest("hex");
    const book = await this.loadBookData(input.bookId);
    const context: ParseContext = {
      fingerprint,
      timezone: input.timezone,
      categories: book.categories,
      paymentMethods: book.paymentMethods,
    };

    const parsed = await this.parseFile(input.buffer, context);
    if (parsed.totalRows > MAX_BILL_IMPORT_ROWS) {
      throw new BillParseError(
        "import_too_large",
        `文件里有 ${parsed.totalRows} 行交易，超过 ${MAX_BILL_IMPORT_ROWS} 行上限。`,
      );
    }

    const previous = await this.prisma.importLog.findFirst({
      where: { bookId: input.bookId, sourceFingerprint: fingerprint },
      orderBy: { createdAt: "desc" },
      select: {
        fileRef: true,
        rowCount: true,
        importedCount: true,
        createdAt: true,
      },
    });

    const assembled = await buildBillPreview(parsed, previous, async (candidates) =>
      detectDuplicates({
        prisma: this.prisma,
        bookId: input.bookId,
        candidates,
        settings: input.settings,
        timezone: input.timezone,
        checkCandidateIds: parsed.source === "libevra",
      }));

    const stored = this.cache.put({
      previewId: randomUUID(),
      userId: input.userId,
      bookId: input.bookId,
      fingerprint,
      createdAt: Date.now(),
      revision: 1,
      source: parsed.source,
      format: parsed.format,
      candidates: assembled.candidates,
      warnings: assembled.warnings,
      originalCandidates: assembled.originalCandidates,
      originalWarnings: assembled.originalWarnings,
      reconciliation: parsed.reconciliation,
      committed: null,
    });
    return previewOf(stored);
  }

  private requirePreview(previewId: string, userId: string, bookId: string): PreviewRecord {
    const record = this.cache.get(previewId, userId, bookId);
    if (record === null) {
      throw gone("preview_expired", BILL_REVIEW_MESSAGES.previewExpired);
    }
    return record;
  }

  /**
   * 合并核对字段；来源身份和文件定位不接受客户端覆盖（规则在 shared 的 `mergeBillRows`）。
   */
  private mergeRows(
    record: PreviewRecord,
    rows: readonly BillImportCommitRow[],
  ): BillImportCandidate[] {
    try {
      return mergeBillRows(record, rows);
    } catch (error) {
      if (error instanceof BillReviewError) throw badRequest(error.code, error.message);
      throw error;
    }
  }

  /**
   * 提交必须基于**最后一次核对快照**：字段或勾选在 preview/recheck 之后被改过，
   * 说明检测结果已经不是最终提交内容的检测结果，拒绝并要求重新核对。
   * 未知行/重复行留给 mergeRows 给出原有 400 语义。
   */
  private assertCommitMatchesPreview(
    record: PreviewRecord,
    rows: readonly BillImportCommitRow[],
  ): void {
    if (commitRowsAreStale(record.candidates, rows)) {
      throw conflict(
        "preview_stale",
        BILL_REVIEW_MESSAGES.previewStale,
      );
    }
  }

  private resolveRow(candidate: BillImportCandidate, book: BookData): ResolveResult {
    return resolveBillRow(candidate, book);
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationChain;
    let release!: () => void;
    this.operationChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async recheck(input: RecheckInput): Promise<BillImportPreview> {
    return this.runExclusive(async () => this.recheckUnlocked(input));
  }

  private async recheckUnlocked(input: RecheckInput): Promise<BillImportPreview> {
    const record = this.requirePreview(input.previewId, input.userId, input.bookId);
    const book = await this.loadBookData(input.bookId);
    // 重新核对时把字段级问题写进警告，响应仍保持 Preview 契约。
    const merged = withResolveWarnings(this.mergeRows(record, input.rows), book);

    const duplicates = await detectDuplicates({
      prisma: this.prisma,
      bookId: input.bookId,
      candidates: merged,
      settings: input.settings,
      // 重新核对请求不带独立时区；候选自己的时区才是转换依据，这里只用于
      // 判重的同日回退，取第一条候选即可。
      timezone: merged[0]?.timezone ?? "Asia/Shanghai",
      checkCandidateIds: record.source === "libevra",
    });
    record.candidates = duplicates.candidates;
    record.warnings = mergeWarnings(record.originalWarnings ?? [], duplicates.warnings);
    // 每次成功重检都推进版本；旧 revision 的 commit 必须失败，不能在并发/多窗口
    // 场景下把上一轮的检测结果套到新一轮内容上。
    record.revision += 1;

    return {
      ...previewOf(record),
      candidates: duplicates.candidates,
      warnings: record.warnings,
    };
  }

  async commit(input: CommitInput): Promise<ImportReport> {
    return this.runExclusive(async () => this.commitUnlocked(input));
  }

  private async commitUnlocked(input: CommitInput): Promise<ImportReport> {
    const record = this.requirePreview(input.previewId, input.userId, input.bookId);

    if (input.previewRevision !== record.revision) {
      throw conflict(
        "preview_revision_mismatch",
        BILL_REVIEW_MESSAGES.revisionMismatch,
      );
    }
    this.assertCommitMatchesPreview(record, input.rows);

    if (record.committed !== null) return record.committed;

    if (record.reconciliation.ok === false && !input.acknowledgeWarnings) {
      throw badRequest(
        "reconciliation_not_acknowledged",
        BILL_REVIEW_MESSAGES.reconciliationNotAcknowledged,
      );
    }

    const book = await this.loadBookData(input.bookId);
    const merged = this.mergeRows(record, input.rows);
    const rowCount = merged.length;
    const errors: ImportRowError[] = [];
    const planned: ResolvedRow[] = [];
    for (const candidate of merged) {
      if (!candidate.selected) continue;
      const resolved = this.resolveRow(candidate, book);
      if (resolved.ok) {
        planned.push(resolved.row);
      } else {
        for (const issue of resolved.issues) {
          errors.push({ line: candidate.line, column: issue.column, message: issue.message });
        }
      }
    }

    if (errors.length > 0) {
      errors.sort((left, right) => left.line - right.line);
      // 沿用旧 /import 的约定：行级校验失败返回 200 + ok:false，且一行都不写。
      return importReportSchema.parse({
        ok: false,
        rowCount,
        importedCount: 0,
        skippedCount: 0,
        skippedLines: [],
        errors,
      });
    }

    if (planned.length === 0) {
      const report = importReportSchema.parse({
        ok: true,
        rowCount,
        importedCount: 0,
        skippedCount: rowCount,
        skippedLines: merged.map((candidate) => candidate.line).sort((left, right) => left - right),
        errors: [],
      });
      this.cache.markCommitted(record.previewId, report);
      return report;
    }

    let outcome: { readonly report: ImportReport };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        await lockBookStorage(tx, input.bookId);
        // 同一文件并发提交（双击/重试）串行化；锁到事务结束自动释放。
        // 强转 text：Prisma 无法反序列化 void 类型的返回值。
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`import:${input.bookId}:${record.fingerprint}`}))::text`;

        const previous = await tx.importLog.findFirst({
          where: { bookId: input.bookId, sourceFingerprint: record.fingerprint },
          orderBy: { createdAt: "desc" },
          select: {
            fileRef: true,
            exportedFileRef: true,
            rowCount: true,
            importedCount: true,
            skippedCount: true,
          },
        });
        if (previous !== null) {
          return {
            report: importReportSchema.parse({
              ok: true,
              fileRef: previous.fileRef,
              exportedFileRef: previous.exportedFileRef,
              rowCount: previous.rowCount,
              importedCount: previous.importedCount,
              skippedCount: previous.skippedCount,
              skippedLines: [],
              errors: [],
            }),
          };
        }

        const ids = planned.map((row) => row.candidate.sourceTransactionId ?? row.candidate.id);
        const existing = await tx.transaction.findMany({
          where: { bookId: input.bookId, id: { in: ids } },
          select: { id: true },
        });
        const existingIds = new Set(existing.map((row) => row.id));

        const refs = planned
          .map((row) => row.candidate.sourceRef)
          .filter((ref): ref is string => ref !== null && ref !== "");
        const existingRefs =
          refs.length === 0
            ? new Set<string>()
            : new Set(
                (
                  await tx.transaction.findMany({
                    where: {
                      bookId: input.bookId,
                      sourceNamespace: "",
                      sourceRef: { in: refs },
                    },
                    select: { sourceRef: true },
                  })
                )
                  .map((row) => row.sourceRef)
                  .filter((ref): ref is string => ref !== null),
              );

        const toInsert = rowsToInsert(planned, existingIds, existingRefs);

        // 分类/支付方式可能在预览后被归档或删除；整批拒绝，避免写入半个账本。
        const categoryIds = [...new Set(toInsert.map((row) => row.categoryId))];
        const usableCategories = await tx.category.count({
          where: { bookId: input.bookId, id: { in: categoryIds }, isArchived: false },
        });
        if (usableCategories !== categoryIds.length) {
          throw conflict("data_changed", BILL_REVIEW_MESSAGES.dataChanged);
        }
        const paymentIds = [
          ...new Set(
            toInsert
              .map((row) => row.candidate.paymentMethodId)
              .filter((id): id is string => id !== null),
          ),
        ];
        if (paymentIds.length > 0) {
          const usableMethods = await tx.paymentMethod.count({
            where: { bookId: input.bookId, id: { in: paymentIds }, isArchived: false },
          });
          if (usableMethods !== paymentIds.length) {
            throw conflict("data_changed", BILL_REVIEW_MESSAGES.dataChanged);
          }
        }

        const tagNames = [...new Set(toInsert.flatMap((row) => row.candidate.tags))];
        const existingTags =
          tagNames.length === 0
            ? []
            : await tx.tag.findMany({
                where: { bookId: input.bookId, name: { in: tagNames } },
                select: { id: true, name: true },
              });
        const tagIdByName = new Map(existingTags.map((tag) => [tag.name, tag.id]));
        for (const name of tagNames) {
          if (tagIdByName.has(name)) continue;
          const tag = await tx.tag.create({
            data: { id: randomUUID(), bookId: input.bookId, name, color: BILL_IMPORT_TAG_COLOR },
            select: { id: true },
          });
          tagIdByName.set(name, tag.id);
        }

        const importRef = newImportRef();
        let importedCount = 0;
        for (const row of toInsert) {
          const candidate = row.candidate;
          const tagIds = candidate.tags.map((name) => tagIdByName.get(name));
          if (tagIds.some((tagId) => tagId === undefined)) {
            throw new Error("标签创建后未能取回 id");
          }
          const seq = await allocateTransactionSeq(tx, input.bookId);
          const createdEntry = await tx.transaction.create({
            data: {
              id: candidate.id,
              seq,
              bookId: input.bookId,
              userId: input.userId,
              categoryId: row.categoryId,
              paymentMethodId: candidate.paymentMethodId,
              kind: candidate.kind === "income" ? "income" : "expense",
              amountCents: BigInt(row.amountCents),
              currency: candidate.currency,
              occurredAt: row.occurredAt,
              occurredLocalDate: new Date(`${candidate.date}T00:00:00.000Z`),
              occurredTz: candidate.timezone,
              note: candidate.note.trim() === "" ? null : candidate.note,
              idempotencyKey: randomUUID(),
              sourceRef: candidate.sourceRef,
              importRef,
              tags: {
                create: tagIds.map((tagId) => ({ tagId: tagId as string })),
              },
            },
          });
          await recordEvent(tx, { bookId: input.bookId, transactionId: createdEntry.id, transactionSeq: createdEntry.seq, actorId: input.userId,
            actorName: (await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { displayName: true } })).displayName, kind: "created" });
          importedCount += 1;
        }

        if (importedCount > 0) {
          // 既有数据库约束 import_logs_format_known 只允许 'csv'；本轮不允许新增迁移，
          // 所以四种来源都记 csv。指纹/idempotency 不受影响，来源格式在预览响应里仍可见。
          await tx.importLog.create({
            data: {
              id: randomUUID(),
              bookId: input.bookId,
              userId: input.userId,
              format: "csv",
              fileRef: importRef,
              exportedFileRef: null,
              sourceFingerprint: record.fingerprint,
              rowCount,
              importedCount,
              skippedCount: rowCount - importedCount,
            },
          });
        }

        await assertStorageGrowth(tx, input.userId, input.bookId, 0n);
        const importedIds = new Set(toInsert.map((row) => row.candidate.id));
        const skippedLines = skippedLinesOf(merged, importedIds);

        return {
          report: importReportSchema.parse({
            ok: true,
            fileRef: importRef,
            exportedFileRef: null,
            rowCount,
            importedCount,
            skippedCount: rowCount - importedCount,
            skippedLines,
            errors: [],
          }),
        };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "P2002"
      ) {
        throw conflict("duplicate_source", "有交易的来源单号刚刚被其他导入占用，请重新预览。");
      }
      throw error;
    }

    this.cache.markCommitted(record.previewId, outcome.report);
    return outcome.report;
  }
}
