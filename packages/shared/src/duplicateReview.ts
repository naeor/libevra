import { z } from "zod";
import { recoverDuplicateDetectionSettings, type DuplicateDetectionSettings, type DuplicatePairResult } from "./duplicateDetection.js";
import type { Transaction } from "./ledger.js";
export const duplicateRulesSchema = z.object({
  enabled: z.boolean().optional(), timeWindowSeconds: z.number().int().min(1).max(2592000).optional(),
  matchCategory: z.boolean().optional(), matchPaymentMethod: z.boolean().optional(),
  matchAmount: z.boolean().optional(), matchCurrency: z.boolean().optional(), matchKind: z.boolean().optional(),
  matchTime: z.boolean().optional(), matchMerchant: z.boolean().optional(), matchNote: z.boolean().optional(), matchTags: z.boolean().optional(),
}).strict().transform((value): DuplicateDetectionSettings => recoverDuplicateDetectionSettings(value).settings);
export const duplicateCandidateSchema = z.object({
  id: z.string().min(1).max(128), bookId: z.string().min(1).max(128),
  kind: z.enum(["expense", "income", "transfer", "unknown"]), amountCents: z.number().int().safe().nullable(),
  currency: z.string().max(8).nullable(), occurredAt: z.string().max(64).nullable(),
  occurredAtPrecision: z.enum(["second", "minute", "day"]).optional(),
  occurredLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  categoryId: z.string().max(128).nullable(), paymentMethodId: z.string().max(128).nullable(),
  merchant: z.string().max(500).nullable().optional(), note: z.string().max(2000).nullable().optional(),
  tagIds: z.array(z.string().max(128)).max(100).optional(),
});
export const duplicateCandidatesRequestSchema = z.object({
  candidates: z.array(duplicateCandidateSchema).max(100), settings: duplicateRulesSchema.optional(),
});
/** Pair cursor: completed left rows plus the last examined right row of the active left. */
export const duplicateReviewCursorSchema = z.object({
  activeSeq: z.number().int().nonnegative().optional(),
  leftSeq: z.number().int().nonnegative(), rightSeq: z.number().int().nonnegative(),
  throughSeq: z.number().int().nonnegative(),
});
export type DuplicateReviewCursor = z.infer<typeof duplicateReviewCursorSchema>;
export const duplicateReviewRequestSchema = z.object({
  cursor: duplicateReviewCursorSchema.optional(),
  afterSeq: z.number().int().nonnegative().default(0),
  throughSeq: z.number().int().nonnegative().optional(),
  settings: duplicateRulesSchema.optional(),
});

/**
 * 批量导入之后的检查：**这一批**与账本历史之间、以及这一批彼此之间。
 *
 * 导入接口是整批写入或整批不写，所以没有“预览里逐行勾选”的中间态；能拿到的只有导入编号
 * （`importRef`，写在这批每一笔上）。用导入编号点名这一批，服务端再按同一套核心比对，
 * 就不必让浏览器把文件重新解析一遍 —— 也避免出现第二套解析/判重规则。
 */
export const duplicateImportReviewRequestSchema = z.object({
  importRef: z.string().min(1).max(200),
  settings: duplicateRulesSchema.optional(),
});
export type DuplicateImportReviewRequest = z.infer<typeof duplicateImportReviewRequestSchema>;

/** 批量导入检查的响应：这一批彼此的配对 + 涉及的账目（历史与批次都在 `entries` 里）。 */
export interface DuplicateImportReviewResponse {
  readonly pairs: readonly DuplicatePairResult[];
  readonly entries: readonly Transaction[];
  /** 这一批里被检查的条数，界面用它说明“检查了 N 条”。 */
  readonly checked: number;
  /** 命中数超过服务端上限时为 true：结果**不完整**，界面必须说出来。 */
  readonly truncated: boolean;
}

/**
 * 一组互相疑似重复的账目。
 *
 * ⚠️ **组是“配对结果”的连通分量，不是“同一笔”的结论。** A 与 B 像、B 与 C 像，
 * 不代表 A 与 C 是同一笔；界面必须把组内**每一对**的依据摊开展示（`pairs`），
 * 而不是只给一句“这 3 笔重复”。组只用于排版，任何自动合并/删除都不得以组为单位。
 */
export interface DuplicatePairGroup {
  /** 组内排序后的最小 id；作为渲染 key，稳定且不依赖遍历顺序。 */
  readonly key: string;
  /** 组内全部交易 id，已排序。 */
  readonly ids: readonly string[];
  /** 组内全部命中配对，按 `pairKey` 排序。 */
  readonly pairs: readonly DuplicatePairResult[];
}

/**
 * 把配对结果折成组。
 *
 * 用并查集而不是“按第一个元素分组”：疑似重复是**传递性未知**的关系，一条链
 * A–B、B–C 必须落在同一组里才不会被界面拆成两组各显示一半。纯函数，便于单测与
 * 在浏览器里对本地数据复用同一套分组。
 */
export function groupDuplicatePairs(pairs: readonly DuplicatePairResult[]): readonly DuplicatePairGroup[] {
  const parent = new Map<string, string>();

  function find(id: string): string {
    let current = id;
    while (true) {
      const next = parent.get(current);
      if (next === undefined || next === current) return current;
      current = next;
    }
  }

  function union(left: string, right: string): void {
    if (!parent.has(left)) parent.set(left, left);
    if (!parent.has(right)) parent.set(right, right);
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  }

  for (const pair of pairs) union(pair.leftId, pair.rightId);

  const grouped = new Map<string, DuplicatePairResult[]>();
  for (const pair of pairs) {
    const root = find(pair.leftId);
    const bucket = grouped.get(root);
    if (bucket === undefined) grouped.set(root, [pair]);
    else bucket.push(pair);
  }

  const groups: DuplicatePairGroup[] = [];
  for (const bucket of grouped.values()) {
    const members = new Set<string>();
    for (const pair of bucket) {
      members.add(pair.leftId);
      members.add(pair.rightId);
    }
    const ids = [...members].sort();
    const first = ids[0];
    if (first === undefined) continue;
    groups.push({ key: first, ids, pairs: [...bucket].sort((left, right) => left.pairKey.localeCompare(right.pairKey)) });
  }

  // 成员多的组先看：它在全账本审查里最可能是同一天的批量重复，也最需要处理。
  return groups.sort((left, right) => right.ids.length - left.ids.length || left.key.localeCompare(right.key));
}

/** 新增检查的响应：本批彼此的配对 + 被命中的历史账目。 */
export interface DuplicateCandidatesResponse {
  readonly pairs: readonly DuplicatePairResult[];
  readonly history: readonly Transaction[];
  /** 命中数超过服务端上限时为 true：结果**不完整**，界面必须说出来。 */
  readonly truncated: boolean;
}

/** 全账本审查的一页（按 seq 游标切块，客户端反复调用直到 `nextSeq === null`）。 */
export interface DuplicateReviewChunk {
  /** 精确配对断点；null 完成。旧客户端仍可使用 nextSeq（只推进完整处理的左侧行）。 */
  readonly nextCursor?: DuplicateReviewCursor | null;
  readonly pairs: readonly DuplicatePairResult[];
  readonly entries: readonly Transaction[];
  /** 本次审查范围内的账目总数（已排除软删除）。 */
  readonly total: number;
  /** 本页实际处理的账目数。 */
  readonly processed: number;
  /** 下一块的起点 seq；`null` 表示已到末尾。 */
  readonly nextSeq: number | null;
  /** 固定下来的审查上界，客户端回传后服务端不再取新的 seq，保证进度单调。 */
  readonly throughSeq: number;
  readonly truncated: boolean;
}
