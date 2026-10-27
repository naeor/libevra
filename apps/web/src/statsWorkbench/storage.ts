/**
 * 工作台配置的本机保存（Q-03：本地优先 + 服务端同步；**本轮只有本地这一半**）。
 *
 * ⚠️ **作用域 = 账号（Q-02）。** 键里带用户 ID（游客带游客身份 ID），同一台设备上换账号不会读到
 * 别人的工作台；切换账本只让卡片用新账本的数据重算，工作台本身不变。键以 `libevra.` 开头，所以
 * 「清除本机数据」会一并清掉它（`isAppDeviceStorageKey`）。
 *
 * ⚠️ **记录形状用 Agent D 的 `WorkbenchLocalRecordV1`，校验也用 D 的校验器**：保存前、读取后都过一遍。
 * 读出来的内容无法通过校验（损坏、或来自更新版本）时，**不覆盖、不删除**，界面退回默认工作台并说明；
 * 用户下次主动保存时才会写入新记录。服务端同步（W6）需要新的存储与迁移，另行评审，这里
 * `pendingSync` 恒为 `true`，如实表示「只在本机」。
 *
 * ⚠️ 只存布局与分析定义的引用，**不存任何金额、交易或账本 ID**（总需求规格 §3.3）。
 */
import {
  validateGeometry,
  WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
  LAYOUT_SCHEMA_VERSION,
  migrateContentDocument,
  migrateLayoutDocument,
  roundTripContentDocument,
  roundTripLayoutDocument,
  type LayoutDocumentV1,
  type WorkbenchContentDocumentV1,
  type WorkbenchLocalRecordV1,
} from "@libellum/shared/analysis/layout";
import { runLayoutPipeline } from "@libellum/shared/workbench/pipeline";

import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import { defaultWorkbench } from "./defaults.js";

export function workbenchStorageKey(accountScope: string): string {
  return `${LIBEVRA_KEY_PREFIX}stats-workbench:v1:${accountScope}`;
}

export interface WorkbenchDocuments {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
}

export type LoadOutcome =
  | { readonly status: "missing" }
  | { readonly status: "ok"; readonly documents: WorkbenchDocuments; readonly version: number }
  | { readonly status: "unreadable"; readonly version?: number };

/** 两份文档 + 交叉引用都合法才算合法（与 D 的命令层同一套判断）。 */
export function documentsProblems(documents: WorkbenchDocuments): readonly string[] {
  // 参数白名单、交叉引用、序列化均复用D正式管线；warning保留未知分析，不擅自删除。
  const pipeline = runLayoutPipeline(documents, { targetColumns: documents.layout?.main?.baseCols ?? 2 });
  const problems = pipeline.issues.filter(issue => issue.severity === "error").map(issue => `${issue.path}:${issue.code}`);
  if (pipeline.layout !== undefined) problems.push(...validateGeometry(pipeline.layout.main.objects, pipeline.layout.main.baseCols).map(issue => `geometry:${issue.code}`));
  return problems;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadWorkbench(accountScope: string): LoadOutcome {
  const store = storage();
  if (store === null) return { status: "missing" };
  let raw: string | null;
  try {
    raw = store.getItem(workbenchStorageKey(accountScope));
  } catch {
    return { status: "missing" };
  }
  if (raw === null) return { status: "missing" };
  try {
    const record = JSON.parse(raw) as Partial<WorkbenchLocalRecordV1>;
    if (record.storeSchemaVersion !== WORKBENCH_LOCAL_STORE_SCHEMA_VERSION || record.userId !== accountScope) {
      return { status: "unreadable" };
    }
    if (!Number.isSafeInteger(record.content?.version) || (record.content?.version ?? -1) < 0 ||
        !Number.isSafeInteger(record.layout?.version) || (record.layout?.version ?? -1) < 0) {
      return { status: "unreadable" };
    }
    const version = Math.max(record.content?.version ?? 0, record.layout?.version ?? 0);
    // D 的正式逐版本迁移链：较新 schema 只读保留；失败不拿回退空文档冒充用户布局。
    const content = migrateContentDocument(record.content?.document);
    const layout = migrateLayoutDocument(record.layout?.document);
    if (!content.ok || content.status === "read-only-newer" || content.value === undefined ||
        !layout.ok || layout.status === "read-only-newer" || layout.value === undefined) return { status: "unreadable", version };
    const documents = { content: content.value, layout: layout.value };
    if (documentsProblems(documents).length > 0) return { status: "unreadable", version };
    return { status: "ok", documents, version };
  } catch {
    return { status: "unreadable" };
  }
}

/** 保存成功返回新版本号；不合法的文档拒绝保存（返回 `null`），绝不写入半成品。 */
export function saveWorkbench(accountScope: string, documents: WorkbenchDocuments, previousVersion: number): number | null {
  if (!Number.isSafeInteger(previousVersion) || previousVersion < 0 || previousVersion >= Number.MAX_SAFE_INTEGER) return null;
  if (documentsProblems(documents).length > 0) return null;
  // 由 D 序列化/解析往返检查后再落盘，不能只校验内存结构。
  const content = roundTripContentDocument(documents.content);
  const layout = roundTripLayoutDocument(documents.layout);
  if (!content.ok || content.document === undefined || !layout.ok || layout.document === undefined) return null;
  const store = storage();
  if (store === null) return null;
  const version = previousVersion + 1;
  const record: WorkbenchLocalRecordV1 = {
    storeSchemaVersion: WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
    userId: accountScope,
    content: { version, document: content.document },
    layout: { version, document: layout.document },
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  };
  try {
    // 显式保存也先保留旧原文；损坏/较新记录可恢复，写备份失败则不覆盖。
    const key = workbenchStorageKey(accountScope);
    const previous = store.getItem(key);
    if (previous !== null) {
      let preserveUnreadable = false;
      try {
        const saved = JSON.parse(previous) as Partial<WorkbenchLocalRecordV1>;
        // 较新格式只读；旧标签页不能用过期版本覆盖另一标签页的新保存。
        if (saved.storeSchemaVersion !== WORKBENCH_LOCAL_STORE_SCHEMA_VERSION || saved.userId !== accountScope) return null;
        if ((saved.content?.document?.schemaVersion ?? 0) > LAYOUT_SCHEMA_VERSION ||
            (saved.layout?.document?.schemaVersion ?? 0) > LAYOUT_SCHEMA_VERSION) return null;
        const currentVersion = Math.max(saved.content?.version ?? 0, saved.layout?.version ?? 0);
        if (Number.isSafeInteger(currentVersion) && currentVersion !== previousVersion) return null;
        preserveUnreadable = loadWorkbench(accountScope).status === "unreadable";
      } catch {
        // 损坏原文必须先备份，用户显式保存才允许恢复可用布局。
        preserveUnreadable = true;
      }
      if (preserveUnreadable && store.getItem(`${key}:unreadable`) === null) store.setItem(`${key}:unreadable`, previous);
    }
    if (previous !== null) store.setItem(`${key}:previous`, previous);
    store.setItem(key, JSON.stringify(record));
    return version;
  } catch {
    return null;
  }
}

/** 支持 Web Locks 的浏览器按账号串行保存；锁内重读版本，避免两个标签页同时写同一版本。 */
export async function saveWorkbenchSafely(accountScope: string, documents: WorkbenchDocuments, previousVersion: number): Promise<number | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.locks !== undefined) {
      return await navigator.locks.request(workbenchStorageKey(accountScope), () => saveWorkbench(accountScope, documents, previousVersion));
    }
    return saveWorkbench(accountScope, documents, previousVersion);
  } catch {
    return null;
  }
}

export interface Stored {
  readonly accountScope: string | null;
  readonly documents: WorkbenchDocuments;
  readonly version: number;
  /** 保存过但读不出来（损坏或来自更新版本）：显示默认工作台，原记录不动。 */
  readonly unreadable: boolean;
}

/** 读取账号的工作台；没有保存过（或读不出）时给默认工作台。 */
export function readStored(accountScope: string | null): Stored {
  if (accountScope === null) return { accountScope, documents: defaultWorkbench(), version: 0, unreadable: false };
  const outcome = loadWorkbench(accountScope);
  if (outcome.status === "ok") return { accountScope, documents: outcome.documents, version: outcome.version, unreadable: false };
  return { accountScope, documents: defaultWorkbench(), version: outcome.status === "unreadable" ? outcome.version ?? 0 : 0, unreadable: outcome.status === "unreadable" };
}

/** 「恢复默认」：删掉自己的记录即可，下次读取得到默认工作台。 */
export function clearWorkbench(accountScope: string): void {
  try {
    storage()?.removeItem(workbenchStorageKey(accountScope));
    storage()?.removeItem(`${workbenchStorageKey(accountScope)}:previous`);
    storage()?.removeItem(`${workbenchStorageKey(accountScope)}:unreadable`);
  } catch {
    // 存储不可用时没有可清除的东西。
  }
}
