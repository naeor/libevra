/**
 * 浏览器里读银行结单 PDF：用项目已经打包的 pdf.js（附件 PDF 预览 `components/AttachmentPdf.tsx` 用的同一个
 * `pdfjs-dist`，不新增依赖）取带坐标的文字，再按服务器 Python `extract_document.py` 的规则合成
 * `{ format: "pdf", pages: [[{ y, spans: [{ x, text }] }]] }`，交给 shared 里的 BOA 解析器。
 *
 * 与 Python 版一致的部分：
 * - 有 `/Encrypt` 就拒绝（`encrypted_pdf`，同一组正则，不尝试空密码打开）；
 * - 只读前 30 页；全部文字不足 40 个字符视为扫描件（`scanned_pdf`），超过 200 万字符 `document_limit`；
 * - 坐标取文字起点（PDF 用户空间，原点在左下），保留两位小数（Python `round(x, 2)`，逢 5 取偶）；
 * - 成行：按 (-y, x) 稳定排序，只与最近 3 行比较，容差 `max(2, min(字号 × 0.6, 6))`；行内按 (x, 文字) 排序。
 *
 * 无法做到逐字节相同的部分（不影响 BOA 解析结果，见 `pdf.test.ts`）：
 * - Python 最小解析器把每个 `Tj` / `TJ` 里的每段字符串当成一个片段，后续片段的 x 按“字符数 × 字号 × 0.5”估算；
 *   pdf.js 用真实字宽，并把间距小于 0.6 个字宽的相邻片段合成一项（中间补空格）。所以同一栏里被拆开写的文字，
 *   Python 给几个 span、浏览器给一个 span；BOA 解析器把描述栏的 span 用空格拼起来，结果相同。
 * - pdf.js 为大间距插入的纯空白项、换行标记项不输出（Python 只有 PDF 里真的写了空白串才会有空白 span）。
 * - 字号：Python 取 `Tf 字号 × CTM 纵向缩放`，pdf.js 只给合成后的变换矩阵，这里取它的纵向长度（多了 Tm 缩放）；
 *   只影响“同一行”的容差，行距正常的结单不受影响。
 * - Python 还限制对象数（4000），pdf.js 不暴露这个数，这里不检查。
 */
import type { ExtractedDocument, ExtractedLine } from "@libellum/shared/billParsers";

import { BillParseError } from "@libellum/shared/billParsers";

import { extractError } from "./zip.js";

export const MAX_PDF_PAGES = 30;
export const MAX_PDF_TEXT = 2_000_000;
export const MIN_PDF_TEXT = 40;

/** pdf.js 里本模块用到的那一小部分（便于测试在 Node 里换成 legacy 构建）。 */
export interface PdfTextItemLike {
  readonly str: string;
  readonly transform: readonly number[];
}
export interface PdfPageLike {
  getTextContent(options?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<{ items: readonly unknown[] }>;
  cleanup?(): unknown;
}
export interface PdfDocumentLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}
/** 打开的文档与释放它的方法（pdf.js 6 由 loading task 的 `destroy()` 释放文档与 worker）。 */
export interface PdfHandle {
  readonly document: PdfDocumentLike;
  close(): Promise<void>;
}
export type PdfOpener = (data: Uint8Array) => Promise<PdfHandle>;

/**
 * 浏览器里打开 PDF：按需加载 pdf.js 与它的 worker（与附件预览同一份构建产物），只读文字，不执行脚本、
 * 不加载 XFA；中文字体的 CMap 从本站 `/pdfjs-assets/` 读（`pdf-assets-plugin.ts`），不访问第三方。
 */
export const browserPdfOpener: PdfOpener = async (data) => {
  let pdf: typeof import("pdfjs-dist");
  let workerUrl: string;
  try {
    [pdf, { default: workerUrl }] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
  } catch {
    // 构建产物没加载到（离线且没缓存过这一块）：这是“解析器暂时不可用”，不是文件有问题。
    throw extractError("parser_unavailable");
  }
  pdf.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdf.getDocument({
    data,
    enableXfa: false,
    useWasm: false,
    disableFontFace: true,
    cMapUrl: "/pdfjs-assets/cmaps/",
    standardFontDataUrl: "/pdfjs-assets/standard_fonts/",
    wasmUrl: "/pdfjs-assets/wasm/",
  });
  try {
    return { document: await task.promise, close: () => task.destroy() };
  } catch (error) {
    void task.destroy();
    throw error;
  }
};

/** Python 版的 `/Encrypt` 判断（字节正则：`\s` 只是 ASCII 空白，`\d` 只是 ASCII 数字）。 */
export function hasEncryptMarker(bytes: Uint8Array): boolean {
  const ws = "[ \\t\\n\\r\\f\\v]";
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 8000));
  if (new RegExp(`/Encrypt${ws}+[0-9]+${ws}+0${ws}+R`).test(head)) return true;
  return new RegExp(`/Encrypt${ws}*<<`).test(new TextDecoder("windows-1252").decode(bytes));
}

/**
 * Python `round(x, 2)`：两位小数，恰好在中点时取偶。二进制里能精确落在中点上的只有“奇数 / 8”
 * （x.125 / x.375 / x.625 / x.875）；其余情况 `toFixed` 与 Python 一样是正确舍入。
 */
export function round2(value: number): number {
  if (Number.isInteger(value * 8) && !Number.isInteger(value * 4)) {
    const low = Math.floor(value * 100);
    return (Math.abs(low) % 2 === 0 ? low : low + 1) / 100;
  }
  return Number(value.toFixed(2));
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return typeof item === "object" && item !== null && typeof (item as { str?: unknown }).str === "string" &&
    Array.isArray((item as { transform?: unknown }).transform);
}

interface Piece {
  readonly y: number;
  readonly x: number;
  readonly text: string;
  readonly size: number;
}

/** 一页的文字项 → 行（Python `_pages` 里的成行逻辑）。返回本页文字长度，供总量检查。 */
export function linesOfPage(items: readonly unknown[], state: { total: number }): ExtractedLine[] {
  const pieces: Piece[] = [];
  for (const item of items) {
    if (!isTextItem(item) || item.str.trim() === "") continue;
    const [, , c = 0, d = 0, e = 0, f = 0] = item.transform;
    pieces.push({ y: round2(f), x: round2(e), text: item.str, size: Math.hypot(c, d) || 10 });
  }
  const sorted = [...pieces].sort((left, right) => right.y - left.y || left.x - right.x);
  const groups: { y: number; spans: [number, string][] }[] = [];
  for (const piece of sorted) {
    const tolerance = Math.max(2, Math.min(piece.size * 0.6, 6));
    let group = groups.slice(-3).find((item) => Math.abs(item.y - piece.y) < tolerance);
    if (group === undefined) {
      group = { y: piece.y, spans: [] };
      groups.push(group);
    }
    group.spans.push([piece.x, piece.text]);
    for (const _char of piece.text) state.total += 1;
    if (state.total > MAX_PDF_TEXT) throw extractError("document_limit");
  }
  return groups.map((group) => ({
    y: group.y,
    spans: [...group.spans]
      .sort((left, right) => left[0] - right[0] || (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0))
      .map(([x, text]) => ({ x, text })),
  }));
}

function pdfjsFailure(error: unknown): never {
  if (error instanceof BillParseError) throw error;
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (name === "PasswordException") throw extractError("encrypted_pdf");
  throw extractError("document_invalid");
}

/** 读一份 PDF；失败抛 `BillParseError`（白名单错误码）。 */
export async function extractPdf(bytes: Uint8Array, open: PdfOpener = browserPdfOpener): Promise<ExtractedDocument> {
  if (hasEncryptMarker(bytes)) throw extractError("encrypted_pdf");
  // pdf.js 会把传进去的缓冲区转给 worker（转移后原数组变空），所以给它一份拷贝。
  let handle: PdfHandle;
  try {
    handle = await open(bytes.slice());
  } catch (error) {
    pdfjsFailure(error);
  }
  const document = handle.document;
  try {
    const pages: ExtractedLine[][] = [];
    const state = { total: 0 };
    const count = Math.min(document.numPages, MAX_PDF_PAGES);
    for (let number = 1; number <= count; number += 1) {
      let items: readonly unknown[];
      try {
        const page = await document.getPage(number);
        items = (await page.getTextContent({ includeMarkedContent: false, disableNormalization: true })).items;
        page.cleanup?.();
      } catch (error) {
        pdfjsFailure(error);
      }
      pages.push(linesOfPage(items, state));
    }
    if (state.total < MIN_PDF_TEXT) throw extractError("scanned_pdf");
    return { format: "pdf", sheets: [], pages };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
