/**
 * 一次「OCR 导入会话」的累计记录（S15-B 完成页）。
 *
 * 完成页要回答两句话：**这一批怎么样**、**这次一共导入了多少**。批次与失败重试仍由
 * `batchStore.ts` 负责；这里只追加**计数**，用来跨越多批显示会话累计。
 *
 * 三条边界：
 *  - **只存计数**：`bookId`、批次序号/时间、成功/失败/排队笔数。没有金额、分类、标签、
 *    备注或任何交易明细——这些留在账本里，不复制到浏览器临时存储。
 *  - **不跨账本**：换一本账时旧会话作废，从第 1 批重新计。把 A 账的合计显示在 B 账上，
 *    比“看不到历史”更糟。
 *  - **同一批只算一次**：失败重试沿用同一 `batchId`，重试后**更新**原记录而不是再追加
 *    一批；否则「共 M 批」和「累计 N 笔」会随每次重试虚增。
 *
 * 存储用 sessionStorage：会话是“一次坐下来”的过程，关掉标签页就该消失；没有数据库、
 * 没有新表、没有服务器往返。读写函数都接收可注入的 storage，测试用内存实现即可。
 */

export const IMPORT_SESSION_STORAGE_KEY = "libellum.ocr.import-session.v1";

/** 一次会话最多保留的批次数。正常一次坐下不会到这个量，上限只防无限增长。 */
export const MAX_SESSION_BATCHES = 50;

/** 一批在会话里的记录。只有计数，没有交易内容。 */
export interface OcrImportSessionBatch {
  readonly batchId: string;
  /** 会话内的批次序号，从 1 开始；重试更新同一条时保持不变。 */
  readonly sequence: number;
  /** 最近一次导入完成的时间（ISO 8601）；重试会把它更新为这次的时间。 */
  readonly importedAt: string;
  readonly succeeded: number;
  /** 仍未写入的笔数（重试后是这次剩下的，不是历史累计）。 */
  readonly failed: number;
  /** 其中写在本机队列、等联网投递的笔数。**不能当成云端已保存。** */
  readonly pending: number;
}

export interface OcrImportSession {
  readonly version: 1;
  readonly bookId: string | null;
  /** 最新的批次在最前。 */
  readonly batches: readonly OcrImportSessionBatch[];
}

/** 只依赖这三个方法，测试传内存实现，不碰真实 sessionStorage。 */
export interface ImportSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 浏览器里的默认存储；不可用（隐私模式/服务端渲染）时返回 null。 */
export function importSessionStorage(): ImportSessionStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 非负整数；读回的数据可能是手改的、旧的，认不出来就按 0。 */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizeBatch(raw: unknown): OcrImportSessionBatch | null {
  if (!isRecord(raw)) return null;

  const batchId = raw["batchId"];
  const importedAt = raw["importedAt"];
  const sequence = raw["sequence"];

  if (typeof batchId !== "string" || batchId === "") return null;
  if (typeof importedAt !== "string" || importedAt === "") return null;
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) return null;

  return {
    batchId,
    sequence,
    importedAt,
    succeeded: count(raw["succeeded"]),
    failed: count(raw["failed"]),
    pending: count(raw["pending"]),
  };
}

/** 读回来的东西可能是旧版本、手改过的或损坏的；不认识就当作没有会话。 */
function normalizeSession(raw: unknown): OcrImportSession | null {
  if (!isRecord(raw) || raw["version"] !== 1) return null;
  if (!Array.isArray(raw["batches"])) return null;

  const batches = raw["batches"].flatMap((entry) => {
    const batch = normalizeBatch(entry);
    return batch === null ? [] : [batch];
  });

  // 顺序以序号为准自愈：存储被手改过也不至于把“最新一批”显示在最下面。
  batches.sort((left, right) => right.sequence - left.sequence);

  return {
    version: 1,
    bookId: typeof raw["bookId"] === "string" && raw["bookId"] !== "" ? raw["bookId"] : null,
    batches: batches.slice(0, MAX_SESSION_BATCHES),
  };
}

/** 保存会话。返回是否真的写进去了（配额/隐私模式可能失败）。 */
export function saveImportSession(
  session: OcrImportSession,
  storage: ImportSessionStorage | null = importSessionStorage(),
): boolean {
  if (storage === null) return false;

  try {
    storage.setItem(IMPORT_SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

/** 读取当前标签页的会话；没有、损坏或版本不认识都返回 null。 */
export function loadImportSession(
  storage: ImportSessionStorage | null = importSessionStorage(),
): OcrImportSession | null {
  if (storage === null) return null;

  let text: string | null;
  try {
    text = storage.getItem(IMPORT_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }

  if (text === null) return null;

  try {
    return normalizeSession(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** 「返回明细」结束会话时清除；账本切换时也用它作废旧会话。 */
export function clearImportSession(
  storage: ImportSessionStorage | null = importSessionStorage(),
): void {
  if (storage === null) return;

  try {
    storage.removeItem(IMPORT_SESSION_STORAGE_KEY);
  } catch {
    // 存储不可用时本来就没有可清的东西。
  }
}

/** 一批导入完成后要追加/更新的计数。 */
export interface OcrImportRecord {
  /** 批次 id（导入前捕获，批次被清空后仍可用）。 */
  readonly batchId: string;
  /** 批次所属账本；与现有会话不同则**开始新会话**，绝不混入。 */
  readonly bookId: string | null;
  readonly importedAt: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly pending: number;
}

/**
 * 把一批的结果并入会话。纯函数，不读存储。
 *
 * 重试语义：同一 `batchId` 已存在时**更新**原记录——
 *  - `succeeded` / `pending` 累加：重试只写批次里剩下的失败项，已成功的不会被重写；
 *  - `failed` 取本次的值：那是重试后仍未写入的数量；
 *  - `sequence` 保留第一次的序号，批次卡片不会因为重试改变“第几批”。
 *
 * ⚠️ `pending` 累加记录的是“这批导入时有多少笔写进了本机队列”，不是实时同步状态：
 * 会话只存计数，无法知道队列后来有没有投递成功，所以不把它当作云端已保存。
 */
export function recordImportBatch(
  session: OcrImportSession | null,
  record: OcrImportRecord,
): OcrImportSession {
  const incoming = {
    succeeded: count(record.succeeded),
    failed: count(record.failed),
    pending: count(record.pending),
  };

  if (session === null || session.bookId !== record.bookId) {
    return {
      version: 1,
      bookId: record.bookId,
      batches: [{ batchId: record.batchId, sequence: 1, importedAt: record.importedAt, ...incoming }],
    };
  }

  const existing = session.batches.find((batch) => batch.batchId === record.batchId);

  if (existing === undefined) {
    const sequence =
      session.batches.reduce((highest, batch) => Math.max(highest, batch.sequence), 0) + 1;

    return {
      version: 1,
      bookId: session.bookId,
      batches: [
        { batchId: record.batchId, sequence, importedAt: record.importedAt, ...incoming },
        ...session.batches,
      ].slice(0, MAX_SESSION_BATCHES),
    };
  }

  const updated: OcrImportSessionBatch = {
    batchId: existing.batchId,
    sequence: existing.sequence,
    importedAt: record.importedAt,
    succeeded: existing.succeeded + incoming.succeeded,
    failed: incoming.failed,
    pending: existing.pending + incoming.pending,
  };

  return {
    version: 1,
    bookId: session.bookId,
    batches: session.batches.map((batch) => (batch.batchId === updated.batchId ? updated : batch)),
  };
}

export interface OcrImportSessionTotals {
  /** 会话累计写入账本的笔数（含本机排队中的）。 */
  readonly imported: number;
  readonly batches: number;
  /** 这两行只是展示用，不参与任何保存判断。 */
  readonly pending: number;
}

/** 会话顶部的累计口径。空会话全为 0。 */
export function importSessionTotals(session: OcrImportSession | null): OcrImportSessionTotals {
  if (session === null) return { imported: 0, batches: 0, pending: 0 };

  return session.batches.reduce<OcrImportSessionTotals>(
    (totals, batch) => ({
      imported: totals.imported + batch.succeeded,
      batches: totals.batches + 1,
      pending: totals.pending + batch.pending,
    }),
    { imported: 0, batches: 0, pending: 0 },
  );
}
