/**
 * 游客的本机导出：从本机数据生成与服务器 `/export` 同样的文件。
 *
 * 游客数据只在这个浏览器里，导出是唯一的备份手段。**文件内容的逻辑全部在 `@libellum/shared`**
 * （交易 → 行、CSV、XLSX、月份范围合并）——这里只做三件事：按筛选条件挑出本机的交易、
 * 把它们交给 shared、把结果装进页面已有的 `ExportedFile`。不要在这里另写一份同样的逻辑。
 *
 * 与服务器的两处客观差异（游客本机数据本来就没有这些字段）：
 * - 「录入时间」列为空（游客记录不存创建时间）；
 * - 「来源编号」列为空（游客没有导入来源）。
 */
import {
  MAX_EXPORT_ROWS,
  buildExportCsv,
  buildExportXlsxAsync,
  buildTemplateCsv,
  combineExportBounds,
  exportRowValues,
  newExportRef,
  toExportRow,
  type ExportFormat,
  type Transaction,
} from "@libellum/shared";

import { t } from "../i18n/index.js";
import { deflateRawBrowser } from "./deflateRaw.js";
import type { GuestData } from "./guest/data.js";

export interface GuestExportFilters {
  readonly format: ExportFormat;
  readonly monthFrom?: string | undefined;
  readonly monthTo?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly kind?: "income" | "expense" | undefined;
  readonly categoryId?: string | undefined;
  readonly paymentMethodId?: string | undefined;
  readonly tagId?: string | undefined;
  readonly currency?: string | undefined;
}

export interface GuestExportResult {
  readonly fileRef: string;
  readonly rowCount: number;
  readonly bytes: Uint8Array;
}

/** 服务器的顺序：本地日期、创建时间、id 都是新的在前；游客没有创建时间，用实际发生时刻代替。 */
function newestFirst(left: Transaction, right: Transaction): number {
  if (left.occurredLocalDate !== right.occurredLocalDate) {
    return left.occurredLocalDate < right.occurredLocalDate ? 1 : -1;
  }
  if (left.occurredAt !== right.occurredAt) return left.occurredAt < right.occurredAt ? 1 : -1;
  return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
}

export function selectGuestExportTransactions(
  data: GuestData,
  filters: GuestExportFilters,
): Transaction[] {
  const { from, to } = combineExportBounds(filters);

  return data.transactions
    .filter((tx) => {
      if (from !== undefined && tx.occurredLocalDate < from) return false;
      if (to !== undefined && tx.occurredLocalDate > to) return false;
      if (filters.kind !== undefined && tx.kind !== filters.kind) return false;
      if (filters.categoryId !== undefined && tx.categoryId !== filters.categoryId) return false;
      if (filters.paymentMethodId !== undefined && tx.paymentMethodId !== filters.paymentMethodId) return false;
      if (filters.currency !== undefined && tx.currency !== filters.currency) return false;
      if (filters.tagId !== undefined && !tx.tags.some((tag) => tag.id === filters.tagId)) return false;
      return true;
    })
    .sort(newestFirst);
}

/** 生成游客导出文件。超过上限是错误，不会悄悄给出更短的文件。 */
export async function buildGuestExport(
  data: GuestData,
  filters: GuestExportFilters,
  now: Date = new Date(),
): Promise<GuestExportResult> {
  const selected = selectGuestExportTransactions(data, filters);
  if (selected.length > MAX_EXPORT_ROWS) {
    throw new Error(t("dataio.export.tooLarge", { count: selected.length, limit: MAX_EXPORT_ROWS }));
  }

  const exportRef = newExportRef(now);
  // 分类、支付方式、标签的名字取当前的（改名后导出的是新名字，与服务器按关联取名一致）；找不到就用记录里存的名字。
  const categoryName = new Map(data.categories.map((category) => [category.id, category.name]));
  const paymentName = new Map(data.paymentMethods.map((method) => [method.id, method.name]));
  const tagName = new Map(data.tags.map((tag) => [tag.id, tag.name]));

  const rows = selected.map((tx) =>
    exportRowValues(
      toExportRow(
        {
          id: tx.id,
          seq: tx.seq,
          occurredAt: new Date(tx.occurredAt),
          occurredLocalDate: tx.occurredLocalDate,
          occurredTz: tx.occurredTz,
          kind: tx.kind,
          amountMinor: tx.amountCents,
          currency: tx.currency,
          categoryId: tx.categoryId,
          categoryName: categoryName.get(tx.categoryId) ?? tx.categoryName,
          paymentMethodName:
            tx.paymentMethodId === null ? null : (paymentName.get(tx.paymentMethodId) ?? tx.paymentMethodName),
          note: tx.note,
          tagNames: tx.tags.map((tag) => tagName.get(tag.id) ?? tag.name),
          createdAt: null,
          sourceRef: null,
        },
        data.categories,
      ),
      exportRef,
    ),
  );

  const bytes =
    filters.format === "xlsx"
      ? await buildExportXlsxAsync(rows, deflateRawBrowser)
      : new TextEncoder().encode(buildExportCsv(rows));

  return { fileRef: exportRef, rowCount: rows.length, bytes };
}

/** 导入模板：与服务器同一个函数生成。 */
export function buildGuestTemplate(): Uint8Array {
  return new TextEncoder().encode(buildTemplateCsv());
}
