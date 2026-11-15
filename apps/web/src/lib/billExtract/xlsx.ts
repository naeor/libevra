/**
 * 浏览器里读微信账单 XLSX：ZIP（`zip.ts`）+ `DOMParser` 读 `xl/workbook.xml`、`xl/sharedStrings.xml`、
 * `xl/styles.xml` 与工作表，输出与服务器 Python `extract_document.py` 的 `xlsx()` **同形状同内容**的
 * `{ format: "xlsx", sheets: [{ name, rows: [{ line, cells }] }] }`，交给 shared 里的微信解析器。
 *
 * 逐条对应 Python 版（行号、空列补齐、富文本拼接、日期样式判断、1900/1904 日期序列、长单号保留原文、
 * 公式/错误单元格拒绝、DTD 拒绝、行列与单元格长度上限），错误码也相同。几处 Python 语义需要照着写：
 * - `int()` / `float()` 的写法宽容度（前后空白、下划线、`inf` / `nan`）；
 * - `round()` 是“银行家舍入”（逢 .5 取偶）；
 * - `len()` 数的是码点（不是 UTF-16 单元）；
 * - `findtext()` 只取第一个子元素前面的文字（ElementTree 的 `.text`），`itertext()` 才是全部文字。
 *
 * XML 解析器通过参数传入：浏览器是 `DOMParser`；Node 测试环境没有 DOM，测试传一个同接口的极简解析器。
 */
import type { ExtractedDocument, ExtractedRow, ExtractedSheet } from "@libellum/shared/billParsers";

import { assertZipLimits, extractError, readZipDirectory, readZipEntry, type ZipEntry } from "./zip.js";

export const MAX_ROWS = 20200;
export const MAX_COLUMNS = 100;
export const MAX_CELL = 10000;
export const MAX_SHARED_STRINGS = 200000;
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** 读 XLSX 用到的那一小部分 DOM（浏览器的 `Element` 天然满足）。 */
export interface XmlNodeLike {
  readonly nodeType: number;
  readonly nodeValue: string | null;
}
export interface XmlElementLike extends XmlNodeLike {
  readonly localName: string;
  readonly namespaceURI: string | null;
  readonly textContent: string | null;
  readonly children: ArrayLike<XmlElementLike>;
  readonly childNodes: ArrayLike<XmlNodeLike>;
  getAttribute(name: string): string | null;
  getAttributeNS(namespace: string | null, localName: string): string | null;
}

/** 把 XML 文本解析成根元素；格式错误返回 `null`。 */
export type XmlParser = (text: string) => XmlElementLike | null;

export const browserXmlParser: XmlParser = (text) => {
  const document = new DOMParser().parseFromString(text, "application/xml");
  // 解析失败时浏览器在文档里放一个 <parsererror>（Chrome 放在根元素里，Firefox 把它当根元素）。
  if (document.getElementsByTagName("parsererror").length > 0) return null;
  return document.documentElement;
};

/* ------------------------------------------------------------------ */
/* Python 语义的小工具                                                   */
/* ------------------------------------------------------------------ */

/** `int(text)`：失败抛 `ValueError` → 不在白名单 → `document_invalid`。 */
function pyInt(text: string | null): number {
  if (text === null) throw extractError("document_invalid");
  const match = /^\s*([+-]?)(\d+(?:_\d+)*)\s*$/.exec(text);
  if (match === null) throw extractError("document_invalid");
  return Number(`${match[1]}${match[2]!.replace(/_/g, "")}`);
}

/** `float(text)`（含 `inf` / `nan` 与数字间的下划线）。 */
function pyFloat(text: string): number {
  const trimmed = text.trim();
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(trimmed);
  if (special !== null) {
    if (special[2]!.toLowerCase() === "nan") return Number.NaN;
    return special[1] === "-" ? -Infinity : Infinity;
  }
  const digits = "\\d+(?:_\\d+)*";
  const pattern = new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`);
  if (!pattern.test(trimmed)) throw extractError("document_invalid");
  return Number(trimmed.replace(/_/g, ""));
}

/** Python 3 `round(x)`：最近整数，恰好 .5 时取偶数。 */
function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python `len(str)`：码点个数。 */
function pyLength(value: string): number {
  if (value.length <= MAX_CELL) return value.length; // 码点数 ≤ UTF-16 长度，短串不必细数
  let count = 0;
  for (const _char of value) count += 1;
  return count;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/* ------------------------------------------------------------------ */
/* ElementTree 的几个查找                                                */
/* ------------------------------------------------------------------ */

function childrenOf(element: XmlElementLike, name: string): XmlElementLike[] {
  const out: XmlElementLike[] = [];
  for (let index = 0; index < element.children.length; index += 1) {
    const child = element.children[index]!;
    if (child.namespaceURI === MAIN_NS && child.localName === name) out.push(child);
  }
  return out;
}

/** `findall("s:a/s:b")`：一层一层往下找直接子元素。 */
function findAll(element: XmlElementLike, path: readonly string[]): XmlElementLike[] {
  let current = [element];
  for (const name of path) current = current.flatMap((node) => childrenOf(node, name));
  return current;
}

function findFirst(element: XmlElementLike, name: string): XmlElementLike | null {
  return childrenOf(element, name)[0] ?? null;
}

/** `itertext()` 拼起来：所有后代文字（不含注释），与 `textContent` 相同。 */
function allText(element: XmlElementLike): string {
  return element.textContent ?? "";
}

/** `findtext("s:v", "")`：第一个 `<v>` 的 `.text`——它第一个子元素之前的文字。 */
function leadingText(element: XmlElementLike | null): string {
  if (element === null) return "";
  let out = "";
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const node = element.childNodes[index]!;
    if (node.nodeType === 1) break;
    if (node.nodeType === 3 || node.nodeType === 4) out += node.nodeValue ?? "";
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 读部件                                                                */
/* ------------------------------------------------------------------ */

const ASCII_UPPER = (bytes: Uint8Array): string => {
  // bytes.upper() 只改 ASCII 小写字母；这里只需要判断是否含 "<!DOCTYPE" / "<!ENTITY"。
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte >= 0x61 && byte <= 0x7a ? byte - 32 : byte);
  return out;
};

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 200));
  // 引号写成 \x22 / \x27：正则字面量里直接写引号会让仓库的 i18n 扫描（tools/i18n-scan.mjs）错把后面的注释当成字符串。
  const declared = /^<\?xml[^>]*encoding\s*=\s*[\x22\x27]([A-Za-z0-9._-]+)[\x22\x27]/.exec(head)?.[1];
  if (declared !== undefined && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared, { fatal: true }).decode(bytes);
    } catch {
      throw extractError("document_invalid");
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw extractError("document_invalid");
  }
}

class Archive {
  private readonly byName: Map<string, ZipEntry>;

  constructor(
    private readonly bytes: Uint8Array,
    entries: readonly ZipEntry[],
    private readonly parse: XmlParser,
  ) {
    this.byName = new Map(entries.map((entry) => [entry.name, entry]));
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /** Python `xml(archive.read(name))`。 */
  async xml(name: string): Promise<XmlElementLike> {
    const entry = this.byName.get(name);
    if (entry === undefined) throw extractError("document_invalid");
    const data = await readZipEntry(this.bytes, entry);
    // 外部文件不能带 DTD：实体展开是压缩炸弹之外的另一种内存放大方式。
    const upper = ASCII_UPPER(data);
    if (upper.includes("<!DOCTYPE") || upper.includes("<!ENTITY")) throw extractError("unsafe_xml");
    const root = this.parse(decodeXml(data));
    if (root === null) throw extractError("document_invalid");
    return root;
  }
}

/** 返回 [(sheet 名, zip 内路径)]；名称来自 workbook.xml，路径来自关系文件（Python `_sheet_targets`）。 */
async function sheetTargets(archive: Archive): Promise<[string, string][]> {
  const workbook = await archive.xml("xl/workbook.xml");
  const relationships = new Map<string, string>();
  if (archive.has("xl/_rels/workbook.xml.rels")) {
    const rels = await archive.xml("xl/_rels/workbook.xml.rels");
    for (let index = 0; index < rels.children.length; index += 1) {
      const rel = rels.children[index]!;
      const rid = rel.getAttribute("Id");
      let target = rel.getAttribute("Target") ?? "";
      if (!rid || !target) continue;
      target = target.replace(/^\/+/, "");
      if (!target.startsWith("xl/")) target = `xl/${target}`;
      relationships.set(rid, target);
    }
  }
  const sheets: [string, string][] = [];
  for (const sheet of findAll(workbook, ["sheets", "sheet"])) {
    const name = sheet.getAttribute("name") || `Sheet${sheets.length + 1}`;
    const rid = sheet.getAttributeNS(REL_NS, "id");
    const target = relationships.get(rid ?? "");
    if (target !== undefined && archive.has(target)) sheets.push([name, target]);
  }
  if (sheets.length === 0) {
    // 关系文件损坏时仍按工作表顺序解析；交易识别只看内容，不依赖名字。（Python sorted：按码点排序）
    return archive
      .names()
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((name, index) => [`Sheet${index + 1}`, name]);
  }
  return sheets;
}

function serialToText(serial: number, date1904: boolean): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const stamp = new Date(base + pyRound(serial * 86400) * 1000);
  return `${pad(stamp.getUTCFullYear(), 4)}-${pad(stamp.getUTCMonth() + 1, 2)}-${pad(stamp.getUTCDate(), 2)} ` +
    `${pad(stamp.getUTCHours(), 2)}:${pad(stamp.getUTCMinutes(), 2)}:${pad(stamp.getUTCSeconds(), 2)}`;
}

/** 读一份 XLSX；失败抛 `BillParseError`（白名单错误码）。 */
export async function extractXlsx(bytes: Uint8Array, parse: XmlParser = browserXmlParser): Promise<ExtractedDocument> {
  const entries = readZipDirectory(bytes);
  assertZipLimits(entries);
  const archive = new Archive(bytes, entries, parse);
  if (!archive.has("xl/workbook.xml")) throw extractError("unsupported_format");

  const book = await archive.xml("xl/workbook.xml");
  const props = findFirst(book, "workbookPr");
  const date1904 = props !== null && ["1", "true"].includes(props.getAttribute("date1904") ?? "");

  const strings: string[] = [];
  if (archive.has("xl/sharedStrings.xml")) {
    const root = await archive.xml("xl/sharedStrings.xml");
    for (const item of childrenOf(root, "si")) {
      // 富文本被拆成多个 <t>，拼起来才是单元格真实内容。
      const value = allText(item);
      if (pyLength(value) > MAX_CELL) throw extractError("document_limit");
      strings.push(value);
    }
    if (strings.length > MAX_SHARED_STRINGS) throw extractError("document_limit");
  }

  const dateStyles = new Set<number>();
  if (archive.has("xl/styles.xml")) {
    const root = await archive.xml("xl/styles.xml");
    const formats = new Map<number, string>();
    for (const node of findAll(root, ["numFmts", "numFmt"])) {
      formats.set(pyInt(node.getAttribute("numFmtId")), node.getAttribute("formatCode") ?? "");
    }
    findAll(root, ["cellXfs", "xf"]).forEach((node, index) => {
      const fmt = pyInt(node.getAttribute("numFmtId") ?? "0");
      // 与 Python 的 r'"[^"]*"|\[[^\]]*\]|\\.' 相同（Python 的 `.` 只不匹配 \n）。
      const code = (formats.get(fmt) ?? "").replace(/\x22[^\x22]*\x22|\[[^\]]*\]|\\[^\n]/g, "").toLowerCase();
      // Excel 内置日期格式 + 自定义格式里的 y/d/h/s；只看样式，不看单元格文本。
      if ((fmt >= 14 && fmt < 23) || (fmt >= 45 && fmt < 48) || /[ydhs]/.test(code)) dateStyles.add(index);
    });
  }

  const sheets: ExtractedSheet[] = [];
  for (const [name, path] of await sheetTargets(archive)) {
    const rows: ExtractedRow[] = [];
    const root = await archive.xml(path);
    for (const row of findAll(root, ["sheetData", "row"])) {
      if (rows.length >= MAX_ROWS) throw extractError("document_limit");
      const cells: string[] = [];
      for (const cell of childrenOf(row, "c")) {
        const letters = /^[A-Z]+/.exec(cell.getAttribute("r") ?? "");
        if (letters === null) throw extractError("invalid_xlsx");
        let column = 0;
        for (const char of letters[0]) column = column * 26 + char.charCodeAt(0) - 64;
        if (column > MAX_COLUMNS) throw extractError("document_limit");
        while (cells.length < column) cells.push("");
        if (findFirst(cell, "f") !== null) throw extractError("xlsx_formula");
        let value = leadingText(findFirst(cell, "v"));
        const kind = cell.getAttribute("t") ?? "n";
        if (kind === "s") {
          let index: number;
          try {
            index = pyInt(value);
          } catch {
            throw extractError("invalid_xlsx");
          }
          if (index < 0) index += strings.length; // Python 负下标从末尾数
          const text = strings[index];
          if (index < 0 || text === undefined) throw extractError("invalid_xlsx");
          value = text;
        } else if (kind === "inlineStr") {
          const inline = findFirst(cell, "is");
          value = inline === null ? "" : allText(inline);
        } else if (kind === "e") {
          throw extractError("invalid_xlsx");
        } else if (kind === "d" && value) {
          // t="d" 是 Excel 2010 之后的 ISO 日期字面量，直接保留日期时间。
          value = value.replaceAll("T", " ").split(".")[0]!;
        } else if (value && kind === "n" && dateStyles.has(pyInt(cell.getAttribute("s") ?? "0"))) {
          const serial = pyFloat(value);
          if (serial < 1 || serial > 100000) throw extractError("invalid_date");
          if (Number.isNaN(serial)) throw extractError("document_invalid");
          value = serialToText(serial, date1904);
        }
        // 数字形式的交易单号保留 XML 原文，不经过 float（39 位会丢精度）。
        if (pyLength(value) > MAX_CELL) throw extractError("document_limit");
        cells[column - 1] = value;
      }
      const line = row.getAttribute("r");
      rows.push({ line: line === null ? rows.length + 1 : pyInt(line), cells });
    }
    sheets.push({ name, rows });
  }
  return { format: "xlsx", sheets, pages: [] };
}
