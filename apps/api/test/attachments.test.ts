import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeApp, prisma, resetDatabase, signUp, ledgerOf } from "./support.js";
import { reconcileStorage } from "../src/ledger/storageReconcile.js";

describe("附件、容量与创建者通知", () => {
  let app: FastifyInstance;
  beforeEach(async () => { app = makeApp({ logger: { level: "error" } }); await resetDatabase(); await prisma.storagePolicy.deleteMany(); });
  afterEach(async () => app.close());
  afterAll(async () => prisma.$disconnect());
  async function account(name: string) {
    const cookie = await signUp(app, name);
    const user = await prisma.user.findUniqueOrThrow({ where: { username: name } });
    const ledger = await ledgerOf(app, cookie);
    return { cookie, user, bookId: ledger.book.id };
  }
  async function entry(a: Awaited<ReturnType<typeof account>>) {
    const id = randomUUID();
    const response = await app.inject({ method: "POST", url: "/api/v1/transactions", headers: { cookie: a.cookie, "x-libellum-book": a.bookId },
      payload: { id, idempotencyKey: randomUUID(), kind: "expense", amountCents: 1000, currency: "CNY",
        occurredAt: "2026-11-01T12:00:00.000Z", occurredLocalDate: "2026-11-01", occurredTz: "Asia/Shanghai", tagIds: [] } });
    expect(response.statusCode, response.body).toBe(201);
    return id;
  }
  const png = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");
  async function reserve(a: Awaited<ReturnType<typeof account>>, entries: string[], id = randomUUID()) {
    return app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments`, headers: { cookie: a.cookie },
      payload: { id, transactionIds: entries, name: "凭据.png", mediaType: "image/png", sizeBytes: png.length } });
  }
  async function upload(a: Awaited<ReturnType<typeof account>>, entries: string[]) {
    const response = await reserve(a, entries);
    expect(response.statusCode, response.body).toBe(200);
    const id = response.json<{ id: string }>().id;
    const chunk = await app.inject({ method: "PUT", url: `/api/v1/books/${a.bookId}/attachments/${id}/chunks/0`,
      headers: { cookie: a.cookie, "content-type": "application/octet-stream" }, payload: png });
    expect(chunk.statusCode, chunk.body).toBe(200);
    const done = await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments/${id}/complete`, headers: { cookie: a.cookie } });
    expect(done.statusCode, done.body).toBe(200);
    return id;
  }
  it("同本多笔共用文件；按原件计额，流式读取与 Range 均保持原内容", async () => {
    const a = await account("att_multi");
    const ids = [await entry(a), await entry(a)];
    const id = await upload(a, ids);
    expect(await prisma.entryAttachment.count()).toBe(1);
    expect(await prisma.entryAttachmentLink.count()).toBe(2);
    const full = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments/${id}/content`, headers: { cookie: a.cookie } });
    expect(full.rawPayload).toEqual(png);
    const part = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments/${id}/content`, headers: { cookie: a.cookie, range: "bytes=2-5" } });
    expect(part.statusCode).toBe(206); expect(part.rawPayload).toEqual(png.subarray(2, 6));
    const storage = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/storage`, headers: { cookie: a.cookie } });
    expect(storage.json()).toMatchObject({ attachmentBytes: png.length, attachmentCount: 1 });
    expect((await prisma.transaction.findMany()).every((t) => t.storageBytes > BigInt(png.length))).toBe(true);
  });
  it("上传者退出后编辑者可删除，重加恢复专属权；查看者和外部账号不能上传或下载", async () => {
    const a = await account("att_owner"), b = await account("att_editor"), outside = await account("att_outside");
    await prisma.bookMember.create({ data: { bookId: a.bookId, userId: b.user.id, role: "editor" } });
    const id = await upload(a, [await entry(a)]);
    const remove = () => app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${id}`, headers: { cookie: b.cookie } });
    expect((await remove()).statusCode).toBe(403);
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: a.bookId, userId: a.user.id } }, data: { leftAt: new Date() } });
    expect((await remove()).statusCode).toBe(200);
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: a.bookId, userId: a.user.id } }, data: { leftAt: null } });
    expect((await remove()).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments/${id}/content`, headers: { cookie: outside.cookie } })).statusCode).toBe(403);
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: a.bookId, userId: b.user.id } }, data: { role: "viewer" } });
    expect((await reserve({ ...b, bookId: a.bookId }, [await entry(a)])).statusCode).toBe(403);
  });
  it("跨分块断点续传不重复计量，跨块 Range 保留正确字节", async () => {
    const a = await account("att_resume"), transactionId = await entry(a), id = randomUUID();
    const bytes = Buffer.alloc(1024 * 1024 + 33, 42); png.copy(bytes);
    const base = `/api/v1/books/${a.bookId}/attachments/${id}`;
    const payload = { id, transactionIds: [transactionId], name: "分块.png", mediaType: "image/png", sizeBytes: bytes.length };
    expect((await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments`, headers: { cookie: a.cookie }, payload })).statusCode).toBe(200);
    const send = (position: number, data: Buffer) => app.inject({ method: "PUT", url: `${base}/chunks/${position}`, headers: { cookie: a.cookie, "content-type": "application/octet-stream" }, payload: data });
    expect((await send(0, bytes.subarray(0,1024 * 1024))).statusCode).toBe(200);
    const quota = (await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } })).storageBytes;
    expect((await send(0, bytes.subarray(0,1024 * 1024))).statusCode).toBe(200);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } })).storageBytes).toBe(quota);
    const resumed = await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments`, headers: { cookie: a.cookie }, payload });
    expect(resumed.json().receivedBytes).toBe(1024 * 1024);
    expect((await send(1, bytes.subarray(1024 * 1024))).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/complete`, headers: { cookie: a.cookie } })).statusCode).toBe(200);
    const range = await app.inject({ method: "GET", url: `${base}/content`, headers: { cookie: a.cookie, range: `bytes=${1024 * 1024 - 5}-${1024 * 1024 + 4}` } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(bytes.subarray(1024 * 1024 - 5,1024 * 1024 + 5));
    expect((await reconcileStorage(prisma)).corrected).toBe(0);
  });
  it("个人满额不阻止其他成员上传；账本满额阻止所有新增附件，旧账更正继续保存并通知创建者", async () => {
    const a = await account("att_full"), b = await account("att_space");
    await prisma.bookMember.create({ data: { bookId: a.bookId, userId: b.user.id, role: "editor" } });
    const id = await entry(a);
    await prisma.user.update({ where: { id: a.user.id }, data: { storageLimitBytes: 1n } });
    expect((await reserve(a, [id])).statusCode).toBe(413);
    await upload({ ...b, bookId: a.bookId }, [id]);
    await prisma.book.update({ where: { id: a.bookId }, data: { storageLimitBytes: 1n } });
    expect((await reserve({ ...b, bookId: a.bookId }, [id])).statusCode).toBe(413);
    const edited = await app.inject({ method: "PATCH", url: `/api/v1/transactions/${id}`, headers: { cookie: b.cookie, "x-libellum-book": a.bookId, "x-forwarded-for": "1.2.3.4" },
      payload: { version: 1, amountCents: 2000, changes: [{ field: "amountCents", base: 1000, wanted: 2000, chain: [1000, 2000] }] } });
    expect(edited.statusCode, edited.body).toBe(200);
    const notices = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/notices`, headers: { cookie: a.cookie } });
    expect(notices.statusCode, notices.body).toBe(200);
    expect(notices.body).not.toContain("sourceIp"); expect(notices.body).not.toContain("1.2.3.4");
    expect(notices.json<{ items: unknown[] }>().items.length).toBeGreaterThan(0);
    const event = await prisma.transactionEvent.findFirstOrThrow({ where: { transactionId: id, kind: "updated" }, orderBy: { occurredAt: "desc" } });
    expect(event.sourceIp).not.toBe("1.2.3.4"); expect(event.snapshot).not.toBeNull();
  });
  it("临时上传取消释放空间；可恢复附件删除不释放原件额度，恢复不重复计额", async () => {
    const a = await account("att_restore"), id = await entry(a);
    const temp = await reserve(a, [id]);
    const before = await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } });
    await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${temp.json<{ id: string }>().id}`, headers: { cookie: a.cookie } });
    const after = await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } });
    expect(after.storageBytes).toBeLessThan(before.storageBytes);
    const file = await upload(a, [id]);
    await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${file}`, headers: { cookie: a.cookie } });
    expect(await prisma.entryAttachmentChunk.count()).toBe(1);
    await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments/${file}/restore`, headers: { cookie: a.cookie } });
    expect(await prisma.entryAttachmentChunk.count()).toBe(1);
  });
  it("差值计量与完整重算一致，永久清理释放原件和关联占用", async () => {
    const a = await account("att_meter"), id = await entry(a);
    const file = await upload(a, [id]);
    const before = await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } });
    expect((await reconcileStorage(prisma)).corrected).toBe(0);
    const checked = await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } });
    expect(checked.storageBytes).toBe(before.storageBytes);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${file}/permanent`, headers: { cookie: a.cookie } })).statusCode).toBe(409);
    await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${file}`, headers: { cookie: a.cookie } });
    expect((await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${file}/permanent`, headers: { cookie: a.cookie } })).statusCode).toBe(200);
    expect(await prisma.entryAttachmentChunk.count()).toBe(0);
    expect(await prisma.entryAttachmentLink.count()).toBe(0);
    expect((await reconcileStorage(prisma)).corrected).toBe(0);
    expect((await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments/${file}/content`, headers: { cookie: a.cookie } })).statusCode).toBe(404);
  });
  it("并发上传不能同时占用最后一个附件名额；可恢复附件仍占名额", async () => {
    const a = await account("att_race"), id = await entry(a);
    await prisma.storagePolicy.create({ data: { id: "global", entryFiles: 1 } });
    const replies = await Promise.all([reserve(a, [id]), reserve(a, [id])]);
    expect(replies.map(r => r.statusCode).sort()).toEqual([200, 413]);
    const file = replies.find(r => r.statusCode === 200)!.json<{ id: string }>().id;
    await app.inject({ method: "PUT", url: `/api/v1/books/${a.bookId}/attachments/${file}/chunks/0`, headers: { cookie: a.cookie, "content-type": "application/octet-stream" }, payload: png });
    await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments/${file}/complete`, headers: { cookie: a.cookie } });
    await app.inject({ method: "DELETE", url: `/api/v1/books/${a.bookId}/attachments/${file}`, headers: { cookie: a.cookie } });
    expect((await reserve(a, [id])).json()).toMatchObject({ code: "entry_attachment_count" });
  });
  it("分块幂等重试、途中调低单文件限额与重试完成均不丢原件", async () => {
    const a = await account("att_lower"), id = await entry(a), response = await reserve(a, [id]);
    const file = response.json<{ id: string }>().id;
    for (let n = 0; n < 2; n++) expect((await app.inject({ method: "PUT", url: `/api/v1/books/${a.bookId}/attachments/${file}/chunks/0`, headers: { cookie: a.cookie, "content-type": "application/octet-stream" }, payload: png })).statusCode).toBe(200);
    await prisma.storagePolicy.create({ data: { id: "global", fileBytes: 1n } });
    const complete = () => app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/attachments/${file}/complete`, headers: { cookie: a.cookie } });
    expect((await complete()).json()).toMatchObject({ code: "attachment_too_large" });
    expect(await prisma.entryAttachmentChunk.count()).toBe(1);
    await prisma.storagePolicy.update({ where: { id: "global" }, data: { fileBytes: 100_000_000n } });
    expect((await complete()).statusCode).toBe(200);
    const count = await prisma.transactionEvent.count();
    expect((await complete()).statusCode).toBe(200);
    expect(await prisma.transactionEvent.count()).toBe(count);
  });
  it("删除和恢复账目保留原件，导出包含关联信息及完全相同的文件字节", async () => {
    const a = await account("att_export"), b = await account("att_no_export"), id = await entry(a), file = await upload(a, [id]);
    const archive = await app.inject({ method: "GET", url: `/api/v1/account/attachments-export?bookId=${a.bookId}`, headers: { cookie: a.cookie } });
    expect(archive.statusCode, archive.body).toBe(200);
    const entries = new Map<string, Buffer>();
    for (let offset = 0; offset + 512 <= archive.rawPayload.length;) {
      const header = archive.rawPayload.subarray(offset, offset + 512);
      if (header.every(v => v === 0)) break;
      const name = header.subarray(0, 100).toString().replace(/\0.*$/s, "");
      const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, ""), 8);
      entries.set(name, archive.rawPayload.subarray(offset + 512, offset + 512 + size));
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    expect(entries.get(`${a.bookId}/${file}.bin`)).toEqual(png);
    expect(entries.get(`${a.bookId}/${file}.json`)?.toString()).toContain(id);
    expect((await app.inject({ method: "GET", url: `/api/v1/account/attachments-export?bookId=${a.bookId}`, headers: { cookie: b.cookie } })).statusCode).toBe(403);
    await prisma.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
    const list = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments?state=recoverable`, headers: { cookie: a.cookie } });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
    await prisma.transaction.update({ where: { id }, data: { deletedAt: null } });
    const content = await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/attachments/${file}/content`, headers: { cookie: a.cookie } });
    expect(content.rawPayload).toEqual(png);
    expect((await reconcileStorage(prisma)).corrected).toBe(0);
  });
  it("账本提醒只归创建者，按明确 ID 标记已读，退出后不可读", async () => {
    const a = await account("att_notices"), b = await account("att_actor"), id = await entry(a);
    await prisma.bookMember.create({ data: { bookId: a.bookId, userId: b.user.id, role: "editor" } });
    const edit = async (amount: number, version: number) => app.inject({ method: "PATCH", url: `/api/v1/transactions/${id}`, headers: { cookie: b.cookie, "x-libellum-book": a.bookId }, payload: { version, amountCents: amount, changes: [{ field: "amountCents", base: amount - 1000, wanted: amount, chain: [amount - 1000, amount] }] } });
    expect((await edit(2000, 1)).statusCode).toBe(200);
    const first = await prisma.entryChangeNotice.findFirstOrThrow();
    expect((await edit(3000, 2)).statusCode).toBe(200);
    await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/notices/read`, headers: { cookie: b.cookie }, payload: { ids: [first.id] } });
    expect(await prisma.entryChangeNotice.count({ where: { readAt: null } })).toBe(2);
    await app.inject({ method: "POST", url: `/api/v1/books/${a.bookId}/notices/read`, headers: { cookie: a.cookie }, payload: { ids: [first.id] } });
    expect(await prisma.entryChangeNotice.count({ where: { readAt: null } })).toBe(1);
    await prisma.bookMember.update({ where: { bookId_userId: { bookId: a.bookId, userId: a.user.id } }, data: { leftAt: new Date() } });
    expect((await app.inject({ method: "GET", url: `/api/v1/books/${a.bookId}/notices`, headers: { cookie: a.cookie } })).statusCode).toBe(403);
    expect((await edit(4000, 3)).statusCode).toBe(200);
    expect(await prisma.entryChangeNotice.count()).toBe(2);
  });
  it("离线多次更正永久保留，重试不重复提醒，被服务器拒绝的字段不伪造成修改", async () => {
    const a = await account("att_history"), b = await account("att_history_b"), id = await entry(a);
    await prisma.bookMember.create({ data: { bookId: a.bookId, userId: b.user.id, role: "editor" } });
    const deviceEdits = [{ at: "2026-11-01T10:00:00Z", changes: { amountCents: { from: 1000, to: 1500 } } }, { at: "2026-11-01T11:00:00Z", changes: { amountCents: { from: 1500, to: 2000 } } }];
    const payload = { version: 1, amountCents: 2000, changes: [{ field: "amountCents", base: 1000, wanted: 2000, chain: [1000,1500,2000] }], deviceEdits };
    const edit = (body: unknown) => app.inject({ method: "PATCH", url: "/api/v1/transactions/" + id, headers: { cookie: b.cookie, "x-libellum-book": a.bookId }, payload: body as object });
    expect((await edit(payload)).statusCode).toBe(200);
    const saved = await prisma.transactionEvent.findFirstOrThrow({ where: { transactionId: id, kind: "updated" } });
    expect((saved.snapshot as { deviceEdits: unknown }).deviceEdits).toEqual(deviceEdits);
    expect((await edit(payload)).statusCode).toBe(200);
    expect(await prisma.entryChangeNotice.count()).toBe(1);
    const stale = { ...payload, amountCents: 2000, changes: [{ field: "amountCents", base: 500, wanted: 2000, chain: [500,2000] }], deviceEdits: [{ at: "2026-11-01T12:00:00Z", changes: { amountCents: { from: 500, to: 2000 } } }] };
    expect((await edit(stale)).statusCode).toBe(200);
    expect(await prisma.entryChangeNotice.count()).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id } })).amountCents).toBe(2000n);
  });
  it("日期与时区的离线中间更正随实际写入永久保留", async () => {
    const a = await account("att_date_history"), id = await entry(a);
    const original = await prisma.transaction.findUniqueOrThrow({ where: { id } });
    const deviceEdits = [{ at: "2026-11-01T10:00:00Z", changes: {
      occurredAt: { from: original.occurredAt.toISOString(), to: "2026-10-20T12:00:00.000Z" },
      occurredLocalDate: { from: original.occurredLocalDate.toISOString().slice(0,10), to: "2026-10-20" },
      occurredTz: { from: original.occurredTz, to: "UTC" },
    } }, { at: "2026-11-01T11:00:00Z", changes: {
      occurredAt: { from: "2026-10-20T12:00:00.000Z", to: "2026-10-21T12:00:00.000Z" },
      occurredLocalDate: { from: "2026-10-20", to: "2026-10-21" },
    } }];
    const response = await app.inject({ method: "PATCH", url: "/api/v1/transactions/" + id, headers: { cookie: a.cookie }, payload: {
      version: 1, occurredAt: "2026-10-21T12:00:00.000Z", occurredLocalDate: "2026-10-21", occurredTz: "UTC", deviceEdits,
    } });
    expect(response.statusCode, response.body).toBe(200);
    const saved = await prisma.transactionEvent.findFirstOrThrow({ where: { transactionId: id, kind: "updated" } });
    expect((saved.snapshot as { deviceEdits: unknown }).deviceEdits).toEqual(deviceEdits);
  });
  it("管理员可动态修改默认及个别限额，普通账户不能读取或修改管理接口", async () => {
    const a = await account("att_admin");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/storage-policy", headers: { cookie: a.cookie } })).statusCode).toBe(403);
    await prisma.user.update({ where: { id: a.user.id }, data: { isAdmin: true, accountNumber: "10000007" } });
    await prisma.adminGrant.create({ data: { userId: a.user.id, grantedBy: "test-suite" } });
    await prisma.adminAllowEntry.create({ data: { userId: a.user.id, listedBy: "test-suite" } });
    const policy = { accountBytes: 2000000000, bookBytes: 800000000, fileBytes: 100000000, entryBytes: 200000000, entryFiles: 10 };
    const changed = await app.inject({ method: "PATCH", url: "/api/v1/admin/storage-policy", headers: { cookie: a.cookie }, payload: policy });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual(policy);
    const override = await app.inject({ method: "PATCH", url: "/api/v1/admin/storage-limit", headers: { cookie: a.cookie }, payload: { scope: "book", id: a.bookId, limit: 700000000 } });
    expect(override.statusCode, override.body).toBe(200);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } })).storageLimitBytes).toBe(700000000n);
    expect(await prisma.adminAuditLog.count({ where: { action: { startsWith: "storage." } } })).toBe(2);
  });
  it("导入锁期间独立累加容量差值，解锁合并后与全量核算一致", async () => {
    const a = await account("att_deferred"), jobId = randomUUID();
    await prisma.ledgerImportJob.create({ data: { id: jobId, userId: a.user.id, sourceKind: "guest", targetBookId: a.bookId, status: "running", batchSize: 1, totalBatches: 1, sourceCount: 1, targetBaselineCount: 0, targetExpectedCount: 1, sourceFingerprint: "s", targetFingerprint: "t", payload: {} } });
    const lock = await prisma.ledgerWriteLock.create({ data: { bookId: a.bookId, ownerKind: "import", ownerId: "import:" + jobId } });
    const before = await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } });
    await prisma.ledgerImportJobEvent.create({ data: { jobId, kind: "progress", actorUserId: a.user.id, detail: { processed: 1 } } });
    expect((await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } })).storageBytes).toBe(before.storageBytes);
    const pending = await prisma.bookStoragePending.findUniqueOrThrow({ where: { bookId: a.bookId } });
    expect(pending.bytes).toBeGreaterThan(0n);
    const storage = await app.inject({ method: "GET", url: "/api/v1/books/" + a.bookId + "/storage", headers: { cookie: a.cookie } });
    expect(storage.json().bytes).toBe(Number(before.storageBytes + pending.bytes));
    await prisma.ledgerWriteLock.update({ where: { id: lock.id }, data: { releasedAt: new Date() } });
    expect(await prisma.bookStoragePending.count()).toBe(0);
    expect((await prisma.book.findUniqueOrThrow({ where: { id: a.bookId } })).storageBytes).toBe(before.storageBytes + pending.bytes);
    expect((await reconcileStorage(prisma)).corrected).toBe(0);
  });
});
