import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DUPLICATE_DETECTION_SETTINGS as DEFAULT, type BillImportCandidate } from "@libellum/shared";
import type { PrismaClient } from "../src/db.js";
import { detectDuplicates } from "../src/import/duplicates.js";
import { dateTimeToInstant } from "../src/import/common.js";
import { parseLibevraCsv } from "../src/import/libevra.js";
import { PreviewCache } from "../src/import/cache.js";
import { BillImportService } from "../src/import/service.js";

const bookId = randomUUID();
const userId = randomUUID();
const categoryId = randomUUID();
function candidate(extra: Partial<BillImportCandidate> = {}): BillImportCandidate {
  return { id: randomUUID(), selected: true, amount: "12.34", currency: "CNY", kind: "expense",
    date: "2026-10-01", time: "10:00:00", timezone: "Asia/Shanghai", categoryId, paymentMethodId: null,
    note: "", tags: [], line: 2, timePrecision: "second", merchant: "", sourceRef: null,
    sourceStatus: "", warnings: [], duplicateIds: [], identityDuplicate: false, ...extra };
}
function database(history: unknown[] = []) {
  const findMany = vi.fn(async (args: {where: {deletedAt?: null}}) => args.where.deletedAt === null ? history : []);
  return { prisma: {
    transaction: { findMany }, tag: { findMany: vi.fn(async () => [{ id: "tag-a", name: "旅行" }]) },
    category: { findMany: vi.fn(async () => [{ id: categoryId, name: "默认", kind: "expense", isSystem: true, isArchived: false }]) },
    paymentMethod: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient, findMany };
}
describe("账单导入审查修复", () => {
  it("来源流水身份不复用为候选主键，同一流水多行候选也唯一", () => {
    const id = randomUUID();
    const parsed = parseLibevraCsv([["日期","金额","类型","流水编号"],["2026-10-01","12.34","支出",id],["2026-10-01","12.34","支出",id]], 0,
      { fingerprint: "a", timezone: "Asia/Shanghai", categories: [], paymentMethods: [] });
    expect(new Set(parsed.candidates.map((row) => row.id)).size).toBe(2);
    for (const row of parsed.candidates) { expect(row.id).not.toBe(id); expect(row.sourceTransactionId).toBe(id); }
  });
  it("拒绝 DST 不存在或歧义时刻，正常时刻保留秒", () => {
    expect(() => dateTimeToInstant("2026-03-08", "02:30:00", "America/New_York")).toThrow("nonexistent");
    expect(() => dateTimeToInstant("2026-11-01", "01:30:00", "America/New_York")).toThrow("ambiguous");
    expect(dateTimeToInstant("2026-10-01", "10:00:43", "Asia/Shanghai")).toBe("2026-10-01T02:00:43.000Z");
  });
  it("关闭币种/时间匹配时 SQL 不再提前排除不同币种与历史日期", async () => {
    const row = { id: randomUUID(), seq: 1, kind: "expense", amountCents: 1234n, currency: "USD",
      occurredAt: new Date("2020-01-01Z"), occurredLocalDate: new Date("2020-01-01Z"),
      categoryId, paymentMethodId: null, note: "", tags: [] };
    const db = database([row]);
    const result = await detectDuplicates({ ...db, bookId, candidates: [candidate()],
      settings: { ...DEFAULT, matchTime: false, matchCurrency: false }, timezone: "Asia/Shanghai" });
    expect(result.candidates[0]!.duplicateIds).toEqual([row.id]);
    expect(db.findMany.mock.calls[0]![0].where).not.toHaveProperty("currency");
    expect(db.findMany.mock.calls[0]![0].where).not.toHaveProperty("occurredLocalDate");
  });
  it("备注/商户/标签确实参与，既有标签按账本 ID 比较", async () => {
    const a = candidate({ note: "a", merchant: "甲", tags: ["旅行"] });
    const b = candidate({ note: "b", merchant: "乙", tags: ["餐饮"] });
    for (const key of ["matchNote", "matchMerchant", "matchTags"] as const) {
      const result = await detectDuplicates({ ...database(), bookId, candidates: [a,b],
        settings: { ...DEFAULT, [key]: true }, timezone: "Asia/Shanghai" });
      expect(result.candidates.every((row) => row.duplicateIds.length === 0)).toBe(true);
    }
    const history = { id: randomUUID(), seq: 1, kind: "expense", amountCents: 1234n, currency: "CNY",
      occurredAt: new Date("2026-10-01T02:00:00Z"), occurredLocalDate: new Date("2026-10-01Z"),
      categoryId, paymentMethodId: null, note: "", tags: [{ tagId: "tag-a" }] };
    const result = await detectDuplicates({ ...database([history]), bookId, candidates: [a],
      settings: { ...DEFAULT, matchTags: true }, timezone: "Asia/Shanghai" });
    expect(result.candidates[0]!.duplicateIds).toEqual([history.id]);
  });
  it("关总开关清除派生重复提示，来源身份保护仍生效", async () => {
    const a = candidate({ sourceRef: "same", duplicateIds: ["old"], warnings: ["疑似重复旧提示", "退款需核对"] });
    const b = candidate({ sourceRef: "same" });
    const result = await detectDuplicates({ ...database(), bookId, candidates: [a,b],
      settings: { ...DEFAULT, enabled: false }, timezone: "Asia/Shanghai" });
    expect(result.candidates.every((row) => row.duplicateIds.length === 0)).toBe(true);
    expect(result.candidates[0]!.warnings).toContain("退款需核对");
    expect(result.candidates[0]!.warnings).not.toContain("疑似重复旧提示");
    expect(result.candidates[1]!.identityDuplicate).toBe(true);
  });
  it("重核允许修正并重算精度，修正后清除字段旧错误及顶层重复摘要", async () => {
    const cache = new PreviewCache();
    const original = candidate();
    const previewId = randomUUID();
    const record = cache.put({ previewId, userId, bookId, fingerprint: "a", createdAt: Date.now(),
      revision: 1, source: "libevra", format: "csv", candidates: [original], warnings: ["旧疑似重复摘要"],
      originalWarnings: [], originalCandidates: [original], reconciliation: { ok: null, messages: [] }, committed: null });
    const service = new BillImportService({ prisma: database().prisma, cache, extractor: { extract: vi.fn() } });
    const input = { userId, bookId, previewId, settings: { ...DEFAULT, enabled: false } };
    const bad = await service.recheck({ ...input, rows: [{ ...original, amount: "1.234", time: "11:00", date: "2026-10-02" }] });
    expect(bad.candidates[0]!.warnings.some((s) => s.includes("提交前需要处理"))).toBe(true);
    const good = await service.recheck({ ...input, rows: [{ ...original, amount: "42", currency: "USD", time: null,
      date: "2026-10-03", timezone: "America/New_York" }] });
    expect(good.candidates[0]).toMatchObject({ amount: "42", currency: "USD", date: "2026-10-03", time: null,
      timezone: "America/New_York", timePrecision: "day", warnings: [] });
    expect(good.warnings).toEqual([]);
    expect(record.warnings).toEqual([]);
    const invalidRows = [{ ...original, date: "2026-02-30", amount: "0" }];
    await service.recheck({ ...input, rows: invalidRows });
    const rejected = await service.commit({ ...input, previewRevision: record.revision, acknowledgeWarnings: false,
      rows: invalidRows });
    expect(rejected.ok).toBe(false);
    expect(rejected.importedCount).toBe(0);
    for (const edit of [
      { amount: "-1" }, { amount: "1.234" }, { amount: "1e2" }, { amount: "1,,2" },
      { currency: "ZZZ" }, { time: "25:00" }, { timezone: "not/a-zone" },
      { date: "2026-03-08", time: "02:30:00", timezone: "America/New_York" },
      { date: "2026-11-01", time: "01:30:00", timezone: "America/New_York" },
    ]) {
      const rows = [{ ...original, ...edit }];
      await service.recheck({ ...input, rows });
      const result = await service.commit({ ...input, previewRevision: record.revision,
        acknowledgeWarnings: false, rows });
      expect(result.ok, JSON.stringify(edit)).toBe(false);
      expect(result.importedCount).toBe(0);
    }
  });
});
