// i18n-ignore-file：只给测试用的夹具数据（账单表头、示例文字），不是界面文字。
/**
 * **只给测试用**：生成最小的 XLSX / PDF 夹具，以及一个够读 XLSX 部件的极简 XML 解析器。
 *
 * - 仓库里没有真实账单样本（真实样本是本机私密材料，绝不进仓库），所以夹具用代码生成，形状对照
 *   `apps/api/test/python/test_extract_document.py` 的 `make_xlsx` / `make_pdf`，并补上微信账单与 BOA 结单的版式。
 * - Node 测试环境没有 `DOMParser`；`parseXmlForTests` 产出与浏览器 `Element` 同接口的树
 *   （`localName` / `namespaceURI` / `children` / `childNodes` / `textContent` / `getAttribute(NS)`），
 *   只支持 XLSX 部件会用到的 XML 子集（声明、注释、处理指令、CDATA、命名空间、实体）。浏览器里用的是真正的
 *   `DOMParser`，同一套代码在真实浏览器里的核对见 `billExtract.test.ts` 文件头的说明。
 */
import type { XmlElementLike, XmlNodeLike } from "./xlsx.js";
import { crc32 } from "./zip.js";

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ */
/* ZIP / XLSX                                                           */
/* ------------------------------------------------------------------ */

export interface ZipInput {
  readonly name: string;
  readonly data: string | Uint8Array;
  /** 默认 deflate（与 Python `ZIP_DEFLATED` 一样）。 */
  readonly store?: boolean;
  /** 测试用：通用位标志（例如 1 = 加密）。 */
  readonly flags?: number;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

export async function buildZip(inputs: readonly ZipInput[]): Promise<Uint8Array> {
  const locals: number[] = [];
  const central: number[] = [];
  for (const input of inputs) {
    const raw = typeof input.data === "string" ? encoder.encode(input.data) : input.data;
    const body = input.store === true ? raw : await deflateRaw(raw);
    const name = encoder.encode(input.name);
    const method = input.store === true ? 0 : 8;
    const flags = (input.flags ?? 0) | 0x800;
    const crc = crc32(raw);
    const offset = locals.length;
    locals.push(...le32(0x04034b50), ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0x21),
      ...le32(crc), ...le32(body.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...name, ...body);
    central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(flags), ...le16(method), ...le16(0), ...le16(0x21),
      ...le32(crc), ...le32(body.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(0), ...le32(offset), ...name);
  }
  const end = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(inputs.length), ...le16(inputs.length),
    ...le32(central.length), ...le32(locals.length), ...le16(0)];
  return new Uint8Array([...locals, ...central, ...end]);
}

export const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface XlsxInput {
  readonly sharedStrings?: readonly string[];
  /** 原样放进 `<sst>` 的额外内容（富文本、DTD 等）。 */
  readonly sharedExtra?: string;
  /** 每张表的 `<row>` 片段。 */
  readonly sheets: readonly { readonly name: string; readonly rows: readonly string[] }[];
  readonly styles?: string;
  readonly workbookPr?: string;
  /** 不写关系文件（测试“按工作表文件名顺序”的回退）。 */
  readonly withoutRelationships?: boolean;
  readonly extraEntries?: readonly ZipInput[];
}

export async function makeXlsx(input: XlsxInput): Promise<Uint8Array> {
  const sheetTags = input.sheets.map((sheet, index) =>
    `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const entries: ZipInput[] = [
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${RELATIONSHIP_NS}">${input.workbookPr ?? ""}<sheets>${sheetTags}</sheets></workbook>` },
  ];
  if (input.withoutRelationships !== true) {
    const rels = input.sheets.map((_sheet, index) =>
      `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIP_NS}/worksheet" Target="${index === 1 ? "/xl/" : ""}worksheets/sheet${index + 1}.xml"/>`).join("");
    entries.push({ name: "xl/_rels/workbook.xml.rels", data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` });
  }
  if (input.sharedStrings !== undefined || input.sharedExtra !== undefined) {
    const items = (input.sharedStrings ?? []).map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("");
    entries.push({ name: "xl/sharedStrings.xml", data: `<sst xmlns="${SPREADSHEET_NS}">${items}${input.sharedExtra ?? ""}</sst>` });
  }
  if (input.styles !== undefined) entries.push({ name: "xl/styles.xml", data: `<styleSheet xmlns="${SPREADSHEET_NS}">${input.styles}</styleSheet>` });
  input.sheets.forEach((sheet, index) => {
    entries.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${sheet.rows.join("")}</sheetData></worksheet>` });
  });
  entries.push(...(input.extraEntries ?? []));
  return buildZip(entries);
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

/** 一段文字：x、y（PDF 用户空间）、字号、内容（ASCII）。 */
export type PdfRun = readonly [number, number, number, string];

export function pdfString(text: string): string {
  return `(${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

/** 每段文字一个 `BT … Td … Tj ET`，绝对定位（服务器 Python 与 pdf.js 都能精确得到起点坐标）。 */
export function runsContent(runs: readonly PdfRun[]): string {
  return runs.map(([x, y, size, text]) => `BT /F1 ${size} Tf ${x} ${y} Td ${pdfString(text)} Tj ET`).join("\n") + "\n";
}

/**
 * 最小的多页 PDF（Helvetica，未嵌入字体）；带正确的 xref，pdf.js 不必走修复路径。
 * `extraTrailer` 用于测试加密标记。
 */
export function makePdf(pageContents: readonly string[], extraTrailer = ""): Uint8Array {
  const pageCount = pageContents.length;
  const fontId = 3 + pageCount * 2;
  const kids = pageContents.map((_content, index) => `${3 + index * 2} 0 R`).join(" ");
  const bodies: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
  ];
  pageContents.forEach((content, index) => {
    const contentId = 4 + index * 2;
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    bodies.push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  });
  bodies.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(encoder.encode(output).length);
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `${extraTrailer}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(output);
}

/* ------------------------------------------------------------------ */
/* 极简 XML 解析器（只给 Node 测试）                                      */
/* ------------------------------------------------------------------ */

class TestText implements XmlNodeLike {
  readonly nodeType: number;
  constructor(readonly nodeValue: string, cdata = false) {
    this.nodeType = cdata ? 4 : 3;
  }
}

class TestComment implements XmlNodeLike {
  readonly nodeType = 8;
  constructor(readonly nodeValue: string) {}
}

interface TestAttribute {
  readonly qualified: string;
  readonly local: string;
  readonly namespace: string | null;
  readonly value: string;
}

class TestElement implements XmlElementLike {
  readonly nodeType = 1;
  readonly nodeValue = null;
  readonly childNodes: (TestElement | TestText | TestComment)[] = [];
  constructor(
    readonly localName: string,
    readonly namespaceURI: string | null,
    private readonly attributes: readonly TestAttribute[],
  ) {}
  get children(): TestElement[] {
    return this.childNodes.filter((node): node is TestElement => node instanceof TestElement);
  }
  get textContent(): string {
    return this.childNodes.map((node) => (node instanceof TestElement ? node.textContent : node instanceof TestText ? node.nodeValue : "")).join("");
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.qualified === name)?.value ?? null;
  }
  getAttributeNS(namespace: string | null, local: string): string | null {
    return this.attributes.find((attribute) => attribute.namespace === namespace && attribute.local === local)?.value ?? null;
  }
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[entity]!;
  });
}

/** 解析失败（标签不配对、DTD 等）返回 `null`，与浏览器 `<parsererror>` 的处理一致。 */
export function parseXmlForTests(source: string): XmlElementLike | null {
  const text = source.replace(/\r\n?/g, "\n");
  const stack: { element: TestElement; scope: Map<string, string> }[] = [];
  let root: TestElement | null = null;
  let index = 0;
  const top = () => stack[stack.length - 1];
  while (index < text.length) {
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index);
      if (end < 0) return null;
      index = end + 2;
    } else if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index);
      if (end < 0) return null;
      top()?.element.childNodes.push(new TestComment(text.slice(index + 4, end)));
      index = end + 3;
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index);
      if (end < 0 || top() === undefined) return null;
      top()!.element.childNodes.push(new TestText(text.slice(index + 9, end), true));
      index = end + 3;
    } else if (text.startsWith("<!", index)) {
      return null;
    } else if (text.startsWith("</", index)) {
      const end = text.indexOf(">", index);
      const name = text.slice(index + 2, end).trim();
      const current = stack.pop();
      if (current === undefined) return null;
      const expected = current.element.localName;
      if (name !== expected && !name.endsWith(`:${expected}`)) return null;
      index = end + 1;
    } else if (text[index] === "<") {
      const match = /^<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(text.slice(index));
      if (match === null) return null;
      const scope = new Map(top()?.scope ?? []);
      const raw: [string, string][] = [];
      for (const attribute of match[2]!.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const value = decodeEntities((attribute[2] ?? attribute[3] ?? "").replace(/[\t\n]/g, " "));
        const name = attribute[1]!;
        if (name === "xmlns") scope.set("", value);
        else if (name.startsWith("xmlns:")) scope.set(name.slice(6), value);
        raw.push([name, value]);
      }
      const qualified = match[1]!;
      const [prefix, local] = qualified.includes(":") ? qualified.split(":", 2) as [string, string] : ["", qualified];
      const namespace = scope.get(prefix) ?? null;
      const attributes = raw.map(([name, value]): TestAttribute => {
        if (!name.includes(":")) return { qualified: name, local: name, namespace: name === "xmlns" ? "http://www.w3.org/2000/xmlns/" : null, value };
        const [attributePrefix, attributeLocal] = name.split(":", 2) as [string, string];
        const attributeNamespace = attributePrefix === "xmlns" ? "http://www.w3.org/2000/xmlns/"
          : attributePrefix === "xml" ? "http://www.w3.org/XML/1998/namespace" : (scope.get(attributePrefix) ?? null);
        return { qualified: name, local: attributeLocal, namespace: attributeNamespace, value };
      });
      const element = new TestElement(local, namespace, attributes);
      if (top() === undefined) {
        if (root !== null) return null;
        root = element;
      } else top()!.element.childNodes.push(element);
      if (match[3] !== "/") stack.push({ element, scope });
      index += match[0].length;
    } else {
      const end = text.indexOf("<", index);
      const chunk = text.slice(index, end < 0 ? text.length : end);
      if (top() !== undefined) top()!.element.childNodes.push(new TestText(decodeEntities(chunk)));
      else if (chunk.trim() !== "") return null;
      index = end < 0 ? text.length : end;
    }
  }
  return stack.length === 0 ? root : null;
}
