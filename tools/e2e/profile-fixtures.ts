/** 只在本机开发库创建隔离验收账号；凭据只写入忽略的 _backups。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPrismaClient } from "../../apps/api/src/db.js";
import { hashPassword } from "../../apps/api/src/auth/password.js";
import { takeNextAccountNumber } from "../../apps/api/src/auth/recovery-code.js";
import { createDefaultLedger } from "../../apps/api/src/ledger/bootstrap.js";
import { randomUUID } from "node:crypto";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ledger_dev") throw Error("仅允许本机 ledger_dev");
const prisma = createPrismaClient(url.toString());
const suffix = randomUUID().slice(0, 7);
const password = `Profile-${randomUUID()}`;
try {
  const path = "_backups/profile-verification/fixture.json";
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    const existing = await prisma.user.findUnique({ where: { id: saved.id } });
    if (!existing || !/^(pv_|pn_)/.test(existing.username) || !(await prisma.book.findFirst({ where: { id: saved.bookId, name: "个人资料验收账本", createdBy: saved.id } }))) throw Error("验收夹具身份不匹配，拒绝修改");
    await prisma.user.update({ where: { id: saved.id }, data: { username: saved.username, displayName: "林间小记", avatarId: "flower" } });
    console.log("已复用并还原隔离验收账号。");
    process.exitCode = 0;
  } else {
  const passwordHash = await hashPassword(password);
  const a = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { username: `pv_${suffix}`, displayName: "林间小记", passwordHash, accountNumber: await takeNextAccountNumber(tx) } });
    const bookId = await createDefaultLedger(tx, user.id, "个人资料验收账本");
    return { user, bookId };
  });
  const b = await prisma.$transaction(async tx => tx.user.create({ data: { username: `pb_${suffix}`, displayName: "月光同行", avatarId: "moon", passwordHash, accountNumber: await takeNextAccountNumber(tx) } }));
  await prisma.bookMember.create({ data: { bookId: a.bookId, userId: b.id, role: "viewer" } });
  mkdirSync("_backups/profile-verification", { recursive: true });
  writeFileSync("_backups/profile-verification/fixture.json", JSON.stringify({ username: a.user.username, password, id: a.user.id, otherId: b.id, bookId: a.bookId }));
  console.log("已创建两个隔离的本地验收账号和一个共享账本，凭据已写入忽略目录。");
  }
} finally { await prisma.$disconnect(); }
