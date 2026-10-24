import {
  evaluateDuplicatePair,
  type CreateTransactionInput,
  type DuplicateCandidateFields,
  type DuplicateCandidatesResponse,
  type DuplicateDetectionSettings,
  type DuplicateImportReviewResponse,
  type DuplicatePairResult,
  type DuplicateReviewChunk,
  type DuplicateReviewCursor,
  type Transaction,
} from "@libellum/shared";
import { currentLocale, isChineseLocale, t } from "../i18n/index.js";
import type zhDuplicates from "../i18n/resources/zh-CN/duplicates.js";
import { translateSharedMessage } from "../i18n/sharedMessages.js";
import { apiFetch, currentBookIdHeader } from "./api.js";
import { isGuestRuntime } from "./guest/runtime.js";
import { guestDataValue, guestDeletedIds, guestTransactions } from "./guest/data.js";
import { deletedEntriesValue, readLocalTransactions } from "./offline/localLedger.js";

// ---------------------------------------------------------------------------
// 依据说明的本地化（S16）
// ---------------------------------------------------------------------------

type DuplicateFieldKey = keyof typeof zhDuplicates.match.field;

const DUPLICATE_FIELD_KEYS: ReadonlySet<string> = new Set<DuplicateFieldKey>([
  "amountCents",
  "currency",
  "kind",
  "occurredAt",
  "categoryId",
  "paymentMethodId",
  "merchant",
  "note",
  "tagIds",
]);

function isDuplicateFieldKey(field: string): field is DuplicateFieldKey {
  return DUPLICATE_FIELD_KEYS.has(field);
}

/**
 * 句子里的一串词：中文用「、」连接（与 shared 原文一致），其它语言交给 `Intl.ListFormat`
 * （英文得到 `amount, currency, and time`）。
 */
export function joinDuplicateList(items: readonly string[]): string {
  if (isChineseLocale()) return items.join(t("duplicates.listSeparator"));
  return new Intl.ListFormat(currentLocale(), { style: "long", type: "conjunction" }).format(items);
}

/** 字段名转成当前语言的说法；未知字段原样返回（与 shared 的 `fieldLabel` 同一约定）。 */
export function duplicateFieldLabel(field: string): string {
  return isDuplicateFieldKey(field) ? t(`duplicates.match.field.${field}`) : field;
}

/** 检测范围的说法（`DUPLICATE_SCOPE_LABELS` 按代码翻译）。`local` 绝不能被说成“账本里没有重复”。 */
export function duplicateScopeLabel(scope: "server" | "local"): string {
  return t(`duplicates.scope.${scope}`);
}

/**
 * `describeDuplicateMatch`（`@libellum/shared`）的界面语言版本：**按规则结果重新拼句**，
 * 不按中文原文查表。中文输出与 shared 逐字一致（见 `duplicateReview.test.ts`）。
 *
 * 所有界面上的“为什么像”都应该用这一句，否则同一判定在不同页面会有不同说法。
 * 未命中（`matched: false`）时 shared 返回第一条排除规则的中文说明，这里交给
 * `translateSharedMessage` 查表（正常界面只展示命中的对，这条路径基本走不到）。
 */
export function describeDuplicateMatchText(result: DuplicatePairResult): string {
  if (result.suppressed) return t("duplicates.match.suppressed");
  if (!result.matched) return translateSharedMessage(result.reason);

  const labels: string[] = [];
  for (const rule of result.rules) {
    // 与 shared 的 `checkedFieldsSummary` 相同：跳过的与缺失的字段都没有被比较过。
    if (rule.outcome === "skipped" || rule.outcome === "missing") continue;
    const field = rule.fields[0];
    if (field === undefined || !isDuplicateFieldKey(field)) continue;
    const label = t(`duplicates.match.field.${field}`);
    if (!labels.includes(label)) labels.push(label);
  }

  const checked = labels.length === 0 ? t("duplicates.match.ledgerOnly") : joinDuplicateList(labels);
  if (result.missingFields.length === 0) return t("duplicates.match.allSame", { fields: checked });
  return t("duplicates.match.sameWithMissing", {
    fields: checked,
    missing: joinDuplicateList(result.missingFields.map(duplicateFieldLabel)),
  });
}

/**
 * 一次新增检查的结果，外加**这次答案是从哪来的**。
 *
 * `scope: "local"` 必须一路传到界面：离线或请求失败时只比对过本机已知的记录，
 * 说成“账本里没有重复”就是撒谎（规划 §4「离线不得宣称服务器账本无重复」）。
 */
export interface NewCandidatesResult {
  readonly pairs: readonly DuplicatePairResult[];
  readonly history: readonly Transaction[];
  readonly scope: "server" | "local";
  readonly truncated: boolean;
}

/** 全账本审查的一页，同样带数据来源。 */
export type ReviewCursor = { readonly source: "server"; readonly value: DuplicateReviewCursor }
  | { readonly source: "local"; readonly snapshot: string; readonly left: number; readonly right: number };
export interface ReviewScanChunk extends DuplicateReviewChunk {
  readonly continuation?: ReviewCursor | null;
  readonly scope: "server" | "local";
}

export function candidateFromEntry(entry: Transaction, bookId: string): DuplicateCandidateFields {
  return {
    id: entry.id,
    bookId,
    kind: entry.kind,
    amountCents: entry.amountCents,
    currency: entry.currency,
    occurredAt: entry.occurredAt,
    occurredLocalDate: entry.occurredLocalDate,
    categoryId: entry.categoryId,
    paymentMethodId: entry.paymentMethodId,
    note: entry.note,
    tagIds: entry.tags.map((tag) => tag.id),
  };
}

/**
 * 还没写入账本的记录（OCR 批量、导入预览）跑检测时的候选。
 *
 * `id` 用写入时真正会用的那个 id（幂等键同值）：这样“确认不是同一笔”写下的关系键，
 * 与写入后账本里的交易 id 一致，不会因为换了一种表示而失效。
 */
export function candidateFromInput(
  input: CreateTransactionInput,
  bookId: string,
): DuplicateCandidateFields {
  return {
    id: input.id,
    bookId,
    kind: input.kind,
    amountCents: input.amountCents,
    currency: input.currency,
    occurredAt: input.occurredAt,
    occurredLocalDate: input.occurredLocalDate,
    categoryId: input.categoryId ?? null,
    paymentMethodId: input.paymentMethodId ?? null,
    note: input.note ?? null,
    tagIds: input.tagIds,
  };
}

/** 当前账本 id：游客取本地账本，登录用户取当前账本请求头。 */
export function duplicateBookId(): string {
  return isGuestRuntime() ? (guestDataValue()?.book.id ?? "") : currentBookIdHeader();
}

/**
 * 本机已知、未删除的账目。
 *
 * ⚠️ **游客与登录用户是两份不同的本地数据**：游客账本在 `libellum-guest` 库里，登录用户的
 * 本地快照在离线库里。混用会让游客看到别人的账目（或什么都看不到），所以必须先按运行模式分叉。
 */
async function localEntries(): Promise<readonly Transaction[]> {
  if (isGuestRuntime()) {
    const deleted = guestDeletedIds(guestDataValue());
    return guestTransactions().filter((entry) => !deleted.has(entry.id));
  }
  const deleted = deletedEntriesValue();
  return (await readLocalTransactions()).filter((entry) => !deleted.has(entry.id));
}

/**
 * 新增检查：本批新增彼此之间 + 本批新增对账本历史。
 *
 * ⚠️ **普通路径永远只做这一次有界检查**，不会顺手重扫历史——「每记一笔不重扫全账本」是
 * 性能要求，也是产品语义：全账本扫描是用户在设置里主动发起的另一件事。
 *
 * 服务端不可用（离线、超时、5xx）时回退到本机数据，**并且如实返回 `scope: "local"`**；
 * 检测失败绝不能挡住写入。
 */
export async function checkNewCandidates(
  bookId: string,
  candidates: readonly DuplicateCandidateFields[],
  settings: DuplicateDetectionSettings,
): Promise<NewCandidatesResult> {
  if (!settings.enabled) return { pairs: [], history: [], scope: "local", truncated: false };
  if (candidates.some((candidate) => candidate.bookId !== bookId)) throw new Error(t("duplicates.errors.mixedBooks"));
  if (duplicateBookId() !== bookId) throw new Error(t("duplicates.errors.bookChangedReview"));

  const pairs = new Map<string, DuplicatePairResult>();
  const history = new Map<string, Transaction>();
  let truncated = false;
  let scope: "server" | "local" = "local";

  if (!isGuestRuntime() && navigator.onLine) {
    try {
      // 每批 100 条：与服务端 `duplicateCandidatesRequestSchema` 的上限一致。
      for (let start = 0; start < candidates.length; start += 100) {
        const result = await apiFetch<DuplicateCandidatesResponse>("/transactions/duplicates/candidates", {
          method: "POST",
          bookId,
          body: { candidates: candidates.slice(start, start + 100), settings },
        });
        for (const pair of result.pairs) pairs.set(pair.pairKey, pair);
        for (const entry of result.history) history.set(entry.id, entry);
        truncated ||= result.truncated;
      }
      scope = "server";
    } catch {
      // 有意静默：检测是辅助，写账才是用户的操作。来源由 `scope` 说明。
      scope = "local";
      pairs.clear();
      history.clear();
      truncated = false;
    }
  }

  if (scope === "local") {
    const local = await localEntries();
    const localCandidates = local.map((entry) => candidateFromEntry(entry, bookId));
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i]!;
      const others = [...candidates.slice(i + 1), ...localCandidates];
      for (const other of others) {
        if (other.id === candidate.id) continue;
        const result = evaluateDuplicatePair(candidate, other, settings);
        if (!result.matched) continue;
        pairs.set(result.pairKey, result);
        const entry = local.find((item) => item.id === other.id);
        if (entry !== undefined) history.set(entry.id, entry);
      }
      // 让出事件循环：几百笔的本地比对也不该把界面卡住。
      if (i % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // 请求期间账本被切换时，结果属于另一本账——宁可报错也不要显示到错的账本上。
  if (duplicateBookId() !== bookId) throw new Error(t("duplicates.errors.bookChangedReview"));

  return { pairs: [...pairs.values()], history: [...history.values()], scope, truncated };
}

/** Local snapshots use immutable ID-ordered positions, never fabricated server sequence numbers. */
const reviewSnapshots = new Map<string, { bookId: string; settings: string; guest: boolean; entries: readonly Transaction[] }>();
let snapshotSerial = 0;
export function releaseReviewCursor(cursor?: ReviewCursor | null): void {
  if (cursor?.source === "local") reviewSnapshots.delete(cursor.snapshot);
}
export async function fetchReviewChunk(
  bookId: string, settings: DuplicateDetectionSettings, afterSeq: number, throughSeq?: number, cursor?: ReviewCursor,
): Promise<ReviewScanChunk> {
  const empty = { pairs: [], entries: [], total: 0, processed: 0, nextSeq: null, throughSeq: 0, truncated: false, scope: "local" as const, continuation: null };
  if (!settings.enabled) return empty;
  // 账本设置可以检查另一账本；在线请求明确携带目标，不切换当前本地账本。
  const currentAtStart = duplicateBookId();
  const guestAtStart = isGuestRuntime();
  const starting = cursor === undefined && afterSeq === 0 && throughSeq === undefined;
  if (cursor?.source !== "local" && !isGuestRuntime() && navigator.onLine) {
    try {
      const chunk = await apiFetch<DuplicateReviewChunk>("/transactions/duplicates/review", {
        method: "POST", bookId, body: { settings, afterSeq,
          ...(throughSeq === undefined ? {} : { throughSeq }), ...(cursor?.source === "server" ? { cursor: cursor.value } : {}) },
      });
      if (currentAtStart !== duplicateBookId() || guestAtStart !== isGuestRuntime()) throw new Error(t("duplicates.errors.bookChangedCheck"));
      const value = chunk.nextCursor ?? (chunk.nextSeq === null ? null : { leftSeq: chunk.nextSeq, rightSeq: 0, throughSeq: chunk.throughSeq });
      return { ...chunk, scope: "server", continuation: value === null ? null : { source: "server", value } };
    } catch (error) {
      // A server continuation must never be interpreted as a local position.
      if (!starting || currentAtStart !== duplicateBookId() || guestAtStart !== isGuestRuntime() || bookId !== currentAtStart) throw error;
    }
  } else if (cursor?.source === "server" || (!starting && cursor === undefined)) {
    throw new Error(t("duplicates.errors.onlinePaused"));
  }
  // 只有当前本地账本的数据可用于离线检查，不能把 A 的快照标成 B。
  if (bookId !== duplicateBookId()) throw new Error(t("duplicates.errors.noLocalData"));
  let token: string;
  let snapshot: { bookId: string; settings: string; guest: boolean; entries: readonly Transaction[] };
  if (cursor?.source === "local") {
    token = cursor.snapshot;
    const stored = reviewSnapshots.get(token);
    if (!stored || stored.bookId !== bookId || stored.settings !== JSON.stringify(settings) || stored.guest !== isGuestRuntime()) {
      throw new Error(t("duplicates.errors.snapshotExpired"));
    }
    snapshot = stored;
  } else {
    const local = await localEntries();
    if (bookId !== duplicateBookId()) throw new Error(t("duplicates.errors.bookChangedCheck"));
    const unique = new Map(local.map(entry => [entry.id, entry]));
    snapshot = { bookId, settings: JSON.stringify(settings), guest: isGuestRuntime(), entries: structuredClone([...unique.values()].sort((a, b) => a.id.localeCompare(b.id))) };
    token = String(++snapshotSerial);
    while (reviewSnapshots.size >= 4) reviewSnapshots.delete(reviewSnapshots.keys().next().value!);
    reviewSnapshots.set(token, snapshot);
  }
  const ordered = snapshot.entries;
  let left = cursor?.source === "local" ? cursor.left : 0;
  let right = cursor?.source === "local" ? cursor.right : 1;
  const pairs: DuplicatePairResult[] = []; const entries = new Map<string, Transaction>();
  let processed = 0; let examined = 0;
  // 500 evaluations / 50 completed left rows per chunk; dense buckets can always resume mid-row.
  while (left < ordered.length && examined < 500 && processed < 50) {
    const entry = ordered[left]!;
    const candidate = candidateFromEntry(entry, bookId);
    while (right < ordered.length && examined < 500) {
      const other = ordered[right++]!; examined += 1;
      const result = evaluateDuplicatePair(candidate, candidateFromEntry(other, bookId), settings);
      if (result.matched) { pairs.push(result); entries.set(entry.id, entry); entries.set(other.id, other); }
    }
    if (right >= ordered.length) { left += 1; right = left + 1; processed += 1; }
  }
  const continuation: ReviewCursor | null = left >= ordered.length ? null : { source: "local", snapshot: token, left, right };
  // Keep the snapshot until its owner accepts the response; cancellation may discard this chunk.
  return { pairs, entries: [...entries.values()], total: ordered.length, processed,
    nextSeq: continuation === null ? null : 0, throughSeq: 0, truncated: false, scope: "local", continuation };
}

/**
 * 批量导入之后的检查：这一批与历史之间、以及这一批彼此之间。
 *
 * 为什么按导入编号而不是让浏览器重新解析文件：CSV 导入是**服务端**把整个文件校验后
 * 整批写入的，浏览器手里没有行数据。用导入编号点名这一批，判重仍然只有服务端那一份
 * 规则，就不会出现“浏览器算出来的金额和服务端归一化后的金额不一样”的第二套口径。
 *
 * 游客和离线没有这条路径：导入本身就要联网，失败时返回空结果并说明检查没有做，
 * 而不是假装“没有发现重复”。
 */
export async function fetchImportReview(
  bookId: string,
  importRef: string,
  settings: DuplicateDetectionSettings,
): Promise<{ pairs: readonly DuplicatePairResult[]; entries: readonly Transaction[]; checked: number; truncated: boolean }> {
  if (!settings.enabled) return { pairs: [], entries: [], checked: 0, truncated: false };
  if (isGuestRuntime() || !navigator.onLine) {
    throw new Error(t("duplicates.errors.importReviewUnavailable"));
  }
  const response = await apiFetch<DuplicateImportReviewResponse>("/transactions/duplicates/import-review", {
    method: "POST",
    bookId,
    body: { importRef, settings },
  });
  return { pairs: response.pairs, entries: response.entries, checked: response.checked, truncated: response.truncated };
}
