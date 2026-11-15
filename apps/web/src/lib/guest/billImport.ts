/**
 * 游客的“导入账单”：预览 → 核对 → 提交**全部在本机完成**，数据只进 `libellum-guest`（1.19.96）。
 *
 * 这不是第二套导入逻辑：解析、判重规则、合并核对字段、逐笔校验、去掉已存在的来源身份，全部调用
 * `@libellum/shared/billParsers`——服务器 `apps/api/src/import/service.ts` 用的是同一份。本文件只负责服务器上由
 * 数据库与进程完成的那几件事，换成游客的本机等价物：
 *
 * | 服务器                                   | 游客本机                                                     |
 * |------------------------------------------|--------------------------------------------------------------|
 * | Python 抽取 XLSX / PDF                   | `lib/billExtract`（DecompressionStream + DOMParser / pdf.js） |
 * | 文件指纹 `createHash`                    | `crypto.subtle`（http 局域网下没有时用 shared 的纯 TS 实现）   |
 * | 分类 / 支付方式 / 标签 / 历史账目查询     | 这本游客账本的 blob（`loadGuestDataFor`）                    |
 * | `import_logs` 与账目的 `sourceRef`        | blob 里的 `billImports`（`blob.ts` 的 `GuestBillImport`）     |
 * | 进程内预览缓存 `PreviewCache`             | 同一个类（shared），`userId` 用游客 id                        |
 * | 提交事务逐笔 `create`                     | `createGuestTransactionsBatch`：整批一次写 blob               |
 *
 * 失败时抛与服务器响应同样的 `ApiRequestError`（同样的状态码、错误码与中文原文），导入页不需要分叉处理。
 *
 * 游客独有的一条规则（服务器没有）：会让这本游客账本**转正式账号时迁不过去**的内容在提交前就挡住——备注超过
 * 500 字、一笔超过 10 个标签、标签名超过 20 字（`packages/shared/src/ledgerImport.ts` 的
 * `guestImportTransactionSchema` / `guestImportTagSchema`）。整本账超过一次迁移的上限（1.19.97 起 2 万笔，分段上传）不挡，
 * 只在提交步骤提醒（`billImportLimits.ts` 的 `guestMigrationReminder`）。
 */
import {
  MAX_BILL_IMPORT_BYTES,
  MAX_BILL_IMPORT_ROWS,
  importReportSchema,
  newImportRef,
  type BillImportCandidate,
  type BillImportCommitRow,
  type BillImportPreview,
  type DuplicateDetectionSettings,
  type ImportReport,
  type ImportRowError,
  type Tag,
  type Transaction,
} from "@libellum/shared";
import {
  BILL_IMPORT_TAG_COLOR,
  BILL_REVIEW_MESSAGES,
  BillParseError,
  BillReviewError,
  PreviewCache,
  buildBillPreview,
  commitRowsAreStale,
  detectBillDuplicates,
  mergeBillRows,
  mergeWarnings,
  parseBillFile,
  randomUuid,
  resolveBillRow,
  rowsToInsert,
  sha256HexOfBytes,
  skippedLinesOf,
  systemCategoryByKind,
  withResolveWarnings,
  type BillBookData,
  type BillDuplicateHistoryRow,
  type BillDuplicateSource,
  type BillFieldIssue,
  type ParseContext,
  type PreviewRecord,
  type ResolvedBillRow,
} from "@libellum/shared/billParsers";

import { ApiRequestError } from "../api.js";
import { extractBillDocument, type BillExtractOptions } from "../billExtract/index.js";
import { createGuestTransactionsBatch, loadGuestDataFor, type GuestBatchEntry, type GuestData } from "./data.js";
import { GUEST_MIGRATION_LIMITS } from "./billImportLimits.js";
import { guestRuntimeId } from "./runtime.js";


/** 本标签页的预览（与服务器一样只在内存里，30 分钟过期；刷新就要重新选文件）。 */
const cache = new PreviewCache();

/** 预览之后的核对与提交按顺序做（服务器 `runExclusive` 的同一理由：revision 与候选不能被并发改写）。 */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

function requireGuest(): string {
  const guestId = guestRuntimeId();
  if (guestId === null) throw new Error("guest bill import outside guest runtime");
  return guestId;
}

function badRequest(code: string, message: string): ApiRequestError {
  return new ApiRequestError(400, code, message);
}

/** 服务器 `routes/billImport.ts` 的 `translateParseError`：解析器“不可用”是服务问题，其余是文件问题。 */
function translateParseError(error: unknown): never {
  if (error instanceof BillParseError) {
    if (error.code === "python_unavailable" || error.code === "parser_unavailable" || error.code === "parse_timeout") {
      throw new ApiRequestError(503, "import_parser_unavailable", "文档解析服务暂时不可用，请稍后再试。你的文件没有被保存。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
    }
    throw badRequest(error.code, error.message);
  }
  throw error;
}

function requireTimezone(raw: string): string {
  const timezone = raw.trim();
  if (timezone === "") throw badRequest("missing_timezone", "缺少时区，请重新上传文件。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw badRequest("invalid_timezone", "时区无效，请检查设备时区设置。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  }
  return timezone;
}

/** 文件指纹（SHA-256 十六进制）：优先用浏览器原生实现；没有（http 局域网）时用 shared 的同一算法。 */
async function fingerprintOf(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    try {
      const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      // 落到下面的纯 TS 实现
    }
  }
  return sha256HexOfBytes(bytes);
}

function bookDataOf(data: GuestData): BillBookData {
  return {
    categories: data.categories.map((category) => ({
      parentId: category.parentId ?? null,
      id: category.id,
      name: category.name,
      kind: category.kind,
      isArchived: category.isArchived,
    })),
    paymentMethods: data.paymentMethods.map((method) => ({ id: method.id, name: method.name, isArchived: method.isArchived })),
    systemCategoryByKind: systemCategoryByKind(data.categories),
  };
}

/** 这本账里所有出现过的账目（含已删除待撤销、迁走后的清理留档），与服务器“软删除的行也算”一致。 */
function knownEntries(data: GuestData): Map<string, { readonly entry: Transaction; readonly deleted: boolean }> {
  const known = new Map<string, { entry: Transaction; deleted: boolean }>();
  for (const entry of data.cleanup ?? []) known.set(entry.id, { entry, deleted: true });
  for (const entry of data.deleted) known.set(entry.id, { entry, deleted: true });
  for (const entry of data.transactions) known.set(entry.id, { entry, deleted: false });
  return known;
}

/** 来源单号 → 账目 id（后导入的覆盖先导入的；指向的账目已经不在这本账里时不算）。 */
function sourceRefIndex(data: GuestData): Map<string, string> {
  const index = new Map<string, string>();
  for (const record of data.billImports ?? []) {
    for (const [ref, id] of Object.entries(record.sourceRefs)) index.set(ref, id);
  }
  return index;
}

function latestImportOf(data: GuestData, fingerprint: string) {
  const matches = (data.billImports ?? []).filter((record) => record.fingerprint === fingerprint);
  const latest = matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return latest ?? null;
}

/**
 * 判重的本机数据来源：读的是导入目标那一本游客账本的账目——与 `lib/duplicateReview.ts` 本机分支同一份数据
 * （活的账目，去掉已删除的），只是这里不限于“当前账本”，并按 shared 判重规则要的形状给出。
 */
export function guestDuplicateSource(data: GuestData): BillDuplicateSource {
  const known = knownEntries(data);
  const refs = sourceRefIndex(data);
  const deletedIds = new Set(data.deleted.map((entry) => entry.id));
  const live = data.transactions.filter((entry) => !deletedIds.has(entry.id));
  return {
    async sourceRefs(list) {
      return list.flatMap((ref) => {
        const id = refs.get(ref);
        const hit = id === undefined ? undefined : known.get(id);
        if (id === undefined || hit === undefined) return [];
        return [{ id, sourceRef: ref, seq: hit.entry.seq ?? 0, occurredLocalDate: hit.entry.occurredLocalDate, deleted: hit.deleted }];
      });
    },
    async transactionIds(ids) {
      return ids.flatMap((id) => {
        const hit = known.get(id);
        return hit === undefined ? [] : [{ id, seq: hit.entry.seq ?? 0 }];
      });
    },
    async tags() {
      return data.tags.map((tag) => ({ id: tag.id, name: tag.name }));
    },
    async history(query) {
      const amounts = query.amountCents === null ? null : new Set(query.amountCents);
      const kinds = query.kinds === null ? null : new Set(query.kinds);
      const currencies = query.currencies === null ? null : new Set(query.currencies);
      const rows: (BillDuplicateHistoryRow & { readonly time: number })[] = [];
      for (const entry of live) {
        const time = Date.parse(entry.occurredAt);
        if (Number.isNaN(time)) continue;
        if (amounts !== null && !amounts.has(entry.amountCents)) continue;
        if (kinds !== null && !kinds.has(entry.kind)) continue;
        if (currencies !== null && !currencies.has(entry.currency)) continue;
        if (query.dateRange !== null && (entry.occurredLocalDate < query.dateRange.from || entry.occurredLocalDate > query.dateRange.to)) continue;
        rows.push({
          time, id: entry.id, seq: entry.seq ?? 0, kind: entry.kind, amountCents: entry.amountCents, currency: entry.currency,
          occurredAt: new Date(time).toISOString(), occurredLocalDate: entry.occurredLocalDate, categoryId: entry.categoryId,
          paymentMethodId: entry.paymentMethodId, note: entry.note, tagIds: entry.tags.map((tag) => tag.id),
        });
      }
      // 与服务器的 `ORDER BY occurred_at DESC, id ASC LIMIT n` 相同。
      rows.sort((left, right) => right.time - left.time || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      return rows.slice(0, query.limit).map(({ time: _time, ...row }) => row);
    },
  };
}

/** 游客独有：会让这本账转正式账号时迁不过去的内容（见文件头）。 */
export function guestMigrationIssues(candidate: BillImportCandidate): BillFieldIssue[] {
  const issues: BillFieldIssue[] = [];
  if (candidate.note.length > GUEST_MIGRATION_LIMITS.noteLength) {
    issues.push({ column: "note", message: "备注超过 500 个字，游客账本转为正式账号时无法迁移，请缩短。" }); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  }
  if (candidate.tags.length > GUEST_MIGRATION_LIMITS.tagsPerEntry) {
    issues.push({ column: "tags", message: "一笔账最多 10 个标签，游客账本转为正式账号时无法迁移，请减少标签。" }); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  }
  for (const tag of candidate.tags) {
    if (tag.trim().length > GUEST_MIGRATION_LIMITS.tagNameLength) {
      issues.push({ column: "tags", message: `标签「${tag}」超过 20 个字，游客账本转为正式账号时无法迁移，请缩短。` }); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
    }
  }
  return issues;
}

function withMigrationWarnings(candidates: readonly BillImportCandidate[]): BillImportCandidate[] {
  return candidates.map((candidate) => {
    if (!candidate.selected) return candidate;
    const issues = guestMigrationIssues(candidate);
    if (issues.length === 0) return candidate;
    return { ...candidate, warnings: [...candidate.warnings, ...issues.map((issue) => `提交前需要处理：${issue.message}`)] }; // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  });
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

function requirePreview(previewId: string, guestId: string, bookId: string): PreviewRecord {
  const record = cache.get(previewId, guestId, bookId);
  if (record === null) throw new ApiRequestError(410, "preview_expired", BILL_REVIEW_MESSAGES.previewExpired);
  return record;
}

function mergeRows(record: PreviewRecord, rows: readonly BillImportCommitRow[]): BillImportCandidate[] {
  try {
    return mergeBillRows(record, rows);
  } catch (error) {
    if (error instanceof BillReviewError) throw badRequest(error.code, error.message);
    throw error;
  }
}

export interface GuestBillImportOptions {
  /** 测试用：替换文档抽取（Node 里没有 DOMParser / 浏览器版 pdf.js）。 */
  readonly extract?: BillExtractOptions;
}

/** 预览：读文件、抽取、解析、判重；不写账。 */
export async function guestPreviewBill(
  file: Blob,
  bookId: string,
  settings: DuplicateDetectionSettings,
  timezone: string,
  options: GuestBillImportOptions = {},
): Promise<BillImportPreview> {
  const guestId = requireGuest();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw badRequest("empty_file", "账单文件是空的。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  if (bytes.length > MAX_BILL_IMPORT_BYTES) throw badRequest("file_too_large", "文件超过 10MB 上限，请先拆分后再导入。"); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
  const zone = requireTimezone(timezone);

  const fingerprint = await fingerprintOf(bytes);
  const data = await loadGuestDataFor(bookId);
  const book = bookDataOf(data);
  const context: ParseContext = { fingerprint, timezone: zone, categories: book.categories, paymentMethods: book.paymentMethods };

  let parsed;
  try {
    parsed = await parseBillFile(bytes, context, (document) => extractBillDocument(document, options.extract));
    if (parsed.totalRows > MAX_BILL_IMPORT_ROWS) {
      throw new BillParseError("import_too_large", `文件里有 ${parsed.totalRows} 行交易，超过 ${MAX_BILL_IMPORT_ROWS} 行上限。`); // i18n-ignore：与服务器同一原文，显示前由 translateSharedMessage / 错误码译文翻译
    }
  } catch (error) {
    translateParseError(error);
  }

  const latest = latestImportOf(data, fingerprint);
  const previous = latest === null ? null : { fileRef: latest.fileRef, importedCount: latest.importedCount, createdAt: new Date(latest.createdAt) };
  const parts = await buildBillPreview(parsed, previous, (candidates) =>
    detectBillDuplicates({
      bookId,
      candidates,
      settings,
      checkCandidateIds: parsed.source === "libevra",
      source: guestDuplicateSource(data),
    }));

  const stored = cache.put({
    previewId: randomUuid(),
    userId: guestId,
    bookId,
    fingerprint,
    createdAt: Date.now(),
    revision: 1,
    source: parsed.source,
    format: parsed.format,
    candidates: withMigrationWarnings(parts.candidates),
    warnings: parts.warnings,
    originalCandidates: parts.originalCandidates,
    originalWarnings: parts.originalWarnings,
    reconciliation: parsed.reconciliation,
    committed: null,
  });
  return previewOf(stored);
}

/** 重新核对：合并改过的字段、逐笔校验写成提示、重新判重；revision + 1。 */
export function guestRecheckBill(
  previewId: string,
  rows: readonly BillImportCommitRow[],
  bookId: string,
  settings: DuplicateDetectionSettings,
): Promise<BillImportPreview> {
  return exclusive(async () => {
    const guestId = requireGuest();
    const record = requirePreview(previewId, guestId, bookId);
    const data = await loadGuestDataFor(bookId);
    const merged = withResolveWarnings(mergeRows(record, rows), bookDataOf(data), guestMigrationIssues);
    const duplicates = await detectBillDuplicates({
      bookId,
      candidates: merged,
      settings,
      checkCandidateIds: record.source === "libevra",
      source: guestDuplicateSource(data),
    });
    record.candidates = duplicates.candidates;
    record.warnings = mergeWarnings(record.originalWarnings ?? [], duplicates.warnings);
    record.revision += 1;
    return { ...previewOf(record), candidates: duplicates.candidates, warnings: record.warnings };
  });
}

export interface GuestCommitInput {
  readonly previewId: string;
  readonly previewRevision: number;
  readonly rows: readonly BillImportCommitRow[];
  readonly acknowledgeWarnings: boolean;
}

/** 提交：与服务器同样的前置检查；通过的整批一次写进游客账本。 */
export function guestCommitBill(input: GuestCommitInput, bookId: string): Promise<ImportReport> {
  return exclusive(async () => {
    const guestId = requireGuest();
    const record = requirePreview(input.previewId, guestId, bookId);
    if (input.previewRevision !== record.revision) {
      throw new ApiRequestError(409, "preview_revision_mismatch", BILL_REVIEW_MESSAGES.revisionMismatch);
    }
    if (commitRowsAreStale(record.candidates, input.rows)) {
      throw new ApiRequestError(409, "preview_stale", BILL_REVIEW_MESSAGES.previewStale);
    }
    if (record.committed !== null) return record.committed;
    if (record.reconciliation.ok === false && !input.acknowledgeWarnings) {
      throw badRequest("reconciliation_not_acknowledged", BILL_REVIEW_MESSAGES.reconciliationNotAcknowledged);
    }

    const merged = mergeRows(record, input.rows);
    const rowCount = merged.length;
    const report = await createGuestTransactionsBatch(bookId, (data) => planCommit(data, merged, rowCount, record.fingerprint));
    // 与服务器一样：行级校验失败（ok:false）不算提交过，改完还能再提交；成功后同一预览再提交直接复用报告。
    if (report.ok) cache.markCommitted(record.previewId, report);
    return report;
  });
}

function planCommit(data: GuestData, merged: readonly BillImportCandidate[], rowCount: number, fingerprint: string) {
  const book = bookDataOf(data);
  const errors: ImportRowError[] = [];
  const planned: ResolvedBillRow[] = [];
  for (const candidate of merged) {
    if (!candidate.selected) continue;
    const resolved = resolveBillRow(candidate, book);
    const issues = [...(resolved.ok ? [] : resolved.issues), ...guestMigrationIssues(candidate)];
    if (issues.length === 0 && resolved.ok) planned.push(resolved.row);
    for (const issue of issues) errors.push({ line: candidate.line, column: issue.column, message: issue.message });
  }

  const nothing = { entries: [] as GuestBatchEntry[] };
  if (errors.length > 0) {
    errors.sort((left, right) => left.line - right.line);
    // 沿用服务器的约定：行级校验失败返回 ok:false，且一行都不写。
    return { ...nothing, result: importReportSchema.parse({ ok: false, rowCount, importedCount: 0, skippedCount: 0, skippedLines: [], errors }) };
  }
  if (planned.length === 0) {
    return { ...nothing, result: importReportSchema.parse({ ok: true, rowCount, importedCount: 0, skippedCount: rowCount,
      skippedLines: merged.map((candidate) => candidate.line).sort((left, right) => left - right), errors: [] }) };
  }

  // 同一份文件已经写过（另一个预览先提交了）：返回那一次的结果，不再写。
  const previous = latestImportOf(data, fingerprint);
  if (previous !== null) {
    return { ...nothing, result: importReportSchema.parse({ ok: true, fileRef: previous.fileRef, exportedFileRef: null, rowCount: previous.rowCount,
      importedCount: previous.importedCount, skippedCount: previous.skippedCount, skippedLines: [], errors: [] }) };
  }

  const known = knownEntries(data);
  const refs = sourceRefIndex(data);
  const existingIds = new Set(planned.map((row) => row.candidate.sourceTransactionId ?? row.candidate.id).filter((id) => known.has(id)));
  const existingRefs = new Set(planned.flatMap((row) => {
    const ref = row.candidate.sourceRef;
    if (!ref) return [];
    const id = refs.get(ref);
    return id !== undefined && known.has(id) ? [ref] : [];
  }));
  const toInsert = rowsToInsert(planned, existingIds, existingRefs);

  // 分类/支付方式可能在预览后被归档或删除；整批拒绝，避免写入半个账本。
  const usableCategories = new Set(data.categories.filter((category) => !category.isArchived).map((category) => category.id));
  const usableMethods = new Set(data.paymentMethods.filter((method) => !method.isArchived).map((method) => method.id));
  if (toInsert.some((row) => !usableCategories.has(row.categoryId) || (row.candidate.paymentMethodId !== null && !usableMethods.has(row.candidate.paymentMethodId)))) {
    throw new ApiRequestError(409, "data_changed", BILL_REVIEW_MESSAGES.dataChanged);
  }

  const existingTags = new Set(data.tags.map((tag) => tag.name));
  const newTags: Tag[] = [];
  for (const name of new Set(toInsert.flatMap((row) => row.candidate.tags))) {
    if (existingTags.has(name)) continue;
    newTags.push({ id: randomUuid(), name, color: BILL_IMPORT_TAG_COLOR });
  }

  const entries: GuestBatchEntry[] = toInsert.map((row) => ({
    id: row.candidate.id,
    kind: row.candidate.kind === "income" ? "income" : "expense",
    amountCents: row.amountCents,
    currency: row.candidate.currency as Transaction["currency"],
    categoryId: row.categoryId,
    paymentMethodId: row.candidate.paymentMethodId,
    occurredAt: row.occurredAt.toISOString(),
    occurredLocalDate: row.candidate.date,
    occurredTz: row.candidate.timezone,
    note: row.candidate.note.trim() === "" ? null : row.candidate.note,
    tagNames: [...row.candidate.tags],
  }));

  const importedCount = entries.length;
  const fileRef = newImportRef();
  const importedIds = new Set(toInsert.map((row) => row.candidate.id));
  const result = importReportSchema.parse({
    ok: true,
    fileRef,
    exportedFileRef: null,
    rowCount,
    importedCount,
    skippedCount: rowCount - importedCount,
    skippedLines: skippedLinesOf(merged, importedIds),
    errors: [],
  });
  if (importedCount === 0) return { ...nothing, result };

  const sourceRefs: Record<string, string> = {};
  for (const row of toInsert) if (row.candidate.sourceRef) sourceRefs[row.candidate.sourceRef] = row.candidate.id;
  return {
    entries,
    newTags,
    billImport: { fileRef, fingerprint, createdAt: new Date().toISOString(), rowCount, importedCount, skippedCount: rowCount - importedCount, sourceRefs },
    result,
  };
}
