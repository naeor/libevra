import { createHash, randomUUID } from "node:crypto";

import {
  fingerprintGuestSource,
  fingerprintImportSourceRecord,
  fingerprintTargetSnapshot,
  formalImportPreviewRequestSchema,
  formalImportPreviewResponseSchema,
  incrementalPreviewRequestSchema,
  incrementalPreviewResponseSchema,
  guestCleanupPreviewRequestSchema,
  guestCleanupPreviewResponseSchema,
  formalSourceDispositionSchema,
  ledgerImportRequestSchema,
  ledgerImportResultSchema,
  type GuestImportSource,
  type ImportTargetSnapshot,
  type LedgerImportResult,
  type TaxonomyResolution,
} from "@libellum/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { PrismaClient } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { createDefaultLedger } from "../ledger/bootstrap.js";
import { recordEvent } from "../ledger/events.js";
import {
  loadFormalImportPair,
  loadFormalImportPreview,
  lockFormalImportPair,
} from "../ledger/importSolo.js";
import { loadExistingImportTarget, loadTargetSnapshot } from "../ledger/importTarget.js";
import { analyzeIncremental, sourceNamespaceOf } from "../ledger/importIncremental.js";
import { writeSourceState } from "../ledger/importIncremental.js";
import { previewGuestCleanup } from "../ledger/importCleanup.js";
import { getFormalSourceDispositionByReceipt } from "../ledger/importCleanup.js";
import { allocateTransactionSeq } from "../ledger/transactionSeq.js";
import { badRequest, conflict, forbidden } from "../lib/errors.js";

type Client = Prisma.TransactionClient;

interface LedgerImportRouteOptions {
  readonly prisma: PrismaClient;
  readonly requireAuth: (request: FastifyRequest) => Promise<void>;
  /** Test-only compatibility; absent in production. */
  readonly allowLegacyDirectImport?: boolean;
}

export interface ResolvedTaxonomy {
  readonly categoryIds: ReadonlyMap<string, string>;
  readonly paymentMethodIds: ReadonlyMap<string, string>;
  readonly tagIds: ReadonlyMap<string, string>;
  readonly created: {
    readonly categories: number;
    readonly paymentMethods: number;
    readonly tags: number;
  };
  /** D5 phase 4: ids created by this job, needed for exact undo. */
  readonly createdIds: {
    readonly categories: readonly string[];
    readonly paymentMethods: readonly string[];
    readonly tags: readonly string[];
  };
  readonly reused: {
    readonly categories: number;
    readonly paymentMethods: number;
    readonly tags: number;
  };
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function importRefFor(importId: string): string {
  const digest = createHash("sha256").update(importId).digest("hex");
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 19).replaceAll(":", "");
  return `In-${date}-${time}-${digest.slice(0, 4)}`;
}

function uniqueCreateName(base: string, reserved: Set<string>): string {
  const clean = base.trim() === "" ? "未命名" : base.trim();
  let candidate = clean.slice(0, 20);
  let index = 2;
  while (reserved.has(normalizeName(candidate))) {
    const suffix = `（${String(index)}）`;
    candidate = `${clean.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`;
    index += 1;
  }
  reserved.add(normalizeName(candidate));
  return candidate;
}

function resolutionKey(type: TaxonomyResolution["type"], sourceId: string): string {
  return `${type}:${sourceId}`;
}

export function assertSourceIsSelfConsistent(source: GuestImportSource): void {
  const categoryIds = new Set(source.categories.map((item) => item.id));
  const paymentIds = new Set(source.paymentMethods.map((item) => item.id));
  const tagIds = new Set(source.tags.map((item) => item.id));

  if (categoryIds.size !== source.categories.length) throw badRequest("source_duplicate_id", "来源分类 id 重复。");
  if (paymentIds.size !== source.paymentMethods.length) throw badRequest("source_duplicate_id", "来源支付方式 id 重复。");
  if (tagIds.size !== source.tags.length) throw badRequest("source_duplicate_id", "来源标签 id 重复。");

  for (const transaction of source.transactions) {
    if (!categoryIds.has(transaction.categoryId)) {
      throw badRequest("source_category_missing", "来源账目引用了不存在的分类。");
    }
    if (transaction.paymentMethodId !== null && !paymentIds.has(transaction.paymentMethodId)) {
      throw badRequest("source_payment_missing", "来源账目引用了不存在的支付方式。");
    }
    for (const tagId of transaction.tagIds) {
      if (!tagIds.has(tagId)) throw badRequest("source_tag_missing", "来源账目引用了不存在的标签。");
    }
    if (Number.isNaN(Date.parse(transaction.occurredAt))) {
      throw badRequest("source_date_invalid", "来源账目时间格式无效。");
    }
    if (Number.isNaN(Date.parse(`${transaction.occurredLocalDate}T00:00:00.000Z`))) {
      throw badRequest("source_date_invalid", "来源账目日期格式无效。");
    }
  }
}

export function assertTaxonomyCoverage(source: GuestImportSource, resolutions: readonly TaxonomyResolution[]): void {
  const expected = new Set<string>([
    ...source.categories.map((item) => resolutionKey("category", item.id)),
    ...source.paymentMethods.map((item) => resolutionKey("paymentMethod", item.id)),
    ...source.tags.map((item) => resolutionKey("tag", item.id)),
  ]);
  const actual = new Set<string>();
  for (const resolution of resolutions) {
    const key = resolutionKey(resolution.type, resolution.sourceId);
    if (actual.has(key)) throw badRequest("taxonomy_duplicate", "同一来源对象只能有一个映射决定。");
    if (!expected.has(key)) throw badRequest("taxonomy_unknown", "映射决定引用了不存在的来源对象。");
    actual.add(key);
  }
  if (actual.size !== expected.size) throw badRequest("taxonomy_missing", "还有来源对象没有处理映射。");
}

function findResolution(
  resolutions: ReadonlyMap<string, TaxonomyResolution>,
  type: TaxonomyResolution["type"],
  sourceId: string,
): TaxonomyResolution {
  const resolution = resolutions.get(resolutionKey(type, sourceId));
  if (resolution === undefined) throw badRequest("taxonomy_missing", "还有来源对象没有处理映射。");
  return resolution;
}

/**
 * Resolve the client's mapping choices against the target book. D2 never modifies or deletes an
 * existing target object: `reuse` only points at it; `create` always adds a new object with the
 * source's archived state/description/colour.
 *
 * For a brand-new target, `auto` matches by kind/name against the freshly created presets and
 * creates the rest. Existing targets must not use `auto` — the browser preview has already shown
 * the user a concrete target object, and silently re-deciding on the server would hide a change.
 */
export async function resolveTaxonomy(
  tx: Client,
  targetBookId: string,
  source: GuestImportSource,
  target: ImportTargetSnapshot,
  resolutions: readonly TaxonomyResolution[],
  targetIsNew: boolean,
): Promise<ResolvedTaxonomy> {
  const byKey = new Map(resolutions.map((item) => [resolutionKey(item.type, item.sourceId), item]));
  const categoryIds = new Map<string, string>();
  const paymentMethodIds = new Map<string, string>();
  const tagIds = new Map<string, string>();
  const created = { categories: 0, paymentMethods: 0, tags: 0 };
  const createdIds = { categories: [] as string[], paymentMethods: [] as string[], tags: [] as string[] };
  const reused = { categories: 0, paymentMethods: 0, tags: 0 };

  const categories = new Map(target.categories.map((item) => [item.id, item]));
  const categoryByName = new Map(
    target.categories.map((item) => [`${item.kind}\u0000${normalizeName(item.name)}`, item]),
  );
  const categoryNames = new Set(target.categories.map((item) => normalizeName(item.name)));
  const paymentById = new Map(target.paymentMethods.map((item) => [item.id, item]));
  const paymentByName = new Map(target.paymentMethods.map((item) => [normalizeName(item.name), item]));
  const paymentNames = new Set(target.paymentMethods.map((item) => normalizeName(item.name)));
  const tagById = new Map(target.tags.map((item) => [item.id, item]));
  const tagByName = new Map(target.tags.map((item) => [normalizeName(item.name), item]));
  const tagNames = new Set(target.tags.map((item) => normalizeName(item.name)));

  let nextCategoryOrder = Math.max(0, ...target.categories.map((item) => item.sortOrder)) + 1;
  let nextPaymentOrder = Math.max(0, ...target.paymentMethods.map((item) => item.sortOrder)) + 1;

  for (const category of source.categories) {
    const decision = findResolution(byKey, "category", category.id);
    if (!targetIsNew && decision.action === "auto") {
      throw badRequest("taxonomy_auto_invalid", "已有目标账本不能使用自动映射。");
    }
    if (decision.action === "reuse") {
      const existing =
        decision.targetId === undefined ? undefined : categories.get(decision.targetId);
      if (existing === undefined || existing.kind !== category.kind) {
        throw badRequest("taxonomy_target_missing", "目标分类不存在或类型不匹配，请重新预览。");
      }
      categoryIds.set(category.id, existing.id);
      reused.categories += 1;
      continue;
    }
    if (targetIsNew) {
      const match = category.isSystem
        ? target.categories.find((item) => item.kind === category.kind && item.isSystem)
        : categoryByName.get(`${category.kind}\u0000${normalizeName(category.name)}`);
      if (match !== undefined) {
        categoryIds.set(category.id, match.id);
        reused.categories += 1;
        continue;
      }
    }

    const name = targetIsNew
      ? uniqueCreateName(category.name, categoryNames)
      : decision.createName ?? category.name;
    if (category.isSystem) throw badRequest("taxonomy_system_create", "系统分类不能新建。");
    if (!targetIsNew && categoryNames.has(normalizeName(name))) {
      throw conflict("taxonomy_name_conflict", "目标分类名称已经被占用，请重新预览。");
    }
    const createdCategory = await tx.category.create({
      data: {
        id: randomUUID(),
        bookId: targetBookId,
        name,
        kind: category.kind,
        description: category.description ?? null,
        sortOrder: targetIsNew ? nextCategoryOrder : nextCategoryOrder,
        isArchived: category.isArchived,
        isSystem: false,
      },
      select: { id: true },
    });
    nextCategoryOrder += 1;
    categoryNames.add(normalizeName(name));
    categories.set(createdCategory.id, {
      id: createdCategory.id,
      name,
      kind: category.kind,
      description: category.description ?? null,
      sortOrder: nextCategoryOrder - 1,
      isArchived: category.isArchived,
      isSystem: false,
    });
    categoryByName.set(`${category.kind}\u0000${normalizeName(name)}`, categories.get(createdCategory.id)!);
    categoryIds.set(category.id, createdCategory.id);
    created.categories += 1;
    createdIds.categories.push(createdCategory.id);
  }

  for (const payment of source.paymentMethods) {
    const decision = findResolution(byKey, "paymentMethod", payment.id);
    if (!targetIsNew && decision.action === "auto") {
      throw badRequest("taxonomy_auto_invalid", "已有目标账本不能使用自动映射。");
    }
    if (decision.action === "reuse") {
      const existing = decision.targetId === undefined ? undefined : paymentById.get(decision.targetId);
      if (existing === undefined) throw badRequest("taxonomy_target_missing", "目标支付方式不存在，请重新预览。");
      paymentMethodIds.set(payment.id, existing.id);
      reused.paymentMethods += 1;
      continue;
    }
    if (targetIsNew) {
      const match = paymentByName.get(normalizeName(payment.name));
      if (match !== undefined) {
        paymentMethodIds.set(payment.id, match.id);
        reused.paymentMethods += 1;
        continue;
      }
    }

    const name = targetIsNew
      ? uniqueCreateName(payment.name, paymentNames)
      : decision.createName ?? payment.name;
    if (!targetIsNew && paymentNames.has(normalizeName(name))) {
      throw conflict("taxonomy_name_conflict", "目标支付方式名称已经被占用，请重新预览。");
    }
    const createdPayment = await tx.paymentMethod.create({
      data: {
        id: randomUUID(),
        bookId: targetBookId,
        name,
        sortOrder: nextPaymentOrder,
        isArchived: payment.isArchived,
      },
      select: { id: true },
    });
    nextPaymentOrder += 1;
    paymentNames.add(normalizeName(name));
    paymentMethodIds.set(payment.id, createdPayment.id);
    created.paymentMethods += 1;
    createdIds.paymentMethods.push(createdPayment.id);
  }

  for (const tag of source.tags) {
    const decision = findResolution(byKey, "tag", tag.id);
    if (!targetIsNew && decision.action === "auto") {
      throw badRequest("taxonomy_auto_invalid", "已有目标账本不能使用自动映射。");
    }
    if (decision.action === "reuse") {
      const existing = decision.targetId === undefined ? undefined : tagById.get(decision.targetId);
      if (existing === undefined) throw badRequest("taxonomy_target_missing", "目标标签不存在，请重新预览。");
      tagIds.set(tag.id, existing.id);
      reused.tags += 1;
      continue;
    }
    if (targetIsNew) {
      const match = tagByName.get(normalizeName(tag.name));
      if (match !== undefined) {
        tagIds.set(tag.id, match.id);
        reused.tags += 1;
        continue;
      }
    }

    const name = targetIsNew
      ? uniqueCreateName(tag.name, tagNames)
      : decision.createName ?? tag.name;
    if (!targetIsNew && tagNames.has(normalizeName(name))) {
      throw conflict("taxonomy_name_conflict", "目标标签名称已经被占用，请重新预览。");
    }
    const createdTag = await tx.tag.create({
      data: { id: randomUUID(), bookId: targetBookId, name, color: tag.color },
      select: { id: true },
    });
    tagNames.add(normalizeName(name));
    tagIds.set(tag.id, createdTag.id);
    created.tags += 1;
    createdIds.tags.push(createdTag.id);
  }

  return { categoryIds, paymentMethodIds, tagIds, created, createdIds, reused };
}

export function buildTotals(rows: readonly { kind: "expense" | "income"; amountCents: number; currency: string }[]): LedgerImportResult["totals"] {
  const map = new Map<string, { expenseCents: number; incomeCents: number; count: number }>();
  for (const row of rows) {
    const current = map.get(row.currency) ?? { expenseCents: 0, incomeCents: 0, count: 0 };
    if (row.kind === "expense") current.expenseCents += row.amountCents;
    else current.incomeCents += row.amountCents;
    current.count += 1;
    map.set(row.currency, current);
  }
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([currency, value]) => ({ currency, ...value }));
}

/**
 * 并发提交同一个 importId 时，短暂等待对方事务提交并返回已写好的回执。
 * 没有回执（或回执属于别人）时返回 null，由调用方按原错误处理。
 */
async function replayCommittedReceipt(
  prisma: PrismaClient,
  userId: string,
  receiptId: string,
): Promise<LedgerImportResult | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const existing = await prisma.ledgerImport.findUnique({ where: { id: receiptId } });
    if (existing !== null && existing.userId === userId) {
      return ledgerImportResultSchema.parse(existing.result);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function executeImport(
  prisma: PrismaClient,
  userId: string,
  actorName: string | null,
  body: ReturnType<typeof ledgerImportRequestSchema.parse>,
): Promise<LedgerImportResult> {
  const targetIsNew = body.target.kind === "new";
  const receiptId = body.importId;
  const sourceBookId = body.sourceBookId;
  const expectedTargetFingerprint =
    body.target.kind === "existing" ? body.target.expectedTargetFingerprint : "";
  let effectiveSource: GuestImportSource;
  let sourceFingerprint: string;
  let initialTargetSnapshot: ImportTargetSnapshot | null = null;

  if (sourceBookId !== undefined) {
    /**
     * D4：正式来源。服务端自己读取 B 和目标 A，浏览器只提供 id 与预期指纹。
     * 预览后 B/A 任一发生变化都拒绝；真正的并发资格复查在下面的事务里。
     */
    if (body.target.kind !== "existing") {
      throw badRequest("formal_source_target_required", "正式账本来源只能导入现有正式账本。");
    }
    const pair = await loadFormalImportPair(prisma, userId, sourceBookId, body.target.bookId);
    if (pair.sourceFingerprint !== body.sourceFingerprint) {
      throw conflict("source_changed", "来源账本在预览后发生了变化，请重新预览并确认。");
    }
    if (pair.targetFingerprint !== expectedTargetFingerprint) {
      throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
    }
    effectiveSource = pair.source;
    sourceFingerprint = pair.sourceFingerprint;
    initialTargetSnapshot = pair.target;
  } else {
    if (body.source === undefined) {
      throw badRequest("source_required", "缺少来源账本或游客快照。");
    }
    assertSourceIsSelfConsistent(body.source);
    effectiveSource = body.source;
    sourceFingerprint = await fingerprintGuestSource(body.source);
    if (sourceFingerprint !== body.sourceFingerprint) {
      throw conflict("source_changed", "游客账本在预览后发生了变化，请重新预览并确认。");
    }

    // Existing-target preliminary validation: the fingerprint is checked again inside the
    // transaction, so a change between these two reads is still caught.
    if (body.target.kind === "existing") {
      const initialTarget = await loadExistingImportTarget(prisma, userId, body.target.bookId);
      const targetFingerprint = await fingerprintTargetSnapshot(initialTarget.snapshot);
      if (targetFingerprint !== body.target.expectedTargetFingerprint) {
        throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
      }
      initialTargetSnapshot = initialTarget.snapshot;
    }
  }

  assertTaxonomyCoverage(effectiveSource, body.taxonomy);
  const guestBookId = body.source?.guestBookId ?? null;
  const sourceNamespace = sourceNamespaceOf(sourceBookId ?? null, guestBookId);
  const plan = buildDecisionPlan(body, effectiveSource, initialTargetSnapshot, targetIsNew);

  const skippedIds = plan.skippedSourceIds;
  const removedTargetIds = plan.removedTargetIds;

  const importSource = effectiveSource.transactions
    .filter((item) => !skippedIds.has(item.id))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id));
  const sourceCategoryById = new Map(effectiveSource.categories.map((item) => [item.id, item]));
  const sourcePaymentById = new Map(effectiveSource.paymentMethods.map((item) => [item.id, item]));
  const importRef = importRefFor(receiptId);
  const expectedTotals = buildTotals(importSource);

  try {
    const result = await prisma.$transaction(async (tx) => {
      /**
       * 同一个 importId 的并发提交必须串行化（双击、超时重试、两个标签页同时确认）。
       * 只靠 catch 里的短轮询不够：慢事务一旦超过轮询窗口，先失败的一方就会错误地
       * 返回 409（S14-D D4 并发用例曾在全量测试里偶发 409）。这里用事务级 advisory
       * lock 按 importId 排队；拿到锁后先复查回执，已有回执直接按幂等重放返回。
       * 锁的获取顺序固定为「先 importId、后成员/账本行」，不会与其它事务形成环。
       */
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-import:${receiptId}`}))::text`;
      const replay = await tx.ledgerImport.findUnique({ where: { id: receiptId } });
      if (replay !== null) {
        if (replay.userId !== userId) {
          throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
        }
        return ledgerImportResultSchema.parse(replay.result);
      }

      const targetBookId = targetIsNew
        ? await createDefaultLedger(tx, userId, body.target.kind === "new" ? body.target.name : "")
        : body.target.kind === "existing"
          ? body.target.bookId
          : "";
      let targetSnapshot: ImportTargetSnapshot;
      if (sourceBookId !== undefined) {
        /**
         * D4 的资格 TOCTOU 防护：先锁成员/邀请/分享表与两本账本行，再重新读取并计算指纹。
         * 锁释放前，任何接受邀请、加入成员、生成分享链接的事务都会排队；因此这里看到的是
         * 稳定的单人状态。锁不改变既有邀请/权限判断，只是让并发写等待。
         */
        await lockFormalImportPair(tx, sourceBookId, targetBookId);
        const pair = await loadFormalImportPair(tx, userId, sourceBookId, targetBookId);
        if (pair.sourceFingerprint !== body.sourceFingerprint) {
          throw conflict("source_changed", "来源账本在预览后发生了变化，请重新预览并确认。");
        }
        if (pair.targetFingerprint !== expectedTargetFingerprint) {
          throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
        }
        targetSnapshot = pair.target;
        if (pair.sourceFingerprint !== sourceFingerprint) {
          throw conflict("source_changed", "来源账本在提交过程中发生了变化，请重新预览并确认。");
        }
      } else {
        targetSnapshot = targetIsNew
          ? await loadTargetSnapshot(tx, targetBookId)
          : (await loadExistingImportTarget(tx, userId, targetBookId)).snapshot;
        const targetFingerprint = await fingerprintTargetSnapshot(targetSnapshot);
        if (body.target.kind === "existing") {
          // Re-check the exact target state inside the same transaction as the writes.
          if (targetFingerprint !== body.target.expectedTargetFingerprint) {
            throw conflict("target_changed", "目标账本在预览后发生了变化，请重新预览并确认。");
          }
        } else {
          // A new book must not already contain entries.
          if (targetSnapshot.transactions.length !== 0) {
            throw conflict("target_changed", "新目标账本出现了未预期数据，请重新预览。");
          }
        }
      }

      const targetFingerprint = await fingerprintTargetSnapshot(targetSnapshot);

      const taxonomy = await resolveTaxonomy(
        tx,
        targetBookId,
        effectiveSource,
        targetSnapshot,
        body.taxonomy,
        targetIsNew,
      );

      const removedTargets: NonNullable<LedgerImportResult["removedTargets"]> = [];
      if (removedTargetIds.size > 0) {
        const deletedAt = new Date();
        for (const targetId of removedTargetIds) {
          const row = await tx.transaction.findFirst({
            where: { id: targetId, bookId: targetBookId, deletedAt: null },
            select: { id: true, seq: true, version: true },
          });
          if (row === null) {
            throw conflict("target_changed", "要移除的目标账目已经被删除或修改，请重新预览。");
          }
          await tx.transaction.update({
            where: { id: row.id },
            data: { deletedAt, version: row.version + 1 },
          });
          const groupId = plan.groupOfTarget.get(targetId) ?? "";
          await recordEvent(tx, {
            bookId: targetBookId,
            transactionId: row.id,
            transactionSeq: row.seq,
            actorId: userId,
            actorName,
            kind: "deleted",
            changes: {
              importId: { from: null, to: receiptId },
              importSource: { from: null, to: sourceBookId === undefined ? "guest" : "book" },
              importGroupId: { from: null, to: groupId },
            },
          });
          removedTargets.push({ targetTransactionId: row.id, targetSeq: row.seq, groupId });
        }
      }

      // Avoid silently importing the same guest row twice into the same target. The unique
      // (bookId, sourceRef) index is the final backstop; this check gives a useful error.
      const existingRefs = await tx.transaction.findMany({
        where: {
          bookId: targetBookId,
          deletedAt: null,
          sourceRef: { in: importSource.map((item) => item.id) },
          sourceNamespace: { in: sourceNamespace === "" ? [""] : [sourceNamespace, ""] },
        },
        select: { sourceRef: true },
      });
      if (existingRefs.length > 0) {
        throw conflict("already_imported", "这些来源账目已经导入过这本账本，不会重复导入。");
      }

      const imported: LedgerImportResult["imported"] = [];
      for (const item of importSource) {
        const seq = await allocateTransactionSeq(tx, targetBookId);        const targetTransactionId = randomUUID();
        const categoryId = taxonomy.categoryIds.get(item.categoryId);
        const paymentMethodId =
          item.paymentMethodId === null ? null : taxonomy.paymentMethodIds.get(item.paymentMethodId);
        if (categoryId === undefined || (item.paymentMethodId !== null && paymentMethodId === undefined)) {
          throw badRequest("taxonomy_missing", "账目的分类或支付方式没有映射。");
        }
        if (!sourceCategoryById.has(item.categoryId)) throw badRequest("source_category_missing", "来源分类不存在。");
        if (item.paymentMethodId !== null && !sourcePaymentById.has(item.paymentMethodId)) {
          throw badRequest("source_payment_missing", "来源支付方式不存在。");
        }
        await tx.transaction.create({
          data: {
            id: targetTransactionId,
            seq,
            bookId: targetBookId,
            userId,
            categoryId,
            paymentMethodId: paymentMethodId ?? null,
            kind: item.kind,
            amountCents: BigInt(item.amountCents),
            currency: item.currency,
            occurredAt: new Date(item.occurredAt),
            occurredLocalDate: new Date(`${item.occurredLocalDate}T00:00:00.000Z`),
            occurredTz: item.occurredTz,
            note: item.note,
            idempotencyKey: randomUUID(),
            sourceRef: item.id,
            sourceNamespace,
            importRef,
            tags: {
              create: item.tagIds
                .map((sourceTagId) => taxonomy.tagIds.get(sourceTagId))
                .filter((tagId): tagId is string => tagId !== undefined)
                .map((tagId) => ({ tagId })),
            },
          },
        });
        imported.push({ sourceTransactionId: item.id, targetTransactionId, targetSeq: seq });
      }

      /**
       * D5 phase 2：新导入/被跳过的来源记录都要落下持久决策历史，供下一次增量导入识别。
       * 这里只处理 D2–D4 单事务路径；增量已有目标的路径走服务端分批任务。
       */
      const importedById = new Map(imported.map((item) => [item.sourceTransactionId, item.targetTransactionId]));
      for (const item of effectiveSource.transactions) {
        const targetTransactionId = importedById.get(item.id) ?? null;
        await writeSourceState(tx, {
          targetBookId,
          sourceKind: sourceBookId === undefined ? "guest" : "book",
          sourceBookId: sourceBookId ?? null,
          guestBookId,
          operation: {
            sourceTransactionId: item.id,
            action: targetTransactionId === null ? "skip" : "create",
            targetTransactionId,
            targetVersion: targetTransactionId === null ? null : 1,
            sourceFingerprint: await fingerprintImportSourceRecord(effectiveSource, item.id),
            stateDecision: targetTransactionId === null ? "skipped" : "imported",
          },
          targetTransactionId,
          targetVersion: targetTransactionId === null ? null : 1,
          jobId: receiptId,
        });
      }

      const targetCountAfter = await tx.transaction.count({ where: { bookId: targetBookId, deletedAt: null } });
      const expectedAfter =
        targetSnapshot.transactions.length - removedTargetIds.size + importSource.length;
      if (targetCountAfter !== expectedAfter) {
        throw new Error(`导入后目标账目数量不一致：expected ${String(expectedAfter)}, got ${String(targetCountAfter)}`);
      }

      const insertedIds = imported.map((item) => item.targetTransactionId);
      const inserted = await tx.transaction.findMany({
        where: { bookId: targetBookId, id: { in: insertedIds }, deletedAt: null },
        select: { kind: true, amountCents: true, currency: true },
      });
      const actualTotals = buildTotals(
        inserted.map((row) => ({
          kind: row.kind,
          amountCents: Number(row.amountCents),
          currency: row.currency,
        })),
      );
      if (JSON.stringify(actualTotals) !== JSON.stringify(expectedTotals)) {
        throw new Error("导入后金额/币种对账不一致，已回滚。");
      }

      const receipt = ledgerImportResultSchema.parse({
        importId: receiptId,
        targetBook: {
          id: targetBookId,
          name: targetSnapshot.name,
          bookNumber: targetSnapshot.bookNumber,
          created: targetIsNew,
        },
        sourceBookId,
        sourceCount: effectiveSource.transactions.length,
        importedCount: importSource.length,
        skippedCount: skippedIds.size,
        removedCount: removedTargets.length,
        targetExistingBefore: targetSnapshot.transactions.length,
        targetCountAfter,
        removedTargets,
        totals: actualTotals,
        imported,
        taxonomy: {
          categoriesCreated: taxonomy.created.categories,
          paymentMethodsCreated: taxonomy.created.paymentMethods,
          tagsCreated: taxonomy.created.tags,
          categoriesReused: taxonomy.reused.categories,
          paymentMethodsReused: taxonomy.reused.paymentMethods,
          tagsReused: taxonomy.reused.tags,
        },
        reconciled: true,
      });

      await tx.ledgerImport.create({
        data: {
          id: receiptId,
          userId,
          targetBookId,
          targetCreated: targetIsNew,
          sourceFingerprint,
          targetFingerprint,
          importedCount: importSource.length,
          skippedCount: skippedIds.size,
          result: receipt,        },
      });

      return receipt;
    }, {
      /**
       * A 500-entry guest import creates a book, taxonomies and one transaction per entry inside
       * this transaction. The default 5-second interactive limit is too close for a slower machine,
       * and a timeout mid-transaction would roll back a valid import. The server still bounds the
       * batch with the request schema.
       */
      maxWait: 10_000,
      timeout: 60_000,
    });

    return result;
  } catch (error) {
    /**
     * 并发提交同一个 importId 时，另一个请求可能已经写好了回执；不论本次失败原因是什么，
     * 只要回执属于当前账号，就返回原回执。两个事务可能恰好同时结束，因此短暂等待对方提交，
     * 而不是在“自己先失败、对方尚未提交”的窗口里错误返回 409。
     */
    const replay = await replayCommittedReceipt(prisma, userId, receiptId);
    if (replay !== null) return replay;
    throw error;
  }
}

export interface ImportDecisionPlan {
  readonly skippedSourceIds: ReadonlySet<string>;
  readonly removedTargetIds: ReadonlySet<string>;
  readonly groupOfTarget: ReadonlyMap<string, string>;
}

export function buildDecisionPlan(
  body: ReturnType<typeof ledgerImportRequestSchema.parse>,
  source: GuestImportSource,
  target: ImportTargetSnapshot | null,
  targetIsNew: boolean,
): ImportDecisionPlan {
  if (targetIsNew && body.duplicateGroups.length > 0) {
    throw badRequest("duplicate_new_target", "新目标账本不应有重复组决定。");
  }

  const sourceIds = new Set(source.transactions.map((item) => item.id));
  const targetIds = new Set(target?.transactions.map((item) => item.id) ?? []);
  const seenSource = new Set<string>();
  const seenTarget = new Set<string>();
  const skippedSourceIds = new Set<string>();
  const removedTargetIds = new Set<string>();
  const groupOfTarget = new Map<string, string>();

  for (const group of body.duplicateGroups) {
    const groupSources = new Set<string>();
    const groupTargets = new Set<string>();
    for (const sourceId of group.sourceIds) {
      if (!sourceIds.has(sourceId)) throw badRequest("decision_source_missing", "重复决定引用了不存在的来源账目。");
      if (seenSource.has(sourceId)) throw badRequest("decision_duplicate_source", "同一来源账目被放进了多个重复组。");
      if (groupSources.has(sourceId)) throw badRequest("decision_duplicate_source", "同一来源账目在组内重复。");
      seenSource.add(sourceId);
      groupSources.add(sourceId);
    }
    for (const targetId of group.targetIds) {
      if (!targetIds.has(targetId)) {
        throw badRequest("decision_target_missing", "重复决定引用了不存在的目标账目，请重新预览。");
      }
      if (seenTarget.has(targetId)) throw badRequest("decision_duplicate_target", "同一目标账目被放进了多个重复组。");
      if (groupTargets.has(targetId)) throw badRequest("decision_duplicate_target", "同一目标账目在组内重复。");
      seenTarget.add(targetId);
      groupTargets.add(targetId);
    }

    const sourceActions = new Map<string, "import" | "skip">();
    const targetActions = new Map<string, "keep" | "remove">();

    if (group.sourceActions !== undefined) {
      if (group.sourceActions.length !== group.sourceIds.length) {
        throw badRequest("decision_source_incomplete", "逐条核对必须覆盖本组全部来源账目。");
      }
      for (const item of group.sourceActions) {
        if (!groupSources.has(item.sourceTransactionId)) {
          throw badRequest("decision_source_missing", "逐条决定引用了不属于本组的来源账目。");
        }
        if (sourceActions.has(item.sourceTransactionId)) {
          throw badRequest("decision_duplicate_source", "同一来源账目的处理被重复提交。");
        }
        sourceActions.set(item.sourceTransactionId, item.action);
      }
    } else {
      if (group.action === undefined) {
        throw badRequest("decision_action_missing", "请为每个重复组选择处理方式。");
      }
      const skip = group.action === "keep_a" || group.action === "keep_neither";
      for (const sourceId of group.sourceIds) sourceActions.set(sourceId, skip ? "skip" : "import");
    }

    if (group.targetActions !== undefined) {
      if (group.targetActions.length !== group.targetIds.length) {
        throw badRequest("decision_target_incomplete", "逐条核对必须覆盖本组全部目标账目。");
      }
      for (const item of group.targetActions) {
        if (!groupTargets.has(item.targetTransactionId)) {
          throw badRequest("decision_target_missing", "逐条决定引用了不属于本组的目标账目。");
        }
        if (targetActions.has(item.targetTransactionId)) {
          throw badRequest("decision_duplicate_target", "同一目标账目的处理被重复提交。");
        }
        targetActions.set(item.targetTransactionId, item.action);
      }
    } else {
      if (group.action === undefined || group.action === "custom") {
        throw badRequest("decision_target_missing", "逐条核对必须明确每笔目标记录是保留还是移除。");
      }
      const remove = group.action === "keep_b" || group.action === "keep_neither";
      if (remove && (group.sourceIds.length > 1 || group.targetIds.length > 1)) {
        throw badRequest(
          "group_removal_not_explicit",
          "一对多/多对多组不能用一个组级选择批量删除 A 记录，请逐条确认删除范围。",
        );
      }
      for (const targetId of group.targetIds) targetActions.set(targetId, remove ? "remove" : "keep");
    }

    for (const sourceId of group.sourceIds) {
      if (sourceActions.get(sourceId) === "skip") skippedSourceIds.add(sourceId);
    }
    for (const targetId of group.targetIds) {
      if (targetActions.get(targetId) === "remove") {
        removedTargetIds.add(targetId);
        groupOfTarget.set(targetId, group.groupId);
      }
    }
  }

  return { skippedSourceIds, removedTargetIds, groupOfTarget };
}

export function registerLedgerImportRoutes(app: FastifyInstance, options: LedgerImportRouteOptions): void {
  /**
   * D4 正式来源预览。
   *
   * ⚠️ 客户端不读取 B 的旧快照后直接提交；预览也由服务器读取 B/A，返回 canonical 来源、目标快照
   * 和指纹。这样成员/邀请/权限变化在预览阶段就能明确拒绝；提交时仍会重新读取并锁定复查。
   */
  app.post(
    "/api/v1/ledger-imports/preview",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const body = formalImportPreviewRequestSchema.parse(request.body ?? {});
      const preview = await loadFormalImportPreview(
        options.prisma,
        userId,
        body.sourceBookId,
        body.targetBookId,
      );
      return formalImportPreviewResponseSchema.parse(preview);
    },
  );

  /**
   * D5 phase 2：只读增量预览。正式来源由服务器重新读取；游客来源只上传快照，
   * 状态推断仍以目标账本的 sourceRef/状态表为准，不修改任何记录。
   */
  app.post(
    "/api/v1/ledger-imports/incremental-preview",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const body = incrementalPreviewRequestSchema.parse(request.body ?? {});
      if (body.sourceBookId !== undefined) {
        const pair = await loadFormalImportPair(
          options.prisma,
          userId,
          body.sourceBookId,
          body.targetBookId,
        );
        const analysis = await analyzeIncremental(
          options.prisma,
          body.targetBookId,
          pair.source,
          body.sourceBookId,
          pair.target,
          pair.source.guestBookId ?? null,
        );
        return incrementalPreviewResponseSchema.parse(analysis.response);
      }
      if (body.source === undefined) throw badRequest("source_required", "缺少游客来源快照。");
      assertSourceIsSelfConsistent(body.source);
      const target = await loadExistingImportTarget(options.prisma, userId, body.targetBookId);
      const analysis = await analyzeIncremental(
        options.prisma,
        body.targetBookId,
        body.source,
        null,
        target.snapshot,
        body.source.guestBookId ?? null,
      );
      return incrementalPreviewResponseSchema.parse(analysis.response);
    },
  );

  app.post(
    "/api/v1/ledger-imports/guest-cleanup-preview",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const body = guestCleanupPreviewRequestSchema.parse(request.body ?? {});
      assertSourceIsSelfConsistent(body.source);
      return guestCleanupPreviewResponseSchema.parse(
        await previewGuestCleanup(options.prisma, userId, body),
      );
    },
  );

  app.get(
    "/api/v1/ledger-imports/:receiptId/source-disposition",
    { preHandler: options.requireAuth },
    async (request) => {
      const userId = request.currentUser?.id;
      if (userId === undefined) throw forbidden("auth_required", "请先登录。");
      const { receiptId } = request.params as { receiptId: string };
      return formalSourceDispositionSchema.parse(
        await getFormalSourceDispositionByReceipt(options.prisma, userId, receiptId),
      );
    },
  );

  app.post("/api/v1/ledger-imports", { preHandler: options.requireAuth }, async (request, reply) => {
    const userId = request.currentUser?.id;
    if (userId === undefined) throw forbidden("auth_required", "请先登录。");
    const body = ledgerImportRequestSchema.parse(request.body);

    const existing = await options.prisma.ledgerImport.findUnique({ where: { id: body.importId } });
    if (existing !== null) {
      if (existing.userId !== userId) throw forbidden("import_forbidden", "这个导入任务不属于当前账号。");
      // Read-only legacy replay is deliberately still allowed: it changes nothing and preserves
      // historical receipt queries for old clients. It is not a write path.
      return reply.send(ledgerImportResultSchema.parse(existing.result));
    }
    if (options.allowLegacyDirectImport !== true) {
      throw conflict(
        "legacy_import_disabled",
        "同步导入入口已停用。请先在账本空间正常创建空账本，再使用可撤销的分批导入任务；旧客户端不能绕过最终确认、时间锁或撤销。",
      );
    }

    if (body.target.kind === "existing" && body.target.bookId === "") {
      throw badRequest("target_required", "请选择目标账本。");
    }

    try {
      const result = await executeImport(
        options.prisma,
        userId,
        request.currentUser?.displayName ?? null,
        body,
      );
      return reply.send(result);
    } catch (error) {
      /**
       * 同一 importId 的两个请求同时通过上方回执预检时，先提交的一笔会让另一笔在
       * executeImport 的事务外预检里看到「目标账本已变化」。那属于同一任务的并发重放，
       * 不是用户改动：回执一旦存在就按幂等结果返回，避免误报 409。
       */
      const replay = await replayCommittedReceipt(options.prisma, userId, body.importId);
      if (replay !== null) return reply.send(replay);
      throw error;
    }
  });
}
