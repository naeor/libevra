/**
 * 账单导入的判重（原 `apps/api/src/import/duplicates.ts` 的 `detectDuplicates`，1.19.96 移到 shared）。
 *
 * 规则与提示逐字沿用原版：身份去重（来源单号 / 流水编号）独立于设置；内容判重走 shared 的
 * `evaluateDuplicatePair`，只比较候选-候选、候选-历史，绝不比较历史-历史。
 *
 * 唯一的变化是**数据从哪来**改成参数 {@link BillDuplicateSource}：服务器传入 Prisma 查询（与原来同样的
 * `findMany` 条件、顺序与上限，见 `apps/api/src/import/duplicates.ts`），游客本机导入传入游客库里那本账的
 * 账目（`apps/web/src/lib/guest/billImport.ts`）。
 */
import type { BillImportCandidate } from "../billImport.js";
import {
  evaluateDuplicatePair,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
} from "../duplicateDetection.js";
import { decimalsFor, parseAmountToMinor } from "../money.js";
import { dateTimeToInstant, formatAmountText } from "./common.js";

export const BILL_DUPLICATE_CHUNK = 500;
export const BILL_DUPLICATE_MAX_EXISTING_SCAN = 5000;
export const BILL_DUPLICATE_MAX_COMPARISONS = 250000;

/** 来源单号命中的已有账目（含已删除的）。 */
export interface BillDuplicateRefRow {
  readonly id: string;
  readonly sourceRef: string | null;
  readonly seq: number;
  /** `YYYY-MM-DD`。 */
  readonly occurredLocalDate: string;
  readonly deleted: boolean;
}

export interface BillDuplicateIdRow {
  readonly id: string;
  readonly seq: number;
}

/**
 * 历史账目的预筛条件（与原来的 SQL 条件一一对应）。`null` 表示这一项不过滤。
 * 结果按 `occurredAt` 降序、`id` 升序，最多 `limit` 条；只含未删除的账目。
 */
export interface BillDuplicateHistoryQuery {
  readonly amountCents: readonly number[] | null;
  /** 原样保留重复项（与原 SQL `IN` 的参数一致）。 */
  readonly kinds: readonly ("income" | "expense")[] | null;
  readonly currencies: readonly string[] | null;
  /** 闭区间，`YYYY-MM-DD`。 */
  readonly dateRange: { readonly from: string; readonly to: string } | null;
  readonly limit: number;
}

export interface BillDuplicateHistoryRow {
  readonly id: string;
  readonly seq: number;
  readonly kind: "income" | "expense";
  readonly amountCents: number;
  readonly currency: string;
  /** ISO 8601 绝对时间。 */
  readonly occurredAt: string;
  /** `YYYY-MM-DD`。 */
  readonly occurredLocalDate: string;
  readonly categoryId: string | null;
  readonly paymentMethodId: string | null;
  readonly note: string | null;
  readonly tagIds: readonly string[];
}

export interface BillDuplicateSource {
  /** 一批来源单号（≤ {@link BILL_DUPLICATE_CHUNK}）命中的账目，含已删除的。 */
  sourceRefs(refs: readonly string[]): Promise<readonly BillDuplicateRefRow[]>;
  /** 一批账目 id（≤ {@link BILL_DUPLICATE_CHUNK}）命中的账目，含已删除的。 */
  transactionIds(ids: readonly string[]): Promise<readonly BillDuplicateIdRow[]>;
  tags(): Promise<readonly { readonly id: string; readonly name: string }[]>;
  history(query: BillDuplicateHistoryQuery): Promise<readonly BillDuplicateHistoryRow[]>;
}

export interface BillDuplicateInput {
  readonly bookId: string;
  readonly candidates: readonly BillImportCandidate[];
  readonly settings: DuplicateDetectionSettings;
  readonly checkCandidateIds?: boolean | undefined;
  readonly source: BillDuplicateSource;
}

export interface BillDuplicateResult {
  readonly candidates: BillImportCandidate[];
  readonly warnings: string[];
}

function add(candidate: BillImportCandidate, id: string, message: string): void {
  if (candidate.duplicateIds.length >= 10 || candidate.duplicateIds.includes(id)) return;
  candidate.duplicateIds.push(id);
  if (candidate.warnings.filter((s) => s.includes("疑似重复")).length < 2) candidate.warnings.push(message);
}
function identity(candidate: BillImportCandidate, message: string): void {
  candidate.identityDuplicate = true; candidate.selected = false; candidate.warnings.push(message);
}
function shift(date: string, days: number): string {
  const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}

/** 身份去重独立于设置；只比较候选-候选/候选-历史，绝不比较历史-历史。 */
export async function detectBillDuplicates(input: BillDuplicateInput): Promise<BillDuplicateResult> {
  const candidates = input.candidates.map((candidate) => ({
    ...candidate, duplicateIds: [] as string[],
    identityDuplicate: candidate.warnings.some((warning) => warning.startsWith("文件指纹与已有导入记录")),
    warnings: candidate.warnings.filter((warning) => !/疑似重复|这一笔会被跳过|来源单号.*已.*占用/.test(warning)),
  }));
  const warnings: string[] = [];
  const groups = new Map<string, BillImportCandidate[]>();
  for (const candidate of candidates) for (const key of [
    candidate.sourceRef ? "ref:" + candidate.sourceRef : null,
    candidate.sourceTransactionId ? "id:" + candidate.sourceTransactionId : null,
  ]) {
    if (!key) continue;
    const group = groups.get(key) ?? []; group.push(candidate); groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const owner = group.find((candidate) => candidate.selected && !candidate.identityDuplicate) ?? group[0]!;
    for (const candidate of group) if (candidate !== owner && !candidate.identityDuplicate)
      identity(candidate, `文件内第 ${owner.line} 行使用了相同的来源身份，这一笔会被跳过。`);
  }
  const refs = [...new Set(candidates.flatMap((candidate) => candidate.sourceRef ? [candidate.sourceRef] : []))];
  for (let i = 0; i < refs.length; i += BILL_DUPLICATE_CHUNK) {
    const existing = await input.source.sourceRefs(refs.slice(i, i + BILL_DUPLICATE_CHUNK));
    const byRef = new Map(existing.map((row) => [row.sourceRef, row]));
    for (const candidate of candidates) {
      const row = byRef.get(candidate.sourceRef);
      if (row && !candidate.identityDuplicate)
        identity(candidate, `来源单号已存在（交易 #${row.seq}，${row.occurredLocalDate}${row.deleted ? "，已删除" : ""}），这一笔会被跳过。`);
    }
  }
  const sourceIds = [...new Set(candidates.flatMap((candidate) => candidate.sourceTransactionId ? [candidate.sourceTransactionId] : []))];
  if (input.checkCandidateIds) for (let i = 0; i < sourceIds.length; i += BILL_DUPLICATE_CHUNK) {
    const existing = await input.source.transactionIds(sourceIds.slice(i, i + BILL_DUPLICATE_CHUNK));
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const candidate of candidates) {
      const row = candidate.sourceTransactionId ? byId.get(candidate.sourceTransactionId) : undefined;
      if (row && !candidate.identityDuplicate)
        identity(candidate, `流水编号对应的交易 #${row.seq} 已在本账本中，这一笔会被跳过。`);
    }
  }
  const settings = input.settings;
  if (settings.enabled) {
    const compared = candidates.filter((candidate) => candidate.selected && !candidate.identityDuplicate);
    const fields: DuplicateCandidateFields[] = [];
    const tags = settings.matchTags ? await input.source.tags() : [];
    const tagIds = new Map(tags.map((tag) => [tag.name, tag.id]));
    for (const candidate of compared) {
      let amountCents: number;
      let occurredAt: string | null = null;
      try { amountCents = parseAmountToMinor(candidate.amount, decimalsFor(candidate.currency)); } catch { continue; }
      try {
        const instant = dateTimeToInstant(candidate.date, candidate.time, candidate.timezone);
        if (candidate.time !== null) occurredAt = instant;
      } catch { continue; }
      fields.push({
        id: candidate.id, bookId: input.bookId, kind: candidate.kind, amountCents, currency: candidate.currency,
        occurredAt, occurredAtPrecision: candidate.timePrecision, occurredLocalDate: candidate.date,
        categoryId: candidate.categoryId, paymentMethodId: candidate.paymentMethodId,
        merchant: candidate.merchant, note: candidate.note,
        tagIds: candidate.tags.map((name) => tagIds.get(name) ?? `new:${input.bookId}:${name}`),
      });
    }
    if (fields.length) {
      const dates = fields.map((field) => field.occurredLocalDate).filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
      const days = Math.ceil(settings.timeWindowSeconds / 86400) + 2;
      const existing = await input.source.history({
        amountCents: settings.matchAmount === false ? null : [...new Set(fields.map((field) => field.amountCents!))],
        kinds: settings.matchKind === false ? null : compared.flatMap((candidate) => candidate.kind === "unknown" ? [] : [candidate.kind]),
        currencies: settings.matchCurrency === false ? null : [...new Set(compared.map((field) => field.currency))],
        dateRange: settings.matchTime === false || !dates.length ? null : {
          from: shift(dates[0]!, -days), to: shift(dates[dates.length - 1]!, days),
        },
        limit: BILL_DUPLICATE_MAX_EXISTING_SCAN + 1,
      });
      if (existing.length > BILL_DUPLICATE_MAX_EXISTING_SCAN) warnings.push(`匹配范围超过 ${BILL_DUPLICATE_MAX_EXISTING_SCAN} 笔，历史重复检测仅覆盖最近部分记录。`);
      const history = existing.slice(0, BILL_DUPLICATE_MAX_EXISTING_SCAN).map((row): DuplicateCandidateFields => ({
        id: row.id, bookId: input.bookId, kind: row.kind, amountCents: row.amountCents, currency: row.currency,
        occurredAt: row.occurredAt, occurredAtPrecision: "second", occurredLocalDate: row.occurredLocalDate,
        categoryId: row.categoryId, paymentMethodId: row.paymentMethodId, note: row.note, merchant: null,
        tagIds: [...row.tagIds],
      }));
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const historyById = new Map(existing.map((row) => [row.id, row]));
      let checks = 0;
      outer: for (let i = 0; i < fields.length; i++) {
        const left = fields[i]!;
        for (const right of [...fields.slice(i + 1), ...history]) {
          if (++checks > BILL_DUPLICATE_MAX_COMPARISONS) {
            warnings.push("候选配对数量较大，本次重复检测未覆盖所有组合；请缩小文件范围后继续核对。"); break outer;
          }
          if (!evaluateDuplicatePair(left, right, settings).matched) continue;
          const candidate = byId.get(left.id)!;
          const other = byId.get(right.id);
          if (other) {
            add(candidate, other.id, `与文件内第 ${other.line} 行疑似重复，请核对。`);
            add(other, candidate.id, `与文件内第 ${candidate.line} 行疑似重复，请核对。`);
          } else {
            const row = historyById.get(right.id)!;
            add(candidate, row.id, `与账本已有交易 #${row.seq}（${row.occurredLocalDate} ${formatAmountText(row.amountCents, row.currency)} ${row.currency}）疑似重复，请核对。`);
          }
        }
      }
    }
  }
  const identityCount = candidates.filter((candidate) => candidate.identityDuplicate).length;
  if (identityCount) warnings.push(`有 ${identityCount} 笔交易的来源身份已存在，导入时会跳过，不会重复写入。`);
  const count = candidates.filter((candidate) => candidate.duplicateIds.length).length;
  if (count) warnings.push(`有 ${count} 笔交易疑似重复，已标出但没有取消勾选。`);
  return { candidates, warnings };
}
