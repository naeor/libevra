/**
 * 工作台配置的本机保存；W6 的账号同步与冲突处理在 `sync.ts`，游客仍只在本机。
 *
 * ⚠️ **作用域 = 账号（Q-02）。** 键里带用户 ID（游客带游客身份 ID），同一台设备上换账号不会读到
 * 别人的工作台；切换账本只让卡片用新账本的数据重算，工作台本身不变。键以 `libevra.` 开头，所以
 * 「清除本机数据」会一并清掉它（`isAppDeviceStorageKey`）。
 *
 * ⚠️ **记录形状用 Agent D 的 `WorkbenchLocalRecordV1`，校验也用 D 的校验器**：保存前、读取后都过一遍。
 * 读出来的内容无法通过校验（损坏、或来自更新版本）时，**不覆盖、不删除**，界面退回默认工作台并说明；
 * 用户下次主动保存时才会写入新记录。正式保存先标记 `pendingSync`；实际同步状态由 W6 的
 * 服务端基版本与基配置决定，不能用本机的内容 / 布局版本冒充服务端并发版本。
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
import { configurationFingerprint } from "@libellum/shared/workbench/configuration";
import { isLegacyDefaultWorkspace } from "@libellum/shared/workbench/legacyDefault";
import { runLayoutPipeline } from "@libellum/shared/workbench/pipeline";

import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import { defaultWorkbench } from "./defaults.js";
import { notifyWorkbenchChange } from "./configEvents.js";

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
  // 1.18.01：列数专属布局（`profiles`）每一份也必须是合法几何（与服务器端 `parseWorkspaceDocuments` 同一要求）。
  for (const profile of documents.layout?.profiles ?? []) {
    problems.push(...validateGeometry(profile.geometry.objects, profile.geometry.baseCols).map(issue => `profile:${issue.code}`));
  }
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
    notifyWorkbenchChange(accountScope);
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

/**
 * 本机保存的工作台若与旧版系统默认「日常总览」**完全一致**（只可能来自旧版「恢复默认工作台」再点「完成」），
 * 视为「没有自定义」：原记录先备份到 `<键>:legacy-default`，再移除，界面随即显示当前系统默认（新手布局）；
 * 登录账号的同步随后把云端也对齐为「跟随系统默认」（`sync.ts` 用同一识别规则）。识别规则与服务器一次性
 * 迁移相同（`@libellum/shared/workbench/legacyDefault`）；任何一处不同的布局、损坏或来自更新版本的记录都不动。
 * 幂等：移除后再调用不会有任何动作。返回是否做了改动。
 */
export function retireLegacyDefault(accountScope: string): boolean {
  const outcome = loadWorkbench(accountScope);
  if (outcome.status !== "ok" || !isLegacyDefaultWorkspace(outcome.documents)) return false;
  const store = storage();
  if (store === null) return false;
  const key = workbenchStorageKey(accountScope);
  try {
    const raw = store.getItem(key);
    if (raw === null) return false;
    // 备份写不进去就不移除（宁可继续显示旧布局，也不丢原文）。
    store.setItem(`${key}:legacy-default`, raw);
    store.removeItem(key);
  } catch {
    return false;
  }
  // 可能在渲染期间被调用（`readStored` 是 useState 的初始值），通知放到微任务里，不在渲染中更新别的组件。
  queueMicrotask(() => notifyWorkbenchChange(accountScope));
  return true;
}

/** 文档是否与**当前**系统默认（新手布局，按当前界面语言生成）完全一致。 */
export function isSystemDefault(documents: WorkbenchDocuments): boolean {
  const fingerprint = (workspace: WorkbenchDocuments) => configurationFingerprint({ schemaVersion: 1, workspace, presets: [] });
  try {
    return fingerprint(documents) === fingerprint(defaultWorkbench());
  } catch {
    return false;
  }
}

/**
 * 「恢复默认工作台」后点「完成」：内容与当前系统默认完全一致时，**不另存一份副本**，而是删掉自己的记录
 * （= 跟随系统默认；同步时云端也变成 `workspace: null`）。以后系统默认再调整，这个账号会跟着用新的默认，
 * 不会像 1.17.23 之前那样「停在旧默认」。与 `saveWorkbench` 同样的版本保护：本机记录已被别的标签页改过、
 * 损坏或来自更新版本时不动，返回 `null`；成功返回新的版本号 0。原记录先留一份在 `<键>:previous`。
 */
export function followSystemDefault(accountScope: string, previousVersion: number): number | null {
  const store = storage();
  if (store === null) return null;
  const key = workbenchStorageKey(accountScope);
  try {
    const previous = store.getItem(key);
    if (previous !== null) {
      const saved = JSON.parse(previous) as Partial<WorkbenchLocalRecordV1>;
      if (saved.storeSchemaVersion !== WORKBENCH_LOCAL_STORE_SCHEMA_VERSION || saved.userId !== accountScope) return null;
      const currentVersion = Math.max(saved.content?.version ?? 0, saved.layout?.version ?? 0);
      if (currentVersion !== previousVersion) return null;
      store.setItem(`${key}:previous`, previous);
      store.removeItem(key);
    }
  } catch {
    return null;
  }
  notifyWorkbenchChange(accountScope);
  return 0;
}

/** 读取账号的工作台；没有保存过（或读不出）时给默认工作台。仍是旧版系统默认的记录先按上面的规则移除。 */
export function readStored(accountScope: string | null): Stored {
  if (accountScope === null) return { accountScope, documents: defaultWorkbench(), version: 0, unreadable: false };
  retireLegacyDefault(accountScope);
  const outcome = loadWorkbench(accountScope);
  if (outcome.status === "ok") return { accountScope, documents: outcome.documents, version: outcome.version, unreadable: false };
  return { accountScope, documents: defaultWorkbench(), version: outcome.status === "unreadable" ? outcome.version ?? 0 : 0, unreadable: outcome.status === "unreadable" };
}

/** 删掉自己的记录，下次读取得到默认工作台（测试与清理用；界面上的「恢复默认」只换编辑会话）。 */
export function clearWorkbench(accountScope: string): void {
  try {
    storage()?.removeItem(workbenchStorageKey(accountScope));
    storage()?.removeItem(`${workbenchStorageKey(accountScope)}:previous`);
    storage()?.removeItem(`${workbenchStorageKey(accountScope)}:unreadable`);
  } catch {
    // 存储不可用时没有可清除的东西。
  }
}
