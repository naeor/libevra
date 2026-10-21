import { randomUUID } from "node:crypto";

import type { BillImportCandidate } from "@libellum/shared";

import {
  cleanText,
  isPlaceholder,
  makeSourceRef,
  normalizeAmountText,
  splitDateTime,
  suggestCategoryId,
  suggestPaymentMethodId,
  truncateText,
} from "./common.js";
import { detectWechatHeader } from "./sniff.js";
import {
  BillParseError,
  type ExtractedSheet,
  type ParseContext,
  type ParsedBill,
} from "./types.js";

const KNOWN_COLUMNS = [
  "交易时间",
  "交易类型",
  "交易对方",
  "商品",
  "收/支",
  "收支",
  "金额(元)",
  "金额（元）",
  "金额",
  "支付方式",
  "当前状态",
  "交易单号",
  "商户单号",
  "备注",
];

interface ColumnMap {
  readonly time: number;
  readonly type: number;
  readonly counterparty: number;
  readonly product: number;
  readonly direction: number;
  readonly amount: number;
  readonly payment: number;
  readonly status: number;
  readonly order: number;
  readonly merchantOrder: number;
  readonly note: number;
}

function buildColumns(header: readonly string[]): ColumnMap | null {
  const index = new Map<string, number>();
  header.forEach((cell, position) => {
    const key = cell.trim();
    if (key && !index.has(key)) index.set(key, position);
  });
  const find = (...names: string[]): number => {
    for (const name of names) {
      const hit = index.get(name);
      if (hit !== undefined) return hit;
    }
    return -1;
  };

  const columns: ColumnMap = {
    time: find("交易时间"),
    type: find("交易类型"),
    counterparty: find("交易对方"),
    product: find("商品"),
    direction: find("收/支", "收支"),
    amount: find("金额(元)", "金额（元）", "金额"),
    payment: find("支付方式"),
    status: find("当前状态"),
    order: find("交易单号"),
    merchantOrder: find("商户单号"),
    note: find("备注"),
  };
  if (columns.time < 0 || columns.amount < 0) return null;
  return columns;
}

function cellAt(cells: readonly string[], index: number): string {
  if (index < 0) return "";
  return cells[index] ?? "";
}

function directionKind(raw: string): "income" | "expense" | "unknown" {
  const text = raw.trim();
  if (text === "收入") return "income";
  if (text === "支出") return "expense";
  return "unknown";
}

/**
 * 微信支付账单 XLSX 适配器。
 *
 * 说明区在上面且长度不固定（真实样本 17 行），所以表头必须扫；
 * 金额列没有负号，方向只能从「收/支」读；状态列决定退款/关闭是否默认勾选。
 */
export function parseWechatXlsx(
  sheets: readonly ExtractedSheet[],
  context: ParseContext,
): ParsedBill {
  let sheet: ExtractedSheet | null = null;
  let headerIndex: number | null = null;
  for (const candidate of sheets) {
    const found = detectWechatHeader(candidate.rows.map((row) => row.cells));
    if (found !== null) {
      sheet = candidate;
      headerIndex = found;
      break;
    }
  }

  if (sheet === null || headerIndex === null) {
    throw new BillParseError(
      "unsupported_format",
      "没有在工作簿里找到微信支付账单的表头（交易时间/收/支/金额 等）。",
    );
  }

  const headerRow = sheet.rows[headerIndex];
  const columns = buildColumns(headerRow?.cells.map(cleanText) ?? []);
  if (columns === null) {
    throw new BillParseError("invalid_xlsx", "微信账单表头缺少交易时间或金额列。");
  }

  const warnings: string[] = [];
  const candidates: BillImportCandidate[] = [];
  let totalRows = 0;
  let skippedRows = 0;
  let excludedCount = 0;
  let refundCount = 0;

  // 说明区的统计数字用于交叉核对：文件被截断时，用户需要看到不一致。
  const preamble = sheet.rows
    .slice(0, headerIndex)
    .flatMap((row) => row.cells)
    .map((cell) => cleanText(cell))
    .join(" ");
  const declaredCount = /共\s*(\d+)\s*笔/.exec(preamble)?.[1];

  for (let offset = headerIndex + 1; offset < sheet.rows.length; offset += 1) {
    const row = sheet.rows[offset];
    if (row === undefined) continue;
    const cells = row.cells.map((cell) => cleanText(cell));
    if (cells.every((cell) => cell === "")) continue;

    // 合计/页脚行不是交易；微信账单通常没有，但保留防御。
    if (/^(合计|总计|小计)/.test(cells[0] ?? "")) continue;

    totalRows += 1;
    const line = row.line;

    const dateTime = splitDateTime(cellAt(cells, columns.time));
    const amount = normalizeAmountText(cellAt(cells, columns.amount), "CNY");
    if (dateTime === null || amount === null) {
      skippedRows += 1;
      if (warnings.length < 20) {
        warnings.push(`第 ${line} 行的交易时间或金额无法识别，已跳过。`);
      }
      continue;
    }

    const directionRaw = cellAt(cells, columns.direction);
    let kind = directionKind(directionRaw);
    const status = truncateText(cellAt(cells, columns.status), 200);
    const closed = /关闭|失败|已撤销|已取消/.test(status);
    if (closed) {
      kind = "unknown";
    }

    const merchantRaw = cellAt(cells, columns.counterparty);
    const merchant = isPlaceholder(merchantRaw) ? "" : truncateText(merchantRaw, 200);
    const productRaw = cellAt(cells, columns.product);
    const product = isPlaceholder(productRaw) ? "" : productRaw;
    const noteRaw = cellAt(cells, columns.note);
    const noteExtra = isPlaceholder(noteRaw) ? "" : noteRaw;
    const noteParts: string[] = [];
    if (product) noteParts.push(product);
    if (noteExtra && noteExtra !== product) noteParts.push(noteExtra);

    const paymentRaw = cellAt(cells, columns.payment);
    const paymentMethodId = isPlaceholder(paymentRaw)
      ? null
      : suggestPaymentMethodId(paymentRaw, context.paymentMethods);

    const typeRaw = cellAt(cells, columns.type);
    const categoryText = [product, typeRaw, merchant].filter((part) => part).join(" ");
    const categoryId =
      kind === "unknown"
        ? null
        : suggestCategoryId(categoryText, context.categories, kind);

    const orderRaw = cellAt(cells, columns.order);
    // `/` 是微信的“无此字段”占位；当成单号会让多笔交易共用 wechat:/ 而被判成重复。
    const sourceRef = makeSourceRef(
      "wechat:",
      isPlaceholder(orderRaw) ? "" : orderRaw,
      context.fingerprint,
      1,
      line,
    );

    const rowWarnings: string[] = [];
    if (directionRaw === "不计收支" || directionRaw === "中性交易") {
      rowWarnings.push("这笔在微信里标记为「不计收支」，默认不导入。");
    } else if (kind === "unknown") {
      rowWarnings.push(`收支方向「${directionRaw || "空"}」无法识别，默认不导入。`);
    }
    if (closed) {
      rowWarnings.push(`交易状态为「${status}」，默认不导入。`);
    }
    if (/退款|退还|退回/.test(status)) {
      refundCount += 1;
      rowWarnings.push(`交易状态为「${status}」，已保留原方向，请核对是否计入。`);
    }
    if (!isPlaceholder(paymentRaw) && paymentMethodId === null) {
      rowWarnings.push(`未找到匹配的支付方式「${cleanText(paymentRaw)}」，导入后需手动选择。`);
    }
    if (dateTime.precision === "day") {
      rowWarnings.push("文件只提供日期，时间按当天 00:00 记录。");
    }
    if (isPlaceholder(orderRaw)) {
      rowWarnings.push("这笔没有交易单号，已按文件位置生成来源编号；换一份导出可能无法识别为同一笔。");
    }

    const selected = kind !== "unknown" && !closed;
    if (!selected) excludedCount += 1;

    candidates.push({
      id: randomUUID(),
      selected,
      amount,
      currency: "CNY",
      kind,
      date: dateTime.date.iso,
      time: dateTime.time?.time ?? null,
      timezone: context.timezone,
      categoryId,
      paymentMethodId,
      note: truncateText(noteParts.join("；"), 2000),
      tags: [],
      line,
      timePrecision: dateTime.precision,
      merchant,
      sourceRef,
      sourceStatus: status,
      warnings: rowWarnings,
      duplicateIds: [],
      identityDuplicate: false,
    });
  }

  if (candidates.length === 0) {
    throw new BillParseError("no_rows", "微信账单里没有找到可识别的交易行。");
  }

  if (declaredCount !== undefined && Number(declaredCount) !== totalRows) {
    warnings.push(
      `说明区记录共 ${Number(declaredCount)} 笔，实际识别 ${totalRows} 笔，请核对文件是否完整。`,
    );
  }
  if (excludedCount > 0) {
    warnings.push(`已默认排除 ${excludedCount} 笔不计收支/关闭交易，可在核对页逐笔勾选。`);
  }
  if (skippedRows > 0) {
    warnings.push(`有 ${skippedRows} 行无法识别交易时间或金额，已跳过。`);
  }
  if (refundCount > 0) {
    warnings.push(`有 ${refundCount} 笔带退款/退还状态，已保留但需要核对。`);
  }

  return {
    source: "wechat",
    format: "xlsx",
    candidates,
    warnings,
    reconciliation: { ok: null, messages: [] },
    totalRows,
    skippedRows,
  };
}

export const WECHAT_COLUMN_NAMES = KNOWN_COLUMNS;
