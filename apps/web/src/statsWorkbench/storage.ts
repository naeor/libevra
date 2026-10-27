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
  validateContentDocumentV1,
  validateLayoutDocumentV1,
  validateGeometry,
  WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
  type LayoutDocumentV1,
  type WorkbenchContentDocumentV1,
  type WorkbenchLocalRecordV1,
} from "@libellum/shared/analysis/layout";

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
  | { readonly status: "unreadable" };

/** 两份文档 + 交叉引用都合法才算合法（与 D 的命令层同一套判断）。 */
export function documentsProblems(documents: WorkbenchDocuments): readonly string[] {
  const problems: string[] = [];
  const content = validateContentDocumentV1(documents.content);
  if (!content.ok) problems.push(...content.issues.map((issue) => `${issue.path}:${issue.code}`));
  const layout = validateLayoutDocumentV1(documents.layout);
  if (!layout.ok) problems.push(...layout.issues.map((issue) => `${issue.path}:${issue.code}`));
  if (problems.length > 0) return problems;
  problems.push(
    ...validateGeometry(documents.layout.main.objects, documents.layout.main.baseCols).map(
      (issue) => `geometry:${issue.code}`,
    ),
  );
  const cards = new Set(documents.content.cards.map((card) => card.objectId));
  const containers = new Set(documents.content.containers.map((container) => container.objectId));
  for (const object of documents.layout.main.objects) {
    if (object.objectType === "analysis-card" && !cards.has(object.objectId)) problems.push(`orphan:${object.objectId}`);
    if ((object.objectType === "carousel" || object.objectType === "grid-split") && !containers.has(object.objectId)) {
      problems.push(`orphan:${object.objectId}`);
    }
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
    const documents = { content: record.content?.document, layout: record.layout?.document } as WorkbenchDocuments;
    if (documents.content === undefined || documents.layout === undefined) return { status: "unreadable" };
    if (documentsProblems(documents).length > 0) return { status: "unreadable" };
    return { status: "ok", documents, version: record.content?.version ?? 0 };
  } catch {
    return { status: "unreadable" };
  }
}

/** 保存成功返回新版本号；不合法的文档拒绝保存（返回 `null`），绝不写入半成品。 */
export function saveWorkbench(accountScope: string, documents: WorkbenchDocuments, previousVersion: number): number | null {
  if (documentsProblems(documents).length > 0) return null;
  const store = storage();
  if (store === null) return null;
  const version = previousVersion + 1;
  const record: WorkbenchLocalRecordV1 = {
    storeSchemaVersion: WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
    userId: accountScope,
    content: { version, document: documents.content },
    layout: { version, document: documents.layout },
    updatedAt: new Date().toISOString(),
    pendingSync: true,
  };
  try {
    store.setItem(workbenchStorageKey(accountScope), JSON.stringify(record));
    return version;
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
  return { accountScope, documents: defaultWorkbench(), version: 0, unreadable: outcome.status === "unreadable" };
}

/** 「恢复默认」：删掉自己的记录即可，下次读取得到默认工作台。 */
export function clearWorkbench(accountScope: string): void {
  try {
    storage()?.removeItem(workbenchStorageKey(accountScope));
  } catch {
    // 存储不可用时没有可清除的东西。
  }
}
