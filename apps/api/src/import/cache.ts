import {
  BILL_IMPORT_PREVIEW_TTL_MS,
  type BillImportCandidate,
  type BillImportPreview,
  type ImportReport,
} from "@libellum/shared";

/**
 * 预览缓存只活在进程内：重启后丢失是设计允许的（前端会提示重新上传）。
 * 关键点是按 userId+bookId 隔离，预览 ID 猜到了也不能跨人/跨账本使用。
 */
export interface PreviewRecord {
  readonly previewId: string;
  readonly userId: string;
  readonly bookId: string;
  readonly fingerprint: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly source: BillImportPreview["source"];
  readonly format: BillImportPreview["format"];
  /** 重新核对会更新候选（编辑字段/重复标记），提交以最后一次核对结果为准。 */
  candidates: BillImportCandidate[];
  readonly warnings: string[];
  readonly reconciliation: BillImportPreview["reconciliation"];
  /** 提交成功后的报告；同一预览重复提交直接复用，保证幂等。 */
  committed: ImportReport | null;
}

/**
 * 每个预览最多 2 万条候选，限制条目数是为了给进程内存兜底。
 * 30 分钟 TTL 是共享契约，不放宽。
 */
const DEFAULT_CAPACITY = 25;

export class PreviewCache {
  private readonly entries = new Map<string, PreviewRecord>();

  constructor(
    private readonly ttlMs: number = BILL_IMPORT_PREVIEW_TTL_MS,
    private readonly capacity: number = DEFAULT_CAPACITY,
  ) {}

  put(record: Omit<PreviewRecord, "expiresAt">): PreviewRecord {
    const now = Date.now();
    this.sweep(now);
    const stored: PreviewRecord = { ...record, expiresAt: now + this.ttlMs };
    while (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(stored.previewId, stored);
    return stored;
  }

  get(previewId: string, userId: string, bookId: string): PreviewRecord | null {
    const record = this.entries.get(previewId);
    if (record === undefined) return null;
    if (record.expiresAt <= Date.now()) {
      this.entries.delete(previewId);
      return null;
    }
    // 跨用户/跨账本视同不存在，避免泄露“这个预览存在”的信息。
    if (record.userId !== userId || record.bookId !== bookId) return null;
    return record;
  }

  markCommitted(previewId: string, report: ImportReport): void {
    const record = this.entries.get(previewId);
    if (record === undefined) return;
    record.committed = report;
  }

  size(): number {
    return this.entries.size;
  }

  private sweep(now: number): void {
    // Map 按插入顺序保存，过期时间与插入顺序一致，遇到第一条未过期即可停。
    for (const [id, record] of this.entries) {
      if (record.expiresAt > now) break;
      this.entries.delete(id);
    }
  }
}
