import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS } from "@libellum/shared";

import { parseAlipayCsv } from "../src/import/alipay.js";
import { parseBoaPdf } from "../src/import/boa.js";
import { dateTimeToInstant, normalizeAmountText, parseLocalDate } from "../src/import/common.js";
import { parseLibevraCsv } from "../src/import/libevra.js";
import { decodeTextFile, detectTextHeader, sniffKind } from "../src/import/sniff.js";
import type { ExtractedLine, ExtractedSheet, ParseContext } from "../src/import/types.js";
import { parseWechatXlsx } from "../src/import/wechat.js";

/**
 * 适配器单元测试只用脱敏的合成数据。
 *
 * 真实样本（本机 private-samples）绝不进仓库/夹具：这里有真实表头形状，
 * 但交易对方、单号、金额全是编的。
 */

const CATEGORY_FOOD = "11111111-1111-4111-8111-111111111111";
const CATEGORY_SYSTEM = "22222222-2222-4222-8222-222222222222";
const PAYMENT_WECHAT = "33333333-3333-4333-8333-333333333333";

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

describe("sniffKind / decodeTextFile", () => {
  it("按内容识别 PDF 与文本，不看扩展名", () => {
    expect(sniffKind(Buffer.from("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffKind(Buffer.from("交易时间,收/支,金额\n"))).toBe("text");
    expect(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image");
  });

  it("识别 ZIP 中的 XLSX 与普通 ZIP", () => {
    const xlsxLike = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("xl/workbook.xml", "latin1"),
    ]);
    expect(sniffKind(xlsxLike)).toBe("xlsx");
  });

  it("UTF-8 BOM 被去掉，内容按 UTF-8 解码", () => {
    const decoded = decodeTextFile(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("日期,金额\n")]));
    expect(decoded).toEqual({ text: "日期,金额\n", encoding: "utf-8" });
  });

  it("严格 UTF-8 失败时回退 GB18030（支付宝中文导出的真实编码）", () => {
    // “支付宝交易明细”的 GB18030 字节；真实导出无 BOM，且不是合法 UTF-8。
    const gb18030 = Buffer.from("d6a7b8b6b1a6bdbbd2d7c3f7cfb8", "hex");
    expect(decodeTextFile(gb18030)).toEqual({ text: "支付宝交易明细", encoding: "gb18030" });
  });
});

describe("detectTextHeader", () => {
  it("跳过说明区，找到支付宝表头", () => {
    const rows = [
      ["支付宝交易明细"],
      ["共 1 笔"],
      ["", "", ""],
      [
        "交易时间",
        "交易分类",
        "交易对方",
        "对方账号",
        "商品说明",
        "收/支",
        "金额",
        "收/付款方式",
        "交易状态",
        "交易订单号",
        "商家订单号",
        "备注",
        "",
      ],
    ];
    expect(detectTextHeader(rows)).toEqual({ source: "alipay", headerIndex: 3 });
  });

  it("找到 Libevra 自有 CSV 表头", () => {
    const rows = [EXPORT_COLUMNS.map((column) => column.header)];
    expect(detectTextHeader(rows)).toEqual({ source: "libevra", headerIndex: 0 });
  });
});

describe("parseAlipayCsv", () => {
  const header = [
    "交易时间",
    "交易分类",
    "交易对方",
    "对方账号",
    "商品说明",
    "收/支",
    "金额",
    "收/付款方式",
    "交易状态",
    "交易订单号",
    "商家订单号",
    "备注",
  ];
  const rows = [
    ["支付宝交易明细"],
    ["共 3 笔"],
    header,
    [
      "2026-09-21 09:22:59",
      "餐饮",
      "示例商户",
      "example@example.com",
      "午餐",
      "支出",
      "12.34",
      "零钱",
      "交易成功",
      "20260921220000000000000001\t",
      "M2026092100001",
      "",
      "",
    ],
    [
      "2026-09-22 10:00:00",
      "退款",
      "示例商户",
      "/",
      "退款",
      "不计收支",
      "12.34",
      "零钱",
      "退款成功",
      "20260921220000000000000002",
      "/",
      "",
      "",
    ],
    [
      "2026-09-23 11:00:00",
      "商业服务",
      "示例商户",
      "/",
      "取消的订单",
      "支出",
      "99.00",
      "零钱",
      "交易关闭",
      "20260921220000000000000003",
      "",
      "",
      "",
    ],
  ];

  it("保留金额/时间/方向，清洗单号尾部制表符，把不计收支和关闭交易默认排除", () => {
    const bill = parseAlipayCsv(rows, 2, context());
    expect(bill.source).toBe("alipay");
    expect(bill.format).toBe("csv");
    expect(bill.totalRows).toBe(3);
    expect(bill.candidates).toHaveLength(3);

    const [first, refund, closed] = bill.candidates;
    expect(first).toMatchObject({
      amount: "12.34",
      currency: "CNY",
      kind: "expense",
      date: "2026-09-21",
      time: "09:22:59",
      timePrecision: "second",
      sourceRef: "alipay:20260921220000000000000001",
      selected: true,
      line: 4,
    });
    // 对方账号（邮箱）不落库。
    expect(first?.note).toContain("午餐");
    expect(JSON.stringify(first)).not.toContain("example@example.com");

    expect(refund).toMatchObject({ kind: "unknown", selected: false });
    expect(refund?.warnings.join(" ")).toContain("不计收支");

    expect(closed).toMatchObject({ kind: "unknown", selected: false });
    expect(closed?.warnings.join(" ")).toContain("交易关闭");
    expect(bill.warnings.join(" ")).toContain("默认排除");
  });

  it("没有单号时按文件位置生成来源编号，而不是共用空字符串", () => {
    const noRefRows = [
      header,
      ["2026-09-21 09:22:59", "餐饮", "商户", "", "午餐", "支出", "1.00", "零钱", "交易成功", "/", "/", ""],
      ["2026-09-21 09:23:59", "餐饮", "商户", "", "晚餐", "支出", "2.00", "零钱", "交易成功", "/", "/", ""],
    ];
    const bill = parseAlipayCsv(noRefRows, 0, context());
    const refs = bill.candidates.map((candidate) => candidate.sourceRef);
    expect(new Set(refs).size).toBe(2);
    expect(refs.every((ref) => ref?.startsWith("alipay:") && ref.length <= 64)).toBe(true);
  });
});

describe("parseWechatXlsx", () => {
  const sheetRows: ExtractedSheet["rows"] = [
    { line: 1, cells: ["微信支付账单明细"] },
    { line: 2, cells: ["共 2 笔"] },
    {
      line: 3,
      cells: [
        "交易时间",
        "交易类型",
        "交易对方",
        "商品",
        "收/支",
        "金额(元)",
        "支付方式",
        "当前状态",
        "交易单号",
        "商户单号",
        "备注",
      ],
    },
    {
      line: 4,
      cells: [
        "2026-09-22 00:27:27",
        "商户消费",
        "示例商户",
        "咖啡",
        "支出",
        "18.00",
        "零钱",
        "支付成功",
        "4200000000000000000000000000000001",
        "/",
        "/",
      ],
    },
    {
      line: 5,
      cells: [
        "2026-09-23 12:00:00",
        "转账-退款",
        "/",
        "退款",
        "收入",
        "50",
        "零钱",
        "已全额退款",
        "/",
        "/",
        "/",
      ],
    },
  ];

  it("扫描说明区后的表头，/ 当空值，退款保留原方向并警告", () => {
    const bill = parseWechatXlsx([{ name: "Sheet1", rows: sheetRows }], context());
    expect(bill.source).toBe("wechat");
    expect(bill.format).toBe("xlsx");
    expect(bill.totalRows).toBe(2);
    expect(bill.candidates).toHaveLength(2);

    const [paid, refund] = bill.candidates;
    expect(paid).toMatchObject({
      amount: "18.00",
      kind: "expense",
      date: "2026-09-22",
      time: "00:27:27",
      timePrecision: "second",
      merchant: "示例商户",
      paymentMethodId: PAYMENT_WECHAT,
      selected: true,
      line: 4,
    });
    expect(paid?.sourceRef).toBe("wechat:4200000000000000000000000000000001");

    expect(refund).toMatchObject({ kind: "income", selected: true, line: 5 });
    expect(refund?.warnings.join(" ")).toContain("已全额退款");
    // `/` 不能被当成交易单号共用 wechat:/。
    expect(refund?.sourceRef).toMatch(/^wechat:[0-9a-f]{16}$/);
    expect(bill.warnings.join(" ")).toContain("退款");
  });
});

describe("parseLibevraCsv", () => {
  it("保持旧导出语义：来源编号不加前缀、金额取绝对值、分类/支付方式按名字匹配", () => {
    const header = EXPORT_COLUMNS.map((column) => column.header);
    const values = new Map(EXPORT_COLUMNS.map((column) => [column.key, ""]));
    values.set("occurredLocalDate", "2026-01-02");
    values.set("occurredTime", "03:04");
    values.set("occurredTz", "Asia/Shanghai");
    values.set("kind", "支出");
    values.set("amount", "-12.34");
    values.set("currency", "CNY");
    values.set("category", "餐饮");
    values.set("paymentMethod", "零钱");
    values.set("note", "午饭");
    values.set("tags", "同事 报销");
    values.set("sourceRef", "old-ref-1");
    const row = header.map((h) => {
      const column = EXPORT_COLUMNS.find((item) => item.header === h);
      return column === undefined ? "" : (values.get(column.key) ?? "");
    });

    const bill = parseLibevraCsv([header, row], 0, context());
    expect(bill.source).toBe("libevra");
    expect(bill.candidates).toHaveLength(1);
    expect(bill.candidates[0]).toMatchObject({
      amount: "12.34",
      kind: "expense",
      date: "2026-01-02",
      time: "03:04",
      timePrecision: "minute",
      categoryId: CATEGORY_FOOD,
      paymentMethodId: PAYMENT_WECHAT,
      tags: ["同事", "报销"],
      note: "午饭",
      sourceRef: "old-ref-1",
      selected: true,
    });
  });

  it("缺日期列时报 missing_column", () => {
    expect(() => parseLibevraCsv([["金额", "类型"], ["1.00", "支出"]], 0, context())).toThrow(
      /日期或金额/,
    );
  });
});

function line(y: number, spans: [number, string][]): ExtractedLine {
  return { y, spans: spans.map(([x, text]) => ({ x, text })) };
}

describe("parseBoaPdf", () => {
  it("按分区识别交易、拼接换行描述、核对三段合计与余额", () => {
    const pages: ExtractedLine[][] = [
      [
        line(720, [[36, "Bank of America"]]),
        line(700, [[36, "Account summary"]]),
        line(680, [[36, "Beginning balance on September 18, 2026"], [520, "$1,000.00"]]),
        line(660, [[36, "Deposits and other additions"], [520, "500.00"]]),
        line(640, [[36, "ATM and debit card subtractions"], [520, "-300.00"]]),
        line(620, [[36, "Other subtractions"], [520, "-100.00"]]),
        line(600, [[36, "Service fees"], [520, "-0.00"]]),
        line(580, [[36, "Ending balance on October 19, 2026"], [520, "$1,100.00"]]),
      ],
      [
        line(760, [[36, "Date"], [90, "Description"], [520, "Amount"]]),
        line(740, [[36, "Deposits and other additions"]]),
        line(720, [[36, "09/21/26"], [90, "PAYROLL"], [520, "500.00"]]),
        line(706, [[90, "REF 123"]]),
        line(690, [[36, "ATM and debit card subtractions"]]),
        line(670, [[36, "09/22/26"], [90, "ATM WITHDRAWAL"], [520, "-200.00"]]),
        line(650, [[36, "09/23/26"], [90, "CARD PURCHASE 09/20"], [520, "-100.00"]]),
        line(630, [[36, "Other subtractions"]]),
        line(610, [[36, "09/24/26"], [90, "FEE"], [520, "-100.00"]]),
        line(590, [[36, "Total deposits and other additions"], [520, "$500.00"]]),
        line(570, [[36, "Total ATM and debit card subtractions"], [520, "-$300.00"]]),
        line(550, [[36, "Total other subtractions"], [520, "-$100.00"]]),
        line(40, [[36, "Page 2 of 2"]]),
      ],
    ];

    const bill = parseBoaPdf(pages, context());
    expect(bill.source).toBe("boa");
    expect(bill.format).toBe("pdf");
    expect(bill.totalRows).toBe(4);
    expect(bill.candidates).toHaveLength(4);
    expect(bill.reconciliation.ok).toBe(true);
    expect(bill.reconciliation.messages.join(" ")).toContain("核对一致");

    const [payroll, atm, card, fee] = bill.candidates;
    expect(payroll).toMatchObject({
      amount: "500.00",
      currency: "USD",
      kind: "income",
      date: "2026-09-21",
      time: null,
      timePrecision: "day",
      page: 2,
      line: 3,
    });
    expect(payroll?.merchant).toContain("REF 123");
    expect(atm).toMatchObject({ amount: "200.00", kind: "expense" });
    expect(card).toMatchObject({ amount: "100.00", kind: "expense" });
    expect(card?.warnings.join(" ")).toContain("描述里出现日期 2026-09-20");
    expect(card?.warnings.join(" ")).toContain("与过账日期 2026-09-23 不同");
    expect(card?.date).toBe("2026-09-23");
    expect(fee).toMatchObject({ amount: "100.00", kind: "expense" });
    expect(bill.candidates.every((candidate) => candidate.time === null)).toBe(true);
    expect(bill.warnings.join(" ")).toContain("描述换行");
  });

  it("合计与摘要不一致时 reconciliation.ok=false", () => {
    const pages: ExtractedLine[][] = [
      [
        line(680, [[36, "Beginning balance on September 18, 2026"], [520, "$1,000.00"]]),
        line(660, [[36, "Deposits and other additions"], [520, "500.00"]]),
        line(640, [[36, "ATM and debit card subtractions"], [520, "-300.00"]]),
        line(620, [[36, "Other subtractions"], [520, "-100.00"]]),
        line(600, [[36, "Ending balance on October 19, 2026"], [520, "$1,100.00"]]),
      ],
      [
        line(760, [[36, "Date"], [90, "Description"], [520, "Amount"]]),
        line(740, [[36, "Deposits and other additions"]]),
        line(720, [[36, "09/21/26"], [90, "PAYROLL"], [520, "500.00"]]),
        line(690, [[36, "ATM and debit card subtractions"]]),
        line(670, [[36, "09/22/26"], [90, "ATM WITHDRAWAL"], [520, "-200.00"]]),
        line(630, [[36, "Other subtractions"]]),
        line(610, [[36, "09/24/26"], [90, "FEE"], [520, "-100.00"]]),
        line(590, [[36, "Total deposits and other additions"], [520, "$500.00"]]),
        line(570, [[36, "Total ATM and debit card subtractions"], [520, "-$200.00"]]),
        line(550, [[36, "Total other subtractions"], [520, "-$100.00"]]),
      ],
    ];
    const bill = parseBoaPdf(pages, context());
    expect(bill.reconciliation.ok).toBe(false);
    expect(bill.reconciliation.messages.join(" ")).toMatch(/不一致|应为/);
  });
});

describe("common date/amount helpers", () => {
  it("日期只接受年在前的写法并回读校验", () => {
    expect(parseLocalDate("2026-02-28")?.iso).toBe("2026-02-28");
    expect(parseLocalDate("2026/2/8")?.iso).toBe("2026-02-08");
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("09/21/2026")).toBeNull();
  });

  it("金额不四舍五入，也不接受超过币种精度的写法", () => {
    expect(normalizeAmountText("¥1,234.50", "CNY")).toBe("1234.50");
    expect(normalizeAmountText("(12.30)", "USD")).toBe("-12.30");
    expect(normalizeAmountText("12.345", "CNY")).toBeNull();
  });

  it("按账本时区把本地日期时间换成绝对时间", () => {
    expect(dateTimeToInstant("2026-09-22", "00:27:27", "Asia/Shanghai")).toBe(
      "2026-09-21T16:27:27.000Z",
    );
    expect(dateTimeToInstant("2026-09-22", null, "Asia/Shanghai")).toBe(
      "2026-09-21T16:00:00.000Z",
    );
  });
});
