import {
  CURRENCIES, billImportCommitRowSchema, billImportPreviewSchema, importReportSchema,
  type BillImportCandidate, type BillImportCommitRow, type BillImportPreview,
  type DuplicateDetectionSettings, type ImportReport,
} from "@libellum/shared";
import { t } from "../i18n/index.js";
import { apiFetch } from "./api.js";
import { parseAmountInput } from "./format.js";
import { publishGuestSnapshot } from "./guest/bridge.js";
import { guestRuntimeId, notifyGuestWrite } from "./guest/runtime.js";

/**
 * 1.19.96：游客的导入账单在本机完成（`lib/guest/billImport.ts`，解析与核对规则与服务器共用
 * `@libellum/shared/billParsers`）。按需加载：登录用户的导入页不带这一块（解析器 + 浏览器端 XLSX/PDF 抽取）。
 * 判断游客只看 `guestRuntimeId()`——与 `offline/write.ts` 的游客分支同一个入口，游客路径绝不调用 `apiFetch`。
 */
function guestBillImport() {
  return import("./guest/billImport.js");
}

/**
 * 来源（服务端识别出的账单类型）→ 文案键。
 *
 * ⚠️ S16：顶层只存键，显示时再 `billSourceLabel()` 取当前语言；`source` 本身是服务端的稳定值，不翻译。
 */
const BILL_SOURCE_KEYS = {
  libevra: "dataio.source.libevra",
  wechat: "dataio.source.wechat",
  alipay: "dataio.source.alipay",
  boa: "dataio.source.boa",
} as const satisfies Record<BillImportPreview["source"], string>;

/** 界面上显示的来源名称（`wechat` → 微信支付账单 / WeChat Pay statement）。 */
export function billSourceLabel(source: BillImportPreview["source"]): string {
  return t(BILL_SOURCE_KEYS[source]);
}

/** 导入请求必须显式点名账本，不能触发旧客户端的服务端兼容回退。 */
function requireImportBook(bookId: string): string {
  if (bookId.trim() === "") throw new Error(t("dataio.review.noBook"));
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
  if (!(CURRENCIES as readonly string[]).includes(item.currency)) return t("dataio.rowProblem.currency");
  try {
    const minor = parseAmountInput(item.amount, item.currency);
    if (!Number.isSafeInteger(minor) || minor <= 0) return t("dataio.rowProblem.amountRange");
  } catch { return t("dataio.rowProblem.amountPrecision"); }
  if (item.kind === "unknown") return t("dataio.rowProblem.direction");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return t("dataio.rowProblem.date");
  const date = new Date(`${item.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.date) return t("dataio.rowProblem.dateInvalid");
  if (item.time !== null && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.time)) return t("dataio.rowProblem.time");
  try { new Intl.DateTimeFormat("en", { timeZone: item.timezone }); }
  catch { return t("dataio.rowProblem.timezone"); }
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
  if (guestRuntimeId() !== null) {
    const target = requireImportBook(bookId);
    return billImportPreviewSchema.parse(await (await guestBillImport()).guestPreviewBill(file, target, settings, timezone));
  }
  const formData = new FormData();
  formData.append("settings", JSON.stringify(settings));
  formData.append("timezone", timezone);
  formData.append("file", file);
  return billImportPreviewSchema.parse(await apiFetch("/import/preview", { method: "POST", bookId: requireImportBook(bookId), formData, timeoutMs: 120_000 }));
}

export async function recheckBill(preview: BillImportPreview, bookId: string, settings: DuplicateDetectionSettings): Promise<BillImportPreview> {
  if (guestRuntimeId() !== null) {
    const target = requireImportBook(bookId);
    return billImportPreviewSchema.parse(await (await guestBillImport()).guestRecheckBill(preview.previewId, billCommitRows(preview.candidates), target, settings));
  }
  return billImportPreviewSchema.parse(await apiFetch("/import/recheck", {
    method: "POST", bookId: requireImportBook(bookId),
    body: { previewId: preview.previewId, rows: billCommitRows(preview.candidates), settings },
    timeoutMs: 120_000,
  }));
}

export async function commitBill(preview: BillImportPreview, bookId: string, acknowledgeWarnings: boolean): Promise<ImportReport> {
  if (guestRuntimeId() !== null) {
    const target = requireImportBook(bookId);
    const report = await (await guestBillImport()).guestCommitBill({
      previewId: preview.previewId,
      previewRevision: preview.revision,
      rows: billCommitRows(preview.candidates),
      acknowledgeWarnings,
    }, target);
    // 与 `offline/write.ts` 的游客写入相同：把新快照发布给明细 / 统计，并通知查询层刷新游客视图。
    publishGuestSnapshot();
    notifyGuestWrite();
    return importReportSchema.parse(report);
  }
  return importReportSchema.parse(await apiFetch("/import/commit", {
    method: "POST", bookId: requireImportBook(bookId),
    body: {
      previewId: preview.previewId,
      previewRevision: preview.revision,
      rows: billCommitRows(preview.candidates),
      acknowledgeWarnings,
    },
    timeoutMs: 120_000,
  }));
}
