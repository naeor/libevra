import { evaluateDuplicatePair, type DuplicateCandidateFields, type DuplicateDetectionSettings, type DuplicatePairResult, type Transaction } from "@libellum/shared";
import { apiFetch, currentBookIdHeader } from "./api.js";
import { isGuestRuntime } from "./guest/runtime.js";
import { guestDataValue } from "./guest/data.js";
import { readLocalTransactions, deletedEntriesValue } from "./offline/localLedger.js";
export function candidateFromEntry(entry: Transaction, bookId: string): DuplicateCandidateFields {
  return { id: entry.id, bookId, kind: entry.kind, amountCents: entry.amountCents, currency: entry.currency,
    occurredAt: entry.occurredAt, occurredLocalDate: entry.occurredLocalDate, categoryId: entry.categoryId,
    paymentMethodId: entry.paymentMethodId, note: entry.note, tagIds: entry.tags.map(t => t.id) };
}
export function duplicateBookId(): string { return isGuestRuntime() ? guestDataValue()?.book.id ?? "" : currentBookIdHeader(); }
export interface NewCandidatesResult { pairs: readonly DuplicatePairResult[]; history: readonly Transaction[]; scope: "server" | "local"; truncated: boolean; }
/** New-versus-history and new-versus-new only. Never rescans history internally. */
export async function checkNewCandidates(bookId: string, candidates: readonly DuplicateCandidateFields[], settings: DuplicateDetectionSettings): Promise<NewCandidatesResult> {
  if (!settings.enabled) return { pairs: [], history: [], scope: "local", truncated: false };
  if (candidates.some(c => c.bookId !== bookId)) throw new Error("候选记录账本不一致。");
  const pairs = new Map<string, DuplicatePairResult>(); const history = new Map<string, Transaction>();
  let truncated = false; let scope: "server" | "local" = "local";
  if (!isGuestRuntime() && navigator.onLine) {
    try {
      for (let start = 0; start < candidates.length; start += 100) {
        const result = await apiFetch<Omit<NewCandidatesResult, "scope">>("/transactions/duplicates/candidates", { method: "POST", bookId, body: { candidates: candidates.slice(start, start + 100), settings } });
        result.pairs.forEach(p => pairs.set(p.pairKey, p)); result.history.forEach(e => history.set(e.id, e)); truncated ||= result.truncated;
      }
      scope = "server";
    } catch { scope = "local"; }
  }
  if (bookId !== duplicateBookId()) throw new Error("账本已切换，请重新核对。");
  const local = scope === "local" ? (await readLocalTransactions()).filter(e => !deletedEntriesValue().has(e.id)) : [];
  let compared = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const others = [...candidates.slice(i + 1), ...local.map(e => candidateFromEntry(e, bookId))];
    for (const other of others) {
      if (c.id === other.id) continue;
      if (++compared > 200000) { truncated = true; break; }
      const pair = evaluateDuplicatePair(c, other, settings);
      if (pair.matched) { pairs.set(pair.pairKey, pair); const entry = local.find(e => e.id === other.id); if (entry) history.set(entry.id, entry); }
    }
    if (compared > 200000) break;
    if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { pairs: [...pairs.values()], history: [...history.values()], scope, truncated };
}
export interface ReviewChunk { pairs: DuplicatePairResult[]; entries: Transaction[]; total: number; processed: number; nextSeq: number | null; throughSeq: number; truncated: boolean; }
export function fetchReviewChunk(bookId: string, settings: DuplicateDetectionSettings, afterSeq: number, throughSeq?: number) {
  return apiFetch<ReviewChunk>("/transactions/duplicates/review", { method: "POST", bookId, body: { settings, afterSeq, throughSeq } });
}
