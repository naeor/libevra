import { decimalsFor, evaluateDuplicatePair, parseAmountToMinor,
  type BillImportCandidate, type DuplicateCandidateFields, type DuplicateDetectionSettings } from "@libellum/shared";
import type { PrismaClient } from "../db.js";
import { dateTimeToInstant, formatAmountText } from "./common.js";

const CHUNK = 500;
const MAX_EXISTING_SCAN = 5000;
const MAX_COMPARISONS = 250000;
export interface DuplicateDetectionInput {
  readonly prisma: PrismaClient; readonly bookId: string;
  readonly candidates: BillImportCandidate[]; readonly settings: DuplicateDetectionSettings;
  readonly timezone: string; readonly checkCandidateIds?: boolean;
}
export interface DuplicateDetectionResult { readonly candidates: BillImportCandidate[]; readonly warnings: string[] }
function add(candidate: BillImportCandidate, id: string, message: string): void {
  if (candidate.duplicateIds.length >= 10 || candidate.duplicateIds.includes(id)) return;
  candidate.duplicateIds.push(id);
  if (candidate.warnings.filter((s) => s.includes("疑似重复")).length < 2) candidate.warnings.push(message);
}
function identity(candidate: BillImportCandidate, message: string): void {
  candidate.identityDuplicate = true; candidate.selected = false; candidate.warnings.push(message);
}
function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function shift(date: string, days: number): Date {
  const value = new Date(date + "T00:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value;
}
/** 身份去重独立于设置；只比较候选-候选/候选-历史，绝不比较历史-历史。 */
export async function detectDuplicates(input: DuplicateDetectionInput): Promise<DuplicateDetectionResult> {
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
  for (let i = 0; i < refs.length; i += CHUNK) {
    const existing = await input.prisma.transaction.findMany({
      where: { bookId: input.bookId, sourceNamespace: "", sourceRef: { in: refs.slice(i, i + CHUNK) } },
      select: { id: true, sourceRef: true, seq: true, occurredLocalDate: true, deletedAt: true },
    });
    const byRef = new Map(existing.map((row) => [row.sourceRef, row]));
    for (const candidate of candidates) {
      const row = byRef.get(candidate.sourceRef);
      if (row && !candidate.identityDuplicate)
        identity(candidate, `来源单号已存在（交易 #${row.seq}，${iso(row.occurredLocalDate)}${row.deletedAt ? "，已删除" : ""}），这一笔会被跳过。`);
    }
  }
  const sourceIds = [...new Set(candidates.flatMap((candidate) => candidate.sourceTransactionId ? [candidate.sourceTransactionId] : []))];
  if (input.checkCandidateIds) for (let i = 0; i < sourceIds.length; i += CHUNK) {
    const existing = await input.prisma.transaction.findMany({
      where: { bookId: input.bookId, id: { in: sourceIds.slice(i, i + CHUNK) } },
      select: { id: true, seq: true },
    });
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
    const tags = settings.matchTags ? await input.prisma.tag.findMany({
      where: { bookId: input.bookId }, select: { id: true, name: true },
    }) : [];
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
      const existing = await input.prisma.transaction.findMany({
        where: {
          bookId: input.bookId, deletedAt: null,
          ...(settings.matchAmount === false ? {} : { amountCents: { in: [...new Set(fields.map((field) => BigInt(field.amountCents!)))] } }),
          ...(settings.matchKind === false ? {} : { kind: { in: compared.flatMap((candidate) => candidate.kind === "unknown" ? [] : [candidate.kind]) } }),
          ...(settings.matchCurrency === false ? {} : { currency: { in: [...new Set(compared.map((field) => field.currency))] } }),
          ...(settings.matchTime === false || !dates.length ? {} : { occurredLocalDate: {
            gte: shift(dates[0]!, -days), lte: shift(dates[dates.length - 1]!, days),
          } }),
        },
        select: { id: true, seq: true, kind: true, amountCents: true, currency: true, occurredAt: true,
          occurredLocalDate: true, categoryId: true, paymentMethodId: true, note: true,
          tags: { select: { tagId: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take: MAX_EXISTING_SCAN + 1,
      });
      if (existing.length > MAX_EXISTING_SCAN) warnings.push(`匹配范围超过 ${MAX_EXISTING_SCAN} 笔，历史重复检测仅覆盖最近部分记录。`);
      const history = existing.slice(0, MAX_EXISTING_SCAN).map((row): DuplicateCandidateFields => ({
        id: row.id, bookId: input.bookId, kind: row.kind, amountCents: Number(row.amountCents), currency: row.currency,
        occurredAt: row.occurredAt.toISOString(), occurredAtPrecision: "second", occurredLocalDate: iso(row.occurredLocalDate),
        categoryId: row.categoryId, paymentMethodId: row.paymentMethodId, note: row.note, merchant: null,
        tagIds: row.tags.map((tag) => tag.tagId),
      }));
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const historyById = new Map(existing.map((row) => [row.id, row]));
      let checks = 0;
      outer: for (let i = 0; i < fields.length; i++) {
        const left = fields[i]!;
        for (const right of [...fields.slice(i + 1), ...history]) {
          if (++checks > MAX_COMPARISONS) {
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
            add(candidate, row.id, `与账本已有交易 #${row.seq}（${iso(row.occurredLocalDate)} ${formatAmountText(Number(row.amountCents), row.currency)} ${row.currency}）疑似重复，请核对。`);
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
