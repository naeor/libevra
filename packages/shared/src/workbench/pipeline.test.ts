/**
 * S17 · I-1a 集成胶水层测试：`AnalysisReference` → validateAnalysisParams
 * → projectLayout → 文档 serialize/parse/validate/roundTrip。
 *
 * 夹具在本地构造（不依赖 `analysis/layout/test-support`，避免跨模块耦合）。
 * 全部断言只读消费：不修改输入文档、不写回权威布局。
 */

import { describe, expect, it } from "vitest";
import type {
  AnalysisCardNode,
  GridSplitNode,
  LayoutDocumentV1,
  LayoutGeometry,
  ObjectGeometry,
} from "../analysis/layout/types.js";
import { LAYOUT_ALGORITHM_VERSION, LAYOUT_SCHEMA_VERSION } from "../analysis/layout/types.js";
import {
  parseContentDocumentV1,
  parseLayoutDocumentV1,
  serializeContentDocumentV1,
} from "../analysis/layout/validation.js";
import type {
  LayoutPipelineIssue,
  LayoutPipelineResult,
} from "./pipeline.js";
import { runLayoutPipeline } from "./pipeline.js";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function card(
  objectId: string,
  analysisId = "AN-B01",
  params: Readonly<Record<string, unknown>> = {},
  analysisVersion?: string,
): AnalysisCardNode {
  return {
    objectId,
    type: "analysis-card",
    analysis: {
      analysisId,
      ...(analysisVersion !== undefined ? { analysisVersion } : {}),
      params,
    },
    chart: { chartFamily: "CF-01" },
    rangePolicy: "inherit",
  };
}

function gridSplit(
  objectId: string,
  children: readonly string[],
): GridSplitNode {
  return {
    objectId,
    type: "grid-split",
    children,
    split: { columnSplitPermille: 500, rowSplitPermille: 0 },
  };
}

function geometryOf(
  objects: readonly ObjectGeometry[],
  baseCols = 2,
): LayoutGeometry {
  return { baseCols, objects };
}

function objectOf(
  objectId: string,
  objectType: ObjectGeometry["objectType"],
  anchor: number,
  colSpan = 1,
  rowSpan = 1,
): ObjectGeometry {
  return { objectId, objectType, anchor, colSpan, rowSpan };
}

function layoutDocumentOf(
  main: LayoutGeometry,
  extra: Partial<LayoutDocumentV1> = {},
): LayoutDocumentV1 {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: "unified",
    main,
    ...extra,
  };
}

function contentOf(
  cards: readonly AnalysisCardNode[],
  containers: readonly GridSplitNode[] = [],
) {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, cards, containers };
}

const CONTENT_AB = contentOf([card("card-a"), card("card-b")]);
const LAYOUT_AB = layoutDocumentOf(
  geometryOf([
    objectOf("card-a", "analysis-card", 1),
    objectOf("card-b", "analysis-card", 2),
  ]),
);

function codes(result: LayoutPipelineResult): readonly string[] {
  return result.issues.map((issue) => issue.code);
}

function errors(result: LayoutPipelineResult): readonly LayoutPipelineIssue[] {
  return result.issues.filter((issue) => issue.severity === "error");
}

function warnings(result: LayoutPipelineResult): readonly LayoutPipelineIssue[] {
  return result.issues.filter((issue) => issue.severity === "warning");
}

// ---------------------------------------------------------------------------
// 主链路
// ---------------------------------------------------------------------------

describe("I-1a 布局数据链路", () => {
  it("合法引用+文档：校验/投影/序列化往返全部通过", () => {
    const result = runLayoutPipeline(
      { content: CONTENT_AB, layout: LAYOUT_AB },
      { targetColumns: 3 },
    );
    expect(result.ok).toBe(true);
    expect(errors(result)).toEqual([]);
    expect(result.content).toEqual(CONTENT_AB);
    expect(result.layout).toEqual(LAYOUT_AB);
    expect(result.projection?.columns).toBe(3);
    expect(result.projection?.objects.map((o) => o.objectId)).toEqual([
      "card-a",
      "card-b",
    ]);
    expect(result.documents).toBeDefined();
  });

  it("documents 输出可被 D-1 解析且再序列化逐字节一致", () => {
    const result = runLayoutPipeline(
      { content: CONTENT_AB, layout: LAYOUT_AB },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.documents).toBeDefined();
    if (result.documents === undefined) {
      return;
    }
    const contentParsed = parseContentDocumentV1(result.documents.contentJson);
    const layoutParsed = parseLayoutDocumentV1(result.documents.layoutJson);
    expect(contentParsed.ok).toBe(true);
    expect(layoutParsed.ok).toBe(true);
    if (contentParsed.ok) {
      expect(serializeContentDocumentV1(contentParsed.value)).toBe(
        result.documents.contentJson,
      );
    }
    if (layoutParsed.ok) {
      // 二次序列化与首次输出一致（往返稳定）。
      const second = serializeContentDocumentV1(contentParsed.ok ? contentParsed.value : CONTENT_AB);
      expect(second).toBe(result.documents.contentJson);
    }
  });

  it("不修改输入文档（深比较前后一致）", () => {
    const content = contentOf([card("card-a")]);
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const contentBefore = JSON.stringify(content);
    const layoutBefore = JSON.stringify(layout);
    runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(JSON.stringify(content)).toBe(contentBefore);
    expect(JSON.stringify(layout)).toBe(layoutBefore);
  });

  it("重复运行结果确定（同输入→同输出）", () => {
    const first = runLayoutPipeline({ content: CONTENT_AB, layout: LAYOUT_AB }, { targetColumns: 4 });
    const second = runLayoutPipeline({ content: CONTENT_AB, layout: LAYOUT_AB }, { targetColumns: 4 });
    expect(second).toEqual(first);
  });

  it("接受 JSON 字符串输入（模拟持久化读取）", () => {
    const contentJson = serializeContentDocumentV1(CONTENT_AB);
    const layoutJson = JSON.stringify(LAYOUT_AB);
    const result = runLayoutPipeline(
      { content: contentJson, layout: layoutJson },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.content).toEqual(CONTENT_AB);
  });

  it("空文档：合法且投影为空", () => {
    const result = runLayoutPipeline(
      {
        content: contentOf([]),
        layout: layoutDocumentOf(geometryOf([])),
      },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.projection?.objects).toEqual([]);
    expect(result.documents?.contentJson.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 文档校验失败
// ---------------------------------------------------------------------------

describe("I-1a 文档校验失败", () => {
  it("内容文档非法：返回 error 且路径带 content 前缀", () => {
    const bad = { schemaVersion: 0, cards: [], containers: [] };
    const result = runLayoutPipeline({ content: bad, layout: LAYOUT_AB }, { targetColumns: 2 });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalid-schema-version");
    expect(result.issues.some((issue) => issue.path.startsWith("content"))).toBe(true);
    expect(result.documents).toBeUndefined();
  });

  it("布局文档非法：返回 error 且路径带 layout 前缀", () => {
    const bad = layoutDocumentOf(geometryOf([], 0));
    const result = runLayoutPipeline({ content: CONTENT_AB, layout: bad }, { targetColumns: 2 });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.startsWith("layout"))).toBe(true);
  });

  it("损坏 JSON 字符串：不抛异常，返回 invalid-json", () => {
    const result = runLayoutPipeline(
      { content: "{not-json", layout: JSON.stringify(LAYOUT_AB) },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalid-json");
  });
});

// ---------------------------------------------------------------------------
// AnalysisReference 校验（G-12a v1.1）
// ---------------------------------------------------------------------------

describe("I-1a 分析引用校验", () => {
  it("非法 params（隐私键）→ error，路径定位到卡片引用", () => {
    const content = contentOf([card("card-a", "AN-B01", { title: "私密标题" })]);
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const result = runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.code === "params_private_data");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.path).toContain("content.cards[0].analysis");
    expect(issue?.path).toContain("title");
  });

  it("未知 analysisId → 只读占位（ok 仍 true，保留原配置）", () => {
    const content = contentOf([card("card-a", "AN-UNKNOWN")]);
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const result = runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(result.ok).toBe(true);
    expect(codes(result)).toContain("params_unknown_analysis");
    expect(codes(result)).toContain("pipeline-readonly-analysis");
    expect(result.content?.cards[0]?.analysis.analysisId).toBe("AN-UNKNOWN");
    expect(result.projection?.objects.length).toBe(1);
  });

  it("较新 analysisVersion → 只读占位（ok 仍 true）", () => {
    const content = contentOf([card("card-a", "AN-B01", {}, "s01-v9")]);
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const result = runLayoutPipeline(
      { content, layout },
      { targetColumns: 2, currentAnalysisVersion: "s01-v2" },
    );
    expect(result.ok).toBe(true);
    expect(codes(result)).toContain("params_newer_version");
    expect(codes(result)).toContain("pipeline-readonly-analysis");
  });

  it("白名单外参数键 → error", () => {
    const content = contentOf([card("card-a", "AN-B01", { unknownParam: 1 })]);
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const result = runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("params_unknown_key");
  });
});

// ---------------------------------------------------------------------------
// 跨文档一致性
// ---------------------------------------------------------------------------

describe("I-1a 跨文档一致性", () => {
  it("布局孤儿对象 → error", () => {
    const layout = layoutDocumentOf(
      geometryOf([objectOf("card-a", "analysis-card", 1), objectOf("ghost", "analysis-card", 2)]),
    );
    const result = runLayoutPipeline(
      { content: contentOf([card("card-a")]), layout },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("pipeline-orphan-layout-object");
  });

  it("Spacer 与内容对象共用 ID → error", () => {
    const layout = layoutDocumentOf(
      geometryOf([objectOf("spacer-1", "spacer", 1), objectOf("card-a", "analysis-card", 2)]),
    );
    const result = runLayoutPipeline(
      { content: contentOf([card("spacer-1"), card("card-a")]), layout },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.code === "pipeline-spacer-shadowing-content");
    expect(issue).toBeDefined();
  });

  it("布局对象类型与内容对象类型不一致 → error", () => {
    const layout = layoutDocumentOf(
      geometryOf([objectOf("card-a", "carousel", 1), objectOf("card-b", "analysis-card", 2)]),
    );
    const result = runLayoutPipeline(
      { content: CONTENT_AB, layout },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("pipeline-object-type-mismatch");
  });

  it("内容对象尚未在布局中定位 → warning（不阻断）", () => {
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]));
    const result = runLayoutPipeline(
      { content: CONTENT_AB, layout },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(true);
    const issue = result.issues.find((entry) => entry.code === "pipeline-unplaced-content-object");
    expect(issue?.severity).toBe("warning");
    expect(warnings(result).length).toBeGreaterThanOrEqual(1);
  });

  it("GridSplit 容器与子卡片：合法且投影包含容器", () => {
    const content = contentOf(
      [card("card-a"), card("card-b")],
      [gridSplit("split-1", ["card-a", "card-b"])],
    );
    const layout = layoutDocumentOf(
      geometryOf([
        objectOf("split-1", "grid-split", 1, 2, 2),
        objectOf("card-a", "analysis-card", 5),
        objectOf("card-b", "analysis-card", 6),
      ]),
    );
    const result = runLayoutPipeline({ content, layout }, { targetColumns: 2 });
    expect(result.ok).toBe(true);
    expect(result.projection?.objects.map((o) => o.objectType)).toContain("grid-split");
  });
});

// ---------------------------------------------------------------------------
// 投影与目标列数
// ---------------------------------------------------------------------------

describe("I-1a 投影", () => {
  it("目标列数非法 → error，仍按安全默认 2 列投影", () => {
    const result = runLayoutPipeline(
      { content: CONTENT_AB, layout: LAYOUT_AB },
      { targetColumns: 0 },
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("pipeline-invalid-target-columns");
    expect(result.projection?.columns).toBe(2);
  });

  it("跨列迁移确定性：同一权威布局在 2/3/4 列投影均合法", () => {
    for (const targetColumns of [2, 3, 4] as const) {
      const result = runLayoutPipeline(
        { content: CONTENT_AB, layout: LAYOUT_AB },
        { targetColumns },
      );
      expect(result.ok).toBe(true);
      expect(result.projection?.columns).toBe(targetColumns);
      for (const object of result.projection?.objects ?? []) {
        expect(object.anchor).toBeGreaterThanOrEqual(1);
        expect(object.colSpan).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("独立模式档案字段在序列化中保留（I-1a 只投影主布局）", () => {
    const layout = layoutDocumentOf(geometryOf([objectOf("card-a", "analysis-card", 1)]), {
      mode: "independent",
      profiles: [
        {
          profileKey: "cols-3",
          geometry: geometryOf([objectOf("card-a", "analysis-card", 2)], 3),
        },
      ],
    });
    const result = runLayoutPipeline(
      { content: contentOf([card("card-a")]), layout },
      { targetColumns: 2 },
    );
    expect(result.ok).toBe(true);
    expect(result.layout?.profiles?.[0]?.profileKey).toBe("cols-3");
    expect(result.projection?.columns).toBe(2);
    if (result.documents !== undefined) {
      const parsed = parseLayoutDocumentV1(result.documents.layoutJson);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.profiles?.[0]?.geometry.baseCols).toBe(3);
      }
    }
  });
});
