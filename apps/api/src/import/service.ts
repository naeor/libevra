import { createHash, randomUUID } from "node:crypto";

import {
  CURRENCIES,
  MAX_BILL_IMPORT_ROWS,
  decimalsFor,
  importReportSchema,
  newImportRef,
  parseAmountToMinor,
  parseCsv,
  type BillImportCandidate,
  type BillImportCommitRow,
  type BillImportPreview,
  type DuplicateDetectionSettings,
  type ImportReport,
  type ImportRowError,
} from "@libellum/shared";

import { allocateTransactionSeq } from "../ledger/transactionSeq.js";
import { badRequest, conflict, gone } from "../lib/errors.js";
import type { PrismaClient } from "../db.js";
import type { PreviewCache, PreviewRecord } from "./cache.js";
import { detectDuplicates } from "./duplicates.js";
import { dateTimeToInstant, parseClockTime, parseLocalDate } from "./common.js";
import { DocumentExtractError, type DocumentExtractor } from "./extractor.js";
import { parseAlipayCsv } from "./alipay.js";
import { parseBoaPdf } from "./boa.js";
import { parseLibevraCsv } from "./libevra.js";
import { parseWechatXlsx } from "./wechat.js";
import {
  decodeTextFile,
  detectTextHeader,
  kindLabel,
  sniffKind,
  type SniffedKind,
} from "./sniff.js";
import {
  BillParseError,
  type CategoryOption,
  type ExtractedDocument,
  type ParseContext,
  type ParsedBill,
  type PaymentMethodOption,
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

interface BookData {
  readonly categories: readonly CategoryOption[];
  readonly paymentMethods: readonly PaymentMethodOption[];
  readonly systemCategoryByKind: ReadonlyMap<"expense" | "income", string>;
}

interface FieldIssue {
  readonly column: string;
  readonly message: string;
}

interface ResolvedRow {
  readonly candidate: BillImportCandidate;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly occurredAt: Date;
}

type ResolveResult = { readonly ok: true; readonly row: ResolvedRow } | { readonly ok: false; readonly issues: readonly FieldIssue[] };

function invalidDate(value: string): boolean {
  const parsed = parseLocalDate(value);
  return parsed === null || parsed.iso !== value;
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone.length > 0;
  } catch {
    return false;
  }
}

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
 * 可编辑字段与“最后一次核对快照”的比较。`selected` 也算——勾选/取消勾选会改变
 * 提交范围，前端把它标成 dirty 并要求重新核对；服务端不能接受未经核对的改变。
 * 来源身份、行号、warnings、duplicateIds 不属于提交行，不参与比较。
 */
function commitRowMatchesCandidate(
  row: BillImportCommitRow,
  candidate: BillImportCandidate,
): boolean {
  return (
    row.selected === candidate.selected &&
    row.amount === candidate.amount &&
    row.currency === candidate.currency &&
    row.kind === candidate.kind &&
    row.date === candidate.date &&
    row.time === candidate.time &&
    row.timezone === candidate.timezone &&
    row.categoryId === candidate.categoryId &&
    row.paymentMethodId === candidate.paymentMethodId &&
    row.note === candidate.note &&
    row.tags.length === candidate.tags.length &&
    row.tags.every((tag, index) => tag === candidate.tags[index])
  );
}

function mergeWarnings(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())];
}

function isBoaDocument(document: ExtractedDocument): boolean {
  const text = document.pages
    .flat()
    .map((line) => line.spans.map((span) => span.text).join(""))
    .join("\n")
    .toLowerCase();
  if (text.includes("bank of america")) return true;
  // 没有行名时用结单特有的分区/摘要标签做内容识别，仍然不依赖文件名。
  return text.includes("account summary") && text.includes("deposits and other additions");
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

    const systemCategoryByKind = new Map<"expense" | "income", string>();
    for (const category of categories) {
      if (category.isSystem && !category.isArchived) {
        if (!systemCategoryByKind.has(category.kind)) {
          systemCategoryByKind.set(category.kind, category.id);
        }
      }
    }

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
      systemCategoryByKind,
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

  private parseDocument(
    sniffed: SniffedKind,
    buffer: Buffer,
    document: ExtractedDocument | null,
    context: ParseContext,
  ): ParsedBill {
    if (sniffed === "text") {
      const decoded = decodeTextFile(buffer);
      if (decoded === null) {
        throw new BillParseError("unsupported_format", "无法识别这个文本文件的编码。");
      }
      const rows = parseCsv(decoded.text);
      if (rows.length === 0) {
        throw new BillParseError("empty_file", "账单文件是空的。");
      }
      const header = detectTextHeader(rows);
      if (header === null) {
        throw new BillParseError(
          "unsupported_format",
          "没有找到支付宝交易明细或 Libevra 账单的表头。请确认文件内容是否完整。",
        );
      }
      return header.source === "alipay"
        ? parseAlipayCsv(rows, header.headerIndex, context)
        : parseLibevraCsv(rows, header.headerIndex, context);
    }

    if (document === null) {
      throw new BillParseError("document_invalid", "解析器没有返回内容。");
    }

    if (sniffed === "pdf") {
      if (document.format !== "pdf") {
        throw new BillParseError("unsupported_format", "这个文件不是可读取的 PDF。");
      }
      if (!isBoaDocument(document)) {
        throw new BillParseError(
          "unsupported_format",
          "这份 PDF 不是可识别的 Bank of America 结单（没有找到账户摘要或交易表）。",
        );
      }
      return parseBoaPdf(document.pages, context);
    }

    if (document.format !== "xlsx") {
      throw new BillParseError("unsupported_format", "这个文件不是可读取的 Excel 工作簿。");
    }
    return parseWechatXlsx(document.sheets, context);
  }

  private async parseFile(
    buffer: Buffer,
    context: ParseContext,
  ): Promise<ParsedBill> {
    const sniffed = sniffKind(buffer);
    if (sniffed !== "text" && sniffed !== "pdf" && sniffed !== "xlsx") {
      throw new BillParseError(
        "unsupported_format",
        `识别到这是${kindLabel(sniffed)}，但只支持微信 XLSX、支付宝 CSV、BOA PDF 和 Libevra CSV。`,
      );
    }

    const document =
      sniffed === "text" ? null : await this.extractOrThrow(buffer);
    return this.parseDocument(sniffed, buffer, document, context);
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

    let candidates = parsed.candidates;
    let warnings = [...parsed.warnings];

    if (previous !== null) {
      // 文件指纹命中：这份文件已经导入过。仍然把候选展示出来，但全部标成身份重复，
      // 提交时不会再写一次，也不会用“空列表”让用户以为文件有问题。
      const message = `这个文件在 ${previous.createdAt.toISOString().slice(0, 10)} 已经导入过（${previous.importedCount} 笔），再次导入不会重复入账。`;
      warnings = mergeWarnings(warnings, [message]);
      candidates = candidates.map((candidate) => ({
        ...candidate,
        selected: false,
        identityDuplicate: true,
        warnings: [...candidate.warnings, `文件指纹与已有导入记录 ${previous.fileRef} 相同，导入时会跳过。`],
      }));
    } else {
      const duplicates = await detectDuplicates({
        prisma: this.prisma,
        bookId: input.bookId,
        candidates,
        settings: input.settings,
        timezone: input.timezone,
        checkCandidateIds: parsed.source === "libevra",
      });
      candidates = duplicates.candidates;
      warnings = mergeWarnings(warnings, duplicates.warnings);
    }

    if (parsed.reconciliation.ok === false) {
      warnings = mergeWarnings(warnings, ["结单对账不一致，确认导入前需要先核对对账信息。"]);
    }

    const stored = this.cache.put({
      previewId: randomUUID(),
      userId: input.userId,
      bookId: input.bookId,
      fingerprint,
      createdAt: Date.now(),
      revision: 1,
      source: parsed.source,
      format: parsed.format,
      candidates,
      warnings,
      originalCandidates: (previous === null ? parsed.candidates : candidates).map((candidate) => ({ ...candidate, warnings: [...candidate.warnings] })),
      originalWarnings: [...parsed.warnings, ...(previous === null ? [] : warnings),
        ...(parsed.reconciliation.ok === false ? ["结单对账不一致，确认导入前需要先核对对账信息。"] : [])],
      reconciliation: parsed.reconciliation,
      committed: null,
    });
    return previewOf(stored);
  }

  private requirePreview(previewId: string, userId: string, bookId: string): PreviewRecord {
    const record = this.cache.get(previewId, userId, bookId);
    if (record === null) {
      throw gone("preview_expired", "预览已过期或不存在，请重新上传文件。");
    }
    return record;
  }

  /**
   * 合并核对字段；来源身份和文件定位不接受客户端覆盖。
   */
  private mergeRows(
    record: PreviewRecord,
    rows: readonly BillImportCommitRow[],
  ): BillImportCandidate[] {
    const baseById = new Map(record.candidates.map((candidate) => [candidate.id, candidate]));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    if (rowById.size !== rows.length) throw badRequest("duplicate_row", "同一候选不能提交多次。");
    const originals = new Map((record.originalCandidates ?? record.candidates).map((candidate) => [candidate.id, candidate]));

    for (const row of rows) {
      if (!baseById.has(row.id)) {
        throw badRequest("unknown_row", "提交的数据与预览不一致，请重新上传并核对。");
      }
    }

    return record.candidates.map((candidate) => {
      const row = rowById.get(candidate.id);
      if (row === undefined) return { ...candidate, selected: false, duplicateIds: [],
        warnings: [...(originals.get(candidate.id)?.warnings ?? [])] };

      const original = originals.get(candidate.id) ?? candidate;
      const fieldWarnings: [boolean, RegExp][] = [
        [row.kind !== original.kind, /类型|方向/],
        [row.time !== original.time, /时间|只提供日期|只解析到日期/],
        [row.date !== original.date, /日期/],
        [row.timezone !== original.timezone, /时区/],
        [row.amount !== original.amount || row.currency !== original.currency, /金额|币种/],
        [row.categoryId !== original.categoryId, /分类/],
        [row.paymentMethodId !== original.paymentMethodId, /支付方式/],
      ];

      return {
        ...candidate,
        amount: row.amount,
        currency: row.currency,
        date: row.date,
        time: row.time,
        timezone: row.timezone,
        timePrecision: row.time === null ? "day" : parseClockTime(row.time)?.precision ?? "second",
        warnings: original.warnings.filter((warning) => !fieldWarnings.some(([changed, pattern]) => changed && pattern.test(warning))),
        duplicateIds: [],
        selected: row.selected,
        kind: row.kind,
        categoryId: row.categoryId,
        paymentMethodId: row.paymentMethodId,
        note: row.note,
        tags: [...row.tags],
      };
    });
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
    const candidates = new Map(record.candidates.map((candidate) => [candidate.id, candidate]));
    for (const row of rows) {
      const candidate = candidates.get(row.id);
      if (candidate === undefined) continue;
      if (!commitRowMatchesCandidate(row, candidate)) {
        throw conflict(
          "preview_stale",
          "核对之后候选内容发生了变化，请先重新检查疑似重复，再提交。",
        );
      }
    }
  }

  private resolveRow(candidate: BillImportCandidate, book: BookData): ResolveResult {
    const issues: FieldIssue[] = [];
    const currency = candidate.currency;
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      issues.push({ column: "currency", message: `不支持的币种「${currency}」。` });
      return { ok: false, issues };
    }

    let amountCents = 0;
    try {
      if (!/^\d+(?:\.\d+)?$/.test(candidate.amount)) throw new RangeError("invalid_amount");
      amountCents = parseAmountToMinor(candidate.amount, decimalsFor(currency));
      if (amountCents <= 0 || amountCents > 1e10 * 10 ** decimalsFor(currency)) throw new RangeError("amount_limit");
    } catch {
      issues.push({ column: "amount", message: "金额格式不正确，无法转换为最小单位。" });
    }

    if (candidate.kind === "unknown") {
      issues.push({ column: "kind", message: "收支方向未确定，请选择收入或支出。" });
    }
    if (invalidDate(candidate.date)) {
      issues.push({ column: "date", message: "日期不是有效的 YYYY-MM-DD。" });
    }
    if (candidate.time !== null && parseClockTime(candidate.time) === null) {
      issues.push({ column: "time", message: "时间不是有效的 HH:mm 或 HH:mm:ss。" });
    }
    if (candidate.timePrecision === "day" && candidate.time !== null) {
      issues.push({ column: "time", message: "只解析到日期的交易不能带时间。" });
    }
    if (!validTimezone(candidate.timezone)) {
      issues.push({ column: "timezone", message: `时区「${candidate.timezone}」无效。` });
    }

    let categoryId: string | null = candidate.categoryId;
    if (categoryId === null) {
      if (candidate.kind === "income" || candidate.kind === "expense") {
        categoryId = book.systemCategoryByKind.get(candidate.kind) ?? null;
      }
      if (categoryId === null) {
        issues.push({
          column: "categoryId",
          message: "这个账本缺少对应方向的系统分类，无法导入。",
        });
      }
    } else {
      const category = book.categories.find((item) => item.id === categoryId);
      if (category === undefined) {
        issues.push({ column: "categoryId", message: "所选分类不存在或已被删除。" });
      } else if (category.isArchived) {
        issues.push({ column: "categoryId", message: `分类「${category.name}」已归档。` });
      } else if (
        (candidate.kind === "income" || candidate.kind === "expense") &&
        category.kind !== candidate.kind
      ) {
        issues.push({ column: "categoryId", message: `分类「${category.name}」与收支方向不一致。` });
      }
    }

    if (candidate.paymentMethodId !== null) {
      const method = book.paymentMethods.find((item) => item.id === candidate.paymentMethodId);
      if (method === undefined) {
        issues.push({ column: "paymentMethodId", message: "所选支付方式不存在或已被删除。" });
      } else if (method.isArchived) {
        issues.push({ column: "paymentMethodId", message: `支付方式「${method.name}」已归档。` });
      }
    }

    if (issues.length > 0 || categoryId === null) {
      return { ok: false, issues };
    }

    let occurredAt: Date;
    try {
      occurredAt = new Date(dateTimeToInstant(candidate.date, candidate.time, candidate.timezone));
      if (Number.isNaN(occurredAt.getTime())) throw new RangeError("invalid_instant");
    } catch {
      return {
        ok: false,
        issues: [...issues, { column: "timezone", message: "无法把日期时间换算为绝对时间。" }],
      };
    }

    return {
      ok: true,
      row: { candidate, amountCents, categoryId, occurredAt },
    };
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
    let merged = this.mergeRows(record, input.rows);

    // 重新核对时把字段级问题写进警告，响应仍保持 Preview 契约。
    merged = merged.map((candidate) => {
      if (!candidate.selected) return candidate;
      const resolved = this.resolveRow(candidate, book);
      if (resolved.ok) return candidate;
      return {
        ...candidate,
        warnings: [
          ...candidate.warnings,
          ...resolved.issues.map((issue) => `提交前需要处理：${issue.message}`),
        ],
      };
    });

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
        "这次核对已经更新（可能在其他窗口重新检查过），请刷新核对页后再提交。",
      );
    }
    this.assertCommitMatchesPreview(record, input.rows);

    if (record.committed !== null) return record.committed;

    if (record.reconciliation.ok === false && !input.acknowledgeWarnings) {
      throw badRequest(
        "reconciliation_not_acknowledged",
        "结单对账不一致，请勾选确认后再导入。",
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

        const seenRefs = new Set<string>();
        const seenSourceIds = new Set<string>();
        const toInsert = planned.filter((row) => {
          const sourceId = row.candidate.sourceTransactionId;
          if (existingIds.has(sourceId ?? row.candidate.id) || (sourceId !== undefined && seenSourceIds.has(sourceId))) return false;
          const ref = row.candidate.sourceRef;
          if (ref && (existingRefs.has(ref) || seenRefs.has(ref))) return false;
          if (ref) seenRefs.add(ref);
          if (sourceId) seenSourceIds.add(sourceId);
          return true;
        });

        // 分类/支付方式可能在预览后被归档或删除；整批拒绝，避免写入半个账本。
        const categoryIds = [...new Set(toInsert.map((row) => row.categoryId))];
        const usableCategories = await tx.category.count({
          where: { bookId: input.bookId, id: { in: categoryIds }, isArchived: false },
        });
        if (usableCategories !== categoryIds.length) {
          throw conflict("data_changed", "分类或支付方式已变化，请重新上传并核对。");
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
            throw conflict("data_changed", "分类或支付方式已变化，请重新上传并核对。");
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
            data: { id: randomUUID(), bookId: input.bookId, name, color: "#55997a" },
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
          await tx.transaction.create({
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

        const importedIds = new Set(toInsert.map((row) => row.candidate.id));
        const skippedLines = merged
          .filter(
            (candidate) => !candidate.selected || !importedIds.has(candidate.id),
          )
          .map((candidate) => candidate.line)
          .sort((left, right) => left - right);

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
