import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeApp, prisma, resetDatabase, signUp } from "./support.js";

/**
 * **账本权限分级（所有者 2026-11-10 决定，1.19.56）**，逐角色、逐操作由服务器判断：
 *
 * | 操作 | 只读 | 记账 | 编辑全部 | 管理员 |
 * |---|---|---|---|---|
 * | 查看、导出 | ✓ | ✓ | ✓ | ✓ |
 * | 记账、导入 | | ✓ | ✓ | ✓ |
 * | 改 / 删 / 恢复自己记的账 | | ✓ | ✓ | ✓ |
 * | 改 / 删 / 恢复别人记的账 | | | ✓ | ✓ |
 * | 新增分类、标签、支付方式 | | ✓ | ✓ | ✓ |
 * | 修改分类、标签、支付方式，改账本名 | | | ✓ | ✓ |
 * | 改别人的权限、移出成员、只有管理员能邀请 | | | | ✓ |
 * | 邀请（权限不高于自己） | ✓ | ✓ | ✓ | ✓ |
 */
describe("账本权限分级（1.19.56）", () => {
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
    const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true, accountNumber: true } });
    const membership = await prisma.bookMember.findFirstOrThrow({ where: { userId: user.id }, select: { bookId: true } });
    return { cookie, userId: user.id, bookId: membership.bookId, accountNumber: user.accountNumber ?? "" };
  }

  type Account = Awaited<ReturnType<typeof account>>;

  /** 管理员（创建者）+ 编辑全部 + 记账 + 只读，都在管理员的账本里。 */
  async function ledger() {
    const admin = await account("tier_admin");
    const editor = await account("tier_editor");
    const recorder = await account("tier_recorder");
    const viewer = await account("tier_viewer");
    for (const [who, role] of [[editor, "editor"], [recorder, "recorder"], [viewer, "viewer"]] as const) {
      await prisma.bookMember.create({ data: { bookId: admin.bookId, userId: who.userId, role } });
    }
    return { admin, editor, recorder, viewer, bookId: admin.bookId };
  }

  function as(who: Account, bookId: string) {
    return { cookie: who.cookie, "x-libellum-book": bookId };
  }

  async function addEntry(who: Account, bookId: string) {
    const id = randomUUID();
    return { id, response: await app.inject({
      method: "POST", url: "/api/v1/transactions", headers: as(who, bookId),
      payload: { id, idempotencyKey: id, kind: "expense", amountCents: 1200, currency: "CNY",
        occurredAt: "2026-11-01T12:00:00.000Z", occurredLocalDate: "2026-11-01", occurredTz: "Asia/Shanghai", note: who.userId, tagIds: [] },
    }) };
  }

  function edit(who: Account, bookId: string, id: string, version: number, note: string) {
    return app.inject({
      method: "PATCH", url: `/api/v1/transactions/${id}`, headers: as(who, bookId),
      payload: { version, base: { note: null }, note },
    });
  }

  async function versionOf(id: string): Promise<number> {
    return (await prisma.transaction.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;
  }

  it("只读不能记账，记账与编辑全部可以；账目的记录人是记的人", async () => {
    const t = await ledger();
    expect((await addEntry(t.viewer, t.bookId)).response.statusCode).toBe(403);
    const mine = await addEntry(t.recorder, t.bookId);
    expect(mine.response.statusCode, mine.response.body).toBe(201);
    expect((mine.response.json() as { recorderId: string }).recorderId).toBe(t.recorder.userId);
    expect((await addEntry(t.editor, t.bookId)).response.statusCode).toBe(201);
  });

  it("记账只能修改、删除、恢复自己记的账目；编辑全部可以处理所有账目", async () => {
    const t = await ledger();
    const adminEntry = (await addEntry(t.admin, t.bookId)).id;
    const recorderEntry = (await addEntry(t.recorder, t.bookId)).id;

    const othersEdit = await edit(t.recorder, t.bookId, adminEntry, await versionOf(adminEntry), "改别人的");
    expect(othersEdit.statusCode).toBe(403);
    expect(othersEdit.json().code).toBe("entry_not_yours");
    const ownEdit = await edit(t.recorder, t.bookId, recorderEntry, await versionOf(recorderEntry), "改自己的");
    expect(ownEdit.statusCode, ownEdit.body).toBe(200);
    const viewerEdit = await edit(t.viewer, t.bookId, recorderEntry, await versionOf(recorderEntry), "只读");
    expect(viewerEdit.statusCode).toBe(403);
    const editorEdit = await edit(t.editor, t.bookId, recorderEntry, await versionOf(recorderEntry), "编辑全部改的");
    expect(editorEdit.statusCode, editorEdit.body).toBe(200);
    /** 别人修改过也不改变记录人。 */
    expect((editorEdit.json() as { recorderId: string }).recorderId).toBe(t.recorder.userId);

    const othersDelete = await app.inject({ method: "DELETE", url: `/api/v1/transactions/${adminEntry}`, headers: as(t.recorder, t.bookId) });
    expect(othersDelete.statusCode).toBe(403);
    expect(othersDelete.json().code).toBe("entry_not_yours");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: adminEntry } })).deletedAt).toBeNull();

    const ownDelete = await app.inject({ method: "DELETE", url: `/api/v1/transactions/${recorderEntry}`, headers: as(t.recorder, t.bookId) });
    expect(ownDelete.statusCode).toBe(204);
    const ownRestore = await app.inject({ method: "POST", url: `/api/v1/transactions/${recorderEntry}/restore`, headers: as(t.recorder, t.bookId) });
    expect(ownRestore.statusCode, ownRestore.body).toBe(200);

    const adminDelete = await app.inject({ method: "DELETE", url: `/api/v1/transactions/${adminEntry}`, headers: as(t.editor, t.bookId) });
    expect(adminDelete.statusCode).toBe(204);
    const othersRestore = await app.inject({ method: "POST", url: `/api/v1/transactions/${adminEntry}/restore`, headers: as(t.recorder, t.bookId) });
    expect(othersRestore.statusCode).toBe(403);
  });

  it("记账可以新增分类、标签、支付方式，不能修改；编辑全部可以修改并改账本名", async () => {
    const t = await ledger();
    const tag = await app.inject({ method: "POST", url: "/api/v1/tags", headers: as(t.recorder, t.bookId), payload: { name: "出差", color: "#44aa77" } });
    expect(tag.statusCode, tag.body).toBe(201);
    const tagId = (tag.json() as { id: string }).id;
    const category = await app.inject({ method: "POST", url: "/api/v1/categories", headers: as(t.recorder, t.bookId), payload: { name: "宠物", kind: "expense" } });
    expect(category.statusCode, category.body).toBe(201);
    const method = await app.inject({ method: "POST", url: "/api/v1/payment-methods", headers: as(t.recorder, t.bookId), payload: { name: "饭卡" } });
    expect(method.statusCode, method.body).toBe(201);

    const viewerTag = await app.inject({ method: "POST", url: "/api/v1/tags", headers: as(t.viewer, t.bookId), payload: { name: "只读", color: "#44aa77" } });
    expect(viewerTag.statusCode).toBe(403);

    const rename = await app.inject({ method: "PATCH", url: `/api/v1/tags/${tagId}`, headers: as(t.recorder, t.bookId), payload: { name: "差旅" } });
    expect(rename.statusCode).toBe(403);
    expect(rename.json().code).toBe("book_edit_all_required");
    const archive = await app.inject({ method: "DELETE", url: `/api/v1/categories/${(category.json() as { id: string }).id}`, headers: as(t.recorder, t.bookId) });
    expect(archive.statusCode).toBe(403);
    const editorRename = await app.inject({ method: "PATCH", url: `/api/v1/tags/${tagId}`, headers: as(t.editor, t.bookId), payload: { name: "差旅" } });
    expect(editorRename.statusCode, editorRename.body).toBe(200);

    const ledgerName = (who: Account) => app.inject({ method: "PATCH", url: `/api/v1/books/${t.bookId}`, headers: as(who, t.bookId), payload: { name: `${who.userId.slice(0, 4)} 改的` } });
    expect((await ledgerName(t.recorder)).statusCode).toBe(403);
    expect((await ledgerName(t.editor)).statusCode).toBe(200);
  });

  it("导出与查看同一权限：只读成员也能导出", async () => {
    const t = await ledger();
    await addEntry(t.admin, t.bookId);
    const exported = await app.inject({ method: "GET", url: "/api/v1/export", headers: as(t.viewer, t.bookId) });
    expect(exported.statusCode, exported.body.slice(0, 200)).toBe(200);
  });

  it("记账只能给自己记的账目添加附件", async () => {
    const t = await ledger();
    const adminEntry = (await addEntry(t.admin, t.bookId)).id;
    const recorderEntry = (await addEntry(t.recorder, t.bookId)).id;
    const reserve = (entries: string[]) => app.inject({
      method: "POST", url: `/api/v1/books/${t.bookId}/attachments`, headers: { cookie: t.recorder.cookie },
      payload: { id: randomUUID(), transactionIds: entries, name: "凭据.png", mediaType: "image/png", sizeBytes: 20 },
    });
    const others = await reserve([adminEntry]);
    expect(others.statusCode).toBe(403);
    expect(others.json().code).toBe("entry_not_yours");
    const own = await reserve([recorderEntry]);
    expect(own.statusCode, own.body).toBe(200);
  });

  it("只有管理员能改别人的权限；成员名单标出管理员", async () => {
    const t = await ledger();
    const setRole = (who: Account, target: Account, role: string) => app.inject({
      method: "PATCH", url: `/api/v1/books/members/${target.userId}`, headers: as(who, t.bookId), payload: { role },
    });
    const byEditor = await setRole(t.editor, t.viewer, "recorder");
    expect(byEditor.statusCode).toBe(403);
    expect(byEditor.json().code).toBe("book_admin_required");
    const byAdmin = await setRole(t.admin, t.viewer, "recorder");
    expect(byAdmin.statusCode, byAdmin.body).toBe(200);
    expect((await prisma.bookMember.findUniqueOrThrow({ where: { bookId_userId: { bookId: t.bookId, userId: t.viewer.userId } } })).role).toBe("recorder");

    const list = await app.inject({ method: "GET", url: "/api/v1/books/members", headers: as(t.editor, t.bookId) });
    const body = list.json() as { members: { userId: string; isAdmin: boolean; role: string }[]; isAdmin: boolean; inviteAdminOnly: boolean };
    expect(body.isAdmin).toBe(false);
    expect(body.inviteAdminOnly).toBe(false);
    expect(body.members.filter((member) => member.isAdmin).map((member) => member.userId)).toEqual([t.admin.userId]);

    const books = await app.inject({ method: "GET", url: "/api/v1/books", headers: { cookie: t.admin.cookie } });
    const row = (books.json() as { books: { id: string; isAdmin: boolean }[] }).books.find((book) => book.id === t.bookId);
    expect(row?.isAdmin).toBe(true);
  });

  it("邀请：权限不能高于自己；邀请人后来被降级，未接受的邀请随之失效", async () => {
    const t = await ledger();
    const guest = await account("tier_guest");
    const invite = (who: Account, role: string) => app.inject({
      method: "POST", url: "/api/v1/books/invite", headers: as(who, t.bookId), payload: { accountNumber: guest.accountNumber, role },
    });
    const tooHigh = await invite(t.recorder, "editor");
    expect(tooHigh.statusCode).toBe(403);
    expect(tooHigh.json().code).toBe("invite_role_too_high");
    const sent = await invite(t.recorder, "recorder");
    expect(sent.statusCode, sent.body).toBe(201);

    await prisma.bookMember.update({ where: { bookId_userId: { bookId: t.bookId, userId: t.recorder.userId } }, data: { role: "viewer" } });
    const accept = await app.inject({
      method: "POST", url: `/api/v1/notifications/${(sent.json() as { notificationId: string }).notificationId}/decide`,
      headers: { cookie: guest.cookie }, payload: { decision: "accepted" },
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json().code).toBe("invite_no_longer_valid");
    expect(await prisma.bookMember.count({ where: { bookId: t.bookId, userId: guest.userId } })).toBe(0);
  });
});
