import { createHash, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DEFAULT_DUPLICATE_DETECTION_SETTINGS } from "../duplicateDetection.js";
import { EXPORT_COLUMNS } from "../export.js";
import type { BillImportCandidate } from "../billImport.js";
import {
  BillParseError,
  BillReviewError,
  buildBillPreview,
  commitRowsAreStale,
  dateTimeToInstant,
  decodeTextFile,
  detectBillDuplicates,
  detectTextHeader,
  makeSourceRef,
  mergeBillRows,
  normalizeAmountText,
  parseAlipayCsv,
  parseBillFile,
  parseBoaPdf,
  parseLibevraCsv,
  parseLocalDate,
  parseWechatXlsx,
  randomUuid,
  resolveBillRow,
  rowsToInsert,
  sha256HexOfBytes,
  sha256HexOfText,
  sniffKind,
  syntheticSourceRef,
  systemCategoryByKind,
  withResolveWarnings,
  type BillDuplicateSource,
  type ExtractedLine,
  type ExtractedSheet,
  type ParseContext,
} from "./index.js";

/**
 * shared 账单解析器的测试（1.19.96 从 `apps/api/test/billImportParsers.test.ts` 移植，输入从 `Buffer` 换成
 * `Uint8Array`；服务器那份测试原样保留、继续跑，证明服务器经转出后的行为不变）。
 *
 * 只用脱敏的合成数据：有真实表头形状，但交易对方、单号、金额全是编的。
 */

const CATEGORY_FOOD = "11111111-1111-4111-8111-111111111111";
const CATEGORY_SYSTEM = "22222222-2222-4222-8222-222222222222";
const PAYMENT_WECHAT = "33333333-3333-4333-8333-333333333333";
const encoder = new TextEncoder();

function context(overrides: Partial<ParseContext> = {}): ParseContext {
  return {
    fingerprint: "a".repeat(64),
    timezone: "Asia/Shanghai",
    categories: [
      { id: CATEGORY_FOOD, name: "餐饮", kind: "expense", isArchived: false },
      { id: CATEGORY_SYSTEM, name: "未分类", kind: "expense", isArchived: false },
    ],
    paymentMethods: [{ id: PAYMENT_WECHAT, name: "零钱", isArchived: false }],
    ...overrides,
  };
}

describe("同步 SHA-256 与 UUID", () => {
  it("与 Node createHash 逐字相同（含 0 / 55 / 56 / 64 字节边界与多块输入）", () => {
    for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256HexOfBytes(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(sha256HexOfText("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexOfText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const text of ["支付宝交易明细", "2026092122000000\t", "😀 emoji", "\ud800 lone surrogate"]) {
      expect(sha256HexOfText(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });

  it("来源单号与原来的 createHash 版本一致（超长单号走哈希、空单号走文件位置）", () => {
    const legacy = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");
    const long = "4".repeat(80);
    expect(makeSourceRef("wechat:", long, "f".repeat(64), 1, 9)).toBe(`wechat:${legacy(long).slice(0, 64 - 7)}`);
    expect(syntheticSourceRef("boa:", "f".repeat(64), 2, 7)).toBe(`boa:${legacy(`${"f".repeat(64)}:2:7`).slice(0, 16)}`);
    expect(makeSourceRef("alipay:", " \t ", "f".repeat(64), 1, 3)).toBe(`alipay:${legacy(`${"f".repeat(64)}:1:3`).slice(0, 16)}`);
  });

  it("randomUuid 总是 v4 UUID；没有 crypto.randomUUID 时（http 局域网）退回 getRandomValues", () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(randomUuid()).toMatch(pattern);
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(pattern);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("sniffKind / decodeTextFile（Uint8Array）", () => {
  it("按内容识别 PDF 与文本，不看扩展名", () => {
    expect(sniffKind(encoder.encode("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffKind(encoder.encode("交易时间,收/支,金额\n"))).toBe("text");
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image");
    expect(sniffKind(new Uint8Array())).toBe("unknown");
  });

  it("识别 ZIP 中的 XLSX 与普通 ZIP", () => {
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encoder.encode("xl/workbook.xml")]))).toBe("xlsx");
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...encoder.encode("word/document.xml")]))).toBe("unknown");
  });

  it("与 Buffer 版一样：1–3 字节的非 PDF 文件在读文件头时抛 RangeError（服务器原有行为）", () => {
    expect(() => sniffKind(new Uint8Array([0x61, 0x62]))).toThrow(RangeError);
    expect(() => Buffer.from([0x61, 0x62]).readUInt32LE(0)).toThrow(RangeError);
  });

  it("UTF-8 BOM 被去掉；严格 UTF-8 失败时回退 GB18030", () => {
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("日期,金额\n")]))).toEqual({ text: "日期,金额\n", encoding: "utf-8" });
    const gb18030 = new Uint8Array(Buffer.from("d6a7b8b6b1a6bdbbd2d7c3f7cfb8", "hex"));
    expect(decodeTextFile(gb18030)).toEqual({ text: "支付宝交易明细", encoding: "gb18030" });
  });
});

const ALIPAY_HEADER = ["交易时间", "交易分类", "交易对方", "对方账号", "商品说明", "收/支", "金额", "收/付款方式", "交易状态", "交易订单号", "商家订单号", "备注"];

describe("支付宝 / 微信 / Libevra / BOA 适配器", () => {
  it("支付宝：清洗单号尾部制表符，不计收支与关闭交易默认排除", () => {
    const rows = [
      ["支付宝交易明细"], ["共 3 笔"], ALIPAY_HEADER,
      ["2026-09-21 09:22:59", "餐饮", "示例商户", "example@example.com", "午餐", "支出", "12.34", "零钱", "交易成功", "20260921220000000000000001\t", "M2026092100001", "", ""],
      ["2026-09-22 10:00:00", "退款", "示例商户", "/", "退款", "不计收支", "12.34", "零钱", "退款成功", "20260921220000000000000002", "/", "", ""],
      ["2026-09-23 11:00:00", "商业服务", "示例商户", "/", "取消的订单", "支出", "99.00", "零钱", "交易关闭", "20260921220000000000000003", "", "", ""],
    ];
    expect(detectTextHeader(rows)).toEqual({ source: "alipay", headerIndex: 2 });
    const bill = parseAlipayCsv(rows, 2, context());
    const [first, refund, closed] = bill.candidates;
    expect(first).toMatchObject({ amount: "12.34", kind: "expense", time: "09:22:59", sourceRef: "alipay:20260921220000000000000001", selected: true, line: 4, paymentMethodId: PAYMENT_WECHAT });
    expect(JSON.stringify(first)).not.toContain("example@example.com");
    expect(refund).toMatchObject({ kind: "unknown", selected: false });
    expect(closed).toMatchObject({ kind: "unknown", selected: false });
    expect(bill.candidates.every((candidate) => /^[0-9a-f-]{36}$/.test(candidate.id))).toBe(true);
  });

  it("微信：/ 当空值，退款保留原方向，没有单号时用文件位置生成来源编号", () => {
    const sheet: ExtractedSheet = { name: "Sheet1", rows: [
      { line: 1, cells: ["微信支付账单明细"] },
      { line: 3, cells: ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"] },
      { line: 4, cells: ["2026-09-22 00:27:27", "商户消费", "示例商户", "咖啡", "支出", "¥18.00", "零钱", "支付成功", "4200000000000000000000000000000001", "/", "/"] },
      { line: 5, cells: ["2026-09-23 12:00:00", "转账-退款", "/", "退款", "收入", "50", "零钱", "已全额退款", "/", "/", "/"] },
    ] };
    const bill = parseWechatXlsx([sheet], context());
    expect(bill.candidates[0]).toMatchObject({ amount: "18.00", sourceRef: "wechat:4200000000000000000000000000000001", line: 4 });
    expect(bill.candidates[1]?.sourceRef).toMatch(/^wechat:[0-9a-f]{16}$/);
  });

  it("Libevra：来源编号不加前缀、金额取绝对值、分类/支付方式按名字匹配", () => {
    const header = EXPORT_COLUMNS.map((column) => column.header);
    const values = new Map<string, string>([["occurredLocalDate", "2026-01-02"], ["occurredTime", "03:04"], ["kind", "支出"],
      ["amount", "-12.34"], ["currency", "CNY"], ["category", "餐饮"], ["paymentMethod", "零钱"], ["tags", "同事 报销"], ["sourceRef", "old-ref-1"]]);
    const row = EXPORT_COLUMNS.map((column) => values.get(column.key) ?? "");
    const bill = parseLibevraCsv([header, row], 0, context());
    expect(bill.candidates[0]).toMatchObject({ amount: "12.34", kind: "expense", categoryId: CATEGORY_FOOD, paymentMethodId: PAYMENT_WECHAT, tags: ["同事", "报销"], sourceRef: "old-ref-1" });
  });

  it("BOA：按分区识别、拼接换行描述、两段对账", () => {
    const line = (y: number, spans: [number, string][]): ExtractedLine => ({ y, spans: spans.map(([x, text]) => ({ x, text })) });
    const pages: ExtractedLine[][] = [[
      line(720, [[36, "Bank of America"]]),
      line(680, [[36, "Beginning balance on September 18, 2026"], [520, "$1,000.00"]]),
      line(660, [[36, "Deposits and other additions"], [520, "500.00"]]),
      line(640, [[36, "ATM and debit card subtractions"], [520, "-300.00"]]),
      line(620, [[36, "Other subtractions"], [520, "-100.00"]]),
      line(580, [[36, "Ending balance on October 19, 2026"], [520, "$1,100.00"]]),
    ], [
      line(760, [[36, "Date"], [90, "Description"], [520, "Amount"]]),
      line(740, [[36, "Deposits and other additions"]]),
      line(720, [[36, "09/21/26"], [90, "PAYROLL"], [520, "500.00"]]),
      line(706, [[90, "REF 123"]]),
      line(690, [[36, "ATM and debit card subtractions"]]),
      line(670, [[36, "09/22/26"], [90, "ATM WITHDRAWAL"], [520, "-300.00"]]),
      line(630, [[36, "Other subtractions"]]),
      line(610, [[36, "09/24/26"], [90, "FEE"], [520, "-100.00"]]),
      line(590, [[36, "Total deposits and other additions"], [520, "$500.00"]]),
      line(570, [[36, "Total ATM and debit card subtractions"], [520, "-$300.00"]]),
      line(550, [[36, "Total other subtractions"], [520, "-$100.00"]]),
    ]];
    const bill = parseBoaPdf(pages, context());
    expect(bill.reconciliation.ok).toBe(true);
    expect(bill.candidates.map((candidate) => [candidate.amount, candidate.kind])).toEqual([["500.00", "income"], ["300.00", "expense"], ["100.00", "expense"]]);
    expect(bill.candidates[0]?.merchant).toBe("PAYROLL REF 123");
  });

  it("日期只接受年在前；金额不四舍五入；本地时间换成绝对时间", () => {
    expect(parseLocalDate("2026/2/8")?.iso).toBe("2026-02-08");
    expect(parseLocalDate("09/21/2026")).toBeNull();
    expect(normalizeAmountText("¥1,234.50", "CNY")).toBe("1234.50");
    expect(normalizeAmountText("12.345", "CNY")).toBeNull();
    expect(dateTimeToInstant("2026-09-22", "00:27:27", "Asia/Shanghai")).toBe("2026-09-21T16:27:27.000Z");
  });
});

describe("parseBillFile 的分派", () => {
  const never = async () => { throw new Error("不该抽取"); };

  it("CSV 直接解析，不调用文档抽取", async () => {
    const csv = [ALIPAY_HEADER.join(","), "2026-09-21 09:22:59,餐饮,商户,,午餐,支出,1.00,零钱,交易成功,T1,,"].join("\n");
    const bill = await parseBillFile(encoder.encode(csv), context(), never);
    expect(bill.source).toBe("alipay");
  });

  it("不支持的格式给出白名单错误码；PDF 不是 BOA 时拒绝", async () => {
    await expect(parseBillFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), context(), never)).rejects.toMatchObject({ code: "unsupported_format" });
    const pdf = encoder.encode("%PDF-1.4 something");
    const notBoa = async () => ({ format: "pdf" as const, sheets: [], pages: [[{ y: 1, spans: [{ x: 1, text: "hello" }] }]] });
    await expect(parseBillFile(pdf, context(), notBoa)).rejects.toBeInstanceOf(BillParseError);
  });
});

function candidate(overrides: Partial<BillImportCandidate> = {}): BillImportCandidate {
  return {
    id: randomUuid(), selected: true, amount: "12.34", currency: "CNY", kind: "expense",
    date: "2026-10-01", time: "10:00:00", timezone: "Asia/Shanghai", categoryId: CATEGORY_FOOD, paymentMethodId: null,
    note: "", tags: [], line: 2, timePrecision: "second", merchant: "", sourceRef: null,
    sourceStatus: "", warnings: [], duplicateIds: [], identityDuplicate: false, ...overrides,
  };
}

function memorySource(overrides: Partial<BillDuplicateSource> = {}): BillDuplicateSource {
  return {
    sourceRefs: async () => [],
    transactionIds: async () => [],
    tags: async () => [],
    history: async () => [],
    ...overrides,
  };
}

describe("判重（数据来源作为参数）", () => {
  it("来源单号已存在、文件内同一来源身份、历史疑似重复：提示与原服务器逐字相同", async () => {
    const a = candidate({ sourceRef: "alipay:A", line: 3 });
    const b = candidate({ sourceRef: "alipay:A", line: 4 });
    const c = candidate({ sourceRef: "alipay:C", line: 5 });
    const d = candidate({ line: 6, amount: "38.00" });
    const historyQueries: unknown[] = [];
    const result = await detectBillDuplicates({
      bookId: "book", candidates: [a, b, c, d], settings: DEFAULT_DUPLICATE_DETECTION_SETTINGS,
      source: memorySource({
        sourceRefs: async (refs) => refs.includes("alipay:C") ? [{ id: "t-1", sourceRef: "alipay:C", seq: 42, occurredLocalDate: "2026-10-01", deleted: true }] : [],
        history: async (query) => {
          historyQueries.push(query);
          return [{ id: "t-2", seq: 7, kind: "expense", amountCents: 3800, currency: "CNY", occurredAt: "2026-10-01T02:00:00.000Z",
            occurredLocalDate: "2026-10-01", categoryId: CATEGORY_FOOD, paymentMethodId: null, note: null, tagIds: [] }];
        },
      }),
    });
    const [ra, rb, rc, rd] = result.candidates;
    expect(ra?.identityDuplicate).toBe(false);
    expect(rb?.warnings).toContain("文件内第 3 行使用了相同的来源身份，这一笔会被跳过。");
    expect(rc?.warnings).toContain("来源单号已存在（交易 #42，2026-10-01，已删除），这一笔会被跳过。");
    expect(rd?.warnings).toContain("与账本已有交易 #7（2026-10-01 38.00 CNY）疑似重复，请核对。");
    expect(result.warnings).toEqual(["有 2 笔交易的来源身份已存在，导入时会跳过，不会重复写入。", "有 1 笔交易疑似重复，已标出但没有取消勾选。"]);
    // 预筛条件与原来的 SQL 一一对应：金额去重、方向保留重复项、日期区间按时间窗口（向上取整到天）再扩 2 天。
    expect(historyQueries[0]).toEqual({ amountCents: [1234, 3800], kinds: ["expense", "expense"], currencies: ["CNY"],
      dateRange: { from: "2026-09-28", to: "2026-10-04" }, limit: 5001 });
  });
});

describe("核对与提交规则", () => {
  const book = { categories: [{ id: CATEGORY_FOOD, name: "餐饮", kind: "expense" as const, isArchived: false }], paymentMethods: [],
    systemCategoryByKind: systemCategoryByKind([{ id: CATEGORY_SYSTEM, kind: "expense", isSystem: true, isArchived: false }]) };

  it("逐笔校验：金额换成整数分、未选分类落到系统分类、问题写成提交前提示", () => {
    const ok = resolveBillRow(candidate({ amount: "0.10", categoryId: null }), book);
    expect(ok.ok && ok.row.amountCents).toBe(10);
    expect(ok.ok && ok.row.categoryId).toBe(CATEGORY_SYSTEM);
    const bad = withResolveWarnings([candidate({ amount: "1.234" })], book);
    expect(bad[0]?.warnings).toEqual(["提交前需要处理：金额格式不正确，无法转换为最小单位。"]);
  });

  it("合并提交行：重复 / 未知行抛 BillReviewError；改过的字段让对应提示失效", () => {
    const base = candidate({ warnings: ["文件只提供日期，时间按当天 00:00 记录。", "未找到匹配的支付方式「卡」，导入后需手动选择。"] });
    const row = { id: base.id, selected: true, amount: base.amount, currency: base.currency, kind: base.kind, date: base.date,
      time: "11:00", timezone: base.timezone, categoryId: base.categoryId, paymentMethodId: null, note: "", tags: [] };
    expect(() => mergeBillRows({ candidates: [base] }, [row, row])).toThrow(BillReviewError);
    expect(() => mergeBillRows({ candidates: [base] }, [{ ...row, id: randomUuid() }])).toThrow(/与预览不一致/);
    const merged = mergeBillRows({ candidates: [base] }, [row]);
    expect(merged[0]).toMatchObject({ time: "11:00", timePrecision: "minute", warnings: ["未找到匹配的支付方式「卡」，导入后需手动选择。"] });
    expect(commitRowsAreStale([base], [row])).toBe(true);
    expect(commitRowsAreStale(merged, [row])).toBe(false);
  });

  it("要写入的行：已存在的 id / 来源单号与文件内重复的身份都去掉", () => {
    const resolved = [candidate({ sourceRef: "r1" }), candidate({ sourceRef: "r1" }), candidate({ sourceRef: "r2" })]
      .map((item) => { const result = resolveBillRow(item, book); if (!result.ok) throw new Error("bad"); return result.row; });
    expect(rowsToInsert(resolved, new Set(), new Set(["r2"])).map((row) => row.candidate.sourceRef)).toEqual(["r1"]);
  });

  it("文件指纹命中：全部标成身份重复且不判重；对账不一致追加提示", async () => {
    const parsed = { source: "boa" as const, format: "pdf" as const, candidates: [candidate()], warnings: ["w"],
      reconciliation: { ok: false, messages: [] }, totalRows: 1, skippedRows: 0 };
    const parts = await buildBillPreview(parsed, { fileRef: "In-20261020-000000-abcd", importedCount: 12, createdAt: new Date("2026-10-20T01:00:00Z") },
      async () => { throw new Error("不该判重"); });
    expect(parts.candidates[0]).toMatchObject({ selected: false, identityDuplicate: true });
    expect(parts.warnings).toEqual(["w", "这个文件在 2026-10-20 已经导入过（12 笔），再次导入不会重复入账。", "结单对账不一致，确认导入前需要先核对对账信息。"]);
  });
});
