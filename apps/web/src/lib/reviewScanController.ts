import type { DuplicatePairResult, Transaction } from "@libellum/shared";
import { t } from "../i18n/index.js";
import { ApiRequestError, localizedApiErrorMessage } from "./api.js";
import type { ReviewCursor, ReviewScanChunk } from "./duplicateReview.js";
/**
 * 失败原因（界面语言）：服务器错误按错误码本地化（中文界面仍是服务器原文）；本页自己抛出的
 * 错误在抛出时已经按界面语言取了文案（`duplicateReview.ts`）。
 */
function failureText(error: unknown): string {
  if (error instanceof ApiRequestError) return localizedApiErrorMessage(error);
  return error instanceof Error ? error.message : t("duplicates.review.failed");
}
export interface ReviewScanState {
  readonly phase: "idle" | "running" | "paused" | "done" | "error";
  readonly processed: number; readonly total: number | null;
  readonly pairs: readonly DuplicatePairResult[]; readonly entries: readonly Transaction[];
  readonly scope: "server" | "local"; readonly truncated: boolean; readonly failure: string | null;
}
const initial = (): ReviewScanState => ({ phase: "idle", processed: 0, total: null, pairs: [], entries: [], scope: "server", truncated: false, failure: null });
/** One controller per book/rule set. Generation checks fence late responses and cancel/restart races. */
export class ReviewScanController {
  private state = initial();
  private generation = 0;
  private cursor: ReviewCursor | undefined;
  private afterSeq = 0;
  private throughSeq: number | undefined;
  private listeners = new Set<() => void>();
  constructor(private readonly fetch: (after: number, through?: number, cursor?: ReviewCursor) => Promise<ReviewScanChunk>, private readonly release: (cursor?: ReviewCursor) => void = () => {}) {}
  getSnapshot = (): ReviewScanState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: ReviewScanState) { this.state = next; this.listeners.forEach(listener => listener()); }
  cancel = (): void => { this.generation += 1; if (this.state.phase === "running") this.publish({ ...this.state, phase: "paused" }); };
  dispose = (): void => { this.cancel(); this.release(this.cursor); };
  async scan(resume: boolean): Promise<void> {
    if (this.state.phase === "running") return;
    const run = ++this.generation;
    if (!resume) { this.release(this.cursor); this.cursor = undefined; this.afterSeq = 0; this.throughSeq = undefined; this.publish(initial()); }
    this.publish({ ...this.state, phase: "running", failure: null });
    const pairs = new Map(this.state.pairs.map(pair => [pair.pairKey, pair]));
    const entries = new Map(this.state.entries.map(entry => [entry.id, entry]));
    let processed = this.state.processed;
    try {
      for (;;) {
        const chunk = await this.fetch(this.afterSeq, this.throughSeq, this.cursor);
        if (run !== this.generation) { if (chunk.continuation?.source === "local" && chunk.continuation.snapshot !== (this.cursor?.source === "local" ? this.cursor.snapshot : undefined)) this.release(chunk.continuation); return; }
        this.throughSeq = chunk.throughSeq;
        this.afterSeq = chunk.nextSeq ?? chunk.throughSeq;
        const previousCursor = this.cursor;
        this.cursor = chunk.continuation ?? undefined;
        chunk.pairs.forEach(pair => pairs.set(pair.pairKey, pair));
        chunk.entries.forEach(entry => entries.set(entry.id, entry));
        processed += chunk.processed;
        const finished = chunk.continuation === null || (chunk.continuation === undefined && chunk.nextSeq === null);
        this.publish({ phase: finished ? "done" : "running", processed, total: chunk.total,
          pairs: [...pairs.values()], entries: [...entries.values()], scope: chunk.scope,
          truncated: this.state.truncated || chunk.truncated, failure: null });
        if (finished) { this.release(previousCursor); return; }
        await new Promise(resolve => setTimeout(resolve, 0));
        if (run !== this.generation) return;
      }
    } catch (error) {
      if (run === this.generation) this.publish({ ...this.state, phase: "error", failure: failureText(error) });
    }
  }
}
