import {
  evaluateDuplicatePair,
  type CreateTransactionInput,
  type DuplicateCandidateFields,
  type DuplicateCandidatesResponse,
  type DuplicateDetectionSettings,
  type DuplicateImportReviewResponse,
  type DuplicatePairResult,
  type DuplicateReviewChunk,
  type Transaction,
} from "@libellum/shared";
import { apiFetch, currentBookIdHeader } from "./api.js";
import { isGuestRuntime } from "./guest/runtime.js";
import { guestDataValue, guestDeletedIds, guestTransactions } from "./guest/data.js";
import { deletedEntriesValue, readLocalTransactions } from "./offline/localLedger.js";

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
export interface ReviewScanChunk extends DuplicateReviewChunk {
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
  if (candidates.some((candidate) => candidate.bookId !== bookId)) throw new Error("候选记录账本不一致。");
  if (duplicateBookId() !== bookId) throw new Error("账本已切换，请重新核对。");

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
  if (duplicateBookId() !== bookId) throw new Error("账本已切换，请重新核对。");

  return { pairs: [...pairs.values()], history: [...history.values()], scope, truncated };
}

/**
 * 审查游标用的序号。
 *
 * ⚠️ `Transaction.seq` 在协议里是可选的（离线新建、尚未同步的账目没有服务器序号）。
 * 这些账目在本地审查里按 `0` 处理：它们排在最早的位置，与“尚未拿到序号”一致；
 * 服务端返回的账目一定有序号，所以服务端分块不受影响。
 */
function seqOf(entry: Transaction): number {
  return entry.seq ?? 0;
}

/**
 * 全账本审查的一页。
 *
 * 服务端按 `seq` 游标分块（不一次拉全账本）；游客或离线时在同一套规则核心上只扫本机
 * 已知数据，并用 `scope` 明说范围。两边的分块算法一致：**每对只比一次**（只与 seq 更大的
 * 记录比较），所以翻页不会重复、也不会漏。
 */
export async function fetchReviewChunk(
  bookId: string,
  settings: DuplicateDetectionSettings,
  afterSeq: number,
  throughSeq?: number,
): Promise<ReviewScanChunk> {
  if (!settings.enabled) {
    return { pairs: [], entries: [], total: 0, processed: 0, nextSeq: null, throughSeq: 0, truncated: false, scope: "local" };
  }

  if (!isGuestRuntime() && navigator.onLine) {
    try {
      const chunk = await apiFetch<DuplicateReviewChunk>("/transactions/duplicates/review", {
        method: "POST",
        bookId,
        body: { settings, afterSeq, ...(throughSeq === undefined ? {} : { throughSeq }) },
      });
      return { ...chunk, scope: "server" };
    } catch {
      // 落回本机数据，由界面说明范围。
    }
  }

  const local = await localEntries();
  const ordered = [...local].sort((left, right) => seqOf(left) - seqOf(right));
  const maximum = throughSeq ?? (ordered.length === 0 ? 0 : seqOf(ordered[ordered.length - 1]!));
  const total = ordered.filter((entry) => seqOf(entry) <= maximum).length;
  const chunk = ordered.filter((entry) => seqOf(entry) > afterSeq && seqOf(entry) <= maximum).slice(0, 50);

  const entries = new Map<string, Transaction>();
  const pairs: DuplicatePairResult[] = [];
  let truncated = false;
  for (const entry of chunk) {
    const candidate = candidateFromEntry(entry, bookId);
    for (const other of ordered) {
      if (seqOf(other) <= seqOf(entry) || seqOf(other) > maximum) continue;
      const result = evaluateDuplicatePair(candidate, candidateFromEntry(other, bookId), settings);
      if (!result.matched) continue;
      pairs.push(result);
      entries.set(entry.id, entry);
      entries.set(other.id, other);
    }
    if (pairs.length >= 500) {
      truncated = true;
      break;
    }
  }

  const last = chunk[chunk.length - 1];
  return {
    pairs,
    entries: [...entries.values()],
    total,
    processed: chunk.length,
    nextSeq: last === undefined ? null : seqOf(last),
    throughSeq: maximum,
    truncated,
    scope: "local",
  };
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
    throw new Error("游客账本和离线状态没有批量导入的重复检查：这次导入的记录在服务器账本上。");
  }
  const response = await apiFetch<DuplicateImportReviewResponse>("/transactions/duplicates/import-review", {
    method: "POST",
    bookId,
    body: { importRef, settings },
  });
  return { pairs: response.pairs, entries: response.entries, checked: response.checked, truncated: response.truncated };
}
