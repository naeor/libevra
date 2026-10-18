/**
 * D2 本地导入任务日志。
 *
 * ⚠️ **为什么是 localStorage，而不是游客账本数据库。** 这个日志属于“这一次导入操作”，不属于游客
 * 账本内容；刷新/崩溃后要能读到最后一次请求，而不是把游客数据再混进正式离线队列。日志只在本机，
 * 不参与同步，也不改变游客账本。成功回执保存后立即删除。
 */
import { ledgerImportRequestSchema, type LedgerImportRequest } from "@libellum/shared";

const KEY_PREFIX = "libellum-ledger-import-task:";

export interface PendingImportTask {
  readonly userId: string;
  readonly request: LedgerImportRequest;
  readonly targetLabel: string;
  readonly sourceLabel: string;
  readonly createdAt: string;
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function key(importId: string): string {
  return `${KEY_PREFIX}${importId}`;
}

export function savePendingTask(task: PendingImportTask): void {
  const target = storage();
  if (target === null) return;
  target.setItem(key(task.request.importId), JSON.stringify(task));
}

export function removePendingTask(importId: string): void {
  const target = storage();
  if (target === null) return;
  target.removeItem(key(importId));
}

/** Read every valid pending task; corrupt entries are ignored rather than crashing the export page. */
export function loadPendingTasks(): readonly PendingImportTask[] {
  const target = storage();
  if (target === null) return [];
  const tasks: PendingImportTask[] = [];
  for (let index = 0; index < target.length; index += 1) {
    const itemKey = target.key(index);
    if (itemKey === null || !itemKey.startsWith(KEY_PREFIX)) continue;
    const raw = target.getItem(itemKey);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<PendingImportTask>;
      if (
        typeof parsed.userId !== "string" ||
        typeof parsed.targetLabel !== "string" ||
        typeof parsed.sourceLabel !== "string" ||
        typeof parsed.createdAt !== "string"
      ) {
        continue;
      }
      const request = ledgerImportRequestSchema.parse(parsed.request);
      tasks.push({
        userId: parsed.userId,
        request,
        targetLabel: parsed.targetLabel,
        sourceLabel: parsed.sourceLabel,
        createdAt: parsed.createdAt,
      });
    } catch {
      // A newer/older schema or a damaged entry must not block the page.
    }
  }
  return tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt, "en"));
}
