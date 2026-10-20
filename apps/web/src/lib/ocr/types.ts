/**
 * OCR 批次的浏览器临时数据形状（S15-B B2/B3）。
 *
 * 这里不定义任何“账目”，只定义**待核对候选**：每个字段都可能缺失，用户改了也只改
 * 这份 sessionStorage 里的数据。确认导入时才由 `import.ts` 转成既有
 * `CreateTransactionInput`，并且只走 `lib/offline/write.ts` 的 `createEntry`。
 *
 * 命名与 Python `model.Candidate` / 共享 `OcrCandidate` 对齐，额外多了三类**用户决定**：
 *  - `invalid`：用户明确排除这一笔；
 *  - `reviewed`：用户进过详情并保存过（只用于“已确认”筛选，不代表已入账）；
 *  - `categoryId` / `paymentMethodId` / `tagIds`：为导入准备的分类映射，默认值来自来源平台
 *    或“转账”预设，未选时保持 null，绝不编造。
 */

import type {
  OcrCandidate,
  OcrChannel,
  OcrDirection,
  OcrIssue,
  OcrPageType,
} from "@libellum/shared";

/** 一笔候选在批次里的完整状态（可序列化，因此不是 readonly）。 */
export interface OcrBatchCandidate {
  candidateId: string;
  imageIndex: number;
  amount: string | null;
  currency: string | null;
  direction: OcrDirection;
  occurredLocalDate: string | null;
  occurredTime: string | null;
  merchant: string | null;
  sourcePlatform: OcrChannel | null;
  account: string | null;
  note: string | null;
  status: string | null;
  isRefund: boolean;
  isTransfer: boolean;
  serial: string | null;
  /** 识别阶段的问题；字段补全后由 `deriveIssues` 过滤掉已失效的字段类问题。 */
  issues: OcrIssue[];
  rawText: string;
  invalid: boolean;
  reviewed: boolean;
  categoryId: string | null;
  paymentMethodId: string | null;
  tagIds: string[];
  /** 由 `duplicates.ts` 在每次编辑后重新计算，绝不落账、绝不删除。 */
  duplicateSuspected: boolean;
  duplicateGroupIds: string[];
}

/** 一张截图在批次里的来源信息，用于概览上说明“这一笔来自哪一类页面”。 */
export interface OcrBatchPage {
  imageIndex: number;
  pageType: OcrPageType | null;
  layoutLabel: string | null;
  requiresUserChoice: boolean;
  warnings: string[];
}

/**
 * 一次识别产生的批次。
 *
 * `importIds` 是**第一次确认时**一次性生成并固定的 `id`/`idempotencyKey`；失败重试
 * 复用同一批值，因此重试不会产生重复账目。批次之外没有数据库、没有新表。
 */
export interface OcrBatch {
  version: 1;
  batchId: string;
  createdAt: string;
  /** 生成批次时所在的账本；切到别的账本后只允许看，不允许导入。 */
  bookId: string | null;
  pages: OcrBatchPage[];
  items: OcrBatchCandidate[];
  importIds: Record<string, string>;
}

/** 概览页面使用的筛选维度。 */
export type OcrOverviewFilter = "all" | "pending" | "confirmed" | "duplicates";
export type OcrSourceFilter = "all" | OcrChannel;
export type OcrDirectionFilter = "all" | "expense" | "income";

/** 卡片状态：已识别 / 待核对 / 疑似重复 / 无效。 */
export type OcrItemStatus = "recognized" | "review" | "duplicate" | "invalid";

export interface OcrBatchCounts {
  /** 本次识别出的全部候选（含无效）。 */
  total: number;
  /** 可导入（未标记无效）的笔数。 */
  valid: number;
  /** 待核对：缺字段、有阻塞问题或疑似重复。 */
  pending: number;
  /** 已确认：字段完整、无问题、非重复（无需逐笔核对，但不是已写入）。 */
  confirmed: number;
  /** 疑似重复（未标记无效的）。 */
  duplicates: number;
  /** 已标记无效。 */
  invalid: number;
}

/**
 * 与 Python `model.BLOCKING_ISSUES` 同一口径。
 *
 * 这是一份**前端展示用的镜像**，不参与任何写入判断（服务端仍是权威）。放在这里
 * 是因为“要不要让用户重点看这一笔”必须和识别侧一致，否则概览会把有问题的项
 * 当成“可直接确认”。
 */
export const BLOCKING_ISSUES: ReadonlySet<string> = new Set([
  "missing_amount",
  "missing_date",
  "missing_merchant",
  "missing_currency",
  "missing_year",
  "direction_unclear",
  "amount_uncertain",
  "amount_conflict",
  "amount_unreadable",
  "duplicate_suspected",
  "layout_unverified",
  "layout_conflict",
  "extraction_incomplete",
]);

/** 从共享候选复制成本地可变候选；不修改输入。 */
export function toBatchCandidate(candidate: OcrCandidate): OcrBatchCandidate {
  return {
    candidateId: candidate.candidateId,
    imageIndex: candidate.imageIndex,
    amount: candidate.amount,
    currency: candidate.currency,
    direction: candidate.direction,
    occurredLocalDate: candidate.occurredLocalDate,
    occurredTime: candidate.occurredTime,
    merchant: candidate.merchant,
    sourcePlatform: candidate.sourcePlatform,
    account: candidate.account,
    note: candidate.note,
    status: candidate.status,
    isRefund: candidate.isRefund,
    isTransfer: candidate.isTransfer,
    serial: candidate.serial,
    issues: candidate.issues.map((issue) => ({ ...issue })),
    rawText: candidate.rawText,
    invalid: false,
    reviewed: false,
    categoryId: null,
    paymentMethodId: null,
    tagIds: [],
    duplicateSuspected: false,
    duplicateGroupIds: [],
  };
}

/** 当前字段是否已经有值（用于判断“缺字段”的问题是否已经解决）。 */
function hasValue(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

/**
 * 识别问题里仍然成立的那些。
 *
 * 字段类问题在用户补上该字段后就不再成立（例如填了金额还显示“没有读出金额”），
 * 所以按 `issue.field` 过滤。没有字段归属的问题（版式未验证、提取不完整）保留。
 * `currency_assumed` 是“币种未读出、按来源假设”的提示，用户一旦选过币种就不再是假设。
 */
export function deriveIssues(item: OcrBatchCandidate): OcrIssue[] {
  const filled: Readonly<Record<string, boolean>> = {
    amount: hasValue(item.amount),
    currency: hasValue(item.currency),
    date: hasValue(item.occurredLocalDate),
    time: hasValue(item.occurredTime),
    merchant: hasValue(item.merchant),
    direction: item.direction === "income" || item.direction === "expense",
  };

  return item.issues.filter((issue) => {
    if (issue.field === null) return true;
    // 币种假设提示的是“识别阶段没读出符号”，这一事实不因用户改选币种而消失；
    // 它不阻塞导入，保留它比悄悄抹掉更诚实。
    if (issue.code === "currency_assumed") return true;
    return filled[issue.field] !== true;
  });
}

/** 与 Python `Candidate.is_complete` 同一口径：够用，但不代表所有字段都有。 */
export function isItemComplete(item: OcrBatchCandidate): boolean {
  return (
    hasValue(item.amount) &&
    hasValue(item.currency) &&
    (item.direction === "expense" || item.direction === "income") &&
    hasValue(item.occurredLocalDate) &&
    hasValue(item.merchant)
  );
}

/** 有阻塞问题、疑似重复或缺关键字段：需要用户重点核对。 */
export function isItemQuestionable(item: OcrBatchCandidate): boolean {
  if (item.invalid) return true;
  if (item.duplicateSuspected) return true;
  if (!isItemComplete(item)) return true;
  return deriveIssues(item).some((issue) => BLOCKING_ISSUES.has(issue.code));
}

export function itemStatus(item: OcrBatchCandidate): OcrItemStatus {
  if (item.invalid) return "invalid";
  if (item.duplicateSuspected) return "duplicate";
  if (isItemQuestionable(item)) return "review";
  return "recognized";
}

/** 只说不隐藏信息：所有状态都参与计数，无效项单独显示。 */
export function countBatchItems(items: readonly OcrBatchCandidate[]): OcrBatchCounts {
  let valid = 0;
  let pending = 0;
  let confirmed = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const item of items) {
    if (item.invalid) {
      invalid += 1;
      continue;
    }

    valid += 1;
    const status = itemStatus(item);
    if (status === "duplicate") {
      duplicates += 1;
      pending += 1;
    } else if (status === "review") {
      pending += 1;
    } else {
      confirmed += 1;
    }
  }

  return { total: items.length, valid, pending, confirmed, duplicates, invalid };
}

/** 概览筛选：状态、来源、收支三个维度取交集。 */
export function filterBatchItems(
  items: readonly OcrBatchCandidate[],
  filter: OcrOverviewFilter,
  source: OcrSourceFilter = "all",
  direction: OcrDirectionFilter = "all",
): OcrBatchCandidate[] {
  return items.filter((item) => {
    if (source !== "all" && item.sourcePlatform !== source) return false;
    if (direction !== "all" && item.direction !== direction) return false;

    if (filter === "all") return true;
    // 已标记无效的项不属于“待核对”：用户已经对它做过决定。
    if (filter === "pending") return !item.invalid && isItemQuestionable(item);
    if (filter === "duplicates") return !item.invalid && item.duplicateSuspected;
    // 已确认 = 字段完整、无阻塞问题、非重复，且未被标记无效（无效项不是“确认”）。
    return !item.invalid && itemStatus(item) === "recognized";
  });
}
