/**
 * 「文件字节 → 候选账目」的分派（原 `apps/api/src/import/service.ts` 的 `parseFile` / `parseDocument` /
 * `isBoaDocument`，1.19.96 移到 shared）。
 *
 * 只有一处与平台有关：XLSX / PDF 的**文本抽取**。服务器用 Python 子进程（`extract_document.py`），
 * 浏览器（游客本机导入）用 `DecompressionStream` + `DOMParser` 与 pdf.js；两边都输出同一个
 * {@link ExtractedDocument}，由调用方以 `extract` 参数传进来。分派规则、错误码与提示逐字沿用原版。
 */
import { parseCsv } from "../spreadsheet.js";
import { parseAlipayCsv } from "./alipay.js";
import { parseBoaPdf } from "./boa.js";
import { parseLibevraCsv } from "./libevra.js";
import { decodeTextFile, detectTextHeader, kindLabel, sniffKind, type SniffedKind } from "./sniff.js";
import { BillParseError, type ExtractedDocument, type ParseContext, type ParsedBill } from "./types.js";
import { parseWechatXlsx } from "./wechat.js";

/** XLSX / PDF 文本抽取；失败时抛 `BillParseError`（白名单错误码）。 */
export type BillDocumentExtractor = (bytes: Uint8Array) => Promise<ExtractedDocument>;

export function isBoaDocument(document: ExtractedDocument): boolean {
  const text = document.pages
    .flat()
    .map((line) => line.spans.map((span) => span.text).join(""))
    .join("\n")
    .toLowerCase();
  if (text.includes("bank of america")) return true;
  // 没有行名时用结单特有的分区/摘要标签做内容识别，仍然不依赖文件名。
  return text.includes("account summary") && text.includes("deposits and other additions");
}

export function parseBillDocument(
  sniffed: SniffedKind,
  buffer: Uint8Array,
  document: ExtractedDocument | null,
  context: ParseContext,
): ParsedBill {
  if (sniffed === "text") {
    const decoded = decodeTextFile(buffer);
    if (decoded === null) {
      throw new BillParseError("unsupported_format", "无法识别这个文本文件的编码。");
    }
    const rows = parseCsv(decoded.text);
    if (rows.length === 0) {
      throw new BillParseError("empty_file", "账单文件是空的。");
    }
    const header = detectTextHeader(rows);
    if (header === null) {
      throw new BillParseError(
        "unsupported_format",
        "没有找到支付宝交易明细或 Libevra 账单的表头。请确认文件内容是否完整。",
      );
    }
    return header.source === "alipay"
      ? parseAlipayCsv(rows, header.headerIndex, context)
      : parseLibevraCsv(rows, header.headerIndex, context);
  }

  if (document === null) {
    throw new BillParseError("document_invalid", "解析器没有返回内容。");
  }

  if (sniffed === "pdf") {
    if (document.format !== "pdf") {
      throw new BillParseError("unsupported_format", "这个文件不是可读取的 PDF。");
    }
    if (!isBoaDocument(document)) {
      throw new BillParseError(
        "unsupported_format",
        "这份 PDF 不是可识别的 Bank of America 结单（没有找到账户摘要或交易表）。",
      );
    }
    return parseBoaPdf(document.pages, context);
  }

  if (document.format !== "xlsx") {
    throw new BillParseError("unsupported_format", "这个文件不是可读取的 Excel 工作簿。");
  }
  return parseWechatXlsx(document.sheets, context);
}

/** 按内容识别并解析一份账单文件；XLSX / PDF 先经 `extract` 抽取文本。 */
export async function parseBillFile(
  buffer: Uint8Array,
  context: ParseContext,
  extract: BillDocumentExtractor,
): Promise<ParsedBill> {
  const sniffed = sniffKind(buffer);
  if (sniffed !== "text" && sniffed !== "pdf" && sniffed !== "xlsx") {
    throw new BillParseError(
      "unsupported_format",
      `识别到这是${kindLabel(sniffed)}，但只支持微信 XLSX、支付宝 CSV、BOA PDF 和 Libevra CSV。`,
    );
  }

  const document = sniffed === "text" ? null : await extract(buffer);
  return parseBillDocument(sniffed, buffer, document, context);
}
