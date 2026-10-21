import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  duplicateCandidatesRequestSchema,
  duplicateImportReviewRequestSchema,
  duplicateReviewRequestSchema,
  duplicatePairKey,
  evaluateDuplicatePair,
  type DuplicateCandidateFields,
  type DuplicateCandidatesResponse,
  type DuplicateDetectionSettings,
  type DuplicateImportReviewResponse,
  type DuplicatePairResult,
  type DuplicateReviewChunk,
  type Transaction,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../db.js";
import { loadRelationTransactions, relationView } from "../ledger/notDuplicateRelations.js";
import { badRequest } from "../lib/errors.js";

/**
 * 每次请求最多返回的配对数量。
 *
 * ⚠️ **上限是“结果不完整”的显式信号，不是静默截断**：`truncated: true` 会一路传到界面，
 * 由界面写“还有更多没有显示”。一个看起来完整、实际少了一半的重复清单，比明说上限危险得多。
 */
const MAX_PAIRS_PER_REQUEST = 500;

/** 单笔候选最多取多少条历史参与比对。 */
const MAX_HISTORY_ROWS = 500;

/** 全账本审查每页处理多少笔（每笔一次候选查询）。 */
const REVIEW_CHUNK_SIZE = 50;

export function candidateFromTransaction(entry: Transaction, bookId: string): DuplicateCandidateFields {
  return {
    id: entry.id,
    bookId,
    kind: entry.kind,
    amountCents: entry.amountCents,
    currency: entry.currency,
    occurredAt: entry.occurredAt,
    occurredLocalDate: entry.occurredLocalDate,
    categoryId: entry.categoryId,
    paymentMethodId: entry.paymentMethodId,
    note: entry.note,
    tagIds: entry.tags.map((tag) => tag.id),
  };
}

/**
 * 服务端按需粗筛：只把**启用规则**等值的行取出来，再交给统一核心逐对判断。
 *
 * ⚠️ **这不是第二套规则。** 粗筛只用“开启后必然相等”的字段（同账本、方向、金额、币种、
 * 时间窗口/日期），任何“缺失不排除”“关闭即不比较”的语义都留给 `evaluateDuplicatePair`。
 * 粗筛宽一点只会多做几次纯函数比较，窄一点就会漏掉真实重复——所以宁可宽。
 */
export function duplicateWhere(bookId: string, candidate: DuplicateCandidateFields, settings: DuplicateDetectionSettings) {
  const instant = candidate.occurredAtPrecision !== "day" && candidate.occurredAt !== null
    ? Date.parse(candidate.occurredAt)
    : Number.NaN;
  const currency = candidate.currency === null ? null : candidate.currency.trim().toUpperCase();
  return {
    bookId,
    deletedAt: null,
    ...(settings.matchKind !== false && (candidate.kind === "income" || candidate.kind === "expense") ? { kind: candidate.kind } : {}),
    ...(settings.matchAmount !== false && candidate.amountCents !== null ? { amountCents: BigInt(candidate.amountCents) } : {}),
    ...(settings.matchCurrency !== false && currency !== null && currency !== "" ? { currency } : {}),
    ...(settings.matchTime !== false
      ? Number.isFinite(instant)
        ? { occurredAt: { gte: new Date(instant - settings.timeWindowSeconds * 1000), lte: new Date(instant + settings.timeWindowSeconds * 1000) } }
        : candidate.occurredLocalDate !== null
          ? { occurredLocalDate: new Date(`${candidate.occurredLocalDate}T00:00:00Z`) }
          : {}
      : {}),
  };
}

/**
 * 去掉用户已经确认“不是同一笔”的配对（S15-E3 的关系记忆）。
 *
 * 关系是**服务器权威**的，所以抑制只能在这里做：前端的本地回退没有关系数据，
 * 它的结果永远只是“本机已知数据”的参考（见 `scope`）。
 */
export async function suppressConfirmed(
  prisma: PrismaClient,
  bookId: string,
  pairs: readonly DuplicatePairResult[],
): Promise<DuplicatePairResult[]> {
  if (pairs.length === 0) return [];
  const ids = [...new Set(pairs.flatMap((pair) => [pair.leftId, pair.rightId]))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return [...pairs];
  const relations = await prisma.transactionNotDuplicateRelation.findMany({
    where: { bookId, revokedAt: null, transactionAId: { in: ids }, transactionBId: { in: ids } },
  });
  if (relations.length === 0) return [...pairs];
  const transactions = await loadRelationTransactions(prisma, bookId, ids);
  const ignored = new Set(
    relations
      .filter((relation) => relationView(relation, { transactions }).effective)
      .map((relation) => duplicatePairKey(relation.transactionAId, relation.transactionBId)),
  );
  return pairs.filter((pair) => !ignored.has(pair.pairKey));
}

export function registerDuplicateReviewRoutes<Row>(app: FastifyInstance, options: {
  prisma: PrismaClient;
  requireRead: (request: FastifyRequest) => Promise<void>;
  include: {
    category: { select: { id: true; name: true; isSystem: true } };
    paymentMethod: { select: { id: true; name: true } };
    tags: { include: { tag: { select: { id: true; name: true; color: true } } } };
  };
  toDto: (row: Row) => Transaction;
}) {
  const { prisma, requireRead, include, toDto } = options;
  const dto = (row: unknown) => toDto(row as Row);

  /**
   * 新增检查：**只回答“这批新增”与“历史”之间、以及“这批新增”彼此之间的关系。**
   *
   * ⚠️ **不重扫全账本。** 每笔候选只做一次有界查询（`duplicateWhere` 粗筛 + 上限），
   * 复杂度是 O(本批条数 × 命中行数)，而不是 O(账本大小²)。全账本扫描是另一个入口
   * （`/duplicates/review`），由用户主动发起、可分块取消。
   */
  app.post("/api/v1/transactions/duplicates/candidates", { preHandler: requireRead }, async (request) => {
    const body = duplicateCandidatesRequestSchema.parse(request.body);
    const bookId = request.book!.bookId;
    if (body.candidates.some((candidate) => candidate.bookId !== bookId)) {
      throw badRequest("book_mismatch", "候选记录不属于当前账本。");
    }
    const settings = body.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;
    const empty: DuplicateCandidatesResponse = { pairs: [], history: [], truncated: false };
    if (!settings.enabled) return empty;

    const history = new Map<string, Transaction>();
    const pairs = new Map<string, DuplicatePairResult>();
    let truncated = false;

    const addPair = (result: DuplicatePairResult) => {
      if (pairs.size >= MAX_PAIRS_PER_REQUEST) {
        truncated = true;
        return;
      }
      pairs.set(result.pairKey, result);
    };

    for (let i = 0; i < body.candidates.length; i += 1) {
      const candidate = body.candidates[i]!;
      // 本批新增彼此之间：同一批里的两笔也可能是同一笔（OCR 一页两行、导入重叠）。
      for (let j = i + 1; j < body.candidates.length; j += 1) {
        const other = body.candidates[j]!;
        if (other.id === candidate.id) continue;
        const result = evaluateDuplicatePair(candidate, other, settings);
        if (result.matched) addPair(result);
      }

      const rows = await prisma.transaction.findMany({
        where: duplicateWhere(bookId, candidate, settings),
        include,
        orderBy: { seq: "asc" },
        take: MAX_HISTORY_ROWS + 1,
      });
      if (rows.length > MAX_HISTORY_ROWS) truncated = true;
      for (const row of rows.slice(0, MAX_HISTORY_ROWS)) {
        const entry = dto(row);
        if (entry.id === candidate.id) continue;
        const result = evaluateDuplicatePair(candidate, candidateFromTransaction(entry, bookId), settings);
        if (!result.matched) continue;
        addPair(result);
        history.set(entry.id, entry);
      }
    }

    return {
      pairs: await suppressConfirmed(prisma, bookId, [...pairs.values()]),
      history: [...history.values()],
      truncated,
    } satisfies DuplicateCandidatesResponse;
  });

  /**
   * 全账本主动检查的一页：按 `seq` 游标分块，每块只把块内每笔与**块内之后的记录**比较。
   *
   * ⚠️ **每对只比一次**（`seq > 当前行`），所以分块不会重复劳动，也不会漏掉跨块的配对；
   * ⚠️ **`throughSeq` 由客户端回传**，服务端不重新取“最大 seq”，这样审查期间新增的账目
   * 不会让进度条倒退，也不会让用户永远扫不完。
   */
  app.post("/api/v1/transactions/duplicates/review", { preHandler: requireRead }, async (request) => {
    const body = duplicateReviewRequestSchema.parse(request.body);
    const bookId = request.book!.bookId;
    const settings = body.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;
    const empty: DuplicateReviewChunk = {
      pairs: [], entries: [], total: 0, processed: 0, nextSeq: null, throughSeq: 0, truncated: false,
    };
    if (!settings.enabled) return empty;

    const maximum = body.throughSeq
      ?? (await prisma.transaction.aggregate({ where: { bookId }, _max: { seq: true } }))._max.seq
      ?? 0;
    const total = await prisma.transaction.count({ where: { bookId, deletedAt: null, seq: { lte: maximum } } });
    if (body.afterSeq >= maximum) return { ...empty, total, throughSeq: maximum };

    const rows = await prisma.transaction.findMany({
      where: { bookId, deletedAt: null, seq: { gt: body.afterSeq, lte: maximum } },
      include,
      orderBy: { seq: "asc" },
      take: REVIEW_CHUNK_SIZE + 1,
    });
    const chunk = rows.slice(0, REVIEW_CHUNK_SIZE);

    const entries = new Map<string, Transaction>();
    const pairs: DuplicatePairResult[] = [];
    let truncated = false;

    for (const row of chunk) {
      const entry = dto(row);
      const candidate = candidateFromTransaction(entry, bookId);
      const others = await prisma.transaction.findMany({
        where: { ...duplicateWhere(bookId, candidate, settings), seq: { gt: row.seq, lte: maximum } },
        include,
        orderBy: { seq: "asc" },
        take: MAX_HISTORY_ROWS + 1,
      });
      if (others.length > MAX_HISTORY_ROWS) truncated = true;
      for (const other of others.slice(0, MAX_HISTORY_ROWS)) {
        const match = dto(other);
        const result = evaluateDuplicatePair(candidate, candidateFromTransaction(match, bookId), settings);
        if (!result.matched) continue;
        pairs.push(result);
        entries.set(entry.id, entry);
        entries.set(match.id, match);
        if (pairs.length >= MAX_PAIRS_PER_REQUEST) {
          truncated = true;
          break;
        }
      }
      if (pairs.length >= MAX_PAIRS_PER_REQUEST) break;
    }

    const visible = await suppressConfirmed(prisma, bookId, pairs);
    const last = chunk[chunk.length - 1];
    return {
      pairs: visible,
      entries: [...entries.values()],
      total,
      processed: chunk.length,
      nextSeq: last === undefined ? null : last.seq,
      throughSeq: maximum,
      truncated,
    } satisfies DuplicateReviewChunk;
  });

  /**
   * 批量导入之后的检查：**这一批**与历史之间、以及这一批彼此之间。
   *
   * 为什么用导入编号点名而不是让浏览器把文件再解析一遍：CSV 导入是服务端整批写入的，
   * 浏览器手里没有行数据；重新解析会出现第二套解析口径，字段归一化稍有差别就会
   * 让“同一行”在两边算成不同金额。导入编号写在这批每一笔上（`importRef`），
   * 用它取这批，判定仍然只有一份规则。
   *
   * 有界：这批最多取 `MAX_HISTORY_ROWS` 条，每条候选只做一次带上限的粗筛查询。
   */
  app.post(
    "/api/v1/transactions/duplicates/import-review",
    { preHandler: requireRead },
    async (request) => {
      const body = duplicateImportReviewRequestSchema.parse(request.body);
      const bookId = request.book!.bookId;
      const settings = body.settings ?? DEFAULT_DUPLICATE_DETECTION_SETTINGS;
      const empty: DuplicateImportReviewResponse = { pairs: [], entries: [], checked: 0, truncated: false };
      if (!settings.enabled) return empty;

      const batch = await prisma.transaction.findMany({
        where: { bookId, deletedAt: null, importRef: body.importRef },
        include,
        orderBy: { seq: "asc" },
        take: MAX_HISTORY_ROWS + 1,
      });
      let truncated = batch.length > MAX_HISTORY_ROWS;
      const rows = batch.slice(0, MAX_HISTORY_ROWS);
      const checked = rows.length;
      if (checked === 0) return empty;

      const entries = new Map<string, Transaction>();
      const pairs = new Map<string, DuplicatePairResult>();
      const addPair = (result: DuplicatePairResult) => {
        if (pairs.size >= MAX_PAIRS_PER_REQUEST) {
          truncated = true;
          return;
        }
        pairs.set(result.pairKey, result);
      };

      for (let index = 0; index < rows.length; index += 1) {
        const entry = dto(rows[index]!);
        entries.set(entry.id, entry);
        const candidate = candidateFromTransaction(entry, bookId);

        // 这一批彼此之间：一个文件里同一笔出现两行，是真实存在的重复来源。
        for (let next = index + 1; next < rows.length; next += 1) {
          const other = dto(rows[next]!);
          const result = evaluateDuplicatePair(candidate, candidateFromTransaction(other, bookId), settings);
          if (!result.matched) continue;
          addPair(result);
          entries.set(other.id, other);
        }

        const others = await prisma.transaction.findMany({
          where: duplicateWhere(bookId, candidate, settings),
          include,
          orderBy: { seq: "asc" },
          take: MAX_HISTORY_ROWS + 1,
        });
        if (others.length > MAX_HISTORY_ROWS) truncated = true;
        for (const row of others.slice(0, MAX_HISTORY_ROWS)) {
          const match = dto(row);
          if (match.id === entry.id) continue;
          const result = evaluateDuplicatePair(candidate, candidateFromTransaction(match, bookId), settings);
          if (!result.matched) continue;
          addPair(result);
          entries.set(match.id, match);
        }
      }

      return {
        pairs: await suppressConfirmed(prisma, bookId, [...pairs.values()]),
        entries: [...entries.values()],
        checked,
        truncated,
      } satisfies DuplicateImportReviewResponse;
    },
  );
}
