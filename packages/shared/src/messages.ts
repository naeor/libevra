import { z } from "zod";

/**
 * **留言引用（S16）：一条留言可选地指向一笔账目，或一次账目修改事件。**
 *
 * ⚠️ **引用不是留言的类型，而是一条留言上的可选附注。** 绝大多数留言仍然只是文字：schema 里
 * `reference` 是可选的，旧客户端不传它也能照常发送。
 *
 * ⚠️ **历史引用的语义是“指向那一次修改”。** 它必须锚定在 `TransactionEvent` 的稳定 id 上，
 * 而不是“这笔账目最近一次修改”——账目再被修改时，旧引用不能跟着变。
 *
 * ⚠️ **快照由服务端在发送时生成，客户端只上传 `{kind, id}`。** 客户端传来的展示文本一律不可信，
 * 也不该让两个客户端对“这笔账长什么样”各写一套。
 */

/** 可引用的两种对象。 */
export const QUOTE_REFERENCE_KINDS = ["transaction", "event"] as const;
export const quoteReferenceKindSchema = z.enum(QUOTE_REFERENCE_KINDS);
export type QuoteReferenceKind = (typeof QUOTE_REFERENCE_KINDS)[number];

/** 发送留言时可选的引用目标：只要 kind + id，服务端负责校验与快照。 */
export const messageReferenceInputSchema = z.object({
  kind: quoteReferenceKindSchema,
  id: z.string().uuid(),
});
export type MessageReferenceInput = z.infer<typeof messageReferenceInputSchema>;

/** 一笔账目在引用卡片上需要显示的全部信息（发送时快照）。 */
export interface QuotedTransactionSnapshot {
  readonly kind: "transaction";
  readonly id: string;
  /** 账目编号的数字部分；离线未同步的账目可能没有编号。 */
  readonly seq: number | null;
  /** 已格式化的编号，如 `#000128`。 */
  readonly code: string | null;
  /** 一句话标题：备注优先，其次是分类名；两者都没有时用“一笔账目”。 */
  readonly title: string;
  readonly categoryName: string | null;
  readonly note: string | null;
  /** 最小货币单位，字符串形式（避免 JSON 数字精度问题）。 */
  readonly amountCents: string;
  readonly currency: string;
  readonly transactionKind: "expense" | "income";
  readonly occurredAt: string;
}

export interface QuotedEventChange {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * 一次修改事件在引用卡片上的快照。
 *
 * ⚠️ 字段与 `/ledger/history` 的 `HistoryEntry` 对齐，前端渲染可以直接复用历史列表的文案逻辑；
 * `summary` 是服务端已经排好的中文句子，英文界面由前端按 `kind`/字段映射翻译。
 */
export interface QuotedEventSnapshot {
  readonly kind: "event";
  readonly id: string;
  readonly eventKind: "created" | "updated" | "deleted" | "restored";
  readonly occurredAt: string;
  readonly actorName: string | null;
  readonly transactionId: string | null;
  readonly transactionSeq: number | null;
  readonly summary: string;
  readonly changes: readonly QuotedEventChange[];
}

export type QuoteSnapshot = QuotedTransactionSnapshot | QuotedEventSnapshot;

/**
 * 一条已发送留言上的引用。
 *
 * ⚠️ `available === false` 表示目标已删除、被清理或当前账户无权再访问：界面显示快照内容并标注
 * “已删除或不可访问”，但**不得**因此让整个留言列表报错。
 */
export interface MessageReferenceView {
  readonly kind: QuoteReferenceKind;
  readonly id: string;
  readonly available: boolean;
  readonly snapshot: QuoteSnapshot;
}

/** 留言输入区“选择引用”面板里的一个候选项。 */
export interface QuoteTargetView<S extends QuoteSnapshot = QuoteSnapshot> {
  readonly kind: QuoteReferenceKind;
  readonly id: string;
  readonly snapshot: S;
}

/** 候选项中明确是账目的那种（快照已收窄，便于直接读 title / amount）。 */
export type QuoteTransactionTargetView = QuoteTargetView<QuotedTransactionSnapshot>;
/** 候选项中明确是修改事件的那种（快照已收窄，便于直接读 summary / eventKind）。 */
export type QuoteEventTargetView = QuoteTargetView<QuotedEventSnapshot>;

/**
 * `GET /api/v1/books/quote-targets` 的响应：最近账目与最近修改事件。
 *
 * ⚠️ **两栏各有自己的快照类型**，不是共用一个联合类型——面板按栏渲染，收窄不应靠调用方再写类型
 * 断言。真正的联合 `QuoteTargetView` 仍用于“从任意一栏选中”的结果。
 */
export interface QuoteTargetsResponse {
  readonly transactions: readonly QuoteTransactionTargetView[];
  readonly events: readonly QuoteEventTargetView[];
}
