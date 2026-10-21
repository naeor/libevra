import { randomUUID } from "node:crypto";

import { EXPORT_COLUMNS, type BillImportCandidate } from "@libellum/shared";

import {
  cleanText,
  normalizeAmountText,
  parseClockTime,
  parseLocalDate,
  truncateText,
} from "./common.js";
import { BillParseError, type ParseContext, type ParsedBill } from "./types.js";

const KEY_BY_HEADER: ReadonlyMap<string, string> = new Map(
  EXPORT_COLUMNS.map((column) => [column.header, column.key]),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valuesFor(header: readonly string[], row: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  header.forEach((cell, position) => {
    const key = KEY_BY_HEADER.get(cleanText(cell));
    if (key !== undefined) values.set(key, cleanText(row[position] ?? ""));
  });
  return values;
}

function kindFromText(raw: string): "income" | "expense" | "unknown" {
  const text = raw.trim();
  if (text === "支出" || text === "expense") return "expense";
  if (text === "收入" || text === "income") return "income";
  return "unknown";
}

/**
 * Libevra 自有 CSV 适配器。
 *
 * 保留旧 `/import` 的格式语义（EXPORT_COLUMNS 表头、日期+金额必需），
 * 但走新的候选/预览流程；`sourceRef` 不加平台前缀，避免和旧导入已写入的
 * 来源编号对不上、导致二次导入重复入账。
 */
export function parseLibevraCsv(
  rows: readonly (readonly string[])[],
  headerIndex: number,
  context: ParseContext,
): ParsedBill {
  const headerRow = rows[headerIndex];
  if (headerRow === undefined) {
    throw new BillParseError("empty_file", "账单文件是空的。");
  }
  const header = headerRow.map((cell) => cleanText(cell));
  const hasDate = header.some((cell) => KEY_BY_HEADER.get(cell) === "occurredLocalDate");
  const hasAmount = header.some((cell) => KEY_BY_HEADER.get(cell) === "amount");
  if (!hasDate || !hasAmount) {
    throw new BillParseError("missing_column", "Libevra 账单缺少日期或金额列。");
  }

  const categoryByName = new Map(
    context.categories.filter((category) => !category.isArchived).map((category) => [category.name, category]),
  );
  const paymentByName = new Map(
    context.paymentMethods
      .filter((method) => !method.isArchived)
      .map((method) => [method.name, method]),
  );

  const warnings: string[] = [];
  const candidates: BillImportCandidate[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  for (let offset = headerIndex + 1; offset < rows.length; offset += 1) {
    const row = rows[offset];
    if (row === undefined) continue;
    if (row.every((cell) => cleanText(cell) === "")) continue;

    totalRows += 1;
    const line = offset + 1;
    const values = valuesFor(header, row);

    const date = parseLocalDate(values.get("occurredLocalDate"));
    const currency = (values.get("currency") ?? "CNY").toUpperCase();
    const parsedAmount =
      /^[A-Z]{3}$/.test(currency)
        ? normalizeAmountText(values.get("amount"), currency)
        : null;
    // 旧 /import 一直按绝对值入库、方向由「类型」决定；这里保持同样的语义。
    const amount = parsedAmount?.startsWith("-") ? parsedAmount.slice(1) : parsedAmount;
    if (date === null || amount === null) {
      skippedRows += 1;
      if (warnings.length < 20) {
        warnings.push(`第 ${line} 行的日期、金额或币种无法识别，已跳过。`);
      }
      continue;
    }

    const kind = kindFromText(values.get("kind") ?? "");
    const rowWarnings: string[] = [];
    if (kind === "unknown") {
      rowWarnings.push(`类型「${values.get("kind") ?? ""}」无法识别，默认不导入。`);
    }

    const timeRaw = values.get("occurredTime") ?? "";
    const clock = parseClockTime(timeRaw);
    if (timeRaw && clock === null) {
      rowWarnings.push("时间无法识别，已按当天 00:00 处理。");
    }
    if (clock === null && !timeRaw) {
      rowWarnings.push("文件只提供日期，时间按当天 00:00 记录。");
    }

    const categoryName = values.get("category") ?? "";
    const category = categoryName ? categoryByName.get(categoryName) : undefined;
    if (categoryName && category === undefined) {
      rowWarnings.push(`分类「${categoryName}」不在账本中，导入时将使用系统分类。`);
    }

    const paymentName = values.get("paymentMethod") ?? "";
    const payment = paymentName ? paymentByName.get(paymentName) : undefined;
    if (paymentName && payment === undefined) {
      rowWarnings.push(`支付方式「${paymentName}」不在账本中，导入后需手动选择。`);
    }

    const tags = (values.get("tags") ?? "")
      .split(/\s+/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 30)
      .map((tag) => truncateText(tag, 40));

    const note = values.get("note") ?? "";
    const sourceRefRaw = (values.get("sourceRef") ?? "") || (values.get("fileId") ?? "");
    // 来源身份用于本账本回查；新候选始终有独立 UUID，跨账本导入不能占用源交易主键。
    const fileId = values.get("fileId") ?? "";
    const candidateId = randomUUID();

    candidates.push({
      id: candidateId,
      ...(UUID_PATTERN.test(fileId) ? { sourceTransactionId: fileId } : {}),
      selected: kind !== "unknown",
      amount,
      currency,
      kind,
      date: date.iso,
      time: clock?.time ?? null,
      timezone: cleanText(values.get("occurredTz")) || context.timezone,
      categoryId: category?.id ?? null,
      paymentMethodId: payment?.id ?? null,
      note: truncateText(note, 2000),
      tags,
      line,
      timePrecision: clock?.precision ?? "day",
      merchant: "",
      sourceRef: sourceRefRaw ? truncateText(sourceRefRaw, 64) : null,
      sourceStatus: "",
      warnings: rowWarnings,
      duplicateIds: [],
      identityDuplicate: false,
    });
  }

  if (candidates.length === 0) {
    throw new BillParseError("no_rows", "Libevra 账单里没有可识别的数据行。");
  }
  if (skippedRows > 0) {
    warnings.push(`有 ${skippedRows} 行日期/金额无法识别，已跳过。`);
  }

  return {
    source: "libevra",
    format: "csv",
    candidates,
    warnings,
    reconciliation: { ok: null, messages: [] },
    totalRows,
    skippedRows,
  };
}
