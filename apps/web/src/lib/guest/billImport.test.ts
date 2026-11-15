import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  EXPORT_COLUMNS,
  type BillImportCandidate,
  type BillImportCommitRow,
  type BillImportPreview,
} from "@libellum/shared";

import { makeXlsx, parseXmlForTests } from "../billExtract/testSupport.js";
import { createMemoryGuestBackend } from "./memoryBackend.js";
import { guestMigrationReminder } from "./billImportLimits.js";

/**
 * 游客本机“导入账单”的端到端测试：内存里的游客库（`memoryBackend.ts`）+ 真实的解析器（shared）+ 本机判重 +
 * 整批写入。确认三件事：只写游客库、整批只写一次 blob、来源身份与服务器同样防重复。
 */

const GUEST = "guest-bill-import-0001";
const settings = DEFAULT_DUPLICATE_DETECTION_SETTINGS;
const ALIPAY_HEADER = "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,";

function alipay(rows: readonly string[]): Blob {
  return new Blob([["支付宝交易明细", `共 ${rows.length} 笔`, ALIPAY_HEADER, ...rows].join("\n")], { type: "text/csv" });
}

const FILE_A = alipay([
  "2026-09-21 09:22:59,餐饮,示例便利店,a@b.c,午餐,支出,12.34,微信,交易成功,T0001\t,,,",
  "2026-09-22 10:00:00,工资,公司,/,工资,收入,5000.00,银行卡(1234),交易成功,T0002,,,",
  "2026-09-23 11:00:00,商业服务,示例商户,/,取消的订单,支出,99.00,微信,交易关闭,T0003,,,",
]);

async function boot(store = new Map<string, unknown>()) {
  vi.resetModules();
  const storage = await import("./storage.js");
  const backend = createMemoryGuestBackend(store);
  storage.setGuestStorageBackendForTests(backend);
  const runtime = await import("./runtime.js");
  runtime.setGuestRuntimeId(GUEST);
  const data = await import("./data.js");
  const engine = await import("./billImport.js");
  const current = await data.ensureGuestData(GUEST);
  if (current === null) throw new Error("guest data");
  return { backend, data, engine, runtime, bookId: current.book.id, store };
}

function rowsOf(preview: BillImportPreview): BillImportCommitRow[] {
  return preview.candidates.map((item: BillImportCandidate) => ({
    id: item.id, selected: item.selected && !item.identityDuplicate, amount: item.amount, currency: item.currency, kind: item.kind,
    date: item.date, time: item.time, timezone: item.timezone, categoryId: item.categoryId, paymentMethodId: item.paymentMethodId,
    note: item.note, tags: [...item.tags],
  }));
}

beforeEach(() => {
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("游客本机导入账单", () => {
  it("预览 → 提交：只写游客库，整批只写一次 blob；金额是整数分，来源身份与文件指纹记在同一个 blob 里", async () => {
    const { backend, data, engine, bookId, store } = await boot();
    const preview = await engine.guestPreviewBill(FILE_A, bookId, settings, "Asia/Shanghai");
    expect(preview.source).toBe("alipay");
    expect(preview.candidates.map((item) => [item.amount, item.kind, item.selected, item.sourceRef])).toEqual([
      ["12.34", "expense", true, "alipay:T0001"],
      ["5000.00", "income", true, "alipay:T0002"],
      ["99.00", "unknown", false, "alipay:T0003"],
    ]);
    // 支付方式按账本里的名字匹配（游客预置“微信”“银行卡”）。
    const wechat = data.guestDataValue()!.paymentMethods.find((method) => method.name === "微信")!;
    expect(preview.candidates[0]?.paymentMethodId).toBe(wechat.id);

    const writesBefore = backend.mutations();
    const report = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: preview.revision, rows: rowsOf(preview), acknowledgeWarnings: false }, bookId);
    expect(backend.mutations() - writesBefore).toBe(1);
    expect(report).toMatchObject({ ok: true, rowCount: 3, importedCount: 2, skippedCount: 1, skippedLines: [6], errors: [] });
    expect(report.fileRef).toMatch(/^In-/);

    const entries = data.guestTransactions();
    expect(entries.map((entry) => [entry.amountCents, entry.kind, entry.currency, entry.occurredLocalDate]).sort()).toEqual([
      [1234, "expense", "CNY", "2026-09-21"],
      [500000, "income", "CNY", "2026-09-22"],
    ]);
    // 账目 id 就是候选 id（附件按候选 id 关联到写入后的账目，`billAttachmentMapping`）。
    expect(new Set(entries.map((entry) => entry.id))).toEqual(new Set(preview.candidates.slice(0, 2).map((item) => item.id)));
    expect(entries.find((entry) => entry.amountCents === 1234)?.occurredAt).toBe("2026-09-21T01:22:59.000Z");
    // 只写了游客库的键。
    expect([...store.keys()].every((key) => key.startsWith(`guest:${GUEST}:`))).toBe(true);
    const blob = data.guestDataValue()!;
    expect(blob.billImports).toHaveLength(1);
    expect(Object.keys(blob.billImports![0]!.sourceRefs).sort()).toEqual(["alipay:T0001", "alipay:T0002"]);

    // 同一预览再提交一次：直接复用报告，不再写。
    const again = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: preview.revision, rows: rowsOf(preview), acknowledgeWarnings: false }, bookId);
    expect(again).toEqual(report);
    expect(data.guestTransactions()).toHaveLength(2);

    // 整页重新载入（重新载入模块、从存储读 blob）：导入记录随 blob 读回，同一份文件仍认得出来。
    const reloaded = await boot(store);
    expect(reloaded.data.guestDataValue()?.billImports?.[0]?.fileRef).toBe(report.fileRef);
    const same = await reloaded.engine.guestPreviewBill(FILE_A, reloaded.bookId, settings, "Asia/Shanghai");
    expect(same.candidates.every((item) => item.identityDuplicate)).toBe(true);
  });

  it("同一份文件再导入：整份标成已经导入过；换一份导出里的同一单号：按来源单号跳过（提示与服务器同一原文）", async () => {
    const { data, engine, bookId } = await boot();
    const first = await engine.guestPreviewBill(FILE_A, bookId, settings, "Asia/Shanghai");
    await engine.guestCommitBill({ previewId: first.previewId, previewRevision: 1, rows: rowsOf(first), acknowledgeWarnings: false }, bookId);

    const same = await engine.guestPreviewBill(FILE_A, bookId, settings, "Asia/Shanghai");
    expect(same.candidates.every((item) => item.identityDuplicate && !item.selected)).toBe(true);
    expect(same.warnings.some((warning) => /^这个文件在 \d{4}-\d{2}-\d{2} 已经导入过（2 笔），再次导入不会重复入账。$/.test(warning))).toBe(true);

    const overlapping = alipay([
      "2026-09-21 09:22:59,餐饮,示例便利店,a@b.c,午餐,支出,12.34,微信,交易成功,T0001,,,",
      "2026-09-25 09:00:00,餐饮,示例便利店,a@b.c,晚餐,支出,20.00,微信,交易成功,T0009,,,",
    ]);
    const next = await engine.guestPreviewBill(overlapping, bookId, settings, "Asia/Shanghai");
    const [known, fresh] = next.candidates;
    expect(known?.identityDuplicate).toBe(true);
    expect(known?.warnings.some((warning) => /^来源单号已存在（交易 #\d+，2026-09-21），这一笔会被跳过。$/.test(warning))).toBe(true);
    expect(fresh?.identityDuplicate).toBe(false);
    const report = await engine.guestCommitBill({ previewId: next.previewId, previewRevision: 1, rows: rowsOf(next), acknowledgeWarnings: false }, bookId);
    expect(report).toMatchObject({ ok: true, importedCount: 1 });
    expect(data.guestTransactions()).toHaveLength(3);
  });

  it("疑似重复：与游客账本里已有的账目比对（本机数据），只提示不取消勾选", async () => {
    const { engine, bookId } = await boot();
    const first = await engine.guestPreviewBill(FILE_A, bookId, settings, "Asia/Shanghai");
    await engine.guestCommitBill({ previewId: first.previewId, previewRevision: 1, rows: rowsOf(first), acknowledgeWarnings: false }, bookId);
    // 另一份导出、另一单号，但金额 / 时间 / 方向相同。
    const lookalike = alipay(["2026-09-21 09:23:10,餐饮,示例便利店,a@b.c,午餐,支出,12.34,微信,交易成功,X0001,,,"]);
    const preview = await engine.guestPreviewBill(lookalike, bookId, settings, "Asia/Shanghai");
    expect(preview.candidates[0]).toMatchObject({ selected: true, identityDuplicate: false });
    expect(preview.candidates[0]?.duplicateIds).toHaveLength(1);
    expect(preview.candidates[0]?.warnings.some((warning) => /^与账本已有交易 #\d+（2026-09-21 12\.34 CNY）疑似重复，请核对。$/.test(warning))).toBe(true);
  });

  it("核对：改了字段不重新检查就提交 → preview_stale；重新检查后旧 revision 提交 → preview_revision_mismatch", async () => {
    const { engine, bookId } = await boot();
    const preview = await engine.guestPreviewBill(FILE_A, bookId, settings, "Asia/Shanghai");
    const edited = rowsOf(preview).map((row, index) => (index === 0 ? { ...row, amount: "13.00" } : row));
    await expect(engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: edited, acknowledgeWarnings: false }, bookId))
      .rejects.toMatchObject({ status: 409, code: "preview_stale" });
    const rechecked = await engine.guestRecheckBill(preview.previewId, edited, bookId, settings);
    expect(rechecked.revision).toBe(2);
    await expect(engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: rowsOf(rechecked), acknowledgeWarnings: false }, bookId))
      .rejects.toMatchObject({ status: 409, code: "preview_revision_mismatch" });
    const report = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 2, rows: rowsOf(rechecked), acknowledgeWarnings: false }, bookId);
    expect(report).toMatchObject({ ok: true, importedCount: 2 });
    await expect(engine.guestRecheckBill("00000000-0000-4000-8000-000000000000", [], bookId, settings)).rejects.toMatchObject({ status: 410, code: "preview_expired" });
  });

  it("Libevra CSV：标签按名字新建（颜色与服务器相同）；会让游客账本迁不过去的备注被挡住、一笔不写", async () => {
    const { data, engine, bookId } = await boot();
    const header = EXPORT_COLUMNS.map((column) => column.header);
    const line = (values: Record<string, string>) => EXPORT_COLUMNS.map((column) => values[column.key] ?? "").join(",");
    const csv = [header.join(","),
      line({ occurredLocalDate: "2026-10-01", occurredTime: "08:00", kind: "支出", amount: "8.80", currency: "CNY", category: "交通", tags: "通勤 地铁", sourceRef: "lib-1" }),
      line({ occurredLocalDate: "2026-10-02", kind: "支出", amount: "1", currency: "JPY", note: "x".repeat(501), sourceRef: "lib-2" }),
    ].join("\n");
    const preview = await engine.guestPreviewBill(new Blob([csv]), bookId, settings, "Asia/Shanghai");
    expect(preview.source).toBe("libevra");
    expect(preview.candidates[1]?.warnings).toContain("提交前需要处理：备注超过 500 个字，游客账本转为正式账号时无法迁移，请缩短。");

    const blocked = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: rowsOf(preview), acknowledgeWarnings: false }, bookId);
    expect(blocked).toMatchObject({ ok: false, importedCount: 0, errors: [{ line: 3, column: "note" }] });
    expect(data.guestTransactions()).toHaveLength(0);

    const fixed = rowsOf(preview).map((row, index) => (index === 1 ? { ...row, note: "改短了" } : row));
    const rechecked = await engine.guestRecheckBill(preview.previewId, fixed, bookId, settings);
    const report = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: rechecked.revision, rows: rowsOf(rechecked), acknowledgeWarnings: false }, bookId);
    expect(report).toMatchObject({ ok: true, importedCount: 2 });
    const tags = data.guestDataValue()!.tags.filter((tag) => ["通勤", "地铁"].includes(tag.name));
    expect(tags.map((tag) => tag.color)).toEqual(["#55997a", "#55997a"]);
    const transport = data.guestTransactions().find((entry) => entry.amountCents === 880)!;
    expect(transport.categoryName).toBe("交通");
    expect(transport.tags.map((tag) => tag.name)).toEqual(["通勤", "地铁"]);
    // JPY 没有小数位：1 → 1；没选分类时落到系统分类。
    expect(data.guestTransactions().find((entry) => entry.currency === "JPY")).toMatchObject({ amountCents: 1, categoryIsSystem: true });
  });

  it("微信 XLSX：浏览器端抽取 + 共享解析器，写进游客账本", async () => {
    const { data, engine, bookId } = await boot();
    const strings = ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注", "商户消费", "便利店", "饮料", "支出", "零钱", "支付成功", "/"];
    const sc = (ref: string, text: string) => `<c r="${ref}" t="s"><v>${strings.indexOf(text)}</v></c>`;
    const header = `<row r="17">${strings.slice(0, 11).map((text, index) => sc(`${String.fromCharCode(65 + index)}17`, text)).join("")}</row>`;
    const row = `<row r="18"><c r="A18" t="inlineStr"><is><t>2026-09-22 00:27:27</t></is></c>${sc("B18", "商户消费")}${sc("C18", "便利店")}${sc("D18", "饮料")}${sc("E18", "支出")}` +
      `<c r="F18"><v>18</v></c>${sc("G18", "零钱")}${sc("H18", "支付成功")}<c r="I18"><v>4200000000000000000000000000000000001234</v></c>${sc("J18", "/")}${sc("K18", "/")}</row>`;
    const xlsx = await makeXlsx({ sharedStrings: strings, sheets: [{ name: "Sheet1", rows: [header, row] }] });
    const preview = await engine.guestPreviewBill(new Blob([xlsx as Uint8Array<ArrayBuffer>]), bookId, settings, "Asia/Shanghai", { extract: { xmlParser: parseXmlForTests } });
    expect(preview).toMatchObject({ source: "wechat", format: "xlsx" });
    expect(preview.candidates[0]).toMatchObject({ amount: "18.00", line: 18, sourceRef: "wechat:4200000000000000000000000000000000001234" });
    await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: rowsOf(preview), acknowledgeWarnings: false }, bookId);
    expect(data.guestTransactions()[0]).toMatchObject({ amountCents: 1800, occurredLocalDate: "2026-09-22" });
  });

  it("错误码与服务器相同：认不出的文件 400、空文件 400、解析器加载失败 503", async () => {
    const { engine, bookId } = await boot();
    await expect(engine.guestPreviewBill(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]), bookId, settings, "Asia/Shanghai"))
      .rejects.toMatchObject({ status: 400, code: "unsupported_format" });
    await expect(engine.guestPreviewBill(new Blob([]), bookId, settings, "Asia/Shanghai")).rejects.toMatchObject({ status: 400, code: "empty_file" });
    await expect(engine.guestPreviewBill(FILE_A, bookId, settings, "Mars/Base")).rejects.toMatchObject({ status: 400, code: "invalid_timezone" });
    // pdf.js 那一块没加载到（离线且没缓存）：和服务器 Python 不可用一样是 503，不说成文件有问题。
    const pdf = new Blob(["%PDF-1.4\nnot really"]);
    const { BillParseError } = await import("@libellum/shared/billParsers");
    await expect(engine.guestPreviewBill(pdf, bookId, settings, "Asia/Shanghai", { extract: { openPdf: async () => { throw new BillParseError("parser_unavailable", "x"); } } }))
      .rejects.toMatchObject({ status: 503, code: "import_parser_unavailable" });
  });

  it("写进地址里的另一本游客账本：不动当前快照；那本账删掉之后再提交被拒绝", async () => {
    const { data, engine, bookId } = await boot();
    const other = await data.createGuestBook("旅行");
    const preview = await engine.guestPreviewBill(FILE_A, other.id, settings, "Asia/Shanghai");
    const report = await engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: rowsOf(preview), acknowledgeWarnings: false }, other.id);
    expect(report).toMatchObject({ ok: true, importedCount: 2 });
    expect(data.guestTransactions()).toHaveLength(0);
    expect((await data.loadGuestDataFor(other.id)).transactions).toHaveLength(2);
    // 预览属于那本账：拿到别的账本上提交视同不存在。
    await expect(engine.guestCommitBill({ previewId: preview.previewId, previewRevision: 1, rows: rowsOf(preview), acknowledgeWarnings: false }, bookId))
      .rejects.toMatchObject({ code: "preview_expired" });

    const third = await data.createGuestBook("临时");
    const pending = await engine.guestPreviewBill(FILE_A, third.id, settings, "Asia/Shanghai");
    await data.deleteGuestBook(third.id);
    await expect(engine.guestCommitBill({ previewId: pending.previewId, previewRevision: 1, rows: rowsOf(pending), acknowledgeWarnings: false }, third.id)).rejects.toThrow();
    expect((await data.listGuestLedgers()).some((ledger) => ledger.id === third.id)).toBe(false);
  });

  it("lib/billImport.ts：游客模式下预览 / 核对 / 提交都不发请求", async () => {
    const { bookId } = await boot();
    const fetch = vi.fn(async () => { throw new Error("游客不该联网"); });
    vi.stubGlobal("fetch", fetch);
    const api = await import("../billImport.js");
    const preview = await api.previewBill(FILE_A as File, bookId, settings, "Asia/Shanghai");
    const rechecked = await api.recheckBill(preview, bookId, settings);
    const report = await api.commitBill(rechecked, bookId, false);
    expect(report).toMatchObject({ ok: true, importedCount: 2 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("转正式账号上限的提醒", () => {
  it("导入后超过 2 万笔（1.19.97 分段迁移的上限）或 200 个标签才提醒；标签按名字去重", () => {
    expect(guestMigrationReminder({ existingTransactions: 4990, importable: 11, existingTagNames: [], importTagNames: [] })).toBeNull();
    expect(guestMigrationReminder({ existingTransactions: 19_990, importable: 10, existingTagNames: [], importTagNames: [] })).toBeNull();
    expect(guestMigrationReminder({ existingTransactions: 19_990, importable: 11, existingTagNames: [], importTagNames: [] }))
      .toEqual({ transactions: 20_001, tags: 0, overTransactions: true, overTags: false });
    const existing = Array.from({ length: 199 }, (_, index) => `t${index}`);
    expect(guestMigrationReminder({ existingTransactions: 1, importable: 1, existingTagNames: existing, importTagNames: ["t1", "新", "新"] })).toBeNull();
    expect(guestMigrationReminder({ existingTransactions: 1, importable: 1, existingTagNames: existing, importTagNames: ["新", "又一个"] }))
      .toMatchObject({ tags: 201, overTags: true, overTransactions: false });
  });

  it("导入页在核对与确认步骤显示提醒（只对游客）", () => {
    const page = readFileSync(fileURLToPath(new URL("../../pages/ImportPage.tsx", import.meta.url)), "utf8");
    expect(page).toContain("!guest || check === null");
    expect(page).toContain('t("dataio.import.guestLimitTransactions"');
    expect(page).toContain("...migrationNotes,");
    expect(page).toContain("data-guest-migration-limit");
  });
});
