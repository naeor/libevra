/**
 * OCR 批量识别的「概览页面」数据与纯逻辑（S15-B B3，候选原型）。
 *
 * 这份文件的形状对应 Python 侧 `overview.py` 输出的 JSON（字段名转成 camelCase）。
 * **尚未接入真实 API**：当前使用演示数据，字段映射与「统一确认」保存边界都等所有者
 * 明早验收后再定；不能把这里当成已完成的保存链路。
 *
 * 职责边界（设计方向 §3.3）：
 *  - 概览页只做展示、选择、核对，**不直接编辑字段**；
 *  - 点击卡片进入详情编辑（本原型只有占位详情），返回后由页面把最新值合并回来；
 *  - 有疑问/可能重复的项才需要重点核对，完整项默认预选；
 *  - 统一确认**只是一个回调**，不写账本、不绕过既有保存/锁/幂等机制。
 */

export type OcrPageType = "single-detail" | "transaction-list" | "unknown";
export type OcrDirection = "expense" | "income" | "transfer" | "unknown";
export type OcrPlatform = "WECHAT" | "ALIPAY" | "BANK" | null;
export type OcrStatus = "pending" | "posted" | null;
export type OcrOverviewFilter = "all" | "questionable";

export interface OcrIssueView {
  readonly code: string;
  readonly message: string;
  readonly field: string | null;
}

/** 一笔候选交易：所有字段都可能缺失，缺失一律显示「待确认」，不伪造默认值。 */
export interface OcrCandidateView {
  readonly candidateId: string;
  readonly imageIndex: number;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly direction: OcrDirection;
  readonly occurredLocalDate: string | null;
  readonly occurredTime: string | null;
  readonly merchant: string | null;
  readonly sourcePlatform: OcrPlatform;
  readonly account: string | null;
  readonly note: string | null;
  readonly status: OcrStatus;
  readonly isRefund: boolean;
  readonly isTransfer: boolean;
  readonly issues: readonly OcrIssueView[];
  readonly duplicateSuspected: boolean;
  readonly duplicateGroupIds: readonly string[];
  readonly isComplete: boolean;
  readonly isQuestionable: boolean;
}

export interface OcrOverviewCounts {
  /** 待处理总数。 */
  readonly total: number;
  /** 可直接确认（字段完整、无问题、非重复）。 */
  readonly complete: number;
  /** 有疑问（缺字段、冲突、未验证、疑似重复）。 */
  readonly questionable: number;
  /** 疑似重复的笔数。 */
  readonly duplicates: number;
  /** 当前选中笔数。 */
  readonly selected: number;
}

export const OCR_PAGE_TYPE_LABELS: Readonly<Record<OcrPageType, string>> = {
  "single-detail": "单笔详情",
  "transaction-list": "交易列表",
  unknown: "无法判断",
};

export const OCR_DIRECTION_LABELS: Readonly<Record<OcrDirection, string>> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  unknown: "方向待确认",
};

export const OCR_PLATFORM_LABELS: Readonly<Record<"WECHAT" | "ALIPAY" | "BANK", string>> = {
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK: "银行",
};

export const OCR_STATUS_LABELS: Readonly<Record<"pending" | "posted", string>> = {
  pending: "待入账",
  posted: "已入账",
};

/** 没读出值的字段一律显示待确认。 */
export function fieldText(value: string | null): string {
  return value === null || value.trim() === "" ? "待确认" : value;
}

export function amountText(item: OcrCandidateView): string {
  return fieldText(item.amount);
}

export function currencyText(item: OcrCandidateView): string {
  return item.currency ?? "币种待确认";
}

export function merchantText(item: OcrCandidateView): string {
  return fieldText(item.merchant);
}

export function accountText(item: OcrCandidateView): string {
  return fieldText(item.account);
}

export function platformText(item: OcrCandidateView): string {
  return item.sourcePlatform === null ? "来源待确认" : OCR_PLATFORM_LABELS[item.sourcePlatform];
}

export function directionText(item: OcrCandidateView): string {
  return OCR_DIRECTION_LABELS[item.direction];
}

export function statusText(item: OcrCandidateView): string | null {
  return item.status === null ? null : OCR_STATUS_LABELS[item.status];
}

/** 日期 + 必要时间；缺失时明说是待确认，而不是留空。 */
export function dateTimeText(item: OcrCandidateView): string {
  if (item.occurredLocalDate === null) return "日期待确认";
  return item.occurredTime === null
    ? item.occurredLocalDate
    : `${item.occurredLocalDate} ${item.occurredTime}`;
}

/**
 * 一项是否需要用户重点核对。
 *
 * 不把「OCR 置信度高」当成「没问题」（设计方向 §3.3 明确要求）：这里只有字段完整性、
 * 已标记的问题和重复检测三个来源。非阻塞提示（例如缺时间、币种按平台假设）不升级为
 * 必须逐笔核对，但仍在卡片上显示。
 */
export function isOcrItemQuestionable(item: OcrCandidateView): boolean {
  return item.isQuestionable || item.duplicateSuspected || !item.isComplete;
}

/** 无问题、字段完整的项默认预选；预选不等于已确认。 */
export function defaultSelectedIds(items: readonly OcrCandidateView[]): string[] {
  return items
    .filter((item) => item.isComplete && !isOcrItemQuestionable(item))
    .map((item) => item.candidateId);
}

export function summariseOcrOverview(
  items: readonly OcrCandidateView[],
  selectedIds: readonly string[],
): OcrOverviewCounts {
  const selected = new Set(selectedIds);

  return {
    total: items.length,
    complete: items.filter((item) => item.isComplete && !isOcrItemQuestionable(item)).length,
    questionable: items.filter(isOcrItemQuestionable).length,
    duplicates: items.filter((item) => item.duplicateSuspected).length,
    selected: items.filter((item) => selected.has(item.candidateId)).length,
  };
}

export function filterOcrItems(
  items: readonly OcrCandidateView[],
  filter: OcrOverviewFilter,
): readonly OcrCandidateView[] {
  return filter === "questionable" ? items.filter(isOcrItemQuestionable) : items;
}

/** 选中/取消选中一笔，返回新数组（页面状态不可变更新，便于测试）。 */
export function withSelectionToggled(selectedIds: readonly string[], candidateId: string): string[] {
  return selectedIds.includes(candidateId)
    ? selectedIds.filter((id) => id !== candidateId)
    : [...selectedIds, candidateId];
}

/**
 * 详情编辑返回后合并最新值。
 *
 * 概览页本身不编辑字段（设计方向 §3.3），所以这是从详情页回来的唯一入口；
 * 只替换对应的一条，其它顺序与内容保持不变。
 */
export function applyOcrDetailUpdate(
  items: readonly OcrCandidateView[],
  candidateId: string,
  patch: Partial<OcrCandidateView>,
): OcrCandidateView[] {
  return items.map((item) =>
    item.candidateId === candidateId ? { ...item, ...patch, candidateId: item.candidateId } : item,
  );
}
