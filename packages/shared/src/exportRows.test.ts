import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { EXPORT_COLUMNS } from "./export.js";
import {
  buildExportCsv,
  buildExportXlsx,
  buildExportXlsxAsync,
  buildTemplateCsv,
  EXPORT_XLSX_OPTIONS,
  combineExportBounds,
  exportRowValues,
  exportStamp,
  toExportRow,
  type ExportSourceTransaction,
} from "./exportRows.js";
import { buildXlsx } from "./exportXlsx.js";
import { buildZip, buildZipAsync, crc32 } from "./exportZip.js";

const categories = [
  { id: "p", name: "餐饮", kind: "expense", parentId: null },
  { id: "c", name: "午饭", kind: "expense", parentId: "p" },
];

function source(over: Partial<ExportSourceTransaction> = {}): ExportSourceTransaction {
  return {
    id: "tx-1",
    seq: 12,
    occurredAt: new Date("2026-10-10T04:30:00Z"),
    occurredLocalDate: "2026-10-10",
    occurredTz: "Asia/Shanghai",
    kind: "expense",
    amountMinor: 3850,
    currency: "CNY",
    categoryId: "c",
    categoryName: "午饭",
    paymentMethodName: "微信",
    note: "=SUM(A1)",
    tagNames: ["工作", "报销"],
    createdAt: new Date("2026-10-10T04:31:09Z"),
    sourceRef: null,
    ...over,
  };
}

/** 解包：读中央目录，校验 CRC。 */
function unzip(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no eocd");
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let n = 0; n < count; n += 1) {
    const method = view.getUint16(pointer + 10, true);
    const crc = view.getUint32(pointer + 16, true);
    const size = view.getUint32(pointer + 20, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extra = view.getUint16(pointer + 30, true);
    const comment = view.getUint16(pointer + 32, true);
    const local = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(archive.subarray(pointer + 46, pointer + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = archive.subarray(start, start + size);
    const raw = method === 0 ? body : new Uint8Array(inflateRawSync(body));
    expect(crc32(raw)).toBe(crc);
    out.set(name, new TextDecoder().decode(raw));
    pointer += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("toExportRow", () => {
  it("编号、时间（按记录时区）、金额（按币种精度）、分类路径", () => {
    const row = toExportRow(source(), categories);
    expect(row.displayNumber).toBe("#000012");
    expect(row.occurredTime).toBe("12:30");
    expect(row.amount).toBe(38.5);
    expect(row.categoryPath).toBe('["餐饮","午饭"]');
    expect(row.createdAt).toBe("2026-10-10 04:31:09");
  });

  it("无小数币种不除以一百：¥800 是 800", () => {
    expect(toExportRow(source({ currency: "JPY", amountMinor: 800 }), categories).amount).toBe(800);
  });

  it("缺编号 / 缺录入时间给空串，不抛错", () => {
    const row = toExportRow(source({ seq: undefined, createdAt: null }), categories);
    expect(row.displayNumber).toBe("");
    expect(row.createdAt).toBe("");
  });

  it("未知时区回退到 UTC", () => {
    expect(toExportRow(source({ occurredTz: "Nope/Zone" }), categories).occurredTime).toBe("04:30");
  });
});

describe("CSV", () => {
  it("BOM、\r\n、支出为负、文本列公式转义、金额不转义", () => {
    const row = toExportRow(source(), categories);
    const csv = buildExportCsv([exportRowValues(row, "Out-20261010-043109-abcd")]);
    const headers = EXPORT_COLUMNS.map((c) => c.header).join(",");
    expect(csv.startsWith("\uFEFF" + headers + "\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const line = csv.slice(1).split("\r\n")[1]!;
    expect(line).toBe(
      "#000012,2026-10-10,12:30,Asia/Shanghai,支出,-38.5,CNY,午饭,微信,'=SUM(A1),工作 报销,2026-10-10 04:31:09,tx-1,,Out-20261010-043109-abcd,\"[\"\"餐饮\"\",\"\"午饭\"\"]\"",
    );
  });

  it("没有行时只有表头", () => {
    expect(buildExportCsv([]).split("\r\n")).toHaveLength(2);
  });

  it("模板：只有模板列的表头", () => {
    expect(buildTemplateCsv()).toBe(
      "\uFEFF日期,时间,时区,类型,金额,币种,分类,支付方式,备注,标签\r\n",
    );
  });
});

describe("XLSX", () => {
  const rows = [exportRowValues(toExportRow(source(), categories), "Out-x")];

  it("能解包，文本是内联字符串；金额（F 列）是两位小数的数字", () => {
    const files = unzip(buildExportXlsx(rows, (raw) => deflateRawSync(raw, { level: 9 })));
    expect([...files.keys()]).toContain("xl/worksheets/sheet1.xml");
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    // 1.19.98：金额按 key 定位到第 6 列（F），写成数字并用两位小数格式（s="2"），表格能直接求和。
    // 之前写死下标 4，首列加了“编号”后金额一直被写成文本。
    expect(sheet).toContain('<c r="F2" s="2"><v>-38.5</v></c>');
    expect(sheet).not.toContain('<c r="F2" t="inlineStr">');
    expect(sheet).toContain('<c r="E2" t="inlineStr"><is><t xml:space="preserve">支出</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">#000012</t></is></c>');
    expect(sheet).toContain('<dimension ref="A1:P2"/>');
  });

  it("列选项按列名定位：金额列与列宽跟着 EXPORT_COLUMNS 走", () => {
    const amount = EXPORT_COLUMNS.findIndex((column) => column.key === "amount");
    expect(EXPORT_XLSX_OPTIONS.numericColumns).toEqual([amount]);
    expect(EXPORT_XLSX_OPTIONS.decimalColumns).toEqual([amount]);
    const widths = EXPORT_XLSX_OPTIONS.columnWidths!;
    expect(widths[amount]).toBe(12);
    expect(widths[EXPORT_COLUMNS.findIndex((column) => column.key === "note")]).toBe(28);
    expect(widths[EXPORT_COLUMNS.findIndex((column) => column.key === "displayNumber")]).toBe(10);
    expect(Object.keys(widths)).toHaveLength(EXPORT_COLUMNS.length);
    const files = unzip(buildExportXlsx(rows));
    expect(files.get("xl/worksheets/sheet1.xml")!).toContain(`<col min="${String(amount + 1)}" max="${String(amount + 1)}" width="12"`);
  });

  it("不压缩（压缩不可用）也能解包，内容与压缩版一致", () => {
    const stored = unzip(buildExportXlsx(rows));
    const deflated = unzip(buildExportXlsx(rows, (raw) => deflateRawSync(raw, { level: 9 })));
    expect(stored).toEqual(deflated);
  });

  it("异步版与同步版逐字节相同；压缩抛错时退回存储", async () => {
    const deflate = (raw: Uint8Array): Uint8Array => deflateRawSync(raw, { level: 9 });
    const sync = buildExportXlsx(rows, deflate);
    const async_ = await buildExportXlsxAsync(rows, async (raw) => deflate(raw));
    expect(Array.from(async_)).toEqual(Array.from(sync));

    const failing = await buildExportXlsxAsync(rows, () => {
      throw new Error("no");
    });
    expect(Array.from(failing)).toEqual(Array.from(buildExportXlsx(rows)));
  });

  it("单元格转义 XML 并去掉控制字符，null 为空单元格", () => {
    const files = unzip(buildXlsx([["a<&>\"\u0001b", null]], { numericColumns: [] }));
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain("a&lt;&amp;&gt;&quot;b");
    expect(sheet).toContain('<c r="B1"/>');
  });
});

describe("buildZip", () => {
  it("相同输入得到相同字节", async () => {
    const entries = [{ name: "a.txt", data: "hello".repeat(50) }];
    expect(Array.from(buildZip(entries))).toEqual(Array.from(buildZip(entries)));
    expect(Array.from(await buildZipAsync(entries))).toEqual(Array.from(buildZip(entries)));
  });
});

describe("combineExportBounds / exportStamp", () => {
  it("月份展开为日期并取更窄一边", () => {
    expect(combineExportBounds({ monthFrom: "2026-02", monthTo: "2026-02" })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(
      combineExportBounds({ from: "2026-02-10", to: "2026-02-12", monthFrom: "2026-02", monthTo: "2026-03" }),
    ).toEqual({ from: "2026-02-10", to: "2026-02-12" });
    expect(combineExportBounds({})).toEqual({ from: undefined, to: undefined });
  });

  it("导出编号取日期戳", () => {
    expect(exportStamp("Out-20261010-043109-abcd")).toBe("20261010");
  });
});
