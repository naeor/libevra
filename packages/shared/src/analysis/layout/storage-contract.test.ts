/**
 * D-4 前置：本地优先存储契约（接口占位）与冲突合并纯函数测试。
 *
 * 边界：不实现 IndexedDB/localStorage、不做服务端同步；只验证合并规则与记录结构。
 */

import { describe, expect, it } from "vitest";
import type { LayoutDocumentV1, WorkbenchContentDocumentV1 } from "./types.js";
import type { VersionedDocument } from "./storage-contract.js";
import {
  WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
  createEmptyLocalRecord,
  mergeContentDocuments,
  mergeLayoutDocuments,
} from "./storage-contract.js";
import { analysisCard, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";

function contentVersion(
  version: number,
  cards: WorkbenchContentDocumentV1["cards"],
  containers: WorkbenchContentDocumentV1["containers"] = [],
): VersionedDocument<WorkbenchContentDocumentV1> {
  return { version, document: contentOf(cards, containers) };
}

function layoutVersion(version: number, baseCols: number, anchor: number): VersionedDocument<LayoutDocumentV1> {
  return {
    version,
    document: layoutOf(geometry(baseCols, [object("a", "analysis-card", anchor, 1, 1)])),
  };
}

describe("storage-contract：本地记录结构", () => {
  it("空记录只含内容/布局文档，不含设备级偏好与账务数据", () => {
    const record = createEmptyLocalRecord("user-1", "2026-10-27T00:00:00.000Z");
    expect(record.storeSchemaVersion).toBe(WORKBENCH_LOCAL_STORE_SCHEMA_VERSION);
    expect(record.userId).toBe("user-1");
    expect(record.updatedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(record.pendingSync).toBe(false);
    expect(record.content.version).toBe(0);
    expect(record.content.document).toEqual({ schemaVersion: 1, cards: [], containers: [] });
    expect(record.layout.version).toBe(0);
    expect(record.layout.document.mode).toBe("unified");
    expect(record.layout.document.main).toEqual({ baseCols: 2, objects: [] });
    expect("fxMode" in record).toBe(false);
    expect("theme" in record).toBe(false);
  });
});

describe("storage-contract：布局文档整体替换合并", () => {
  it("远端版本更高 → 远端胜，本地主布局保留为 previousMain", () => {
    const local = layoutVersion(1, 2, 1);
    const remote = layoutVersion(2, 2, 2);
    const result = mergeLayoutDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(2);
    expect(result.usedPreviousLayout).toBe(true);
    expect(result.document?.main).toEqual(remote.document.main);
    expect(result.document?.previousMain).toEqual(local.document.main);
  });

  it("本地版本更高 → 本地胜，远端主布局保留为 previousMain", () => {
    const local = layoutVersion(3, 2, 2);
    const remote = layoutVersion(2, 2, 1);
    const result = mergeLayoutDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(3);
    expect(result.document?.main).toEqual(local.document.main);
    expect(result.document?.previousMain).toEqual(remote.document.main);
  });

  it("内容相同（仅版本不同）→ 不写 previousMain", () => {
    const local = layoutVersion(1, 2, 1);
    const remote = layoutVersion(2, 2, 1);
    const result = mergeLayoutDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(2);
    expect(result.usedPreviousLayout).toBe(false);
    expect("previousMain" in (result.document ?? {})).toBe(false);
  });

  it("合并结果不合法 → ok=false，交给上层回退并保留副本", () => {
    const broken = {
      version: 9,
      document: { schemaVersion: 1, layoutAlgorithmVersion: 1, mode: "unified", main: { baseCols: 0, objects: [] } },
    } as unknown as VersionedDocument<LayoutDocumentV1>;
    const result = mergeLayoutDocuments(broken, layoutVersion(2, 2, 1));
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("storage-contract：内容文档按 objectId 合并", () => {
  const cardA = analysisCard("a");
  const cardB = analysisCard("b");
  const container = gridSplit("g", ["a", "b"]);

  it("双方都改同一对象 → 版本高者胜，败方进入 conflicts", () => {
    const local = contentVersion(2, [cardA, cardB], [container]);
    const remote = contentVersion(1, [{ ...cardA, title: { kind: "preset" } }, cardB], [container]);
    const result = mergeContentDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(2);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.objectId).toBe("a");
    expect(result.conflicts[0]?.kept).toBe("local");
    expect(result.document?.cards.find((card) => card.objectId === "a")?.title).toBeUndefined();
  });

  it("远端更新 → 远端胜，冲突里保留本地旧值", () => {
    const local = contentVersion(1, [cardA, cardB], [container]);
    const remote = contentVersion(2, [{ ...cardA, title: { kind: "preset" } }, cardB], [container]);
    const result = mergeContentDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.conflicts[0]?.kept).toBe("remote");
    expect(result.document?.cards.find((card) => card.objectId === "a")?.title).toEqual({ kind: "preset" });
  });

  it("单侧新增对象保守并入（删除判定待 OQ-CF-01 base 粒度）", () => {
    const local = contentVersion(1, [cardA, cardB], [container]);
    const remote = contentVersion(2, [cardA, cardB, analysisCard("c")], [container]);
    const result = mergeContentDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.document?.cards.map((card) => card.objectId)).toEqual(["a", "b", "c"]);
    expect(result.conflicts).toEqual([]);
  });

  it("完全相同时无冲突且结果不变", () => {
    const local = contentVersion(1, [cardA, cardB], [container]);
    const remote = contentVersion(5, [cardA, cardB], [container]);
    const result = mergeContentDocuments(local, remote);
    expect(result.ok).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.document).toEqual(local.document);
    expect(result.version).toBe(5);
  });
});
