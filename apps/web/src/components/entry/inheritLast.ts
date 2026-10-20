import {
  MAX_TAGS_PER_TRANSACTION,
  type Currency,
  type LedgerMetaResponse,
  type Transaction,
  type TransactionKind,
} from "@libellum/shared";

/**
 * 「沿用上一笔」：把上一笔的分类、支付方式、币种与标签套到当前草稿上。
 *
 * ⚠️ **It is not 「复制这一笔」.** 复制（`location.state.copyFrom`，从明细/详情进来）是把一整笔
 * 旧账抄成新账，**金额、备注、标签全带**；沿用只取四个「记账习惯」字段，**金额、备注、时间一个字
 * 都不动**，也不改当前的支出/收入方向。两者共用同一块表单状态，但语义相反，所以不合并、不互相调用。
 *
 * ⚠️ **Pure, and it has to stay pure.** 本仓库的 web 测试没有 DOM（`vitest.config.ts` 是 node 环境），
 * 点击按钮这件事没法断言；能被断言的是「给一段历史、一份账本可用列表、一个当前草稿，会挑出什么」。
 * 所以挑字段与套字段都放在这里，页面只负责把结果塞回 state 并显示一句提示。
 *
 * ⚠️ **Nothing internal is carried over.** 返回的结构里只有这四个字段：历史交易的 `id`、`seq`、
 * `version`、创建/同步状态一个都不在里面——**照抄一个旧 id 会让新账目和旧账目在内存里同名**，
 * 后续的离线队列与更新都会认错对象。
 */
export interface InheritedFields {
  readonly categoryId: string | null;
  readonly paymentMethodId: string | null;
  readonly currency: Currency;
  readonly tagIds: readonly string[];
}

/**
 * 没有沿用成功的原因。三句提示各不相同，因为读者的下一步不同：
 * 空账本要去记第一笔，方向不对要切支出/收入，账本还没加载完要等一下。
 */
export type InheritRefusal = "no-record" | "no-compatible" | "ledger-unavailable";

export type InheritOutcome =
  | { readonly status: "inherited"; readonly fields: InheritedFields }
  | { readonly status: "nothing"; readonly reason: InheritRefusal };

/**
 * 挑选并应用「上一笔」。
 *
 * `recent` **按新到旧**排（`useTransactions` 的页面就是这个顺序），这里取第一条
 * `kind` 与当前方向一致的记录；最近一条方向不兼容时**继续往后找**，不直接失败——
 * 收入分类绝不能套到支出上，但前面有一笔收入不该让后面那笔支出用不上。
 *
 * ⚠️ **`recent` 必须来自当前账本。** 函数本身无法验证这一点（`Transaction` 里没有账本 id），
 * 账本隔离由调用方保证：`useTransactions` 天然带账本作用域，页面不得自己拼请求。
 *
 * ⚠️ **失效的字段跳过，不找替代值。** 历史分类已归档/已删除/不是当前方向可选的分类，
 * 支付方式已归档，标签已不在账本里——这些字段**保持当前草稿的值**，而不是退回「其他」或
 * 清空：**伪造一个看起来合理的替代值，比什么都不做更糟**，因为用户会以为那就是上一笔。
 */
export function inheritFromLastEntry(
  recent: readonly Transaction[],
  ledger: LedgerMetaResponse | undefined,
  kind: TransactionKind,
  current: InheritedFields,
): InheritOutcome {
  const last = recent.find((entry) => entry.kind === kind);

  if (last === undefined) {
    return {
      status: "nothing",
      reason: recent.length === 0 ? "no-record" : "no-compatible",
    };
  }

  /**
   * 可用列表还没到（`useLedger` 未成功）时不敢沿用：没有列表就无法判断哪些分类/支付方式/标签
   * 现在还能用，只能整组跳过——那会得到一次「只沿用了币种」的半套结果，不如明说还没加载完。
   */
  if (ledger === undefined) return { status: "nothing", reason: "ledger-unavailable" };

  const categories = ledger.categories.filter(
    (category) => category.kind === kind && !category.isArchived && !category.isSystem,
  );
  const usableTagIds = new Set(ledger.tags.map((tag) => tag.id));

  /**
   * 分类：`last.categoryId` 一定是个 string，但**「暂无分类」在库里是一个系统分类**，
   * 它不在可选列表里。所以「上一笔没有分类」和「分类已归档」在这里是同一种结果：跳过，保持当前值。
   */
  const categoryId = categories.some((category) => category.id === last.categoryId)
    ? last.categoryId
    : current.categoryId;

  /** 支付方式：历史里没有（null）或已归档，都算这个字段没得沿用。 */
  const paymentMethodId =
    last.paymentMethodId !== null &&
    ledger.paymentMethods.some(
      (method) => method.id === last.paymentMethodId && !method.isArchived,
    )
      ? last.paymentMethodId
      : current.paymentMethodId;

  /**
   * 标签：只保留账本里仍然存在的，并重新压到上限以内。
   * 历史标签**一个都不剩**时保持当前值——把用户的标签清空也是一种覆盖。
   */
  const inheritedTagIds = last.tags
    .map((tag) => tag.id)
    .filter((id) => usableTagIds.has(id))
    .slice(0, MAX_TAGS_PER_TRANSACTION);
  const tagIds = inheritedTagIds.length > 0 ? inheritedTagIds : current.tagIds;

  /**
   * 币种：`currencySchema` 只放行受支持的币种，历史值一律可用，所以无条件沿用。
   * 金额不跟着变——这正是「沿用」与「复制」的分界。
   */
  return {
    status: "inherited",
    fields: { categoryId, paymentMethodId, currency: last.currency, tagIds },
  };
}
