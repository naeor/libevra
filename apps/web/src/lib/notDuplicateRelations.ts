/**
 * S15-E3 · 「不重复关系」的数据访问（前端）。
 *
 * 关系是**服务器权威**状态：
 *  - 读：React Query 缓存 + 联网后重新取；离线时展示已加载的缓存，并明确标注离线；
 *  - 写：**不进入离线写队列**。离线时创建/撤销被禁用（见 `NotDuplicateRelationsSection`
 *    与 `ScanPage` 的确认入口），因为两台设备同时给同一对相反判断需要冲突解决，
 *    而 E3 明确不引入那一层。
 *
 * ⚠️ 个人检测偏好仍然只存 `localStorage`（`lib/duplicateSettings.ts`），
 * **不和账本级关系混存**。
 *
 * ⚠️ 关系判定**不替代幂等**：即使两笔被判为不重复，重复提交仍由
 * `idempotencyKey` / 唯一约束保护。
 */

import {
  normalizeNotDuplicatePair,
  notDuplicatePairKey,
  notDuplicateRelationListResponseSchema,
  type CreateNotDuplicateRelationsInput,
  type NotDuplicateRelationListResponse,
  type NotDuplicateRelationMutationResponse,
} from "@libellum/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { t } from "../i18n/index.js";
import { apiFetch } from "./api.js";
import { useGuestMode } from "./guest/session.js";

export const notDuplicateRelationQueryKeys = {
  /** 前缀：一次写入让所有列表失效。 */
  all: ["not-duplicate-relations"] as const,
  list: (bookId: string, includeRevoked: boolean) =>
    ["not-duplicate-relations", bookId, includeRevoked] as const,
};

export interface NotDuplicateRelationQueryOptions {
  readonly includeRevoked?: boolean;
  readonly transactionId?: string;
  /** 分页游标；缺省读第一页。 */
  readonly cursor?: string;
  /** `false` 时即使有缓存也不会发请求（例如游客模式）。 */
  readonly enabled?: boolean;
}

function listPath(bookId: string): string {
  return `/books/${bookId}/not-duplicate-relations`;
}

/** 读一页关系；默认只要生效中的。 */
export async function fetchNotDuplicateRelations(
  bookId: string,
  options: NotDuplicateRelationQueryOptions = {},
): Promise<NotDuplicateRelationListResponse> {
  const includeRevoked = options.includeRevoked === true;

  const response = await apiFetch<unknown>(listPath(bookId), {
    method: "GET",
    query: {
      includeRevoked: includeRevoked ? "true" : undefined,
      transactionId: options.transactionId,
      cursor: options.cursor,
    },
    bookId,
  });

  return notDuplicateRelationListResponseSchema.parse(response);
}

/** 分页上限：关系是“用户逐对确认”产生的，正常账本远小于 20 页（400 条）。 */
const MAX_RELATION_PAGES = 20;

/**
 * 目标账本里仍然生效的「不是同一笔」配对键。
 *
 * ⚠️ 账本导入的重复检测在**浏览器**里跑（服务端只校验结构），不会经过
 * `suppressConfirmed`，所以这里把关系读出来自己过滤：用户确认过的对不再提示。
 * 只收 `effective` 的行——被撤销或关键字段变过的旧关系不该继续抑制。
 */
export async function fetchNotDuplicatePairKeys(
  bookId: string,
): Promise<ReadonlySet<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_RELATION_PAGES; page += 1) {
    const response = await fetchNotDuplicateRelations(
      bookId,
      cursor === undefined ? {} : { cursor },
    );
    for (const item of response.items) {
      if (!item.effective) continue;
      keys.add(notDuplicatePairKey(item.transactionAId, item.transactionBId));
    }
    if (response.nextCursor === null) break;
    cursor = response.nextCursor;
  }

  return keys;
}

/**
 * 记下一批「不是同一笔」。
 *
 * `pairs` 与 `transactionIds` 都只来自用户明确确认；本函数不会从任何"保留/跳过"
 * 之类的选择里自动推断关系。
 */
export async function createNotDuplicateRelations(
  bookId: string,
  input: CreateNotDuplicateRelationsInput,
): Promise<NotDuplicateRelationMutationResponse> {
  return apiFetch<NotDuplicateRelationMutationResponse>(listPath(bookId), {
    method: "POST",
    body: input,
    bookId,
  });
}

/** 撤销一条关系（软撤销，服务器保留行）。 */
export async function revokeNotDuplicateRelation(
  bookId: string,
  relationId: string,
): Promise<NotDuplicateRelationMutationResponse> {
  return apiFetch<NotDuplicateRelationMutationResponse>(
    `${listPath(bookId)}/${relationId}`,
    { method: "DELETE", bookId },
  );
}

/**
 * 拍照记账确认「不是同一笔」时要提交的请求体。
 *
 * 只把**新记账的这一笔**与对话框里列出的每一笔配对；不把那些已有记录两两配对，
 * 因为用户这次确认的只是"新这笔和它们不是同一笔"，没有对它们彼此表态。
 *
 * 纯函数，便于测试"点确认时提交的 pairs 正是对话框里那几对"。
 */
export function notDuplicateConfirmationForEntry(
  existingTransactionIds: readonly string[],
  newEntryId: string,
): CreateNotDuplicateRelationsInput | null {
  const pairs = new Map<string, { transactionIdA: string; transactionIdB: string }>();

  for (const existingId of existingTransactionIds) {
    const normalized = normalizeNotDuplicatePair(existingId, newEntryId);
    if (!normalized.ok) continue;
    pairs.set(notDuplicatePairKey(existingId, newEntryId), {
      transactionIdA: normalized.pair.transactionAId,
      transactionIdB: normalized.pair.transactionBId,
    });
  }

  if (pairs.size === 0) return null;

  return {
    // 稳定顺序：同样的输入永远得到同样的请求体，便于测试与日志对照。
    pairs: [...pairs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, pair]) => pair),
    decisionSource: pairs.size > 1 ? "review_group" : "manual",
  };
}

export function useNotDuplicateRelations(
  bookId: string,
  options: NotDuplicateRelationQueryOptions = {},
) {
  const guest = useGuestMode();
  const includeRevoked = options.includeRevoked === true;

  return useQuery({
    queryKey: notDuplicateRelationQueryKeys.list(bookId, includeRevoked),
    queryFn: () => fetchNotDuplicateRelations(bookId, options),
    enabled: (options.enabled ?? true) && !guest && bookId !== "",
    staleTime: 30_000,
  });
}

export function useCreateNotDuplicateRelations(bookId: string) {
  const guest = useGuestMode();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateNotDuplicateRelationsInput) => {
      if (guest) {
        throw new Error(t("duplicates.errors.guestRelations"));
      }
      return createNotDuplicateRelations(bookId, input);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: notDuplicateRelationQueryKeys.all }),
  });
}

export function useRevokeNotDuplicateRelation(bookId: string) {
  const guest = useGuestMode();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (relationId: string) => {
      if (guest) {
        throw new Error(t("duplicates.errors.guestRelations"));
      }
      return revokeNotDuplicateRelation(bookId, relationId);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: notDuplicateRelationQueryKeys.all }),
  });
}
