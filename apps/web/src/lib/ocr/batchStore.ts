/**
 * 批次的会话级临时存储（sessionStorage）。
 *
 * 为什么是 sessionStorage 而不是 IndexedDB/localStorage：
 *  - 批次是**一次核对过程**的临时数据，不是账本；刷新当前标签页要能恢复，关掉就该消失；
 *  - 不参与离线同步、不进缓存、不进数据库，减少真实截图识别结果在设备上停留的时间；
 *  - 结构小（几条到几百条文本），没有异步读写的必要。
 *
 * 存储里只有识别出的文字字段，没有图片（图片在识别后就被丢弃）。确认导入成功或
 * 用户取消后由页面调用 `clearBatch()`；没有第二条清理路径。
 */

import type { OcrBatch } from "./types.js";

const STORAGE_KEY = "libellum:ocr-review-batch";

/** 只依赖这三个方法，测试可以传一个内存实现，不碰真实 sessionStorage。 */
export interface BatchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 浏览器里的默认存储；不可用（隐私模式/服务端渲染）时返回 null。 */
export function batchStorage(): BatchStorage | null {
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

/** 读回来的东西可能是旧版本、手改过的或损坏的；不认识就当作没有批次。 */
function normalizeBatch(raw: unknown): OcrBatch | null {
  if (!isRecord(raw)) return null;
  if (raw["version"] !== 1) return null;
  if (typeof raw["batchId"] !== "string" || raw["batchId"] === "") return null;
  if (typeof raw["createdAt"] !== "string") return null;
  if (!Array.isArray(raw["items"]) || !Array.isArray(raw["pages"])) return null;

  const items = raw["items"].filter(
    (item): item is OcrBatch["items"][number] =>
      isRecord(item) && typeof item["candidateId"] === "string",
  );

  const importIds: Record<string, string> = {};
  if (isRecord(raw["importIds"])) {
    for (const [candidateId, id] of Object.entries(raw["importIds"])) {
      if (typeof id === "string" && id !== "") importIds[candidateId] = id;
    }
  }

  return {
    version: 1,
    batchId: raw["batchId"],
    createdAt: raw["createdAt"],
    bookId: typeof raw["bookId"] === "string" ? raw["bookId"] : null,
    pages: raw["pages"] as OcrBatch["pages"],
    items,
    importIds,
  };
}

/** 保存批次。返回是否真的写进去了（配额/隐私模式可能失败）。 */
export function saveBatch(batch: OcrBatch, storage: BatchStorage | null = batchStorage()): boolean {
  if (storage === null) return false;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(batch));
    return true;
  } catch {
    return false;
  }
}

/** 读取当前标签页的批次；没有、损坏或版本不认识都返回 null。 */
export function loadBatch(storage: BatchStorage | null = batchStorage()): OcrBatch | null {
  if (storage === null) return null;

  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (text === null) return null;

  try {
    return normalizeBatch(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** 确认导入成功、全部失败后重来、或用户取消时清除。 */
export function clearBatch(storage: BatchStorage | null = batchStorage()): void {
  if (storage === null) return;

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 存储不可用时本来就没有可清的东西。
  }
}

/** 测试/诊断用：当前固定 key。 */
export const BATCH_STORAGE_KEY = STORAGE_KEY;
