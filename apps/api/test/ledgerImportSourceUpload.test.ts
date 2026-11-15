import { randomUUID } from "node:crypto";

import {
  MAX_STAGED_IMPORT_TRANSACTIONS,
  fingerprintGuestSource,
  fingerprintTargetSnapshot,
  importJobRequestSchema,
  type GuestImportSource,
} from "@libellum/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createImportJob } from "../src/ledger/importJob.js";
import { MAX_ACTIVE_SOURCE_UPLOADS, sweepExpiredSourceUploads } from "../src/ledger/importSourceUpload.js";
import { loadTargetSnapshot } from "../src/ledger/importTarget.js";
import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * 1.19.97 · 游客来源分段上传：超过 5000 笔（以及超过一次请求体积）的游客账本可以迁入正式账号。
 *
 * 只验证“把同一份来源可靠交给服务器”这一层与它接入的三个入口（增量预览、导入任务、清理预览）；
 * 分批写入、确认与撤销沿用原流程，已有 D5/Phase4 测试覆盖。
 */
describe("staged guest-source uploads (1.19.97)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = makeApp();
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function account(username: string) {
    const cookie = await signUp(app, username);
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
    const book = await prisma.book.findFirstOrThrow({
      where: { createdBy: user.id, disposedAt: null },
      select: { id: true },
    });
    return { cookie, userId: user.id, bookId: book.id };
  }

  function sourceOf(count: number, guestBookId = `guest-book-${randomUUID()}`): GuestImportSource {
    const categoryId = randomUUID();
    return {
      name: "大账本",
      guestBookId,
      categories: [
        { id: categoryId, name: "分段分类", kind: "expense", description: null, sortOrder: 0, isArchived: false, isSystem: false },
      ],
      paymentMethods: [],
      tags: [],
      transactions: Array.from({ length: count }, (_, index) => ({
        id: randomUUID(),
        kind: "expense" as const,
        amountCents: 100 + index,
        currency: "CNY" as const,
        categoryId,
        paymentMethodId: null,
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        occurredLocalDate: "2026-01-01",
        occurredTz: "Asia/Shanghai",
        note: index % 3 === 0 ? `第 ${String(index)} 笔` : null,
        tagIds: [],
      })),
    };
  }

  function partsOf(source: GuestImportSource, size: number) {
    const parts: GuestImportSource["transactions"][] = [];
    for (let start = 0; start < source.transactions.length; start += size) {
      parts.push(source.transactions.slice(start, start + size));
    }
    return parts;
  }

  async function createUpload(cookie: string, source: GuestImportSource, partCount: number, uploadId: string = randomUUID()) {
    const { transactions, ...header } = source;
    return app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/source-uploads",
      headers: { cookie },
      payload: {
        uploadId,
        sourceFingerprint: await fingerprintGuestSource(source),
        transactionCount: transactions.length,
        partCount,
        header,
      },
    });
  }

  function putPart(cookie: string, uploadId: string, position: number, transactions: GuestImportSource["transactions"]) {
    return app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/source-uploads/${uploadId}/parts/${String(position)}`,
      headers: { cookie },
      payload: { transactions },
    });
  }

  function complete(cookie: string, uploadId: string) {
    return app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/source-uploads/${uploadId}/complete`,
      headers: { cookie },
    });
  }

  /** 完整走一遍：建暂存 → 逐段上传 → 拼接校验。返回服务器给的暂存 id。 */
  async function upload(cookie: string, source: GuestImportSource, size: number): Promise<string> {
    const parts = partsOf(source, size);
    const created = await createUpload(cookie, source, parts.length);
    expect(created.statusCode).toBe(200);
    const uploadId = (created.json() as { uploadId: string }).uploadId;
    for (const [index, part] of parts.entries()) {
      const response = await putPart(cookie, uploadId, index, part);
      expect(response.statusCode).toBe(200);
    }
    const done = await complete(cookie, uploadId);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ uploadId, status: "ready", transactionCount: source.transactions.length });
    return uploadId;
  }

  async function jobRequestFor(bookId: string, source: GuestImportSource, uploadId: string, batchSize = 500) {
    const target = await loadTargetSnapshot(prisma, bookId);
    return importJobRequestSchema.parse({
      importId: randomUUID(),
      target: { kind: "existing", bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
      sourceUploadId: uploadId,
      sourceFingerprint: await fingerprintGuestSource(source),
      taxonomy: source.categories.map((category) => ({ type: "category", sourceId: category.id, action: "create", createName: category.name })),
      duplicateGroups: [],
      incrementalDecisions: [],
      batchSize,
    });
  }

  async function awaitStatus(cookie: string, jobId: string, wanted: readonly string[]): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const response = await app.inject({ method: "GET", url: `/api/v1/ledger-imports/jobs/${jobId}`, headers: { cookie } });
      expect(response.statusCode).toBe(200);
      const job = response.json() as Record<string, unknown>;
      if (wanted.includes(job["status"] as string)) return job;
      if (Date.now() > deadline) throw new Error(`status timeout: ${String(job["status"])}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  it("accepts a guest source above the 5000-entry inline cap and creates a job from it", async () => {
    const owner = await account("staged_large");
    const source = sourceOf(5_001);
    // 整本放进一次请求：还没轮到 5000 笔的 schema 上限，请求体就超过了 Fastify 默认的 1 MiB（原来的实际瓶颈）。
    const inline = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, source },
    });
    expect(inline.statusCode).toBe(413);

    const uploadId = await upload(owner.cookie, source, 1_000);
    expect(await prisma.ledgerImportSourceUploadPart.count({ where: { uploadId } })).toBe(0);

    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, sourceUploadId: uploadId },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { statuses: unknown[]; summary: { newCount: number } };
    expect(body.statuses).toHaveLength(5_001);
    expect(body.summary.newCount).toBe(5_001);

    const job = await createImportJob(prisma, owner.userId, await jobRequestFor(owner.bookId, source, uploadId), {
      startImmediately: false,
    });
    expect(job).toMatchObject({ sourceKind: "guest", sourceCount: 5_001, totalBatches: 11, status: "queued" });
    const stored = await prisma.ledgerImportJob.findUniqueOrThrow({ where: { id: job.id }, select: { payload: true } });
    // 任务里有完整来源的副本：之后的批次不依赖暂存。
    expect((stored.payload as { source: GuestImportSource }).source.transactions).toHaveLength(5_001);
  }, 120_000);

  it("runs the whole reversible flow from a staged source: preview, job, confirm, clean-up preview", async () => {
    const owner = await account("staged_flow");
    const source = sourceOf(25);
    const uploadId = await upload(owner.cookie, source, 10);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/jobs",
      headers: { cookie: owner.cookie },
      payload: await jobRequestFor(owner.bookId, source, uploadId, 10),
    });
    expect(created.statusCode).toBe(202);
    const jobId = (created.json() as { id: string }).id;
    await awaitStatus(owner.cookie, jobId, ["awaiting_confirmation"]);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/ledger-imports/jobs/${jobId}/confirm`,
      headers: { cookie: owner.cookie },
    });
    expect(confirmed.statusCode).toBe(200);
    const job = await awaitStatus(owner.cookie, jobId, ["confirmed", "completed"]);
    const result = job["result"] as { importedCount: number; imported: { sourceTransactionId: string }[] };
    expect(result.importedCount).toBe(25);
    expect(new Set(result.imported.map((item) => item.sourceTransactionId))).toEqual(
      new Set(source.transactions.map((item) => item.id)),
    );
    expect(await prisma.transaction.count({ where: { bookId: owner.bookId, sourceNamespace: `guest:${source.guestBookId!}` } })).toBe(25);

    const cleanup = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/guest-cleanup-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, guestBookId: source.guestBookId, receiptId: jobId, sourceUploadId: uploadId },
    });
    expect(cleanup.statusCode).toBe(200);
    expect(cleanup.json()).toMatchObject({ cleanableCount: 25, retainedCount: 0, sourceCount: 25 });
  }, 60_000);

  it("keeps parts idempotent and refuses a different body for the same part", async () => {
    const owner = await account("staged_parts");
    const source = sourceOf(6);
    const [first, second] = partsOf(source, 3);
    const created = await createUpload(owner.cookie, source, 2);
    const uploadId = (created.json() as { uploadId: string }).uploadId;

    expect((await putPart(owner.cookie, uploadId, 0, first!)).statusCode).toBe(200);
    const again = await putPart(owner.cookie, uploadId, 0, first!);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ receivedParts: [0], status: "receiving" });
    const changed = await putPart(owner.cookie, uploadId, 0, second!);
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "source_upload_part_conflict" });
    expect((await putPart(owner.cookie, uploadId, 2, second!)).statusCode).toBe(400);

    const early = await complete(owner.cookie, uploadId);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: "source_upload_incomplete" });

    // 重新用同一个 id 建暂存 = 断点续传：返回已收到的段。
    const resumed = await createUpload(owner.cookie, source, 2, uploadId);
    expect(resumed.json()).toMatchObject({ uploadId, receivedParts: [0] });
    expect((await putPart(owner.cookie, uploadId, 1, second!)).statusCode).toBe(200);
    expect((await complete(owner.cookie, uploadId)).statusCode).toBe(200);
    expect((await complete(owner.cookie, uploadId)).json()).toMatchObject({ status: "ready" });
    expect((await putPart(owner.cookie, uploadId, 1, second!)).statusCode).toBe(409);
  });

  it("rejects a staged source whose content does not match the declared fingerprint", async () => {
    const owner = await account("staged_fingerprint");
    const source = sourceOf(4);
    const created = await createUpload(owner.cookie, source, 1);
    const uploadId = (created.json() as { uploadId: string }).uploadId;
    const tampered = source.transactions.map((item, index) => (index === 0 ? { ...item, amountCents: item.amountCents + 1 } : item));
    expect((await putPart(owner.cookie, uploadId, 0, tampered)).statusCode).toBe(200);
    const done = await complete(owner.cookie, uploadId);
    expect(done.statusCode).toBe(409);
    expect(done.json()).toMatchObject({ code: "source_upload_fingerprint_mismatch" });
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, sourceUploadId: uploadId },
    });
    expect(preview.statusCode).toBe(409);
    expect(preview.json()).toMatchObject({ code: "source_upload_incomplete" });
  });

  it("keeps uploads private to their owner", async () => {
    const owner = await account("staged_owner");
    const other = await account("staged_other");
    const source = sourceOf(3);
    const uploadId = await upload(owner.cookie, source, 3);

    const foreignPreview = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: other.cookie },
      payload: { targetBookId: other.bookId, sourceUploadId: uploadId },
    });
    expect(foreignPreview.statusCode).toBe(403);
    expect(foreignPreview.json()).toMatchObject({ code: "source_upload_forbidden" });
    expect((await complete(other.cookie, uploadId)).statusCode).toBe(403);
    expect((await createUpload(other.cookie, source, 1, uploadId)).statusCode).toBe(403);
    await expect(
      createImportJob(prisma, other.userId, await jobRequestFor(other.bookId, source, uploadId), { startImmediately: false }),
    ).rejects.toMatchObject({ code: "source_upload_forbidden" });
  });

  it("reuses a ready upload of the same source and replaces older uploads of the same guest ledger", async () => {
    const owner = await account("staged_reuse");
    const source = sourceOf(5);
    const first = await upload(owner.cookie, source, 5);

    const reused = await createUpload(owner.cookie, source, 1);
    expect(reused.json()).toMatchObject({ uploadId: first, status: "ready" });

    const changed: GuestImportSource = { ...source, transactions: source.transactions.slice(1) };
    const second = await upload(owner.cookie, changed, 5);
    expect(second).not.toBe(first);
    expect(await prisma.ledgerImportSourceUpload.findUnique({ where: { id: first } })).toBeNull();
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, sourceUploadId: first },
    });
    expect(stale.statusCode).toBe(404);
    expect(stale.json()).toMatchObject({ code: "source_upload_missing" });
  });

  it("expires uploads and limits how many a user keeps at once", async () => {
    const owner = await account("staged_expiry");
    const source = sourceOf(2);
    const uploadId = await upload(owner.cookie, source, 2);
    await prisma.ledgerImportSourceUpload.update({ where: { id: uploadId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const expired = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/incremental-preview",
      headers: { cookie: owner.cookie },
      payload: { targetBookId: owner.bookId, sourceUploadId: uploadId },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({ code: "source_upload_expired" });
    expect(await sweepExpiredSourceUploads(prisma)).toBe(1);

    for (let index = 0; index < MAX_ACTIVE_SOURCE_UPLOADS; index += 1) {
      expect((await createUpload(owner.cookie, sourceOf(1), 1)).statusCode).toBe(200);
    }
    const tooMany = await createUpload(owner.cookie, sourceOf(1), 1);
    expect(tooMany.statusCode).toBe(429);
    expect(tooMany.json()).toMatchObject({ code: "source_upload_limit" });
  });

  it("validates the declared size and refuses staged sources on the legacy synchronous endpoint", async () => {
    const owner = await account("staged_limits");
    const source = sourceOf(1);
    const { transactions: _transactions, ...header } = source;
    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/source-uploads",
      headers: { cookie: owner.cookie },
      payload: {
        uploadId: randomUUID(),
        sourceFingerprint: "0".repeat(64),
        transactionCount: MAX_STAGED_IMPORT_TRANSACTIONS + 1,
        partCount: 11,
        header,
      },
    });
    expect(tooLarge.statusCode).toBe(400);
    const badParts = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports/source-uploads",
      headers: { cookie: owner.cookie },
      payload: { uploadId: randomUUID(), sourceFingerprint: "0".repeat(64), transactionCount: 4_001, partCount: 2, header },
    });
    expect(badParts.statusCode).toBe(400);

    const uploadId = await upload(owner.cookie, source, 1);
    const target = await loadTargetSnapshot(prisma, owner.bookId);
    const legacy = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-imports",
      headers: { cookie: owner.cookie },
      payload: {
        importId: randomUUID(),
        target: { kind: "existing", bookId: owner.bookId, expectedTargetFingerprint: await fingerprintTargetSnapshot(target) },
        sourceUploadId: uploadId,
        sourceFingerprint: await fingerprintGuestSource(source),
        taxonomy: [],
        duplicateGroups: [],
      },
    });
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json()).toMatchObject({ code: "source_upload_unsupported" });
  });
});
