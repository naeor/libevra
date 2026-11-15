/**
 * 预览 → 核对 → 提交里**与存储无关**的规则（原 `apps/api/src/import/service.ts` 的私有函数，1.19.96 移到
 * shared）：合并用户改过的字段、逐笔校验（金额 / 日期 / 时区 / 分类 / 支付方式）、“文件已导入过”的标记、
 * 去重后要写入哪些行、提交报告里的跳过行。
 *
 * 服务器的 `BillImportService` 与游客的本机导入（`apps/web/src/lib/guest/billImport.ts`）都调用这里；
 * 两边只各自负责“数据从哪来、写到哪去”。提示语是服务器原有的中文原文（浏览器显示前查表翻译），一字不改。
 */
import { CURRENCIES } from "../ledger.js";
import { decimalsFor, parseAmountToMinor } from "../money.js";
import type { BillImportCandidate, BillImportCommitRow } from "../billImport.js";
import { dateTimeToInstant, parseClockTime, parseLocalDate } from "./common.js";
import type { CategoryOption, ParsedBill, PaymentMethodOption } from "./types.js";

/** 服务器与游客本机导入共用的固定提示（错误码 → 原文）。 */
export const BILL_REVIEW_MESSAGES = {
  previewExpired: "预览已过期或不存在，请重新上传文件。",
  duplicateRow: "同一候选不能提交多次。",
  unknownRow: "提交的数据与预览不一致，请重新上传并核对。",
  previewStale: "核对之后候选内容发生了变化，请先重新检查疑似重复，再提交。",
  revisionMismatch: "这次核对已经更新（可能在其他窗口重新检查过），请刷新核对页后再提交。",
  reconciliationNotAcknowledged: "结单对账不一致，请勾选确认后再导入。",
  dataChanged: "分类或支付方式已变化，请重新上传并核对。",
  reconciliationWarning: "结单对账不一致，确认导入前需要先核对对账信息。",
} as const;

/** 导入时新建标签用的颜色（服务器与游客本机导入相同；用户之后可以在标签管理里改）。 */
export const BILL_IMPORT_TAG_COLOR = "#55997a";

/** 合并提交行时的 400 类错误（服务器转成 `badRequest(code, message)`）。 */
export class BillReviewError extends Error {
  readonly code: "duplicate_row" | "unknown_row";

  constructor(code: "duplicate_row" | "unknown_row", message: string) {
    super(message);
    this.name = "BillReviewError";
    this.code = code;
  }
}

export interface BillBookData {
  readonly categories: readonly CategoryOption[];
  readonly paymentMethods: readonly PaymentMethodOption[];
  readonly systemCategoryByKind: ReadonlyMap<"expense" | "income", string>;
}

/** 每个方向第一个未归档的系统分类（未选分类的候选提交时落到这里）。 */
export function systemCategoryByKind(
  categories: readonly { readonly id: string; readonly kind: "expense" | "income"; readonly isSystem: boolean; readonly isArchived: boolean }[],
): Map<"expense" | "income", string> {
  const result = new Map<"expense" | "income", string>();
  for (const category of categories) {
    if (category.isSystem && !category.isArchived) {
      if (!result.has(category.kind)) {
        result.set(category.kind, category.id);
      }
    }
  }
  return result;
}

export interface BillFieldIssue {
  readonly column: string;
  readonly message: string;
}

export interface ResolvedBillRow {
  readonly candidate: BillImportCandidate;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly occurredAt: Date;
}

export type BillResolveResult =
  | { readonly ok: true; readonly row: ResolvedBillRow }
  | { readonly ok: false; readonly issues: readonly BillFieldIssue[] };

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

export function mergeWarnings(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())];
}

/**
 * 可编辑字段与“最后一次核对快照”的比较。`selected` 也算——勾选/取消勾选会改变
 * 提交范围，前端把它标成 dirty 并要求重新核对；服务端不能接受未经核对的改变。
 * 来源身份、行号、warnings、duplicateIds 不属于提交行，不参与比较。
 */
export function commitRowMatchesCandidate(
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

/**
 * 提交必须基于**最后一次核对快照**：有一行与快照不同就返回 `true`（调用方拒绝，要求重新核对）。
 * 未知行/重复行留给 {@link mergeBillRows} 给出原有 400 语义。
 */
export function commitRowsAreStale(
  candidates: readonly BillImportCandidate[],
  rows: readonly BillImportCommitRow[],
): boolean {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const row of rows) {
    const candidate = byId.get(row.id);
    if (candidate === undefined) continue;
    if (!commitRowMatchesCandidate(row, candidate)) return true;
  }
  return false;
}

/**
 * 合并核对字段；来源身份和文件定位不接受客户端覆盖。
 */
export function mergeBillRows(
  record: { readonly candidates: readonly BillImportCandidate[]; readonly originalCandidates?: readonly BillImportCandidate[] | undefined },
  rows: readonly BillImportCommitRow[],
): BillImportCandidate[] {
  const baseById = new Map(record.candidates.map((candidate) => [candidate.id, candidate]));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  if (rowById.size !== rows.length) throw new BillReviewError("duplicate_row", BILL_REVIEW_MESSAGES.duplicateRow);
  const originals = new Map((record.originalCandidates ?? record.candidates).map((candidate) => [candidate.id, candidate]));

  for (const row of rows) {
    if (!baseById.has(row.id)) {
      throw new BillReviewError("unknown_row", BILL_REVIEW_MESSAGES.unknownRow);
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

/** 逐笔校验一行候选；通过时给出整数最小单位金额、最终分类与绝对时间。 */
export function resolveBillRow(candidate: BillImportCandidate, book: BillBookData): BillResolveResult {
  const issues: BillFieldIssue[] = [];
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

/**
 * 重新核对时把字段级问题写进警告（响应仍保持 Preview 契约）。`extraIssues` 给调用方追加自己的校验
 * （游客本机导入用它提示“转正式账号时迁不过去”的长度上限；服务器不传）。
 */
export function withResolveWarnings(
  merged: readonly BillImportCandidate[],
  book: BillBookData,
  extraIssues?: (candidate: BillImportCandidate) => readonly BillFieldIssue[],
): BillImportCandidate[] {
  return merged.map((candidate) => {
    if (!candidate.selected) return candidate;
    const resolved = resolveBillRow(candidate, book);
    const issues = [...(resolved.ok ? [] : resolved.issues), ...(extraIssues?.(candidate) ?? [])];
    if (issues.length === 0) return candidate;
    return {
      ...candidate,
      warnings: [
        ...candidate.warnings,
        ...issues.map((issue) => `提交前需要处理：${issue.message}`),
      ],
    };
  });
}

/** 同一账本里已经导入过这份文件（文件指纹命中）的那一次导入。 */
export interface PreviousBillImport {
  readonly fileRef: string;
  readonly importedCount: number;
  readonly createdAt: Date;
}

export interface BillPreviewParts {
  readonly candidates: BillImportCandidate[];
  readonly warnings: string[];
  /** 合并核对字段时用来判断“哪条提示随字段一起失效”的原始候选。 */
  readonly originalCandidates: BillImportCandidate[];
  readonly originalWarnings: string[];
}

/**
 * 预览内容：文件指纹命中时全部标成身份重复（不再判重），否则交给 `detect` 判重；对账不一致追加提示。
 */
export async function buildBillPreview(
  parsed: ParsedBill,
  previous: PreviousBillImport | null,
  detect: (candidates: BillImportCandidate[]) => Promise<{ readonly candidates: BillImportCandidate[]; readonly warnings: readonly string[] }>,
): Promise<BillPreviewParts> {
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
    const duplicates = await detect(candidates);
    candidates = duplicates.candidates;
    warnings = mergeWarnings(warnings, duplicates.warnings);
  }

  if (parsed.reconciliation.ok === false) {
    warnings = mergeWarnings(warnings, [BILL_REVIEW_MESSAGES.reconciliationWarning]);
  }

  return {
    candidates,
    warnings,
    originalCandidates: (previous === null ? parsed.candidates : candidates).map((candidate) => ({ ...candidate, warnings: [...candidate.warnings] })),
    originalWarnings: [...parsed.warnings, ...(previous === null ? [] : warnings),
      ...(parsed.reconciliation.ok === false ? [BILL_REVIEW_MESSAGES.reconciliationWarning] : [])],
  };
}

/**
 * 去掉已存在的来源身份（账目 id / 来源单号）以及文件内重复的身份，得到真正要写入的行。
 */
export function rowsToInsert(
  planned: readonly ResolvedBillRow[],
  existingIds: ReadonlySet<string>,
  existingRefs: ReadonlySet<string>,
): ResolvedBillRow[] {
  const seenRefs = new Set<string>();
  const seenSourceIds = new Set<string>();
  return planned.filter((row) => {
    const sourceId = row.candidate.sourceTransactionId;
    if (existingIds.has(sourceId ?? row.candidate.id) || (sourceId !== undefined && seenSourceIds.has(sourceId))) return false;
    const ref = row.candidate.sourceRef;
    if (ref && (existingRefs.has(ref) || seenRefs.has(ref))) return false;
    if (ref) seenRefs.add(ref);
    if (sourceId) seenSourceIds.add(sourceId);
    return true;
  });
}

/** 报告里的跳过行：没勾选的，或勾选了但没有写入的（身份已存在）。 */
export function skippedLinesOf(merged: readonly BillImportCandidate[], importedIds: ReadonlySet<string>): number[] {
  return merged
    .filter(
      (candidate) => !candidate.selected || !importedIds.has(candidate.id),
    )
    .map((candidate) => candidate.line)
    .sort((left, right) => left - right);
}
