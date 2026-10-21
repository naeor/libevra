import {
  CURRENCIES, billImportCommitRowSchema, billImportPreviewSchema, importReportSchema,
  type BillImportCandidate, type BillImportCommitRow, type BillImportPreview,
  type DuplicateDetectionSettings, type ImportReport,
} from "@libellum/shared";
import { apiFetch } from "./api.js";
import { parseAmountInput } from "./format.js";

export const BILL_SOURCE_LABELS: Record<BillImportPreview["source"], string> = {
  libevra: "Libevra 账单", wechat: "微信支付账单", alipay: "支付宝交易明细", boa: "Bank of America 结单",
};

/** 导入请求必须显式点名账本，不能触发旧客户端的服务端兼容回退。 */
function requireImportBook(bookId: string): string {
  if (bookId.trim() === "") throw new Error("尚未确定导入账本，请返回明细页后重新导入。");
  return bookId;
}

/** Only editable fields leave the browser; provenance stays with the server preview. */
export function billCommitRows(items: readonly BillImportCandidate[]): BillImportCommitRow[] {
  return items.map((item) => billImportCommitRowSchema.parse({
    id: item.id, selected: item.selected && !item.identityDuplicate,
    amount: item.amount, currency: item.currency, kind: item.kind, date: item.date,
    time: item.time, timezone: item.timezone, categoryId: item.categoryId,
    paymentMethodId: item.paymentMethodId, note: item.note, tags: item.tags,
  }));
}

export function billRowProblem(item: BillImportCandidate): string | null {
  if (item.identityDuplicate || !item.selected) return null;
  if (!(CURRENCIES as readonly string[]).includes(item.currency)) return "请确认币种。";
  try {
    const minor = parseAmountInput(item.amount, item.currency);
    if (!Number.isSafeInteger(minor) || minor <= 0) return "金额必须大于零且不能超过可保存范围。";
  } catch { return "请填写符合币种精度的金额。"; }
  if (item.kind === "unknown") return "请确认收入或支出方向。";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return "请确认交易日期。";
  const date = new Date(`${item.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.date) return "交易日期不存在。";
  if (item.time !== null && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.time)) return "请确认交易时间。";
  try { new Intl.DateTimeFormat("en", { timeZone: item.timezone }); }
  catch { return "请填写有效的时区。"; }
  return null;
}

export function billReviewCounts(items: readonly BillImportCandidate[]) {
  const selected = items.filter((row) => row.selected && !row.identityDuplicate);
  return {
    total: items.length,
    selected: selected.length,
    importable: selected.filter((row) => billRowProblem(row) === null).length,
    review: items.filter((row) => billRowProblem(row) !== null || row.warnings.length > 0).length,
    duplicates: items.filter((row) => row.duplicateIds.length > 0).length,
    excluded: items.filter((row) => !row.selected || row.identityDuplicate).length,
  };
}

export async function previewBill(file: File, bookId: string, settings: DuplicateDetectionSettings, timezone: string): Promise<BillImportPreview> {
  const formData = new FormData();
  formData.append("settings", JSON.stringify(settings));
  formData.append("timezone", timezone);
  formData.append("file", file);
  return billImportPreviewSchema.parse(await apiFetch("/import/preview", { method: "POST", bookId: requireImportBook(bookId), formData, timeoutMs: 120_000 }));
}

export async function recheckBill(preview: BillImportPreview, bookId: string, settings: DuplicateDetectionSettings): Promise<BillImportPreview> {
  return billImportPreviewSchema.parse(await apiFetch("/import/recheck", {
    method: "POST", bookId: requireImportBook(bookId),
    body: { previewId: preview.previewId, rows: billCommitRows(preview.candidates), settings },
    timeoutMs: 120_000,
  }));
}

export async function commitBill(preview: BillImportPreview, bookId: string, acknowledgeWarnings: boolean): Promise<ImportReport> {
  return importReportSchema.parse(await apiFetch("/import/commit", {
    method: "POST", bookId: requireImportBook(bookId),
    body: { previewId: preview.previewId, rows: billCommitRows(preview.candidates), acknowledgeWarnings },
    timeoutMs: 120_000,
  }));
}
