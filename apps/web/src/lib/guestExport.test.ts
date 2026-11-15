import { inflateRawSync } from "node:zlib";
import { MAX_EXPORT_ROWS, type Transaction } from "@libellum/shared";
import { describe, expect, it } from "vitest";

import { buildGuestExport, buildGuestTemplate, selectGuestExportTransactions } from "./guestExport.js";
import type { GuestData } from "./guest/data.js";

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    seq: 1,
    kind: "expense",
    amountCents: 3850,
    currency: "CNY",
    categoryId: "c1",
    categoryName: "旧名字",
    categoryIsSystem: false,
    paymentMethodId: "pm1",
    paymentMethodName: "旧支付",
    occurredAt: "2026-10-10T04:30:00.000Z",
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    note: null,
    tags: [{ id: "t1", name: "旧标签", color: "#000" }],
    version: 1,
    ...over,
  } as Transaction;
}

const data = {
  schemaVersion: 1,
  book: { id: "b", name: "游客账本" },
  categories: [
    { id: "p", name: "餐饮", kind: "expense", isSystem: false, isArchived: false, sortOrder: 0 },
    { id: "c1", name: "午饭", kind: "expense", parentId: "p", isSystem: false, isArchived: false, sortOrder: 1 },
    { id: "c2", name: "工资", kind: "income", isSystem: false, isArchived: false, sortOrder: 2 },
  ],
  paymentMethods: [{ id: "pm1", name: "微信", isArchived: false, sortOrder: 0 }],
  tags: [{ id: "t1", name: "工作", color: "#000" }],
  transactions: [
    tx({ id: "a", seq: 1, note: "=1+1" }),
    tx({ id: "b", seq: 2, kind: "income", categoryId: "c2", amountCents: 100000, occurredAt: "2026-11-01T01:00:00.000Z", occurredLocalDate: "2026-11-01", paymentMethodId: null, paymentMethodName: null, tags: [], note: "a,\"b\"" }),
    tx({ id: "c", seq: 3, currency: "JPY", amountCents: 800, occurredAt: "2026-09-30T23:00:00.000Z", occurredLocalDate: "2026-10-01", note: null }),
  ],
  deleted: [tx({ id: "gone", seq: 9 })],
  nextSeq: 10,
} as unknown as GuestData;

const NOW = new Date("2026-11-15T08:00:00Z");

function csvLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  expect(text.startsWith("\uFEFF")).toBe(true);
  expect(text.endsWith("\r\n")).toBe(true);
  return text.slice(1).split("\r\n").slice(0, -1);
}

describe("游客 CSV 导出", () => {
  it("逐字节：BOM、表头、\r\n、新的在前、已删除不导出、公式转义、金额带符号", async () => {
    const result = await buildGuestExport(data, { format: "csv" }, NOW);
    expect(result.rowCount).toBe(3);
    expect(result.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));

    const ref = result.fileRef;
    expect(ref).toMatch(/^Out-20261115-/);
    expect(csvLines(result.bytes)).toEqual([
      "编号,日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签,录入时间,流水编号,来源编号,导出编号,分类路径JSON",
      `#000002,2026-11-01,09:00,Asia/Shanghai,收入,1000,CNY,工资,,"a,""b""",,,b,,${ref},"[""工资""]"`,
      `#000001,2026-10-10,12:30,Asia/Shanghai,支出,-38.5,CNY,午饭,微信,'=1+1,工作,,a,,${ref},"[""餐饮"",""午饭""]"`,
      `#000003,2026-10-01,07:00,Asia/Shanghai,支出,-800,JPY,午饭,微信,,工作,,c,,${ref},"[""餐饮"",""午饭""]"`,
    ]);
  });

  it("模板与服务器一致：只有表头", () => {
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buildGuestTemplate());
    expect(text).toBe("\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n");
  });
});

describe("筛选", () => {
  const ids = (filters: Parameters<typeof selectGuestExportTransactions>[1]): string[] =>
    selectGuestExportTransactions(data, filters).map((entry) => entry.id);

  it("月份 / 收支 / 分类 / 支付方式 / 标签 / 币种", () => {
    expect(ids({ format: "csv", monthFrom: "2026-10", monthTo: "2026-10" })).toEqual(["a", "c"]);
    expect(ids({ format: "csv", monthFrom: "2026-11" })).toEqual(["b"]);
    expect(ids({ format: "csv", monthTo: "2026-09" })).toEqual([]);
    expect(ids({ format: "csv", kind: "income" })).toEqual(["b"]);
    expect(ids({ format: "csv", categoryId: "c2" })).toEqual(["b"]);
    expect(ids({ format: "csv", paymentMethodId: "pm1" })).toEqual(["a", "c"]);
    expect(ids({ format: "csv", tagId: "t1" })).toEqual(["a", "c"]);
    expect(ids({ format: "csv", currency: "JPY" })).toEqual(["c"]);
  });

  it("超过上限是错误，不是更短的文件", async () => {
    const many = { ...data, transactions: Array.from({ length: MAX_EXPORT_ROWS + 1 }, (_, i) => tx({ id: `x${String(i)}` })) } as GuestData;
    await expect(buildGuestExport(many, { format: "csv" }, NOW)).rejects.toThrow(String(MAX_EXPORT_ROWS));
  });
});

describe("游客 XLSX 导出", () => {
  function unzip(bytes: Uint8Array): Map<string, string> {
    const buf = Buffer.from(bytes);
    const out = new Map<string, string>();
    let eocd = buf.length - 22;
    while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
    let p = buf.readUInt32LE(eocd + 16);
    for (let n = buf.readUInt16LE(eocd + 10); n > 0; n -= 1) {
      const method = buf.readUInt16LE(p + 10);
      const size = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const skip = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + size);
      out.set(buf.toString("utf8", p + 46, p + 46 + nameLen), (method === 0 ? body : inflateRawSync(body)).toString("utf8"));
      p += 46 + nameLen + skip;
    }
    return out;
  }

  it("能解包，含表头与预期单元格", async () => {
    const result = await buildGuestExport(data, { format: "xlsx" }, NOW);
    expect(result.rowCount).toBe(3);
    const files = unzip(result.bytes);
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("<t xml:space=\"preserve\">分类路径JSON</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">#000002</t>");
    expect(sheet).toContain("<t xml:space=\"preserve\">午饭</t>");
    expect(sheet).toContain('<dimension ref="A1:P4"/>');
  });

  it("压缩不可用时退回只存储，仍可解包且内容相同", async () => {
    const original = globalThis.CompressionStream;
    const withCompression = unzip((await buildGuestExport(data, { format: "xlsx" }, NOW)).bytes);
    // @ts-expect-error 模拟不支持 CompressionStream 的浏览器
    globalThis.CompressionStream = undefined;
    try {
      const stored = unzip((await buildGuestExport(data, { format: "xlsx" }, NOW)).bytes);
      // 导出编号的随机后缀每次不同，先抹平再比较。
      const norm = (m: Map<string, string>): [string, string][] => [...m].map(([k, v]) => [k, v.replace(/Out-[0-9a-f-]+/g, "Out-X")]);
      expect(norm(stored)).toEqual(norm(withCompression));
    } finally {
      globalThis.CompressionStream = original;
    }
  });
});
