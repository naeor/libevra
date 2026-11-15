/**
 * 账单文件的**浏览器端**文本抽取（只有游客本机导入需要；登录用户的导入在服务器上用 Python 抽取）。
 *
 * 入口与服务器 `extract_document.py` 的 `main()` 相同：10 MB 上限，`%PDF-` 开头读 PDF，`PK` 开头读 XLSX，
 * 其余 `unsupported_format`。输出是 shared 的 `ExtractedDocument`，失败抛带白名单错误码的 `BillParseError`
 * （消息与服务器 `extractor.ts` 一样是「解析失败。」，界面按错误码显示可读说明）。
 */
import { MAX_BILL_IMPORT_BYTES } from "@libellum/shared";
import type { ExtractedDocument } from "@libellum/shared/billParsers";

import { extractPdf, type PdfOpener } from "./pdf.js";
import { extractXlsx, type XmlParser } from "./xlsx.js";
import { extractError } from "./zip.js";

export interface BillExtractOptions {
  /** 测试用：替换 XML 解析器（Node 没有 DOMParser）。 */
  readonly xmlParser?: XmlParser;
  /** 测试用：替换 pdf.js 的打开方式（Node 里用 legacy 构建）。 */
  readonly openPdf?: PdfOpener;
}

export async function extractBillDocument(bytes: Uint8Array, options: BillExtractOptions = {}): Promise<ExtractedDocument> {
  if (bytes.length > MAX_BILL_IMPORT_BYTES) throw extractError("document_limit");
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return extractPdf(bytes, options.openPdf);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return extractXlsx(bytes, options.xmlParser);
  throw extractError("unsupported_format");
}
