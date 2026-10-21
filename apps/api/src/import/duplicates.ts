import {
  decimalsFor,
  evaluateDuplicateCandidates,
  parseAmountToMinor,
  type BillImportCandidate,
  type DuplicateCandidateFields,
  type DuplicateDetectionSettings,
} from "@libellum/shared";

import type { PrismaClient } from "../db.js";
import { dateTimeToInstant, formatAmountText } from "./common.js";

/** Prisma `in` 列表过长会撑爆参数上限，按块查询。 */
const REF_CHUNK_SIZE = 500;
/** SQL 粗筛上限；超出时只比对最近的一部分并明确提示，不假装覆盖全量。 */
const MAX_EXISTING_SCAN = 5_000;
const MAX_DUPLICATE_IDS = 10;

interface ExistingRefRow {
  readonly id: string;
  readonly seq: number;
  readonly occurredLocalDate: Date;
  readonly deletedAt: Date | null;
}

interface ExistingTransactionRow extends ExistingRefRow {
  readonly kind: "expense" | "income";
  readonly amountCents: bigint;
  readonly currency: string;
  readonly occurredAt: Date;
  readonly categoryId: string;
  readonly paymentMethodId: string | null;
}

export interface DuplicateDetectionInput {
  readonly prisma: PrismaClient;
  readonly bookId: string;
  readonly candidates: BillImportCandidate[];
  readonly settings: DuplicateDetectionSettings;
  /** 请求级时区，用于候选没带时区或时区无效时兜底。 */
  readonly timezone: string;
  /**
   * 是否把候选 id 当作可能已存在的交易 id 查询（只有 Libevra 导出会复用流水编号）。
   * 其他格式的候选 id 是随机 uuid，查了只会白跑几十次 SQL。
   */
  readonly checkCandidateIds?: boolean;
}

export interface DuplicateDetectionResult {
  readonly candidates: BillImportCandidate[];
  readonly warnings: string[];
}

function cloneCandidate(candidate: BillImportCandidate): BillImportCandidate {
  return {
    ...candidate,
    warnings: [...candidate.warnings],
    duplicateIds: [...candidate.duplicateIds],
  };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortRef(ref: string): string {
  return ref.length <= 28 ? ref : `${ref.slice(0, 25)}…`;
}

function markIdentityDuplicate(candidate: BillImportCandidate, warning: string): void {
  candidate.identityDuplicate = true;
  candidate.selected = false;
  if (!candidate.warnings.includes(warning)) candidate.warnings.push(warning);
}

function addDuplicate(
  candidate: BillImportCandidate,
  duplicateId: string,
  warning: string,
): void {
  if (candidate.duplicateIds.length >= MAX_DUPLICATE_IDS) return;
  if (!candidate.duplicateIds.includes(duplicateId)) {
    candidate.duplicateIds.push(duplicateId);
  }
  // 每个候选最多两条重复提示，避免 20 个同额交易把 warnings 撑爆。
  const duplicateWarnings = candidate.warnings.filter((item) => item.includes("疑似重复"));
  if (duplicateWarnings.length < 2 && !candidate.warnings.includes(warning)) {
    candidate.warnings.push(warning);
  }
}

async function findExistingRefs(
  prisma: PrismaClient,
  bookId: string,
  refs: readonly string[],
): Promise<Map<string, ExistingRefRow>> {
  const found = new Map<string, ExistingRefRow>();
  for (let index = 0; index < refs.length; index += REF_CHUNK_SIZE) {
    const chunk = refs.slice(index, index + REF_CHUNK_SIZE);
    const rows = await prisma.transaction.findMany({
      where: {
        bookId,
        sourceNamespace: "",
        sourceRef: { in: chunk },
      },
      select: {
        id: true,
        seq: true,
        sourceRef: true,
        occurredLocalDate: true,
        deletedAt: true,
      },
    });
    for (const row of rows) {
      if (row.sourceRef === null) continue;
      found.set(row.sourceRef, row);
    }
  }
  return found;
}

/**
 * 统一重复检测（预览与重新核对共用）。
 *
 * 分两层，语义不同：
 * - 身份重复：同一个 `sourceNamespace+sourceRef` 已存在（或文件内重复），提交时会被跳过，
 *   所以直接取消勾选并标 `identityDuplicate`；
 * - 内容重复：金额/方向/币种/时间相近，只是“疑似”，保留勾选，交给用户判断。
 *
 * E3 的“不重复”关系只能抑制两笔**已存在**交易之间的配对；新候选在提交前没有数据库 id，
 * 无法映射到关系表，这一点在实现报告里作为已知限制说明，不假装已覆盖。
 */
export async function detectDuplicates(
  input: DuplicateDetectionInput,
): Promise<DuplicateDetectionResult> {
  const candidates = input.candidates.map(cloneCandidate);
  const warnings: string[] = [];

  // 1) 文件内部同一来源单号只保留一笔（优先保留已勾选的那笔）。
  const groups = new Map<string, BillImportCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.sourceRef === null || candidate.sourceRef === "") continue;
    const group = groups.get(candidate.sourceRef);
    if (group === undefined) groups.set(candidate.sourceRef, [candidate]);
    else group.push(candidate);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const owner = group.find((candidate) => candidate.selected) ?? group[0];
    if (owner === undefined) continue;
    for (const candidate of group) {
      if (candidate === owner) continue;
      markIdentityDuplicate(
        candidate,
        `文件内第 ${owner.line} 行使用了相同的来源单号，这一笔会被跳过。`,
      );
    }
  }

  // 2) 与账本已有交易的身份比对：业务上的“防重复写入”靠这一层。
  const refs = candidates
    .map((candidate) => candidate.sourceRef)
    .filter((ref): ref is string => ref !== null && ref !== "");
  if (refs.length > 0) {
    const existingRefs = await findExistingRefs(input.prisma, input.bookId, refs);
    for (const candidate of candidates) {
      if (candidate.sourceRef === null) continue;
      const existing = existingRefs.get(candidate.sourceRef);
      if (existing === undefined) continue;
      if (existing.deletedAt !== null) {
        markIdentityDuplicate(
          candidate,
          `来源单号「${shortRef(candidate.sourceRef)}」已被一笔已删除的交易占用，无法再次导入。`,
        );
      } else {
        markIdentityDuplicate(
          candidate,
          `来源单号「${shortRef(candidate.sourceRef)}」已存在（交易 #${existing.seq}，${isoDate(existing.occurredLocalDate)}），这一笔会被跳过。`,
        );
      }
    }
  }

  // 2b) Libevra 导出把交易 id 写进「流水编号」，适配器会把它复用为候选 id。
  // 旧 /import 靠 id 命中跳过已入账行；这里同样把这类候选标成身份重复。
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.id))];
  if (input.checkCandidateIds === true && candidateIds.length > 0) {
    for (let index = 0; index < candidateIds.length; index += REF_CHUNK_SIZE) {
      const chunk = candidateIds.slice(index, index + REF_CHUNK_SIZE);
      const existingById = await input.prisma.transaction.findMany({
        where: { bookId: input.bookId, id: { in: chunk } },
        select: { id: true, seq: true, occurredLocalDate: true, deletedAt: true },
      });
      const byId = new Map(existingById.map((row) => [row.id, row]));
      for (const candidate of candidates) {
        const existing = byId.get(candidate.id);
        if (existing === undefined || candidate.identityDuplicate) continue;
        markIdentityDuplicate(
          candidate,
          `流水编号对应的交易 #${existing.seq}（${isoDate(existing.occurredLocalDate)}）已在本账本中，这一笔会被跳过。`,
        );
      }
    }
  }

  // 3) 内容重复：只对将要导入（已勾选、方向明确）的候选做，避免给排除行刷噪音。
  if (input.settings.enabled) {
    const compared = candidates.filter(
      (candidate) =>
        candidate.selected &&
        !candidate.identityDuplicate &&
        candidate.kind !== "unknown" &&
        candidate.date.length === 10,
    );

    const amounts = new Map<string, number>();
    for (const candidate of compared) {
      try {
        const amountCents = parseAmountToMinor(candidate.amount, decimalsFor(candidate.currency));
        if (Number.isSafeInteger(amountCents)) amounts.set(candidate.id, amountCents);
      } catch {
        // 金额读不出的候选在提交阶段会报错，这里不参与内容判重。
      }
    }
    const comparable = compared.filter((candidate) => amounts.has(candidate.id));

    if (comparable.length > 0) {
      const dates = comparable.map((candidate) => candidate.date).sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      if (first !== undefined && last !== undefined) {
        const windowDays = Math.ceil(input.settings.timeWindowSeconds / 86_400) + 1;
        const currencies = [...new Set(comparable.map((candidate) => candidate.currency))];
        const existing = await input.prisma.transaction.findMany({
          where: {
            bookId: input.bookId,
            deletedAt: null,
            kind: { in: ["expense", "income"] },
            currency: { in: currencies },
            occurredLocalDate: {
              gte: new Date(`${shiftIsoDate(first, -windowDays)}T00:00:00.000Z`),
              lte: new Date(`${shiftIsoDate(last, windowDays)}T00:00:00.000Z`),
            },
          },
          select: {
            id: true,
            seq: true,
            kind: true,
            amountCents: true,
            currency: true,
            occurredAt: true,
            occurredLocalDate: true,
            categoryId: true,
            paymentMethodId: true,
            deletedAt: true,
          },
          take: MAX_EXISTING_SCAN,
        });
        if (existing.length === MAX_EXISTING_SCAN) {
          warnings.push(
            `时间范围内账本交易超过 ${MAX_EXISTING_SCAN} 笔，重复检测只比对了其中一部分。`,
          );
        }

        const fields: DuplicateCandidateFields[] = [];
        for (const candidate of comparable) {
          const amountCents = amounts.get(candidate.id);
          if (amountCents === undefined) continue;
          let occurredAt: string | null = null;
          if (candidate.timePrecision !== "day" && candidate.time !== null) {
            try {
              occurredAt = dateTimeToInstant(
                candidate.date,
                candidate.time,
                candidate.timezone === "" ? input.timezone : candidate.timezone,
              );
            } catch {
              occurredAt = null;
            }
          }
          fields.push({
            id: candidate.id,
            bookId: input.bookId,
            kind: candidate.kind === "income" ? "income" : "expense",
            amountCents,
            currency: candidate.currency,
            occurredAt,
            ...(candidate.timePrecision === "day"
              ? {}
              : { occurredAtPrecision: candidate.timePrecision }),
            occurredLocalDate: candidate.date,
            categoryId: candidate.categoryId,
            paymentMethodId: candidate.paymentMethodId,
          });
        }
        for (const row of existing) {
          fields.push({
            id: row.id,
            bookId: input.bookId,
            kind: row.kind,
            amountCents: Number(row.amountCents),
            currency: row.currency,
            occurredAt: row.occurredAt.toISOString(),
            occurredAtPrecision: "second",
            occurredLocalDate: isoDate(row.occurredLocalDate),
            categoryId: row.categoryId,
            paymentMethodId: row.paymentMethodId,
          });
        }

        const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const existingById = new Map(existing.map((row) => [row.id, row]));
        const batch = evaluateDuplicateCandidates(fields, input.settings);
        for (const pair of batch.pairs) {
          if (!pair.matched || pair.suppressed) continue;
          const left = byId.get(pair.leftId);
          const right = byId.get(pair.rightId);
          if (left !== undefined && right !== undefined) {
            addDuplicate(left, right.id, `与文件内第 ${right.line} 行疑似重复，请核对。`);
            addDuplicate(right, left.id, `与文件内第 ${left.line} 行疑似重复，请核对。`);
            continue;
          }
          if (left !== undefined || right !== undefined) {
            const candidate = left ?? right;
            const existingRow = existingById.get(left !== undefined ? pair.rightId : pair.leftId);
            if (candidate !== undefined && existingRow !== undefined) {
              addDuplicate(
                candidate,
                existingRow.id,
                `与账本已有交易 #${existingRow.seq}（${isoDate(existingRow.occurredLocalDate)} ${formatAmountText(Number(existingRow.amountCents), existingRow.currency)} ${existingRow.currency}）疑似重复，请核对。`,
              );
            }
          }
        }
      }
    }
  }

  const identityCount = candidates.filter((candidate) => candidate.identityDuplicate).length;
  if (identityCount > 0) {
    warnings.push(`有 ${identityCount} 笔交易的来源单号已存在，导入时会跳过，不会重复写入。`);
  }
  const duplicateCount = candidates.filter((candidate) => candidate.duplicateIds.length > 0).length;
  if (duplicateCount > 0) {
    warnings.push(
      `有 ${duplicateCount} 笔交易与账本已有记录或文件内其他行疑似重复，已标出但没有取消勾选。`,
    );
  }

  return { candidates, warnings };
}
