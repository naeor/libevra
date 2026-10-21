import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { billImportPreviewSchema, type BillImportCommitRow, type BillImportPreview } from "@libellum/shared";
import type { FastifyInstance } from "fastify";

import type { DocumentExtractor } from "../src/import/extractor.js";
import type { ExtractedDocument } from "../src/import/types.js";
import { ledgerOf, makeApp, prisma, resetDatabase, signUp } from "./support.js";

const SETTINGS = {
  enabled: true,
  timeWindowSeconds: 60,
  matchCategory: true,
  matchPaymentMethod: true,
};

interface MultipartInput {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

function multipart(input: MultipartInput): { boundary: string; body: Buffer } {
  const boundary = "----libevra-bill-import-test";
  const chunks = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="settings"\r\n\r\n${JSON.stringify(SETTINGS)}\r\n`,
      "utf8",
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="timezone"\r\n\r\nAsia/Shanghai\r\n`,
      "utf8",
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${input.filename}"\r\n` +
        `Content-Type: ${input.contentType}\r\n\r\n`,
      "utf8",
    ),
    input.content,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ];
  return { boundary, body: Buffer.concat(chunks) };
}

async function previewFile(
  app: FastifyInstance,
  cookie: string,
  bookId: string,
  input: MultipartInput,
): Promise<BillImportPreview> {
  const { boundary, body } = multipart(input);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/import/preview",
    headers: {
      cookie,
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "x-libellum-book": bookId,
    },
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(200);
  return billImportPreviewSchema.parse(response.json());
}

function commitRows(preview: BillImportPreview): BillImportCommitRow[] {
  return preview.candidates.map((candidate) => ({
    id: candidate.id,
    selected: candidate.selected && !candidate.identityDuplicate,
    amount: candidate.amount,
    currency: candidate.currency,
    kind: candidate.kind,
    date: candidate.date,
    time: candidate.time,
    timezone: candidate.timezone,
    categoryId: candidate.categoryId,
    paymentMethodId: candidate.paymentMethodId,
    note: candidate.note,
    tags: candidate.tags,
  }));
}

const ALIPAY_CSV = [
  "支付宝交易明细",
  "共2笔",
  "------------------------------------",
  "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,",
  "2026-10-01 10:00:00,商业服务,测试商户甲,/,测试商品,支出,12.34,招商银行储蓄卡(1399),交易成功,2026100112345678901234567890,202610011234567,",
  "2026-10-02 11:00:00,商业服务,测试商户乙,/,退款,不计收支,12.34,招商银行储蓄卡(1399),交易成功,2026100212345678901234567890,202610021234567,",
].join("\r\n");

const LIBEVRA_CSV = [
  "日期,金额,币种,类型,分类,支付方式,备注,来源编号",
  "2026-10-01,12.34,CNY,支出,餐饮,,测试备注,SRC-1",
].join("\r\n");

function wechatDocument(): ExtractedDocument {
  return {
    format: "xlsx",
    pages: [],
    sheets: [
      {
        name: "Sheet1",
        rows: [
          { line: 1, cells: ["微信支付账单明细"] },
          { line: 2, cells: ["共2笔"] },
          {
            line: 3,
            cells: [
              "交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)",
              "支付方式", "当前状态", "交易单号", "商户单号", "备注",
            ],
          },
          {
            line: 4,
            cells: [
              "2026-09-22 00:27:27", "转账", "测试好友", "转账备注", "支出", "0.10",
              "零钱", "支付成功", "4200000000000000000000000000000000001234", "/", "/",
            ],
          },
          {
            line: 5,
            cells: [
              "2026-09-23 10:00:00", "商户消费", "测试商户", "商品", "收入", "50.00",
              "/", "已全额退款", "4200000000000000000000000000000000005678", "/", "",
            ],
          },
        ],
      },
    ],
  };
}

function boaDocument(options: { readonly depositTotal?: string; readonly ending?: string } = {}): ExtractedDocument {
  const depositTotal = options.depositTotal ?? "$600.00";
  const ending = options.ending ?? "$1,100.00";
  const line = (y: number, spans: readonly { x: number; text: string }[]) => ({ y, spans });
  return {
    format: "pdf",
    sheets: [],
    pages: [
      [
        line(700, [{ x: 36, text: "Beginning balance on September 18, 2026" }, { x: 500, text: "$1,000.00" }]),
        line(680, [{ x: 36, text: "Deposits and other additions" }, { x: 500, text: "600.00" }]),
        line(660, [{ x: 36, text: "ATM and debit card subtractions" }, { x: 500, text: "-500.00" }]),
        line(640, [{ x: 36, text: "Other subtractions" }, { x: 500, text: "-0.00" }]),
        line(620, [{ x: 36, text: "Service fees" }, { x: 500, text: "-0.00" }]),
        line(600, [{ x: 36, text: "Ending balance on October 19, 2026" }, { x: 500, text: ending }]),
        line(580, [{ x: 36, text: "Account summary" }]),
      ],
      [
        line(700, [{ x: 36, text: "Date" }, { x: 90, text: "Description" }, { x: 540, text: "Amount" }]),
        line(680, [{ x: 36, text: "Deposits and other additions" }]),
        line(660, [{ x: 36, text: "09/18/26" }, { x: 90, text: "PAYROLL DEPOSIT" }, { x: 540, text: "600.00" }]),
        line(640, [{ x: 36, text: "ATM and debit card subtractions" }]),
        line(620, [{ x: 36, text: "09/19/26" }, { x: 90, text: "CARD PURCHASE" }, { x: 540, text: "-500.00" }]),
        line(600, [{ x: 36, text: "Total deposits and other additions" }, { x: 500, text: depositTotal }]),
        line(580, [{ x: 36, text: "Total ATM and debit card subtractions" }, { x: 500, text: "-$500.00" }]),
        line(560, [{ x: 36, text: "Total other subtractions" }, { x: 500, text: "-$0.00" }]),
        line(540, [{ x: 36, text: "Total service fees" }, { x: 500, text: "-$0.00" }]),
        line(520, [{ x: 36, text: "Page 2 of 2" }]),
      ],
    ],
  };
}

function stubExtractor(document: ExtractedDocument): DocumentExtractor {
  return { extract: async () => document };
}

async function owner(app: FastifyInstance, username: string) {
  const cookie = await signUp(app, username);
  const ledger = await ledgerOf(app, cookie);
  return { cookie, bookId: ledger.book.id, ledger };
}

describe("bill import V2 preview/commit routes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("parses an Alipay CSV by content and excludes no-flow rows", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_alipay");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "任意名字.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });

    expect(preview.source).toBe("alipay");
    expect(preview.format).toBe("csv");
    expect(preview.candidates).toHaveLength(2);

    const [expense, neutral] = preview.candidates;
    expect(expense).toMatchObject({
      amount: "12.34",
      currency: "CNY",
      kind: "expense",
      date: "2026-10-01",
      time: "10:00:00",
      timePrecision: "second",
      sourceRef: "alipay:2026100112345678901234567890",
      selected: true,
    });
    expect(neutral).toMatchObject({ kind: "unknown", selected: false });
    expect(neutral?.warnings.join("")).toContain("不计收支");
  });

  it("parses a Libevra CSV with the existing export columns", async () => {
    const app = makeApp();
    const { cookie, bookId, ledger } = await owner(app, "bill_libevra");
    const category = ledger.categories.find((item) => item.kind === "expense" && !item.isArchived);
    expect(category).toBeDefined();
    const csv = [
      "日期,金额,币种,类型,分类,支付方式,备注,来源编号",
      `2026-10-01,12.34,CNY,支出,${category?.name},,测试备注,SRC-1`,
    ].join("\r\n");

    const preview = await previewFile(app, cookie, bookId, {
      filename: "账单.csv",
      contentType: "text/csv",
      content: Buffer.from(csv, "utf8"),
    });

    expect(preview.source).toBe("libevra");
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({
      amount: "12.34",
      kind: "expense",
      categoryId: category?.id,
      sourceRef: "SRC-1",
      note: "测试备注",
    });
  });

  it("skips re-imported Libevra rows whose file id is already a transaction id", async () => {
    const app = makeApp();
    const { cookie, bookId, ledger } = await owner(app, "bill_libevra_id");
    const category = ledger.categories.find((item) => item.kind === "expense" && !item.isArchived);
    expect(category).toBeDefined();
    const firstCsv = [
      "日期,金额,币种,类型,分类,支付方式,备注,来源编号",
      `2026-10-01,12.34,CNY,支出,${category?.name},,测试备注,SRC-1`,
    ].join("\r\n");
    const first = await previewFile(app, cookie, bookId, {
      filename: "libevra.csv",
      contentType: "text/csv",
      content: Buffer.from(firstCsv, "utf8"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: first.previewId, rows: commitRows(first), acknowledgeWarnings: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    const stored = await prisma.transaction.findFirstOrThrow({ where: { bookId } });

    // 导出再导入：来源编号为空，流水编号是已入账交易 id，旧 /import 会跳过这一行。
    const againCsv = [
      "日期,金额,币种,类型,分类,支付方式,备注,来源编号,流水编号",
      `2026-10-01,12.34,CNY,支出,${category?.name},,测试备注,,${stored.id}`,
    ].join("\r\n");
    const again = await previewFile(app, cookie, bookId, {
      filename: "libevra-again.csv",
      contentType: "text/csv",
      content: Buffer.from(againCsv, "utf8"),
    });
    const candidate = again.candidates[0]!;
    expect(candidate.identityDuplicate).toBe(true);
    expect(candidate.selected).toBe(false);
    expect(candidate.warnings.join("")).toContain("流水编号");
  });

  it("detects WeChat XLSX content without trusting the filename", async () => {
    const app = makeApp({ importExtractor: stubExtractor(wechatDocument()) });
    const { cookie, bookId } = await owner(app, "bill_wechat");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "statement.pdf",
      contentType: "application/pdf",
      // 内容 sniff 只认 ZIP 魔数和工作簿路径；它必须是 xlsx，而不是 .pdf 扩展名。
      content: Buffer.concat([
        Buffer.from("PK\u0003\u0004", "latin1"),
        Buffer.alloc(26),
        Buffer.from("xl/workbook.xml", "latin1"),
      ]),
    });

    expect(preview.source).toBe("wechat");
    expect(preview.format).toBe("xlsx");
    expect(preview.candidates).toHaveLength(2);
    expect(preview.candidates[0]).toMatchObject({ amount: "0.10", kind: "expense", timePrecision: "second" });
    expect(preview.candidates[0]?.sourceRef).toMatch(/^wechat:/);
    expect(preview.candidates[1]?.warnings.join("")).toContain("退款");
  });

  it("reconciles BOA section totals and keeps day precision", async () => {
    const app = makeApp({ importExtractor: stubExtractor(boaDocument()) });
    const { cookie, bookId } = await owner(app, "bill_boa");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "statement.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.7 fake", "latin1"),
    });

    expect(preview.source).toBe("boa");
    expect(preview.format).toBe("pdf");
    expect(preview.reconciliation.ok).toBe(true);
    expect(preview.candidates).toHaveLength(2);
    expect(preview.candidates[0]).toMatchObject({
      amount: "600.00",
      currency: "USD",
      kind: "income",
      date: "2026-09-18",
      time: null,
      timePrecision: "day",
      page: 2,
    });
    expect(preview.candidates[1]).toMatchObject({ amount: "500.00", kind: "expense" });
    expect(preview.candidates[0]?.warnings.join("")).toContain("00:00");
  });

  it("commits selected rows once and re-checks the same preview idempotently", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_commit");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });

    const rows = commitRows(preview);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, acknowledgeWarnings: false },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, rowCount: 2, importedCount: 1, skippedCount: 1 });

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, acknowledgeWarnings: false },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toEqual(first.json());

    expect(await prisma.transaction.count({ where: { bookId } })).toBe(1);
    expect(await prisma.importLog.count({ where: { bookId } })).toBe(1);
    const stored = await prisma.transaction.findFirstOrThrow({ where: { bookId } });
    expect(stored.sourceRef).toBe("alipay:2026100112345678901234567890");
    expect(stored.importRef).toMatch(/^In-/);
    expect(stored.amountCents).toBe(1234n);
  });

  it("marks every candidate as identity-duplicate when the same file is uploaded again", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_reupload");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows: commitRows(preview), acknowledgeWarnings: false },
    });
    expect(response.statusCode, response.body).toBe(200);

    const again = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    expect(again.warnings.join("")).toContain("已经导入过");
    expect(again.candidates.every((candidate) => candidate.identityDuplicate && !candidate.selected)).toBe(true);
  });

  it("flags content duplicates against the existing ledger without deselecting them", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_duplicate");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const committed = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows: commitRows(preview), acknowledgeWarnings: false },
    });
    expect(committed.statusCode, committed.body).toBe(200);
    const stored = await prisma.transaction.findFirstOrThrow({ where: { bookId } });

    // 同一笔交易换了订单号再导出：内容相同、来源身份不同，只能提示疑似重复。
    const renamed = ALIPAY_CSV.replace("2026100112345678901234567890", "2026100199999999999999999999");
    const again = await previewFile(app, cookie, bookId, {
      filename: "alipay-again.csv",
      contentType: "text/csv",
      content: Buffer.from(renamed, "utf8"),
    });
    const candidate = again.candidates[0]!;
    expect(candidate.duplicateIds).toContain(stored.id);
    expect(candidate.identityDuplicate).toBe(false);
    expect(candidate.selected).toBe(true);
    expect(candidate.warnings.join("")).toContain("疑似重复");
  });

  it("marks a reused source reference as identity duplicate even when the file is new", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_identity_ref");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const committed = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows: commitRows(preview), acknowledgeWarnings: false },
    });
    expect(committed.statusCode, committed.body).toBe(200);

    const changed = ALIPAY_CSV.replace("支出,12.34", "支出,99.99");
    const next = await previewFile(app, cookie, bookId, {
      filename: "alipay-changed.csv",
      contentType: "text/csv",
      content: Buffer.from(changed, "utf8"),
    });
    const candidate = next.candidates[0]!;
    expect(candidate.identityDuplicate).toBe(true);
    expect(candidate.selected).toBe(false);
    expect(candidate.warnings.join("")).toContain("来源单号");
    expect(await prisma.transaction.count({ where: { bookId } })).toBe(1);
  });

  it("creates tags named by the user on commit", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_tags");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const rows = commitRows(preview);
    rows[0] = { ...rows[0]!, tags: ["出差", "客户"] };
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, acknowledgeWarnings: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, importedCount: 1 });

    const tags = await prisma.tag.findMany({ where: { bookId }, orderBy: { name: "asc" } });
    expect(tags.map((tag) => tag.name)).toEqual(["出差", "客户"]);
    expect(await prisma.transactionTag.count({ where: { transaction: { bookId } } })).toBe(2);
  });

  it("核对和直接提交允许修正金额币种日期时间时区，并按修正值保存", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_immutable");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const rows = commitRows(preview);
    rows[0] = { ...rows[0]!, amount: "99.99", currency: "USD", date: "2026-10-05", time: "09:12:43", timezone: "America/New_York" };
    const checked = await app.inject({
      method: "POST", url: "/api/v1/import/recheck", headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, settings: SETTINGS },
    });
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json().candidates[0]).toMatchObject({ amount: "99.99", currency: "USD", timePrecision: "second" });
    rows[0] = { ...rows[0]!, amount: "100.01", time: "09:12" };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, acknowledgeWarnings: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, importedCount: 1 });
    const saved = await prisma.transaction.findFirstOrThrow({ where: { bookId } });
    expect(saved.amountCents).toBe(10001n);
    expect(saved.currency).toBe("USD");
    expect(saved.occurredAt.toISOString()).toBe("2026-10-05T13:12:00.000Z");
    expect(saved.occurredLocalDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(saved.occurredTz).toBe("America/New_York");
  });

  it("V2 三接口缺少目标账本头时拒绝，不回退到最早账本", async () => {
    const app = makeApp();
    const { cookie } = await owner(app, "bill_no_target");
    for (const action of ["preview", "recheck", "commit"]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/import/" + action, headers: { cookie }, payload: {} });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "missing_target_book" });
    }
  });

  it("自有导出导入另一账本生成新主键，重复流水两行只导入一笔", async () => {
    const app = makeApp();
    const a = await owner(app, "bill_source_id_a");
    const b = await owner(app, "bill_source_id_b");
    const first = await previewFile(app, a.cookie, a.bookId, { filename: "a.csv", contentType: "text/csv", content: Buffer.from(LIBEVRA_CSV) });
    const saved = await app.inject({ method: "POST", url: "/api/v1/import/commit",
      headers: { cookie: a.cookie, "x-libellum-book": a.bookId },
      payload: { previewId: first.previewId, rows: commitRows(first), acknowledgeWarnings: false } });
    expect(saved.json()).toMatchObject({ ok: true, importedCount: 1 });
    const source = await prisma.transaction.findFirstOrThrow({ where: { bookId: a.bookId } });
    const csv = ["日期,金额,币种,类型,流水编号",
      `2026-10-01,12.34,CNY,支出,${source.id}`,
      `2026-10-01,12.34,CNY,支出,${source.id}`].join("\n");
    const preview = await previewFile(app, b.cookie, b.bookId, { filename: "b.csv", contentType: "text/csv", content: Buffer.from(csv) });
    expect(new Set(preview.candidates.map((row) => row.id)).size).toBe(2);
    expect(preview.candidates.every((row) => row.id !== source.id)).toBe(true);
    const response = await app.inject({ method: "POST", url: "/api/v1/import/commit",
      headers: { cookie: b.cookie, "x-libellum-book": b.bookId },
      payload: { previewId: preview.previewId, rows: commitRows(preview), acknowledgeWarnings: false } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, importedCount: 1, skippedCount: 1 });
    expect(await prisma.transaction.count({ where: { bookId: b.bookId } })).toBe(1);
  });

  it("returns row errors and writes nothing when a selected row is still invalid", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_invalid");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const rows = commitRows(preview);
    rows[0] = { ...rows[0]!, kind: "unknown", selected: true };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, acknowledgeWarnings: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: false, importedCount: 0 });
    expect(await prisma.transaction.count({ where: { bookId } })).toBe(0);
  });

  it("updates editable fields through recheck and keeps read-only fields fixed", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_recheck");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });
    const rows = commitRows(preview);
    rows[0] = { ...rows[0]!, note: "核对后的备注", tags: ["账单导入"] };

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/import/recheck",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { previewId: preview.previewId, rows, settings: SETTINGS },
    });
    expect(response.statusCode, response.body).toBe(200);
    const updated = billImportPreviewSchema.parse(response.json());
    expect(updated.candidates[0]).toMatchObject({ note: "核对后的备注", tags: ["账单导入"] });
  });

  it("requires explicit acknowledgement when BOA reconciliation fails", async () => {
    const app = makeApp({
      importExtractor: stubExtractor(boaDocument({ depositTotal: "$700.00" })),
    });
    const { cookie, bookId } = await owner(app, "bill_boa_mismatch");
    const preview = await previewFile(app, cookie, bookId, {
      filename: "statement.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.7 fake", "latin1"),
    });
    expect(preview.reconciliation.ok).toBe(false);
    const payload = { previewId: preview.previewId, rows: commitRows(preview), acknowledgeWarnings: false };

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ code: "reconciliation_not_acknowledged" });

    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/import/commit",
      headers: { cookie, "x-libellum-book": bookId },
      payload: { ...payload, acknowledgeWarnings: true },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ ok: true, importedCount: 2 });
  });

  it("rejects unsupported content and files over the size or row limits", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_limits");

    const notes = multipart({
      filename: "notes.txt",
      contentType: "text/plain",
      content: Buffer.from("这不是账单文件。", "utf8"),
    });
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: {
        cookie,
        "x-libellum-book": bookId,
        "content-type": `multipart/form-data; boundary=${notes.boundary}`,
      },
      payload: notes.body,
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: "unsupported_format" });

    const big = multipart({
      filename: "big.csv",
      contentType: "text/csv",
      content: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41),
    });
    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: {
        cookie,
        "x-libellum-book": bookId,
        "content-type": `multipart/form-data; boundary=${big.boundary}`,
      },
      payload: big.body,
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json()).toMatchObject({ code: "file_too_large" });

    const tooManyRows = [
      "日期,金额,类型,分类,备注,来源编号",
      ...Array.from({ length: 20_001 }, () => "2026-10-01,1.00,支出,,,"),
    ].join("\n");
    const many = multipart({
      filename: "rows.csv",
      contentType: "text/csv",
      content: Buffer.from(tooManyRows, "utf8"),
    });
    const tooMany = await app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: {
        cookie,
        "x-libellum-book": bookId,
        "content-type": `multipart/form-data; boundary=${many.boundary}`,
      },
      payload: many.body,
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toMatchObject({ code: "import_too_large" });
  });

  it("requires authentication and a target book", async () => {
    const app = makeApp();
    const { cookie, bookId } = await owner(app, "bill_auth");
    const { boundary, body } = multipart({
      filename: "alipay.csv",
      contentType: "text/csv",
      content: Buffer.from(ALIPAY_CSV, "utf8"),
    });

    const anonymous = await app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(anonymous.statusCode).toBe(401);

    const unknownBook = await app.inject({
      method: "POST",
      url: "/api/v1/import/preview",
      headers: {
        cookie,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-libellum-book": "00000000-0000-4000-8000-000000000000",
      },
      payload: body,
    });
    expect(unknownBook.statusCode).toBeGreaterThanOrEqual(400);

    expect(bookId).not.toHaveLength(0);
  });
});
