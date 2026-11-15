import { EXPORT_COLUMNS } from "../export.js";
import { compactText } from "./common.js";

/**
 * 按内容识别账单文件（原 `apps/api/src/import/sniff.ts`，1.19.96 移到 shared）。
 *
 * 原版收 Node 的 `Buffer`；这里收 `Uint8Array`（`Buffer` 是它的子类，服务器照旧传 Buffer），
 * 把 `toString("latin1")` / `readUInt32LE` / `includes` 换成逐字节的等价写法，判定顺序与结果不变。
 */
export type SniffedKind = "pdf" | "xlsx" | "xls" | "html" | "image" | "text" | "unknown";

export interface DecodedText {
  readonly text: string;
  readonly encoding: "utf-8" | "gb18030" | "utf-16le" | "utf-16be";
}

/** 与 `Buffer#toString("latin1")` 相同：每个字节就是一个 U+0000–U+00FF 字符。 */
function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let index = start; index < Math.min(end, bytes.length); index += 1) out += String.fromCharCode(bytes[index]!);
  return out;
}

/**
 * 越界读文件头时与 Node `Buffer` 抛出同样的错误（`RangeError`，`code: ERR_BUFFER_OUT_OF_BOUNDS`）。
 * 原版对 1–3 字节的文件在 `readUInt32LE(0)` 处抛错、服务器因此返回 500；为保证服务器行为完全不变，这里照原样抛
 * （游客本机导入把它当作“认不出的文件”处理，见 `apps/web/src/lib/guest/billImport.ts`）。
 */
function outOfBounds(): RangeError {
  return Object.assign(new RangeError("Attempt to access memory outside buffer bounds"), { code: "ERR_BUFFER_OUT_OF_BOUNDS" });
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw outOfBounds();
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw outOfBounds();
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

/** 与 `Buffer#includes(Buffer.from(needle, "latin1"))` 相同：字节子串查找。 */
function includesLatin1(bytes: Uint8Array, needle: string): boolean {
  const pattern = Array.from(needle, (char) => char.charCodeAt(0) & 0xff);
  const first = pattern[0];
  if (first === undefined) return true;
  const last = bytes.length - pattern.length;
  const head: number = first;
  outer: for (let index = bytes.indexOf(head); index !== -1 && index <= last; index = bytes.indexOf(head, index + 1)) {
    for (let offset = 1; offset < pattern.length; offset += 1) {
      if (bytes[index + offset] !== pattern[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * 只按字节判断文件种类，扩展名完全不参与。
 *
 * 用户把 XLSX 改名成 .csv、或把 PDF 拖成 .txt 都很常见；按内容 sniff
 * 才能给出「这份文件实际是什么」的可操作提示，而不是解析到一半失败。
 */
export function sniffKind(buffer: Uint8Array): SniffedKind {
  if (buffer.length === 0) return "unknown";

  if (latin1(buffer, 0, 5) === "%PDF-") return "pdf";
  if (readUInt32LE(buffer, 0) === 0x04034b50) {
    // ZIP 容器里只有 XLSX 是本功能支持的；其余（docx/普通 zip）交给 extractor 拒绝。
    return includesLatin1(buffer, "xl/workbook.xml") ? "xlsx" : "unknown";
  }
  if (buffer.length >= 8 && readUInt32LE(buffer, 0) === 0xe011cfd0) return "xls";
  if (latin1(buffer, 0, 5).toLowerCase() === "<html") return "html";
  if (latin1(buffer, 0, 15).toLowerCase().includes("<!doctype html")) {
    return "html";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image";
  }
  if (buffer.length >= 8 && readUInt32BE(buffer, 0) === 0x89504e47) return "image";
  if (latin1(buffer, 0, 4) === "RIFF") return "image";

  return decodeTextFile(buffer) === null ? "unknown" : "text";
}

function decodeWith(buffer: Uint8Array, encoding: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * 文本解码：先严格 UTF-8，失败再 GB18030。
 *
 * 支付宝中文版导出实测就是 GB18030（严格 UTF-8 在第 86 字节失败），
 * 而且没有 BOM；用非 fatal 的 UTF-8 会把整份文件变成替换字符，
 * 所以必须用 fatal 版本做「是不是 UTF-8」的判定。
 */
export function decodeTextFile(buffer: Uint8Array): DecodedText | null {
  if (buffer.length === 0) return null;

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const text = decodeWith(buffer.subarray(3), "utf-8", true);
    return text === null ? null : { text, encoding: "utf-8" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const text = decodeWith(buffer.subarray(2), "utf-16le", true);
    return text === null ? null : { text, encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const text = decodeWith(buffer.subarray(2), "utf-16be", true);
    return text === null ? null : { text, encoding: "utf-16be" };
  }

  const utf8 = decodeWith(buffer, "utf-8", true);
  if (utf8 !== null && !utf8.includes("\u0000")) {
    return { text: utf8, encoding: "utf-8" };
  }

  const gb = decodeWith(buffer, "gb18030", false);
  if (gb === null || gb.includes("\u0000")) return null;
  // GB18030 对任何字节都能解出字符；用替换符比例判断它是否真的像中文文本。
  const replacements = (gb.match(/\ufffd/g) ?? []).length;
  if (replacements / Math.max(1, gb.length) > 0.01) return null;
  return { text: gb, encoding: "gb18030" };
}

const ALIPAY_HEADERS = new Set([
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
]);

const LIBEVRA_HEADERS = new Set<string>(EXPORT_COLUMNS.map((column) => column.header));

const WECHAT_HEADERS = new Set([
  "交易时间",
  "交易类型",
  "交易对方",
  "商品",
  "收/支",
  "金额(元)",
  "金额（元）",
  "金额",
  "支付方式",
  "当前状态",
  "交易单号",
  "商户单号",
  "备注",
]);

function headerTexts(row: readonly string[]): string[] {
  return row.map((cell) => compactText(cell));
}

function amountHeaderIndex(cells: readonly string[]): number {
  return cells.findIndex((cell) =>
    cell === "金额" || cell === "金额(元)" || cell === "金额（元）" || cell === "金额(元)" || cell === "金额（元）",
  );
}

function hasCell(cells: readonly string[], names: readonly string[]): boolean {
  return names.some((name) => cells.includes(name));
}

/**
 * 从 CSV 行里找真正的表头。
 *
 * 支付宝的说明区有 23 行，微信 XLSX 有 17 行；表头不在第一行是常态，
 * 所以扫描前 80 行、按「命中已知列名数量」打分，而不是写死行号。
 */
export function detectTextHeader(
  rows: readonly (readonly string[])[],
): { source: "alipay" | "libevra"; headerIndex: number } | null {
  let best: { source: "alipay" | "libevra"; headerIndex: number; score: number } | null = null;

  const limit = Math.min(rows.length, 80);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const cells = headerTexts(row);
    if (cells.filter((cell) => cell.length > 0).length < 3) continue;

    const alipayHits = cells.filter((cell) => ALIPAY_HEADERS.has(cell)).length;
    const libevraHits = cells.filter((cell) => LIBEVRA_HEADERS.has(cell)).length;
    const hasAmount = amountHeaderIndex(cells) >= 0;

    if (hasAmount && hasCell(cells, ["收/支", "收支"]) && alipayHits >= 6) {
      if (best === null || alipayHits > best.score) {
        best = { source: "alipay", headerIndex: index, score: alipayHits };
      }
    }
    if (hasAmount && hasCell(cells, ["日期"]) && libevraHits >= 5) {
      if (best === null || libevraHits > best.score) {
        best = { source: "libevra", headerIndex: index, score: libevraHits };
      }
    }
  }

  return best === null ? null : { source: best.source, headerIndex: best.headerIndex };
}

/** 微信 XLSX 的表头：说明区在上方，且列名与支付宝完全不同，同样按内容打分。 */
export function detectWechatHeader(rows: readonly (readonly string[])[]): number | null {
  let bestIndex: number | null = null;
  let bestScore = 0;

  const limit = Math.min(rows.length, 80);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const cells = headerTexts(row);
    const hits = cells.filter((cell) => WECHAT_HEADERS.has(cell)).length;
    const hasCore =
      cells.includes("交易时间") &&
      hasCell(cells, ["收/支", "收支"]) &&
      amountHeaderIndex(cells) >= 0;
    if (hasCore && hits >= 6 && hits > bestScore) {
      bestIndex = index;
      bestScore = hits;
    }
  }

  return bestIndex;
}

/** 给「无法识别」错误用的中文描述；不暴露任何文件内容。 */
export function kindLabel(kind: SniffedKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "xlsx":
      return "Excel 工作簿";
    case "xls":
      return "旧版 Excel（.xls）";
    case "html":
      return "网页文件";
    case "image":
      return "图片";
    case "text":
      return "文本";
    default:
      return "未知格式";
  }
}
