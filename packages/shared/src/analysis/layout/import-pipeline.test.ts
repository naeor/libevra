/**
 * D-4 前置：分享快照导入端到端纯函数管道测试。
 *
 * 覆盖：ID 重生成与容器子引用重写、待绑定占位、未知图表家族提示、
 * 非法/超限输入拒绝、Spacer 保留、预览 dry-run、目标列数校验。
 * 边界：不写存储、不改当前布局、不做权限/隐私判断。
 */

import { describe, expect, it } from "vitest";
import type { ShareSnapshotV1 } from "./share-snapshot.js";
import { buildShareSnapshot, exportShareSnapshot } from "./share-snapshot.js";
import type { ImportObjectIdFactory } from "./import-pipeline.js";
import { isWithinImportLimits, prepareShareImport } from "./import-pipeline.js";
import { analysisCard, contentOf, geometry, gridSplit, layoutOf, object } from "./test-support.js";

const CONTENT = contentOf([analysisCard("a"), analysisCard("b")], [gridSplit("g", ["a", "b"])]);

const LAYOUT = layoutOf(
  geometry(2, [
    object("g", "grid-split", 1, 2, 2),
    object("a", "analysis-card", 3, 1, 1),
    object("b", "analysis-card", 4, 1, 1),
  ]),
);

function newFactory(): ImportObjectIdFactory {
  let counter = 0;
  return (kind) => {
    counter += 1;
    return `${kind}-${String(counter)}`;
  };
}

function exportedJson(): string {
  const exported = exportShareSnapshot(CONTENT, LAYOUT);
  expect(exported.ok).toBe(true);
  return exported.json ?? "";
}

describe("import-pipeline：正常导入（ID 重生成 + 引用重写）", () => {
  it("全量重生成 ID，容器 children 与布局几何同步改写", () => {
    const result = prepareShareImport(exportedJson(), { generateObjectId: newFactory(), targetColumns: 2 });
    expect(result.ok).toBe(true);
    expect(result.content?.cards.map((card) => card.objectId)).toEqual(["analysis-card-1", "analysis-card-2"]);
    const container = result.content?.containers[0];
    expect(container?.type).toBe("grid-split");
    expect(container?.children).toEqual(["analysis-card-1", "analysis-card-2"]);
    expect(result.layout?.main.objects.map((item) => item.objectId)).toEqual([
      "grid-split-3",
      "analysis-card-1",
      "analysis-card-2",
    ]);
  });

  it("导入不修改输入快照，且未产生 repaired/orphan 问题", () => {
    const json = exportedJson();
    const parsed = JSON.parse(json) as ShareSnapshotV1;
    const before = JSON.stringify(parsed);
    const result = prepareShareImport(json, { generateObjectId: newFactory() });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(parsed)).toBe(before);
    const codes = result.issues.map((item) => item.code);
    expect(codes).not.toContain("orphan-layout-object");
    expect(codes.some((code) => code.startsWith("repaired-"))).toBe(false);
  });

  it("独立模式档案与 Spacer 一并导入并重生成 ID", () => {
    const withSpacer = layoutOf(
      geometry(2, [
        object("g", "grid-split", 1, 2, 2),
        object("a", "analysis-card", 3, 1, 1),
        object("b", "analysis-card", 4, 1, 1),
        object("s", "spacer", 5, 1, 1),
      ]),
      {
        mode: "independent",
        profiles: [{ profileKey: "cols-2", geometry: geometry(2, [object("a", "analysis-card", 1, 1, 1)]) }],
      },
    );
    const exported = exportShareSnapshot(CONTENT, withSpacer);
    const result = prepareShareImport(exported.json ?? "", { generateObjectId: newFactory(), targetColumns: 2 });
    expect(result.ok).toBe(true);
    const spacer = result.layout?.main.objects.find((item) => item.objectType === "spacer");
    expect(spacer?.objectId).toBe("spacer-4");
    expect(result.layout?.profiles?.map((profile) => profile.profileKey)).toEqual(["cols-2"]);
    expect(result.preview?.spacers).toBe(1);
  });
});

describe("import-pipeline：待绑定占位与提示（Q-15）", () => {
  it("分析引用无法解析 → 登记待绑定，不删卡片、不失败", () => {
    const result = prepareShareImport(exportedJson(), {
      generateObjectId: newFactory(),
      resolveAnalysis: () => "unknown",
    });
    expect(result.ok).toBe(true);
    expect(result.rebindRequests).toHaveLength(2);
    expect(result.rebindRequests[0]?.analysisId).toBe("an-b01");
    expect(result.issues.map((item) => item.code)).toContain("analysis-needs-rebind");
  });

  it("分析引用可解析 → 无待绑定", () => {
    const result = prepareShareImport(exportedJson(), {
      generateObjectId: newFactory(),
      resolveAnalysis: () => "known",
    });
    expect(result.ok).toBe(true);
    expect(result.rebindRequests).toEqual([]);
    expect(result.issues.map((item) => item.code)).not.toContain("analysis-needs-rebind");
  });

  it("未知图表家族只提示（降级交给投影），不阻断导入", () => {
    const result = prepareShareImport(exportedJson(), {
      generateObjectId: newFactory(),
      knownChartFamilies: ["cf-99"],
    });
    expect(result.ok).toBe(true);
    expect(result.issues.map((item) => item.code)).toContain("unknown-chart-family");
  });
});

describe("import-pipeline：G-12b 未知/较新分析定义版本（只读占位）", () => {
  const VERSIONED_CONTENT = contentOf([
    {
      ...analysisCard("a"),
      analysis: { analysisId: "an-b01", analysisVersion: "s01-v2", params: {} },
    },
    analysisCard("b"),
  ]);
  const VERSIONED_LAYOUT = layoutOf(
    geometry(2, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 2, 1, 1),
    ]),
  );

  function versionedJson(): string {
    const exported = exportShareSnapshot(VERSIONED_CONTENT, VERSIONED_LAYOUT);
    expect(exported.ok).toBe(true);
    return exported.json ?? "";
  }

  it("较新版本 → 只读占位提示，保留引用与参数、不自动改版本", () => {
    const result = prepareShareImport(versionedJson(), {
      generateObjectId: newFactory(),
      resolveAnalysisVersion: (reference) =>
        reference.analysisVersion === undefined ? "current" : "newer",
    });
    expect(result.ok).toBe(true);
    const readonlyIssues = result.issues.filter((item) => item.code === "analysis-version-readonly");
    expect(readonlyIssues).toHaveLength(1);
    expect(readonlyIssues[0]?.detail).toContain("较新");
    const card = result.content?.cards.find((item) => item.analysis.analysisId === "an-b01");
    expect(card?.analysis.analysisVersion).toBe("s01-v2");
    expect(card?.analysis.params).toEqual({});
  });

  it("未知版本 → 只读占位提示（未知文案）", () => {
    const result = prepareShareImport(versionedJson(), {
      generateObjectId: newFactory(),
      resolveAnalysisVersion: () => "unknown",
    });
    expect(result.ok).toBe(true);
    const readonlyIssues = result.issues.filter((item) => item.code === "analysis-version-readonly");
    expect(readonlyIssues).toHaveLength(2);
    expect(readonlyIssues[0]?.detail).toContain("未知");
  });

  it("全部 current → 无只读占位问题；不传解析器 → 向后兼容无该问题", () => {
    const current = prepareShareImport(versionedJson(), {
      generateObjectId: newFactory(),
      resolveAnalysisVersion: () => "current",
    });
    expect(current.ok).toBe(true);
    expect(current.issues.map((item) => item.code)).not.toContain("analysis-version-readonly");

    const legacy = prepareShareImport(versionedJson(), { generateObjectId: newFactory() });
    expect(legacy.ok).toBe(true);
    expect(legacy.issues.map((item) => item.code)).not.toContain("analysis-version-readonly");
  });
});

describe("import-pipeline：非法输入与边界", () => {
  it("ID 工厂返回重复 ID → 拒绝", () => {
    const result = prepareShareImport(exportedJson(), { generateObjectId: () => "dup" });
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain("duplicate-object-id");
  });

  it("ID 工厂返回空 ID → 拒绝", () => {
    const result = prepareShareImport(exportedJson(), { generateObjectId: () => "   " });
    expect(result.ok).toBe(false);
    expect(result.issues.map((item) => item.code)).toContain("invalid-generated-id");
  });

  it("非法 JSON 与超限 payload 被拒绝", () => {
    const invalid = prepareShareImport("{ not json", { generateObjectId: newFactory() });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues.map((item) => item.code)).toContain("invalid-json");

    const tooLarge = prepareShareImport("x".repeat(64 * 1024 + 1), { generateObjectId: newFactory() });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.issues.map((item) => item.code)).toContain("payload-too-large");
  });

  it("非法预览列数 → 记录 invalid-columns，预览无目标列数", () => {
    const result = prepareShareImport(exportedJson(), { generateObjectId: newFactory(), targetColumns: 0 });
    expect(result.ok).toBe(true);
    expect(result.issues.map((item) => item.code)).toContain("invalid-columns");
    const preview = result.preview;
    expect(preview?.targetColumns).toBeNull();
    expect(preview?.projectionIssueCount).toBe(0);
  });

  it("dry-run 投影：窄列数下对象集合不变，硬问题数为 0（降级原因不在 issues 中）", () => {
    const result = prepareShareImport(exportedJson(), { generateObjectId: newFactory(), targetColumns: 1 });
    expect(result.ok).toBe(true);
    expect(result.preview?.cards).toBe(2);
    expect(result.preview?.containers).toBe(1);
    expect(result.preview?.targetColumns).toBe(1);
    // 投影的降级原因（container-narrow/width-overflow 等）记在对象 degradedReasons 上，
    // issues 只含硬问题（孤儿/无法放置/不变量失败），dirty 快照导入此处应为 0。
    expect(result.preview?.projectionIssueCount).toBe(0);
  });
});

describe("import-pipeline：对象数量上限", () => {
  it("合法快照在上限内", () => {
    const snapshot = buildShareSnapshot(CONTENT, LAYOUT);
    expect(isWithinImportLimits(snapshot)).toBe(true);
  });

  it("超过工作台对象上限 → false（快速拒绝）", () => {
    const snapshot = buildShareSnapshot(CONTENT, LAYOUT);
    const oversized = {
      ...snapshot,
      cards: Array.from({ length: 41 }, (_, index) => ({
        ...snapshot.cards[0],
        objectId: `bulk-${String(index)}`,
      })),
    } as unknown as ShareSnapshotV1;
    expect(isWithinImportLimits(oversized)).toBe(false);
  });
});
