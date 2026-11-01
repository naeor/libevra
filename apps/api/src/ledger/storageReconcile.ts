import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../db.js";
import { lockBookStorage } from "./storage.js";

interface Meter { table: string; args: string }
const identifier = (value: string) => { if (!/^[a-z_]+$/.test(value)) throw new Error("invalid_meter_identifier"); return `"${value}"`; };

/** 从实际计量触发器读取口径，避免定期校准与差值计量维护两套表清单。 */
export async function reconcileStorage(prisma: PrismaClient): Promise<{ books: number; accounts: number; corrected: number }> {
  const meters = await prisma.$queryRaw<Meter[]>`SELECT c.relname AS "table", encode(t.tgargs,'escape') AS args FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname LIKE '%_storage_meter' AND NOT t.tgisinternal`;
  const specs = meters.map(m => ({ table: identifier(m.table), fields: m.args.split("\\000") }));
  let corrected = 0;
  const books = await prisma.book.findMany({ select: { id: true } });
  for (const book of books) await prisma.$transaction(async tx => {
    await lockBookStorage(tx, book.id);
    if (await tx.ledgerWriteLock.count({ where: { bookId: book.id, releasedAt: null } })) return;
    let bytes = 0n;
    const entries = new Map<string, bigint>();
    for (const spec of specs) {
      const [kind, scopeKey, entryKey] = spec.fields;
      if (kind === "account") continue;
      const clause = kind === "entrylink" ? 'r.transaction_id IN (SELECT id FROM transactions WHERE book_id=$1::uuid)'
        : kind === "joblink" ? 'r.job_id IN (SELECT id FROM ledger_import_jobs WHERE target_book_id=$1::uuid)'
        : `r.${identifier(scopeKey!)}=$1::uuid`;
      const cost = `libevra_row_bytes(to_jsonb(r))${kind === "attachment" ? "+r.size_bytes" : ""}`;
      const sum = await tx.$queryRawUnsafe<{ bytes: bigint }[]>(`SELECT COALESCE(sum(${cost}),0)::bigint AS bytes FROM ${spec.table} r WHERE ${clause}`, book.id);
      bytes += sum[0]!.bytes;
      if (entryKey) {
        const rows = await tx.$queryRawUnsafe<{ id: string; bytes: bigint }[]>(`SELECT r.${identifier(entryKey)} AS id, sum(${cost})::bigint AS bytes FROM ${spec.table} r WHERE ${clause} AND r.${identifier(entryKey)} IS NOT NULL GROUP BY r.${identifier(entryKey)}`, book.id);
        for (const row of rows) entries.set(row.id, (entries.get(row.id) ?? 0n) + row.bytes);
      }
    }
    const links = await tx.$queryRaw<{ id: string; bytes: bigint }[]>`SELECT l.transaction_id AS id, sum(a.size_bytes)::bigint AS bytes FROM entry_attachment_links l JOIN entry_attachments a ON a.id=l.attachment_id WHERE a.book_id=${book.id}::uuid GROUP BY l.transaction_id`;
    for (const row of links) entries.set(row.id, (entries.get(row.id) ?? 0n) + row.bytes);
    const current = await tx.book.findUniqueOrThrow({ where: { id: book.id }, select: { storageBytes: true } });
    if (current.storageBytes !== bytes) { await tx.$executeRaw`UPDATE books SET storage_bytes=${bytes} WHERE id=${book.id}::uuid`; corrected++; }
    for (const [id, size] of entries) await tx.$executeRaw`UPDATE transactions SET storage_bytes=${size} WHERE id=${id}::uuid AND storage_bytes<>${size}`;
  }, { timeout: 60_000 });
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
    let bytes = 0n;
    for (const spec of specs.filter(s => s.fields[0] === "account")) {
      const rows = await tx.$queryRawUnsafe<{ bytes: bigint }[]>(`SELECT COALESCE(sum(libevra_row_bytes(to_jsonb(r))),0)::bigint AS bytes FROM ${spec.table} r WHERE r.${identifier(spec.fields[1]!)}=$1::uuid`, user.id);
      bytes += rows[0]!.bytes;
    }
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { storageBytes: true } });
    if (current.storageBytes !== bytes) { await tx.$executeRaw`UPDATE users SET storage_bytes=${bytes} WHERE id=${user.id}::uuid`; corrected++; }
  });
  return { books: books.length, accounts: users.length, corrected };
}

export function registerStorageReconciliation(app: FastifyInstance, prisma: PrismaClient): void {
  if (process.env["NODE_ENV"] === "test") return;
  let active = true, busy = false;
  const timer = setInterval(() => { if (active && !busy) { busy = true; void reconcileStorage(prisma).then(result => app.log.info({ storageReconciliation: result })).catch(error => app.log.error(error)).finally(() => { busy = false; }); } }, 24 * 60 * 60_000);
  timer.unref();
  app.addHook("onClose", async () => { active = false; clearInterval(timer); });
}
