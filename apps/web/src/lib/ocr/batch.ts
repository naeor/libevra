/**
 * 把一次识别结果变成一个浏览器内的「批次」（S15-B 概览页的数据来源）。
 *
 * 设计方向 §3.4/§10.5 划的边界在这里落成代码：批次只存在于 sessionStorage，
 * 没有数据库、没有新表；它保存的是**用户正在核对的草稿**，不是账目。确认导入时
 * 才把每条候选转成既有 `CreateTransactionInput`，逐条走 `offline/write.ts`。
 *
 * 两个刻意的决定：
 *  - **同一次上传全部进批次。** 多张图混合时，单笔详情页也作为 1 笔候选并入，
 *    这样只有一个核对流程，不会出现“有的图在批次里、有的图在逐笔弹窗里”；
 *  - **默认值只来自可见依据。** 分类只有明确识别为转账时才预填“转账”预设；支付方式
 *    只按来源平台名称匹配；没有依据就留空，由详情页让用户选。
 */

import type { OcrChannel, OcrItemResult } from "@libellum/shared";

import { withDuplicateMarks, type OcrDuplicateGroup } from "./duplicates.js";
import {
  toBatchCandidate,
  type OcrBatch,
  type OcrBatchCandidate,
  type OcrBatchPage,
} from "./types.js";

interface CategoryLike {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly isArchived: boolean;
  readonly isSystem?: boolean;
}

interface PaymentMethodLike {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

export interface CreateBatchOptions {
  /** 生成批次时所在的账本；切换账本后批次只可查看，不允许导入。 */
  readonly bookId: string | null;
  readonly categories?: readonly CategoryLike[];
  readonly paymentMethods?: readonly PaymentMethodLike[];
  readonly now?: Date;
  readonly generateBatchId?: () => string;
}

/** 来源平台对应的默认支付方式名称，与现有单笔核对 `draftOf` 的映射一致。 */
const CHANNEL_METHOD_NAMES: Readonly<Record<OcrChannel, string>> = {
  WECHAT: "微信",
  ALIPAY: "支付宝",
  BANK: "银行卡",
};

function defaultPaymentMethodId(
  item: OcrBatchCandidate,
  methods: readonly PaymentMethodLike[],
): string | null {
  if (item.sourcePlatform === null) return null;
  const name = CHANNEL_METHOD_NAMES[item.sourcePlatform];
  return methods.find((method) => method.name === name && !method.isArchived)?.id ?? null;
}

/**
 * 转账预填「转账」分类。
 *
 * `TransactionKind` 只有 expense/income，转账不是 kind；这里只是把识别到的转账
 * 映射到账本已有的同名分类（所有者预设里有支出/收入两个「转账」），用户仍可改。
 * 没有这个分类就留空，不编造。
 */
function defaultCategoryId(
  item: OcrBatchCandidate,
  categories: readonly CategoryLike[],
): string | null {
  if (!item.isTransfer) return null;
  const kind = item.direction === "income" ? "income" : "expense";
  return (
    categories.find(
      (category) =>
        category.name === "转账" &&
        category.kind === kind &&
        !category.isArchived &&
        category.isSystem !== true,
    )?.id ?? null
  );
}

/**
 * 把“有可见依据”的默认值写进候选，并标明来源。
 *
 * 分类的默认值只有转账预设这一条，来源记 `ocr`（平台/规则默认），这样概览页不会把它
 * 当成系统按文字猜出来的建议（`inferred`）。支付方式只按来源平台名称匹配（微信/支付宝/
 * 银行卡），匹配不到就留空，由详情页让用户选。
 */
function applyDefaults(
  candidate: OcrBatchCandidate,
  categories: readonly CategoryLike[],
  paymentMethods: readonly PaymentMethodLike[],
): void {
  const categoryId = defaultCategoryId(candidate, categories);
  if (categoryId !== null) {
    candidate.categoryId = categoryId;
    candidate.categorySource = "ocr";
  }
  candidate.paymentMethodId = defaultPaymentMethodId(candidate, paymentMethods);
}

/** 旧服务/未知页只有单笔 draft 时，把它作为一笔待核对候选。 */
function candidateFromDraft(item: OcrItemResult): OcrBatchCandidate | null {
  const draft = item.draft;
  if (draft === null) return null;

  return {
    candidateId: `img${String(item.index)}-draft`,
    imageIndex: item.index,
    amount: draft.amount,
    currency: draft.currency,
    direction: draft.kind === "income" ? "income" : "expense",
    occurredLocalDate: draft.occurredLocalDate,
    occurredTime: draft.occurredTime,
    merchant: draft.counterparty,
    sourcePlatform: draft.channel,
    account: null,
    note: draft.note,
    status: null,
    isRefund: draft.isRefund,
    isTransfer: false,
    serial: draft.serial,
    issues: [
      {
        code: "extraction_incomplete",
        message: "这张截图无法判断页面类型，只按一笔处理，请核对。",
        field: null,
      },
    ],
    rawText: "",
    invalid: false,
    reviewed: false,
    categoryId: null,
    paymentMethodId: null,
    tagIds: [],
    duplicateSuspected: false,
    duplicateGroupIds: [],
  };
}

function pageOf(item: OcrItemResult): OcrBatchPage {
  return {
    imageIndex: item.index,
    pageType: item.pageType,
    layoutLabel: item.layoutLabel,
    requiresUserChoice: item.requiresUserChoice,
    warnings: [...item.warnings],
  };
}

/**
 * 建立批次。纯函数：不读 storage、不写账本，测试可以直接断言。
 *
 * 每一页的候选来自 `item.candidates`；没有候选但有 `draft` 的页面（未知页按单笔
 * 结果处理、或旧服务）会生成 1 笔，并带上 `extraction_incomplete` 让用户知道
 * 这一笔不是从“已确认的版式”切出来的。
 */
export function createBatch(
  items: readonly OcrItemResult[],
  options: CreateBatchOptions,
): OcrBatch {
  const categories = options.categories ?? [];
  const paymentMethods = options.paymentMethods ?? [];
  const now = options.now ?? new Date();
  const generateBatchId = options.generateBatchId ?? (() => String(now.getTime()));

  const candidates: OcrBatchCandidate[] = [];

  for (const item of items) {
    const fromExtraction = item.candidates.map(toBatchCandidate);

    if (fromExtraction.length > 0) {
      for (const candidate of fromExtraction) {
        applyDefaults(candidate, categories, paymentMethods);
        candidates.push(candidate);
      }
      continue;
    }

    const fromDraft = candidateFromDraft(item);
    if (fromDraft !== null) {
      applyDefaults(fromDraft, categories, paymentMethods);
      candidates.push(fromDraft);
    }
  }

  const marked = withDuplicateMarks(candidates);

  return {
    version: 1,
    batchId: generateBatchId(),
    createdAt: now.toISOString(),
    bookId: options.bookId,
    pages: items.map(pageOf),
    items: marked.items,
    importIds: {},
  };
}

export function batchItem(
  batch: OcrBatch,
  candidateId: string,
): OcrBatchCandidate | null {
  return batch.items.find((item) => item.candidateId === candidateId) ?? null;
}

/**
 * 编辑一笔候选（只改批次临时数据）。
 *
 * 每次都重算重复标记：把金额改掉后，原来“疑似重复”的提示应当立即消失；反之，
 * 改得和另一笔一样时应当立即出现。`reviewed` 由调用方决定（保存详情时置 true）。
 */
export function updateBatchItem(
  batch: OcrBatch,
  candidateId: string,
  patch: Partial<Omit<OcrBatchCandidate, "candidateId" | "imageIndex">>,
): OcrBatch {
  const items = batch.items.map((item) =>
    item.candidateId === candidateId
      ? { ...item, ...patch, candidateId: item.candidateId, imageIndex: item.imageIndex }
      : item,
  );

  return { ...batch, items: withDuplicateMarks(items).items };
}

/** 重新计算重复标记（例如页面重新载入后，规则变化也能自愈）。 */
export function refreshDuplicateMarks(
  batch: OcrBatch,
): { batch: OcrBatch; groups: OcrDuplicateGroup[] } {
  const marked = withDuplicateMarks(batch.items);
  return { batch: { ...batch, items: marked.items }, groups: marked.groups };
}

/** 确认导入前一次性生成并固定 id；已经有的不覆盖，所以重试复用同一批 id。 */
export function assignImportIds(
  batch: OcrBatch,
  generateId: () => string,
): OcrBatch {
  const importIds: Record<string, string> = { ...batch.importIds };
  let changed = false;

  for (const item of batch.items) {
    if (item.invalid) continue;
    if (importIds[item.candidateId] === undefined) {
      importIds[item.candidateId] = generateId();
      changed = true;
    }
  }

  return changed ? { ...batch, importIds } : batch;
}

/** 部分成功后把已写入的候选从批次移除，失败项留在批次里供重试。 */
export function withoutBatchItems(
  batch: OcrBatch,
  candidateIds: readonly string[],
): OcrBatch {
  const removed = new Set(candidateIds);
  const items = batch.items.filter((item) => !removed.has(item.candidateId));
  const importIds: Record<string, string> = {};

  for (const [candidateId, id] of Object.entries(batch.importIds)) {
    if (!removed.has(candidateId)) importIds[candidateId] = id;
  }

  return { ...batch, items: withDuplicateMarks(items).items, importIds };
}

/** 批次是否属于当前账本。属于另一本时只读，避免把 A 账的截图写进 B 账。 */
export function batchBelongsToBook(batch: OcrBatch, bookId: string | null): boolean {
  if (batch.bookId === null || bookId === null) return true;
  return batch.bookId === bookId;
}
