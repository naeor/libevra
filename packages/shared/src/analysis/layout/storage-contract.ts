/**
 * D-4 前置：本地优先（local-first）存储契约草案 —— **接口占位**。
 *
 * 边界（Lead 批准范围 D-4-⑤）：
 * - 本文件只定义**写什么/何时写/冲突合并的接口与纯函数规则**；
 * - 不实现 IndexedDB/localStorage、不做服务端同步、不加迁移/接口/路由；
 * - 服务端同步只登记契约（W6 需单独评审、备份并经所有者批准）；
 * - 不记录任何账务数据/计算结果/他人信息：只存内容文档与布局文档（含 Spacer）。
 *
 * 口径来源：`S17-工作台个人配置与布局分享-方案草案.md` §3–§5
 * （本地缓存+离线队列、服务端权威、内容/布局文档分开带 version、
 * 布局文档整体替换并保留上一个布局、内容文档按 objectId 合并）。
 */

import type {
  AnalysisCardNode,
  ContainerNode,
  LayoutDocumentV1,
  WorkbenchContentDocumentV1,
} from "./types.js";
import type { DocumentValidationIssue } from "./validation.js";
import { validateContentDocumentV1, validateLayoutDocumentV1 } from "./validation.js";

/** 本地记录结构版本（与服务端同步 schema 一起演进；不等于工作台文档 schemaVersion）。 */
export const WORKBENCH_LOCAL_STORE_SCHEMA_VERSION = 1;

/** 带版本号的一份文档：`version` 由服务端权威分配或本地离线队列递增。 */
export interface VersionedDocument<T> {
  readonly version: number;
  readonly document: T;
}

/**
 * 本地记录（一个账号一份，键含 userId；**不含**综合折算/主题/语言等设备级设置）。
 * `updatedAt` 由调用方提供（本层纯函数不读时钟）。
 */
export interface WorkbenchLocalRecordV1 {
  readonly storeSchemaVersion: number;
  readonly userId: string;
  readonly content: VersionedDocument<WorkbenchContentDocumentV1>;
  readonly layout: VersionedDocument<LayoutDocumentV1>;
  /** ISO 时间字符串，仅作展示/排序提示；权威顺序以 version 为准。 */
  readonly updatedAt: string;
  readonly pendingSync: boolean;
}

/** 空记录：新账号首次进入时创建（默认工作台由上层投影生成，不写入权威内容）。 */
export function createEmptyLocalRecord(
  userId: string,
  updatedAt: string,
): WorkbenchLocalRecordV1 {
  return {
    storeSchemaVersion: WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
    userId,
    content: {
      version: 0,
      document: { schemaVersion: 1, cards: [], containers: [] },
    },
    layout: {
      version: 0,
      document: {
        schemaVersion: 1,
        layoutAlgorithmVersion: 1,
        mode: "unified",
        main: { baseCols: 2, objects: [] },
      },
    },
    updatedAt,
    pendingSync: false,
  };
}

/** 合并冲突：保留胜方值，同时把败方值交给调用方另存为“上一个版本/副本”。 */
export interface DocumentMergeConflict {
  readonly objectId: string;
  /** 合并后保留的一方（内容文档合并按 version 高者胜，平局 server/remote 胜）。 */
  readonly kept: "local" | "remote";
  /** 败方对象，供上层保存为可恢复副本（不写回权威文档）。 */
  readonly alternative: AnalysisCardNode | ContainerNode;
}

export interface LayoutMergeResult {
  readonly ok: boolean;
  readonly document?: LayoutDocumentV1;
  /** 合并后的权威版本号（取胜方版本）。 */
  readonly version: number;
  /** true = 用败方主布局生成了 `previousMain`（可恢复“上一个布局”）。 */
  readonly usedPreviousLayout: boolean;
  readonly issues: readonly DocumentValidationIssue[];
}

export interface ContentMergeResult {
  readonly ok: boolean;
  readonly document?: WorkbenchContentDocumentV1;
  readonly version: number;
  readonly conflicts: readonly DocumentMergeConflict[];
  readonly issues: readonly DocumentValidationIssue[];
}

function issue(path: string, code: string, detail: string): DocumentValidationIssue {
  return { path, code, detail };
}

function jsonOf(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 布局文档合并：**整体替换**（不试图合并几何），保留败方主布局为 `previousMain`。
 * - 版本高者胜；平局时 remote（服务端权威）胜；
 * - 败方版本更旧但内容不同 → 必留 `previousMain`（OQ-CF-03 保留数量待决）；
 * - 合并结果必须通过 D-1 严格校验，否则 ok=false（上层回退并保留原副本）。
 */
export function mergeLayoutDocuments(
  local: VersionedDocument<LayoutDocumentV1>,
  remote: VersionedDocument<LayoutDocumentV1>,
): LayoutMergeResult {
  const winnerIsRemote = remote.version >= local.version;
  const winner = winnerIsRemote ? remote : local;
  const loser = winnerIsRemote ? local : remote;
  const changed = jsonOf(winner.document) !== jsonOf(loser.document);
  const merged: LayoutDocumentV1 = changed
    ? { ...winner.document, previousMain: loser.document.main }
    : winner.document;
  const validated = validateLayoutDocumentV1(merged);
  if (!validated.ok) {
    return { ok: false, version: winner.version, usedPreviousLayout: false, issues: validated.issues };
  }
  return {
    ok: true,
    document: validated.value,
    version: winner.version,
    usedPreviousLayout: changed,
    issues: [],
  };
}

interface ContentEntry {
  readonly card: AnalysisCardNode | undefined;
  readonly container: ContainerNode | undefined;
}

function indexContent(document: WorkbenchContentDocumentV1): Map<string, ContentEntry> {
  const index = new Map<string, ContentEntry>();
  for (const card of document.cards) {
    index.set(card.objectId, { card, container: undefined });
  }
  for (const container of document.containers) {
    index.set(container.objectId, { card: undefined, container });
  }
  return index;
}

function entryNode(entry: ContentEntry): AnalysisCardNode | ContainerNode | undefined {
  return entry.card ?? entry.container;
}

/**
 * 内容文档合并（首版保守规则，OQ-CF-01 合并粒度待研究）：
 * - 两侧都有的对象：JSON 相同保留；不同则由 version 高者胜（平局 remote 胜），败方进 conflicts；
 * - 只有一侧存在的对象：**并入保留**（新增并集；删除判定需要 base 版本，待 OQ-CF-01，
 *   在 base 粒度确定前不做静默删除，避免丢用户卡片/容器）；
 * - 容器树、objectId、Spacer 语义不在此改写：合并结果必须通过 D-1 校验。
 */
export function mergeContentDocuments(
  local: VersionedDocument<WorkbenchContentDocumentV1>,
  remote: VersionedDocument<WorkbenchContentDocumentV1>,
): ContentMergeResult {
  const remoteWinsTie = true;
  const remoteNewer = remote.version >= local.version;
  const localIndex = indexContent(local.document);
  const remoteIndex = indexContent(remote.document);
  const conflicts: DocumentMergeConflict[] = [];
  const issues: DocumentValidationIssue[] = [];

  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of [...localIndex.keys(), ...remoteIndex.keys()]) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }

  const cards: AnalysisCardNode[] = [];
  const containers: ContainerNode[] = [];
  for (const objectId of order) {
    const localEntry = localIndex.get(objectId);
    const remoteEntry = remoteIndex.get(objectId);
    const localNode = localEntry === undefined ? undefined : entryNode(localEntry);
    const remoteNode = remoteEntry === undefined ? undefined : entryNode(remoteEntry);
    if (localNode === undefined || remoteNode === undefined) {
      const keptNode = localNode ?? remoteNode;
      if (keptNode !== undefined) {
        if (!reflectNode(keptNode, cards, containers)) {
          issues.push(issue("$.cards", "invalid-card", `对象类型无法归入卡片/容器：${objectId}`));
        }
      }
      continue;
    }
    if (jsonOf(localNode) === jsonOf(remoteNode)) {
      if (!reflectNode(localNode, cards, containers)) {
        issues.push(issue("$.cards", "invalid-card", `对象类型无法归入卡片/容器：${objectId}`));
      }
      continue;
    }
    const keepRemote = remoteNewer || !remoteWinsTie;
    const keptNode = keepRemote ? remoteNode : localNode;
    const loserNode = keepRemote ? localNode : remoteNode;
    conflicts.push({ objectId, kept: keepRemote ? "remote" : "local", alternative: loserNode });
    if (!reflectNode(keptNode, cards, containers)) {
      issues.push(issue("$.cards", "invalid-card", `对象类型无法归入卡片/容器：${objectId}`));
    }
  }

  const merged: WorkbenchContentDocumentV1 = {
    schemaVersion: Math.max(
      local.document.schemaVersion,
      remote.document.schemaVersion,
    ),
    cards,
    containers,
  };
  const validated = validateContentDocumentV1(merged);
  if (!validated.ok) {
    return {
      ok: false,
      version: Math.max(local.version, remote.version),
      conflicts,
      issues: [...issues, ...validated.issues],
    };
  }
  return {
    ok: true,
    document: validated.value,
    version: Math.max(local.version, remote.version),
    conflicts,
    issues,
  };
}

function reflectNode(
  node: AnalysisCardNode | ContainerNode,
  cards: AnalysisCardNode[],
  containers: ContainerNode[],
): boolean {
  if ("type" in node && node.type === "analysis-card") {
    cards.push(node);
    return true;
  }
  if ("type" in node && (node.type === "grid-split" || node.type === "carousel")) {
    containers.push(node);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 服务端同步契约（占位，不实现；W6 需迁移/评审/备份与所有者批准）
// ---------------------------------------------------------------------------

export interface SyncPushResult {
  readonly ok: boolean;
  /** 服务端分配的新权威版本号；失败时缺省。 */
  readonly version?: number;
  readonly issues?: readonly DocumentValidationIssue[];
}

export interface SyncPullResult {
  readonly ok: boolean;
  readonly record?: WorkbenchLocalRecordV1;
  readonly issues?: readonly DocumentValidationIssue[];
}

/** 同步传输契约占位：只声明签名，不提供实现（W6 实现前不得接入生产）。 */
export interface WorkbenchSyncTransport {
  push(userId: string, record: WorkbenchLocalRecordV1): Promise<SyncPushResult>;
  pull(userId: string): Promise<SyncPullResult>;
}

/** 本地存储读写契约占位：实现方负责 IndexedDB/localStorage 与清理键登记。 */
export interface WorkbenchLocalStore {
  read(userId: string): Promise<WorkbenchLocalRecordV1 | null>;
  write(record: WorkbenchLocalRecordV1): Promise<void>;
  clear(userId: string): Promise<void>;
}
