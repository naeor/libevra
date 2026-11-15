import { categoryPath, type CategoryNode } from "./categoryTree.js";
import { EXPORT_COLUMNS, TEMPLATE_COLUMN_KEYS } from "./export.js";
import { buildXlsx, buildXlsxAsync, type XlsxOptions } from "./exportXlsx.js";
import type { DeflateRaw, DeflateRawAsync } from "./exportZip.js";
import { formatTransactionNumber } from "./ledger.js";
import { decimalsFor } from "./money.js";
import { csvRow, csvRowEscaped } from "./spreadsheet.js";

/**
 * 导出文件的**纯逻辑**：已取到的交易 → 导出行 → CSV / XLSX 字节。
 *
 * 1.19.94 从 `apps/api/src/routes/export.ts` 与 `apps/api/src/ledger/export-query.ts` 移到这里，
 * 服务器与游客（浏览器、本机数据）用同一份：列、顺序、BOM、换行、公式转义都只有一处定义。
 * 数据库查询仍在服务器；游客的数据读取在 `apps/web/src/lib/guest/`。
 */

export interface ExportRow {
  readonly id: string;
  /** **The number a person reads, exactly as displayed: `#000001`.** */
  readonly displayNumber: string;
  /** `YYYY-MM-DD`, the phone's own calendar date. */
  readonly occurredLocalDate: string;
  /** `HH:mm`, in the zone the entry was recorded in. */
  readonly occurredTime: string;
  readonly occurredTz: string;
  readonly kind: "income" | "expense";
  /** A number, because a spreadsheet must be able to sum it. */
  readonly amount: number;
  readonly currency: string;
  readonly categoryName: string;
  readonly categoryPath?: string;
  readonly paymentMethodName: string | null;
  readonly note: string | null;
  readonly tagNames: readonly string[];
  /** `YYYY-MM-DD HH:mm:ss`（UTC）— when the row was created. 游客数据没有这一项，为空串。 */
  readonly createdAt: string;
  readonly sourceRef: string | null;
}

/** 一条已取到的交易，字段都是原始值（服务器从数据库行，游客从本机记录）。 */
export interface ExportSourceTransaction {
  readonly id: string;
  /** 打印的编号；缺失（旧数据）时编号列为空串。 */
  readonly seq: number | null | undefined;
  readonly occurredAt: Date;
  /** `YYYY-MM-DD`。 */
  readonly occurredLocalDate: string;
  readonly occurredTz: string;
  readonly kind: "income" | "expense";
  /** 最小币种单位的整数（¥1000 存为 1000）。 */
  readonly amountMinor: number;
  readonly currency: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly paymentMethodName: string | null;
  readonly note: string | null;
  readonly tagNames: readonly string[];
  /** 没有则 `null`（游客）。 */
  readonly createdAt: Date | null;
  readonly sourceRef: string | null;
}

/** `HH:mm` in the zone the entry was recorded in, falling back to the stored instant. */
export function timeInZone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(instant);
  }
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCreatedAt(createdAt: Date | null): string {
  if (createdAt === null) return "";
  return `${createdAt.toISOString().slice(0, 10)} ${twoDigits(createdAt.getUTCHours())}:${twoDigits(createdAt.getUTCMinutes())}:${twoDigits(createdAt.getUTCSeconds())}`;
}

/**
 * 交易 → 导出行。`categories` 用来算分类路径 JSON。
 *
 * ⚠️ 编号用与界面同一个 `formatTransactionNumber`；金额按币种自己的精度换算
 * （¥800 存为 800，不是 80000——写死除以一百曾把 ¥800 导成 8）。
 */
export function toExportRow(
  source: ExportSourceTransaction,
  categories: readonly CategoryNode[],
): ExportRow {
  return {
    id: source.id,
    displayNumber: source.seq == null ? "" : formatTransactionNumber(source.seq),
    occurredLocalDate: source.occurredLocalDate,
    occurredTime: timeInZone(source.occurredAt, source.occurredTz),
    occurredTz: source.occurredTz,
    kind: source.kind,
    amount: source.amountMinor / 10 ** decimalsFor(source.currency),
    currency: source.currency,
    categoryName: source.categoryName,
    categoryPath: JSON.stringify(categoryPath(categories, source.categoryId).map((c) => c.name)),
    paymentMethodName: source.paymentMethodName,
    note: source.note,
    tagNames: source.tagNames,
    createdAt: formatCreatedAt(source.createdAt),
    sourceRef: source.sourceRef,
  };
}

/**
 * Columns whose values come from the user and are therefore escaped.
 *
 * Everything except 金额, which is written as a bare number: escaping a number
 * turns it into text and breaks the one thing a spreadsheet export is for.
 */
export const EXPORT_TEXT_COLUMNS: readonly number[] = EXPORT_COLUMNS.map((column, index) => ({ column, index }))
  .filter(({ column }) => column.key !== "amount")
  .map(({ index }) => index);

export const EXPORT_HEADERS: readonly string[] = EXPORT_COLUMNS.map((column) => column.header);

/**
 * The cell values for one row, in column order.
 *
 * `exportRef` 对同一次导出的每一行都相同——“这个文件来自哪次导出”看一个单元格就能回答。
 */
export function exportRowValues(row: ExportRow, exportRef: string): (string | number)[] {
  return EXPORT_COLUMNS.map((column) => {
    switch (column.key) {
      case "displayNumber":
        // 写成用户看到的字符串（含 `#`），与明细页一致。
        return row.displayNumber;
      case "occurredLocalDate":
        return row.occurredLocalDate;
      case "occurredTime":
        return row.occurredTime;
      case "occurredTz":
        return row.occurredTz;
      case "kind":
        return row.kind === "expense" ? "支出" : "收入";
      case "amount":
        // Expenses are negative so a spreadsheet's own SUM is meaningful.
        return row.kind === "expense" ? -row.amount : row.amount;
      case "currency":
        return row.currency;
      case "category":
        return row.categoryName;
      case "categoryPath":
        return row.categoryPath ?? JSON.stringify([row.categoryName]);
      case "paymentMethod":
        return row.paymentMethodName ?? "";
      case "note":
        return row.note ?? "";
      case "tags":
        return row.tagNames.join(" ");
      case "createdAt":
        return row.createdAt;
      case "fileId":
        return row.id;
      case "sourceRef":
        return row.sourceRef ?? "";
      case "exportRef":
        return exportRef;
    }
  });
}

/** UTF-8 BOM + 表头 + 每行，`\r\n` 分隔并以 `\r\n` 结尾；文本列做公式转义。 */
export function buildExportCsv(rows: readonly (readonly (string | number)[])[]): string {
  return `﻿${[
    csvRow(EXPORT_HEADERS as string[]),
    ...rows.map((row) => csvRowEscaped(row, EXPORT_TEXT_COLUMNS)),
  ].join("\r\n")}\r\n`;
}

/** 导入模板：同样的表头，没有行，没有追溯列。 */
export function buildTemplateCsv(): string {
  const headers = EXPORT_COLUMNS.filter((column) => TEMPLATE_COLUMN_KEYS.includes(column.key)).map(
    (column) => column.header,
  );
  return `﻿${csvRow(headers)}\r\n`;
}

/** 各列在表格里的宽度（字符数），按列的 key 写，不按序号——见下方说明。 */
const EXPORT_XLSX_WIDTHS: Readonly<Partial<Record<(typeof EXPORT_COLUMNS)[number]["key"], number>>> = {
  displayNumber: 10,
  occurredLocalDate: 12,
  occurredTime: 8,
  occurredTz: 16,
  kind: 6,
  amount: 12,
  currency: 8,
  category: 12,
  paymentMethod: 12,
  note: 28,
  tags: 16,
  createdAt: 20,
  fileId: 38,
  sourceRef: 38,
  exportRef: 26,
  categoryPath: 30,
};

function exportColumnIndex(key: (typeof EXPORT_COLUMNS)[number]["key"]): number {
  return EXPORT_COLUMNS.findIndex((column) => column.key === key);
}

/**
 * 金额列写成数字并保留两位小数（表格自己的求和才有意义）。
 *
 * ⚠️ 列序号**从 `EXPORT_COLUMNS` 按 key 算出来**，不写死。1.19.98 之前这里写死 `[4]`：首列加了「编号」之后
 * 金额移到第 5 列（F），第 4 列成了「类型」，于是金额一直被写成文本、列宽也整体错了一列（所有者 2026-11-16 确认按 bug 修）。
 */
const AMOUNT_COLUMN = exportColumnIndex("amount");
export const EXPORT_XLSX_OPTIONS: XlsxOptions = {
  sheetName: "账目",
  numericColumns: [AMOUNT_COLUMN],
  decimalColumns: [AMOUNT_COLUMN],
  columnWidths: Object.fromEntries(
    EXPORT_COLUMNS.flatMap((column, index) => {
      const width = EXPORT_XLSX_WIDTHS[column.key];
      return width === undefined ? [] : [[index, width]];
    }),
  ),
};

export function buildExportXlsx(
  rows: readonly (readonly (string | number)[])[],
  deflate?: DeflateRaw,
): Uint8Array {
  return buildXlsx([EXPORT_HEADERS, ...rows], EXPORT_XLSX_OPTIONS, deflate);
}

export function buildExportXlsxAsync(
  rows: readonly (readonly (string | number)[])[],
  deflate?: DeflateRawAsync,
): Promise<Uint8Array> {
  return buildXlsxAsync([EXPORT_HEADERS, ...rows], EXPORT_XLSX_OPTIONS, deflate);
}

/** 文件名里的日期戳：取导出编号里的 `YYYYMMDD`。 */
export function exportStamp(exportRef: string): string {
  return exportRef.slice(4, 19).replace(/-/g, "").slice(0, 8);
}

/** `2026-10` boundaries, expanded to date literals. */
function monthBounds(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** 把月份范围与日期范围合并成闭区间日期界限（取更窄的一边）。 */
export function combineExportBounds(query: {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly monthFrom?: string | undefined;
  readonly monthTo?: string | undefined;
}): { from: string | undefined; to: string | undefined } {
  let from = query.from;
  let to = query.to;

  if (query.monthFrom !== undefined) {
    const bounds = monthBounds(query.monthFrom);
    from = from === undefined || bounds.start > from ? bounds.start : from;
  }
  if (query.monthTo !== undefined) {
    const bounds = monthBounds(query.monthTo);
    to = to === undefined || bounds.end < to ? bounds.end : to;
  }

  return { from, to };
}
