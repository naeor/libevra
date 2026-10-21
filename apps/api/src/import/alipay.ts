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
import { BillParseError, type ParseContext, type ParsedBill } from "./types.js";

interface ColumnMap {
  readonly time: number;
  readonly category: number;
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
    const key = cleanText(cell);
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
    category: find("交易分类"),
    counterparty: find("交易对方"),
    product: find("商品说明"),
    direction: find("收/支"),
    amount: find("金额"),
    payment: find("收/付款方式", "付款方式"),
    status: find("交易状态"),
    order: find("交易订单号"),
    merchantOrder: find("商家订单号"),
    note: find("备注"),
  };
  if (columns.time < 0 || columns.amount < 0 || columns.direction < 0) return null;
  return columns;
}

function cellAt(cells: readonly string[], index: number): string {
  if (index < 0) return "";
  return cells[index] ?? "";
}

/**
 * 支付宝交易明细 CSV 适配器。
 *
 * 真实样本：GB18030、前 23 行说明、表头第 24 行、每行末尾多一个空列、
 * 订单号带尾部制表符。这里只消费已经按行切好的二维数组，
 * 编码与分隔符由 route 层的 sniff/decode 负责。
 *
 * 对方账号列故意不落库：那是邮箱/手机号，导入记账不需要它。
 */
export function parseAlipayCsv(
  rows: readonly (readonly string[])[],
  headerIndex: number,
  context: ParseContext,
): ParsedBill {
  const headerRow = rows[headerIndex];
  const columns = buildColumns(headerRow ?? []);
  if (columns === null) {
    throw new BillParseError(
      "unsupported_format",
      "支付宝明细的表头缺少交易时间、金额或收/支列。",
    );
  }

  const warnings: string[] = [];
  const candidates: BillImportCandidate[] = [];
  let totalRows = 0;
  let skippedRows = 0;
  let excludedCount = 0;
  let refundCount = 0;

  const preamble = rows
    .slice(0, headerIndex)
    .flatMap((row) => row)
    .map((cell) => cleanText(cell))
    .join(" ");
  const declaredCount = /共\s*(\d+)\s*笔/.exec(preamble)?.[1];

  for (let offset = headerIndex + 1; offset < rows.length; offset += 1) {
    const row = rows[offset];
    if (row === undefined) continue;
    const cells = row.map((cell) => cleanText(cell));
    if (cells.every((cell) => cell === "")) continue;

    // 文件尾部的说明/温馨提示不是交易；判断依据是「没有日期且像文字段落」。
    if (/^(以上|说明|温馨提示|注[:：])/.test(cells[0] ?? "")) continue;

    totalRows += 1;
    // 支付宝导出没有字段内换行，行下标可以精确对上文件行号。
    const line = offset + 1;

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
    const status = truncateText(cellAt(cells, columns.status), 200);
    const closed = /关闭|失败|已撤销|已取消/.test(status);

    let kind: "income" | "expense" | "unknown";
    if (directionRaw === "收入") kind = "income";
    else if (directionRaw === "支出") kind = "expense";
    else kind = "unknown";

    // 「不计收支」和「交易关闭」都不是真实收支；即便写了支出，也默认不导入。
    if (directionRaw === "不计收支" || closed) kind = "unknown";

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

    const categoryRaw = cellAt(cells, columns.category);
    const categoryText = [categoryRaw, product].filter((part) => part).join(" ");
    const categoryId =
      kind === "unknown"
        ? null
        : suggestCategoryId(categoryText, context.categories, kind);

    const orderRaw = cellAt(cells, columns.order);
    const merchantOrder = cellAt(cells, columns.merchantOrder);
    // `\t`/`/` 清洗干净后再当来源编号；都为空才用文件位置生成 synthetic。
    const refRaw = !isPlaceholder(orderRaw)
      ? orderRaw
      : !isPlaceholder(merchantOrder)
        ? merchantOrder
        : "";
    const sourceRef = makeSourceRef(
      "alipay:",
      refRaw,
      context.fingerprint,
      1,
      line,
    );

    const rowWarnings: string[] = [];
    if (directionRaw === "不计收支") {
      rowWarnings.push("这笔在支付宝里标记为「不计收支」，默认不导入。");
    } else if (closed) {
      rowWarnings.push(`交易状态为「${status}」，默认不导入。`);
    } else if (kind === "unknown") {
      rowWarnings.push(`收支方向「${directionRaw || "空"}」无法识别，默认不导入。`);
    }
    if (/退款/.test(status)) {
      refundCount += 1;
      rowWarnings.push(`交易状态为「${status}」，已保留原方向，请核对是否计入。`);
    }
    if (!isPlaceholder(paymentRaw) && paymentMethodId === null) {
      rowWarnings.push(`未找到匹配的支付方式「${cleanText(paymentRaw)}」，导入后需手动选择。`);
    }
    if (dateTime.precision === "day") {
      rowWarnings.push("文件只提供日期，时间按当天 00:00 记录。");
    }
    if (isPlaceholder(orderRaw) && isPlaceholder(merchantOrder)) {
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
    throw new BillParseError("no_rows", "支付宝明细里没有找到可识别的交易行。");
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
    warnings.push(`有 ${refundCount} 笔带退款状态，已保留但需要核对。`);
  }

  return {
    source: "alipay",
    format: "csv",
    candidates,
    warnings,
    reconciliation: { ok: null, messages: [] },
    totalRows,
    skippedRows,
  };
}
