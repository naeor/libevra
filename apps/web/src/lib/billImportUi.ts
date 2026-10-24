/**
 * 账单导入 V2 的**纯前端逻辑**：不变的东西放这里，页面只负责状态与请求。
 *
 * 这一层刻意不 import React、不读 storage、不发请求，原因和 `lib/ocr/*` 一样：
 * 本仓库的 web 测试跑在纯 Node 里（没有 DOM），页面交互只能靠“纯函数 + 静态标记 +
 * 源码契约”三种手段验证。把判定、计数、分组、提交前校验写成纯函数，才有东西可测。
 *
 * ⚠️ **判重本身不在这里。** 文件内重复与历史账目重复都由服务端统一判重（`duplicateIds`、
 * `identityDuplicate`），前端只做展示与“保留/跳过”的选择。用户已确认「不是同一笔」的配对由
 * 服务端抑制，前端不再二次提示——否则会出现“后端说不是，前端还在喊重复”的矛盾。
 */

import {
  MAX_BILL_IMPORT_BYTES,
  type BillImportCandidate,
  type BillImportPreview,
  type ImportReport,
} from "@libellum/shared";

import { t } from "../i18n/index.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { billRowProblem } from "./billImport.js";

/**
 * ⚠️ S16：这一层的文案都在**调用时**用 `t()` 取（页面每次渲染都会重新调用这些函数），
 * 顶层常量只存键。服务端预览里带来的提示（`warnings`、对账说明、提交失败原因）是服务器的中文原文，
 * 显示前经过 `translateSharedMessage` 查表：中文界面原样显示，英文界面查到译文才替换。
 */

/**
 * 文件选择框的 `accept`。
 *
 * **不是格式白名单的全部真相**：真正的格式判定在服务端（读文件头/表头，不看扩展名）。
 * 这里的扩展名 + MIME 只用于让系统文件选择器少显示无关文件；`billFileProblem` 用同一份
 * 列表做“明显不可能”的早退，避免让用户等一次 10MB 上传后才看到“不认识这个格式”。
 */
export const BILL_IMPORT_ACCEPT =
  ".csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf";

/** 首批支持的扩展名（小写，含点）。 */
const BILL_IMPORT_EXTENSIONS = [".csv", ".xlsx", ".pdf"] as const;

const BILL_IMPORT_MIME_TYPES = new Set<string>([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
]);

/** `10 MB` 这类人类可读的大小。输入为字节；0 显示 `0 B`。 */
export function formatBillFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))} MB`;
}

/**
 * 选文件阶段的早退检查。`null` 表示“可以让服务端试一试”。
 *
 * ⚠️ **扩展名不认识但 MIME 认识时放行**：有些系统下载的账单没有扩展名（`statement`），
 * 或者扩展名被改坏。真正该拒绝的是“扩展名和 MIME 都不像账单”的文件。
 * 反过来，服务端才是最终裁决者——它读不出表头时会返回明确的错误，前端照原样显示。
 */
export function billFileProblem(file: { readonly name: string; readonly size: number; readonly type?: string }): string | null {
  if (file.size <= 0) return t("dataio.billFile.empty");
  if (file.size > MAX_BILL_IMPORT_BYTES) {
    return t("dataio.billFile.tooLarge", {
      size: formatBillFileSize(file.size),
      limit: formatBillFileSize(MAX_BILL_IMPORT_BYTES),
    });
  }

  const name = file.name.toLowerCase();
  const extension = /\.[a-z0-9]+$/.exec(name)?.[0] ?? "";
  const type = (file.type ?? "").toLowerCase();

  if ((BILL_IMPORT_EXTENSIONS as readonly string[]).includes(extension)) return null;
  if (type !== "" && BILL_IMPORT_MIME_TYPES.has(type)) return null;

  return t("dataio.billFile.unsupported");
}

/** 逐笔卡片的展示状态。**顺序有意义**：身份重复优先于一切。 */
export type BillRowStatus = "identity" | "duplicate" | "review" | "ready" | "excluded";

/** 状态徽章的文字（显示时取当前语言）。 */
export function billRowStatusLabel(status: BillRowStatus): string {
  return t(`dataio.rowStatus.${status}`);
}

/** 状态徽章的颜色；与 OCR 概览的语义一致：提醒用 `warn-*`，正常用品牌色。 */
export const BILL_ROW_STATUS_CLASSES: Readonly<Record<BillRowStatus, string>> = {
  identity: "bg-canvas text-muted",
  duplicate: "bg-warn-soft text-warn-dark",
  review: "bg-warn-soft text-warn-dark",
  ready: "bg-brand-soft text-brand-dark",
  excluded: "bg-canvas text-muted",
};

/** 方向的字面文案；`unknown` 单独一档，因为账单里确实有“不计收支”的行。 */
export function billDirectionLabel(kind: BillImportCandidate["kind"]): string {
  return t(`dataio.direction.${kind}`);
}

/** 这一笔是否**真的会写进账本**：勾选了，且不是服务端已判定“来源已存在”的那一笔。 */
export function billRowSelected(item: BillImportCandidate): boolean {
  return item.selected && !item.identityDuplicate;
}

/**
 * 逐笔问题（金额/币种/方向/日期/时间/时区），来自既有契约的 `billRowProblem`。
 *
 * `item.warnings` 是服务端识别时写的中文原文，只在显示时查表翻译，不改预览数据本身。
 */
export function billRowWarnings(item: BillImportCandidate, problem: string | null): string[] {
  const warnings = item.warnings.map((warning) => translateSharedMessage(warning));
  if (problem !== null) warnings.push(problem);
  return warnings;
}

export function billRowStatus(item: BillImportCandidate, problem: string | null): BillRowStatus {
  if (item.identityDuplicate) return "identity";
  if (item.duplicateIds.length > 0) return "duplicate";
  if (problem !== null || item.warnings.length > 0) return "review";
  return billRowSelected(item) ? "ready" : "excluded";
}

/** 概览的五个筛选，与 OCR 概览的胶囊按钮保持一致。 */
export type BillImportFilter = "all" | "review" | "duplicate" | "selected" | "excluded";

/** 筛选按钮的顺序；文字在显示时用 `billFilterLabel()` 取。 */
export const BILL_IMPORT_FILTERS: readonly { readonly id: BillImportFilter }[] = [
  { id: "all" },
  { id: "review" },
  { id: "duplicate" },
  { id: "selected" },
  { id: "excluded" },
];

export function billFilterLabel(filter: BillImportFilter): string {
  return t(`dataio.filter.${filter}`);
}

/** 与 `billReviewCounts` 同口径，只是把“已跳过”拆出来给筛选用。 */
export interface BillFilterCounts extends Record<BillImportFilter, number> {
  readonly total: number;
  readonly identity: number;
}

/** “待核对”的判定：字段问题（金额/日期等）或有提醒。重复单独一档。 */
function billRowNeedsReview(
  item: BillImportCandidate,
  problem: string | null = billRowProblem(item),
): boolean {
  return problem !== null || item.warnings.length > 0;
}

export function billFilterCounts(
  items: readonly BillImportCandidate[],
  /** 允许调用方缓存逐笔校验结果，避免每次输入都重算几万行的金额/日期。 */
  problemOf: (item: BillImportCandidate) => string | null = billRowProblem,
): BillFilterCounts {
  let review = 0;
  let duplicate = 0;
  let selected = 0;
  let excluded = 0;
  let identity = 0;

  for (const item of items) {
    if (item.duplicateIds.length > 0) duplicate += 1;
    if (item.identityDuplicate) identity += 1;
    if (billRowSelected(item)) selected += 1;
    else excluded += 1;
    if (billRowNeedsReview(item, problemOf(item))) review += 1;
  }

  return {
    all: items.length,
    total: items.length,
    review,
    duplicate,
    selected,
    excluded,
    identity,
  };
}

/**
 * 按筛选过滤。
 *
 * “待核对”包括字段问题（金额/日期等）——这些正是用户要改的；**疑似重复单独一档**，
 * 因为重复不等于填错，两者要分开看。已选/已跳过按“最终是否会写入”算。
 */
export function billFilterRows(
  items: readonly BillImportCandidate[],
  filter: BillImportFilter,
  problemOf: (item: BillImportCandidate) => string | null = billRowProblem,
): readonly BillImportCandidate[] {
  switch (filter) {
    case "all":
      return items;
    case "review":
      return items.filter((item) => billRowNeedsReview(item, problemOf(item)));
    case "duplicate":
      return items.filter((item) => item.duplicateIds.length > 0);
    case "selected":
      return items.filter((item) => billRowSelected(item));
    case "excluded":
      return items.filter((item) => !billRowSelected(item));
  }
}

/** 文件内部的疑似重复分组（同一份文件里两笔以上像同一笔）。 */
export interface BillDuplicateGroup {
  readonly groupId: string;
  readonly ids: readonly string[];
  /** 展示用的说明（调用时按当前界面语言生成）；具体证据由服务端统一判重给出，这里只说“像”。 */
  readonly reason: string;
}

/** 与**账本里已有账目**相似的引用：只有编号，没有内容，因此不能两边对比。 */
export interface BillHistoryDuplicate {
  readonly candidateId: string;
  readonly ids: readonly string[];
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(node: string): string {
    const current = this.parent.get(node) ?? node;
    this.parent.set(node, current);
    if (current === node) return node;
    const root = this.find(current);
    this.parent.set(node, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent.set(rightRoot, leftRoot);
  }
}

/**
 * 把 `duplicateIds` 分成两堆：能在本批预览里找到的（文件内重复，可并排对比）与找不到的
 * （已有账目的编号，只能提示“和账本里的某一笔相似”）。
 *
 * ⚠️ **契约里 `duplicateIds` 没有说明指向哪一边**。这里用“能否解析成同批候选”来区分，
 * 两种情况都能正确展示；如果后端将来给出明确字段，只需改这一个函数。
 */
function partitionDuplicateIds(items: readonly BillImportCandidate[]): {
  readonly edges: readonly { readonly left: string; readonly right: string }[];
  readonly history: readonly BillHistoryDuplicate[];
} {
  const known = new Set(items.map((item) => item.id));
  const edges: { left: string; right: string }[] = [];
  const seen = new Set<string>();
  const history: BillHistoryDuplicate[] = [];

  for (const item of items) {
    const foreign = item.duplicateIds.filter((id) => !known.has(id));
    if (foreign.length > 0) history.push({ candidateId: item.id, ids: [...new Set(foreign)].sort() });

    for (const other of item.duplicateIds) {
      if (other === item.id || !known.has(other)) continue;
      // 无向边去重：A→B 与 B→A 只留一条。
      const key = [item.id, other].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ left: item.id, right: other });
    }
  }

  return { edges, history };
}

/**
 * 文件内的疑似重复分组（并查集），按候选在文件里的顺序输出。
 *
 * ⚠️ **只分组，不取消勾选。** 与 OCR 概览的既有决定一致：疑似重复只提示，
 * 由用户决定保留哪些；自动取消会导致“明明没问题却被静默跳过”。
 */
export function billDuplicateGroups(items: readonly BillImportCandidate[]): BillDuplicateGroup[] {
  const { edges } = partitionDuplicateIds(items);
  if (edges.length === 0) return [];

  const forest = new UnionFind();
  for (const edge of edges) forest.union(edge.left, edge.right);

  const order = new Map(items.map((item, index) => [item.id, index]));
  const members = new Map<string, string[]>();
  for (const edge of edges) {
    for (const id of [edge.left, edge.right]) {
      const root = forest.find(id);
      const list = members.get(root) ?? [];
      if (!list.includes(id)) list.push(id);
      members.set(root, list);
    }
  }

  const groups: BillDuplicateGroup[] = [];
  for (const list of members.values()) {
    const ids = [...list].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    if (ids.length < 2) continue;
    groups.push({
      groupId: `bill-dup-${String(groups.length + 1)}`,
      ids,
      reason: t("dataio.review.duplicateReason"),
    });
  }

  return groups;
}

/** 与已有账目相似、需要用户判断的候选。 */
export function billHistoryDuplicates(items: readonly BillImportCandidate[]): BillHistoryDuplicate[] {
  return [...partitionDuplicateIds(items).history];
}

/** 提交前的判定结果。`blockers` 为空才允许点“确认导入”。 */
export interface BillCommitCheck {
  readonly selectedCount: number;
  readonly importableCount: number;
  readonly problems: readonly { readonly id: string; readonly message: string }[];
  readonly needsAcknowledgement: boolean;
  readonly blockers: readonly string[];
}

/**
 * 提交前校验：没选中、字段有问题、文件级提示未确认，都不许提交。
 *
 * ⚠️ 身份重复是**服务端保证**的（`billCommitRows` 会强制 `selected:false`），所以这里
 * 不把它算进选中数，也不允许它出现在 `importableCount` 里。
 */
export function billCommitCheck(
  items: readonly BillImportCandidate[],
  preview: Pick<BillImportPreview, "warnings" | "reconciliation">,
  acknowledged: boolean,
  problemsById: ReadonlyMap<string, string | null>,
): BillCommitCheck {
  const selected = items.filter((item) => billRowSelected(item));
  const problems: { id: string; message: string }[] = [];

  for (const item of selected) {
    const problem = problemsById.get(item.id) ?? null;
    if (problem !== null) problems.push({ id: item.id, message: problem });
  }

  const needsAcknowledgement =
    preview.warnings.length > 0 || preview.reconciliation.ok === false;

  const blockers: string[] = [];
  if (items.length === 0) {
    blockers.push(t("dataio.review.blockerNoRows"));
  } else if (selected.length === 0) {
    blockers.push(t("dataio.review.blockerNoneSelected"));
  }
  if (problems.length > 0) {
    blockers.push(t("dataio.review.blockerProblems", { count: problems.length }));
  }
  if (needsAcknowledgement && !acknowledged) {
    blockers.push(t("dataio.review.blockerAcknowledge"));
  }

  const importable = selected.filter((item) => (problemsById.get(item.id) ?? null) === null);

  return {
    selectedCount: selected.length,
    importableCount: importable.length,
    problems,
    needsAcknowledgement,
    blockers,
  };
}

/** 结果页上的一个失败项；`where` 把行号/PDF 页拼成一句人话。 */
export interface BillFailure {
  readonly line: number;
  readonly page: number | null;
  readonly where: string;
  readonly message: string;
}

/** 结果页需要的全部数字与失败清单。 */
export interface BillReportView {
  readonly status: "success" | "partial" | "failed";
  readonly read: number;
  readonly selected: number;
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly BillFailure[];
  readonly skippedLines: readonly number[];
}

/**
 * `ImportReport` → 结果页视图。
 *
 * ⚠️ 契约里**没有**“失败数”与“选中数”：失败以 `errors[].line` 表达，选中数只有调用方
 * 知道（预览里的勾选）。所以这里显式接收 `selectedCount`，并把 `errors` 映射到
 * PDF 页码（同批候选里同一 `line` 的 `page`）——这是“错误定位到文件行或 PDF 页”的落点。
 */
export function billReportView(
  report: ImportReport,
  preview: Pick<BillImportPreview, "candidates">,
  selectedCount: number,
): BillReportView {
  const byLine = new Map<number, BillImportCandidate>();
  for (const candidate of preview.candidates) {
    if (!byLine.has(candidate.line)) byLine.set(candidate.line, candidate);
  }

  const failures: BillFailure[] = report.errors.map((error) => {
    const page = byLine.get(error.line)?.page ?? null;
    const where =
      page === null
        ? t("dataio.review.line", { line: error.line })
        : t("dataio.review.pageLine", { page, line: error.line });
    // 失败原因是服务端原文；列名（`amount`、`date`…）是服务端的稳定字段名，原样显示。
    const reason = translateSharedMessage(error.message);
    const message =
      error.column === null ? reason : t("dataio.review.failureWithColumn", { column: error.column, message: reason });
    return { line: error.line, page, where, message };
  });

  const imported = report.importedCount;
  const failed = failures.length;
  const status: BillReportView["status"] =
    report.ok && failed === 0 ? "success" : imported > 0 ? "partial" : "failed";

  return {
    status,
    read: preview.candidates.length,
    selected: selectedCount,
    imported,
    skipped: report.skippedCount,
    failed,
    failures,
    skippedLines: [...report.skippedLines],
  };
}

/** 日期 + 时间，**精度不足时明说**，不编造 00:00 或 12:00。 */
export function billTimeText(item: Pick<BillImportCandidate, "date" | "time" | "timePrecision">): string {
  // 日期保持账单原样的 `YYYY-MM-DD`（与下方可编辑的日期框一致），不随语言改写。
  if (item.time === null || item.time === "" || item.timePrecision === "day") {
    return t("dataio.review.timeUnknown", { date: item.date });
  }
  return `${item.date} ${item.time}`;
}

/** 错误/卡片定位：`第 3 页 · 第 12 行` 或 `第 12 行`（英文：`Page 3 · Row 12`）。 */
export function billLocationText(item: Pick<BillImportCandidate, "line" | "page">): string {
  return item.page === undefined
    ? t("dataio.review.line", { line: item.line })
    : t("dataio.review.pageLine", { page: item.page, line: item.line });
}

/** `sourceRef` 有值才显示；空字符串按没有处理。 */
export function billSourceRefText(item: Pick<BillImportCandidate, "sourceRef">): string | null {
  const value = item.sourceRef?.trim() ?? "";
  return value === "" ? null : value;
}

/**
 * 标签输入 → 数组：逗号、顿号、空白都算分隔；去重、截断到契约上限（30 个、每个 40 字）。
 * 空输入返回 `[]`（不是 `[""]`，那会被契约拒绝）。
 */
export function parseBillTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const raw of text.split(/[,，、\s]+/)) {
    const tag = raw.trim().slice(0, 40);
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length === 30) break;
  }

  return tags;
}

/** 数组 → 标签输入框的文本（空格分隔，便于 `parseBillTags` 往返）。 */
export function billTagsText(tags: readonly string[]): string {
  return tags.join(" ");
}

/**
 * 文件级提示的汇总文字，给底部确认条的复选框与确认对话框共用。
 * 返回空数组表示“没有需要用户确认的文件级提示”。
 */
export function billAcknowledgementReasons(
  preview: Pick<BillImportPreview, "warnings" | "reconciliation">,
): readonly string[] {
  const reasons: string[] = [];
  if (preview.warnings.length > 0) reasons.push(...preview.warnings.map((warning) => translateSharedMessage(warning)));
  if (preview.reconciliation.ok === false) {
    reasons.push(
      t("dataio.review.reconciliation", {
        details:
          preview.reconciliation.messages.length > 0
            ? preview.reconciliation.messages
                .map((message) => translateSharedMessage(message))
                .join(t("dataio.review.reconciliationSeparator"))
            : t("dataio.review.reconciliationFallback"),
      }),
    );
  }
  return reasons;
}

/** 逐笔的“为什么建议核对”文案；空数组表示这一笔没有需要说明的地方。 */
export function billRowNotes(
  item: BillImportCandidate,
  problem: string | null,
  historyIds: readonly string[],
): readonly string[] {
  const notes = billRowWarnings(item, problem);
  if (historyIds.length > 0) {
    notes.push(t("dataio.review.similarHistory", { ids: historyIds.join(t("dataio.common.listSeparator")) }));
  }
  if (item.identityDuplicate) {
    notes.push(t("dataio.review.identityExists"));
  }
  return notes;
}
