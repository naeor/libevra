// i18n-ignore-file：只给测试用的夹具数据（账单表头、示例文字），不是界面文字。
/**
 * **只给测试用**：浏览器抽取与服务器 Python 抽取的对照夹具（`billExtract.test.ts` 在 Node 里逐个比对；
 * 也可以在开发服务器的真实浏览器里 `import("/src/lib/billExtract/fixtures.ts")` 跑同一批，核对真正的
 * `DOMParser` / `DecompressionStream` / 打包的 pdf.js）。期望结果是 Python 现场运行的存档 `pythonOutputs.json`。
 *
 * 仓库里没有真实 XLSX / PDF 样本（真实账单是本机私密材料，不进仓库；`apps/ocr` 里只有截图），所以夹具用
 * `testSupport.ts` 按 Python 测试的 `make_xlsx` / `make_pdf` 生成，并补上微信账单与 BOA 结单的版式。
 */
import {
  SPREADSHEET_NS,
  buildZip,
  makePdf,
  makeXlsx,
  pdfString,
  runsContent,
  type PdfRun,
} from "./testSupport.js";


export const DATE_STYLES =
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="14"/></cellXfs>';

/** Excel 日期序列（1900 系统）。 */
function serial(iso: string): number {
  return (Date.parse(`${iso}Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const WECHAT_STRINGS = [
  "微信支付账单明细", "微信昵称：[示例]", "起始时间：[2026-09-01 00:00:00] 终止时间：[2026-09-30 23:59:59]", "共 4 笔记录",
  "交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注",
  "商户消费", "示例便利店", "饮料", "支出", "零钱", "支付成功", "/", "转账-退款", "已全额退款", "收入", "4200000000000000000000000000000000000077",
];
const s = (text: string) => {
  const index = WECHAT_STRINGS.indexOf(text);
  if (index < 0) throw new Error(text);
  return index;
};
function sc(ref: string, text: string): string {
  return `<c r="${ref}" t="s"><v>${s(text)}</v></c>`;
}

export async function wechatWorkbook(extra: { workbookPr?: string; dateSerialOffset?: number } = {}): Promise<Uint8Array> {
  const offset = extra.dateSerialOffset ?? 0;
  const preamble = [
    `<row r="1">${sc("A1", "微信支付账单明细")}</row>`,
    `<row r="2">${sc("A2", "微信昵称：[示例]")}</row>`,
    `<row r="3">${sc("A3", "起始时间：[2026-09-01 00:00:00] 终止时间：[2026-09-30 23:59:59]")}</row>`,
    `<row r="4">${sc("A4", "共 4 笔记录")}</row>`,
    // 富文本 + 注音：Python itertext 会把 <rPh> 里的文字也拼进来，浏览器 textContent 同样。
    `<row r="5"><c r="A5" t="s"><v>${WECHAT_STRINGS.length}</v></c><c r="C5" t="inlineStr"><is><r><t>内联</t></r><r><t xml:space="preserve"> 文字</t></r></is></c></row>`,
  ];
  const headers = ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"];
  const header = `<row r="17">${headers.map((text, index) => sc(`${String.fromCharCode(65 + index)}17`, text)).join("")}</row>`;
  const rows = [
    `<row r="18"><c r="A18" s="1"><v>${serial("2026-09-22T00:27:27") - offset}</v></c>${sc("B18", "商户消费")}${sc("C18", "示例便利店")}${sc("D18", "饮料")}${sc("E18", "支出")}` +
      `<c r="F18"><v>18</v></c>${sc("G18", "零钱")}${sc("H18", "支付成功")}<c r="I18"><v>4200000000000000000000000000000000001234</v></c>${sc("J18", "/")}${sc("K18", "/")}</row>`,
    `<row r="19"><c r="A19" t="d"><v>2026-09-23T12:00:00.000</v></c>${sc("B19", "转账-退款")}${sc("C19", "/")}${sc("D19", "/")}${sc("E19", "收入")}` +
      `<c r="F19" t="str"><v>50.00</v></c>${sc("G19", "零钱")}${sc("H19", "已全额退款")}${sc("I19", "4200000000000000000000000000000000000077")}</row>`,
    // 稀疏列：只有 A、E、F、K；中间空列补成 ""。
    `<row r="20"><c r="A20" s="2"><v>${Math.floor(serial("2026-09-24T00:00:00")) - offset}</v></c>${sc("E20", "支出")}<c r="F20"><v>0.5</v></c><c r="K20" t="b"><v>1</v></c></row>`,
    // 没有 r 的行：Python 用 len(rows)+1。
    `<row><c r="A21" t="inlineStr"><is><t>以上为全部</t></is></c></row>`,
  ];
  return makeXlsx({
    sharedStrings: WECHAT_STRINGS,
    sharedExtra: "<si><r><t>微信</t></r><r><t>支付</t></r><rPh sb=\"0\" eb=\"1\"><t>ウェイ</t></rPh></si>",
    sheets: [{ name: "微信支付账单", rows: [...preamble, header, ...rows] }],
    styles: DATE_STYLES,
    ...(extra.workbookPr === undefined ? {} : { workbookPr: extra.workbookPr }),
  });
}

export interface Fixture {
  readonly name: string;
  readonly bytes: () => Promise<Uint8Array>;
  /** 两边输出必须逐字相同（`false`：只比较交给解析器后的候选）。 */
  readonly identical: boolean;
}

export const BOA_SUMMARY: PdfRun[] = [
  [36, 740, 10, "Bank of America"],
  [36, 720, 9, "Account summary"],
  [36, 700, 9, "Beginning balance on September 18, 2026"], [520, 700, 9, "$1,000.00"],
  [36, 686, 9, "Deposits and other additions"], [520, 686, 9, "500.00"],
  [36, 672, 9, "ATM and debit card subtractions"], [520, 672, 9, "-300.00"],
  [36, 658, 9, "Other subtractions"], [520, 658, 9, "-100.00"],
  [36, 644, 9, "Service fees"], [520, 644, 9, "-0.00"],
  [36, 630, 9, "Ending balance on October 19, 2026"], [520, 630, 9, "$1,100.00"],
];
export const BOA_DETAIL: PdfRun[] = [
  [36, 760, 9, "Date"], [90, 760, 9, "Description"], [520, 760, 9, "Amount"],
  [36, 740, 9, "Deposits and other additions"],
  [36, 720, 9, "09/21/26"], [90, 720, 9, "PAYROLL ACME INC"], [520, 720, 9, "500.00"],
  [90, 706, 9, "REF 123456"],
  [36, 690, 9, "ATM and debit card subtractions"],
  [36, 670, 9, "09/22/26"], [90, 670, 9, "ATM WITHDRAWAL"], [520, 670, 9, "-200.00"],
  [36, 650, 9, "09/23/26"], [90, 650, 9, "CARD PURCHASE 09/20 COFFEE"], [520, 650, 9, "-100.00"],
  [36, 630, 9, "Other subtractions"],
  [36, 610, 9, "09/24/26"], [90, 610, 9, "MONTHLY FEE"], [520, 610, 9, "-100.00"],
  [36, 590, 9, "Total deposits and other additions"], [520, 590, 9, "$500.00"],
  [36, 570, 9, "Total ATM and debit card subtractions"], [520, 570, 9, "-$300.00"],
  [36, 550, 9, "Total other subtractions"], [520, 550, 9, "-$100.00"],
  [36, 40, 8, "Page 2 of 2"],
];

/**
 * 同一份结单，但描述用 TJ 拆成带字距的几段（真实 PDF 常见），x 估算方式两边不同。
 * `continuation`：连“换行描述”那一行也拆开——Python 因此把它切成两个 span、认不出是换行描述而丢掉；
 * pdf.js 按真实字距合成一项、照常拼回上一笔。这是两边唯一已知的结果差异（浏览器这边更完整），单独断言。
 */
export function boaDetailWithTj(continuation = false): string {
  const dated = new Set(BOA_DETAIL.filter(([x]) => x === 36).map(([, y]) => y));
  const lines = BOA_DETAIL.map(([x, y, size, text]) => {
    if (x === 90 && text.includes(" ") && (continuation || dated.has(y))) {
      const [head, ...rest] = text.split(" ");
      return `BT /F1 ${size} Tf ${x} ${y} Td [${pdfString(head!)} -250 ${pdfString(rest.join(" "))}] TJ ET`;
    }
    return `BT /F1 ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET`;
  });
  return `${lines.join("\n")}\n`;
}

export const FIXTURES: readonly Fixture[] = [
  { name: "xlsx：微信账单（说明区、日期序列、长单号、富文本与注音、内联字符串、t=d/str/b、稀疏列、缺 r 的行）", identical: true, bytes: () => wechatWorkbook() },
  { name: "xlsx：1904 日期系统", identical: true, bytes: () => wechatWorkbook({ workbookPr: '<workbookPr date1904="1"/>', dateSerialOffset: 1462 }) },
  { name: "xlsx：两张表（第二张用绝对路径关系）", identical: true, bytes: () => makeXlsx({ sharedStrings: ["甲", "乙"], sheets: [
    { name: "第一张", rows: ['<row r="1"><c r="A1" t="s"><v>0</v></c></row>'] },
    { name: "第二张", rows: ['<row r="3"><c r="B3" t="s"><v>1</v></c><c r="A3"><v>7</v></c></row>'] },
  ] }) },
  { name: "xlsx：没有关系文件时按工作表文件名排序", identical: true, bytes: () => makeXlsx({ withoutRelationships: true, sheets: [
    { name: "x", rows: ['<row r="1"><c r="A1"><v>1</v></c></row>'] }, { name: "y", rows: ['<row r="2"><c r="A2"><v>2</v></c></row>'] },
  ] }) },
  { name: "xlsx：公式单元格拒绝", identical: true, bytes: () => makeXlsx({ sheets: [{ name: "S", rows: ['<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>'] }] }) },
  { name: "xlsx：sharedStrings 带 DTD 拒绝", identical: true, bytes: () => makeXlsx({ sharedExtra: '<!DOCTYPE foo [<!ENTITY x "y">]><si><t>&x;</t></si>', sheets: [{ name: "S", rows: ['<row r="1"><c r="A1" t="s"><v>0</v></c></row>'] }] }) },
  { name: "xlsx：错误单元格 t=e", identical: true, bytes: () => makeXlsx({ sheets: [{ name: "S", rows: ['<row r="1"><c r="A1" t="e"><v>#DIV/0!</v></c></row>'] }] }) },
  { name: "xlsx：共享字符串下标越界", identical: true, bytes: () => makeXlsx({ sharedStrings: ["a"], sheets: [{ name: "S", rows: ['<row r="1"><c r="A1" t="s"><v>5</v></c></row>'] }] }) },
  { name: "xlsx：共享字符串负下标（Python 从末尾数）", identical: true, bytes: () => makeXlsx({ sharedStrings: ["a", "b"], sheets: [{ name: "S", rows: ['<row r="1"><c r="A1" t="s"><v>-1</v></c></row>'] }] }) },
  { name: "xlsx：超过 100 列", identical: true, bytes: () => makeXlsx({ sheets: [{ name: "S", rows: ['<row r="1"><c r="CW1"><v>1</v></c></row>'] }] }) },
  { name: "xlsx：单元格没有 r", identical: true, bytes: () => makeXlsx({ sheets: [{ name: "S", rows: ['<row r="1"><c><v>1</v></c></row>'] }] }) },
  { name: "xlsx：日期样式但序列小于 1", identical: true, bytes: () => makeXlsx({ styles: DATE_STYLES, sheets: [{ name: "S", rows: ['<row r="1"><c r="A1" s="1"><v>0.5</v></c></row>'] }] }) },
  { name: "xlsx：日期序列恰好落在半秒（银行家舍入）", identical: true, bytes: () => makeXlsx({ styles: DATE_STYLES, sheets: [{ name: "S", rows: [
    `<row r="1"><c r="A1" s="1"><v>${(46000 * 86400 + 0.5) / 86400}</v></c><c r="B1" s="1"><v>${(46000 * 86400 + 1.5) / 86400}</v></c></row>`,
  ] }] }) },
  { name: "xlsx：ZIP 里没有 workbook", identical: true, bytes: () => buildZip([{ name: "random.txt", data: "hello" }]) },
  { name: "xlsx：重名条目", identical: true, bytes: () => buildZip([{ name: "xl/workbook.xml", data: "<a/>" }, { name: "xl/workbook.xml", data: "<b/>" }]) },
  { name: "xlsx：加密条目", identical: true, bytes: () => buildZip([{ name: "xl/workbook.xml", data: "<a/>", flags: 1 }]) },
  { name: "xlsx：不压缩的条目也能读", identical: true, bytes: async () => buildZip([
    { name: "xl/workbook.xml", store: true, data: `<workbook xmlns="${SPREADSHEET_NS}"><sheets/></workbook>` },
    { name: "xl/worksheets/sheet1.xml", store: true, data: `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData><row r="9"><c r="C9" t="inlineStr"><is><t>&amp;&lt;ok&gt;</t></is></c></row></sheetData></worksheet>` },
  ]) },
  { name: "pdf：两行文字（Python 测试的 make_pdf 版式）", identical: true, bytes: async () => makePdf(["BT\n/F1 12 Tf\n72 720 Td\n(Statement line one for testing) Tj\n0 -18 Td\n(Second line here for testing) Tj\nET\n"]) },
  { name: "pdf：BOA 结单（两页，绝对定位）", identical: true, bytes: async () => makePdf([runsContent(BOA_SUMMARY), runsContent(BOA_DETAIL)]) },
  { name: "pdf：BOA 结单（描述用 TJ 拆字）", identical: false, bytes: async () => makePdf([runsContent(BOA_SUMMARY), boaDetailWithTj()]) },
  { name: "pdf：没有文字（扫描件）", identical: true, bytes: async () => makePdf(["BT /F1 12 Tf 72 720 Td () Tj ET\n"]) },
  { name: "pdf：带 /Encrypt", identical: true, bytes: async () => makePdf([runsContent(BOA_SUMMARY)], "/Encrypt 9 0 R\n") },
  { name: "其它：不支持的二进制", identical: true, bytes: async () => new TextEncoder().encode("GIF89a secret document bytes") },
];
