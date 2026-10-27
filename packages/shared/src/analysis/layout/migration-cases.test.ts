/**
 * D-3.2：跨列迁移固定案例（所有者规格 §13/§14 中的确定性示例）与退化/冲突/降级语义。
 *
 * 这些用例以「输入布局 + 目标列数 → 期望几何」的表格形式钉住迁移规则的对外行为：
 * 3→4（所有者示例：C 回填 4）、4→3（所有者示例：C 回到 6）、冲突贪心、尺寸降级、
 * 容器完整/收缩、Spacer 保留、以及“每次从权威主布局重算、无累计漂移”。
 */

import { describe, expect, it } from "vitest";
import { validateGeometry } from "./grid.js";
import { projectLayout, projectionToGeometry } from "./projection.js";
import {
  anchorsOf,
  analysisCard,
  carousel,
  contentOf,
  contract,
  contractsOf,
  geometry,
  gridSplit,
  object,
  projectedOf,
  reasonsOf,
  size,
  spacer,
} from "./test-support.js";

const CONTENT_ABC = contentOf([analysisCard("A"), analysisCard("B"), analysisCard("C")]);

function project(
  layoutObjects: ReturnType<typeof object>[],
  baseCols: number,
  targetColumns: number,
) {
  const layout = geometry(baseCols, layoutObjects);
  return projectLayout(layout, CONTENT_ABC, { targetColumns });
}

describe("migration-cases：所有者固定示例", () => {
  it("3 列 → 4 列：A@1(2×2)、B@3、C@6 → C 回填 4", () => {
    const result = project(
      [
        object("A", "analysis-card", 1, 2, 2),
        object("B", "analysis-card", 3, 1, 1),
        object("C", "analysis-card", 6, 1, 1),
      ],
      3,
      4,
    );
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 4 });
    expect(projectedOf(result, "A")).toMatchObject({ colSpan: 2, rowSpan: 2, form: "full" });
    expect(validateGeometry(projectionToGeometry(result).objects, 4)).toEqual([]);
  });

  it("4 列 → 3 列：A@1(2×2)、B@3、C@4 → C 回填 6", () => {
    const result = project(
      [
        object("A", "analysis-card", 1, 2, 2),
        object("B", "analysis-card", 3, 1, 1),
        object("C", "analysis-card", 4, 1, 1),
      ],
      4,
      3,
    );
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 6 });
    expect(validateGeometry(projectionToGeometry(result).objects, 3)).toEqual([]);
  });

  it("3 列 → 2 列：A 保持 2×2，B 与 C 顺延到最早合法空位", () => {
    const result = project(
      [
        object("A", "analysis-card", 1, 2, 2),
        object("B", "analysis-card", 3, 1, 1),
        object("C", "analysis-card", 6, 1, 1),
      ],
      3,
      2,
    );
    expect(anchorsOf(result)).toEqual({ A: 1, B: 5, C: 6 });
  });
});

describe("migration-cases：冲突与退化", () => {
  it("同锚点冲突按单遍贪心依次后移（a@1,b@1,c@2 → a1,b2,c3）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b"), analysisCard("c")]);
    const layout = geometry(3, [
      object("a", "analysis-card", 1, 1, 1),
      object("b", "analysis-card", 1, 1, 1),
      object("c", "analysis-card", 2, 1, 1),
    ]);
    const result = projectLayout(layout, content, { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ a: 1, b: 2, c: 3 });
    expect(reasonsOf(result, "b")).toContain("anchor-occupied");
    expect(reasonsOf(result, "c")).toContain("anchor-occupied");
  });

  it("非法锚点视为未定位排最后（sourceAnchor=null + source-invalid）", () => {
    const result = project(
      [
        object("A", "analysis-card", 0, 1, 1),
        object("B", "analysis-card", 2, 1, 1),
      ],
      3,
      3,
    );
    expect(projectedOf(result, "A").sourceAnchor).toBeNull();
    expect(reasonsOf(result, "A")).toContain("source-invalid");
    // 非法锚点对象排到最后处理，因此拿到最早合法空位（B 仍在原锚点 2）。
    expect(anchorsOf(result)).toEqual({ B: 2, A: 1 });
  });

  it("行跨超限被夹到 8 并登记 size-clamped", () => {
    const layout = geometry(3, [object("A", "analysis-card", 1, 1, 99)]);
    const result = projectLayout(layout, contentOf([analysisCard("A")]), { targetColumns: 3 });
    expect(projectedOf(result, "A").rowSpan).toBe(8);
    expect(reasonsOf(result, "A")).toContain("size-clamped");
  });

  it("卡片对象数组顺序无关（打乱对象数组不改变投影几何）", () => {
    const objects = [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 6, 1, 1),
    ];
    const forward = project([...objects], 3, 4);
    const reversed = project([...objects].reverse(), 3, 4);
    expect(anchorsOf(reversed)).toEqual(anchorsOf(forward));
  });
});

describe("migration-cases：尺寸降级与容器/Spacer", () => {
  it("宽度不足：有 ladder → compact(width-overflow)，无 ladder → compat 1×1", () => {
    const cards = contentOf([analysisCard("W")]);
    const layout = geometry(3, [object("W", "analysis-card", 1, 3, 1)]);

    const compact = projectLayout(layout, cards, {
      targetColumns: 2,
      contracts: contractsOf(contract("W", { sizeLadder: [size(2, 1)] })),
    });
    expect(projectedOf(compact, "W")).toMatchObject({ colSpan: 2, rowSpan: 1, form: "compact" });
    expect(reasonsOf(compact, "W")).toContain("width-overflow");

    const compat = projectLayout(layout, cards, { targetColumns: 2 });
    expect(projectedOf(compat, "W")).toMatchObject({ colSpan: 1, rowSpan: 1, form: "compat" });
    expect(reasonsOf(compat, "W")).toContain("missing-contract");
  });

  it("容器：放得下保持完整，目标列数不足 minFullCols 时收缩为 1×1", () => {
    const content = contentOf(
      [analysisCard("a"), analysisCard("b")],
      [gridSplit("G", ["a", "b"])],
    );
    const layout = geometry(4, [object("G", "grid-split", 1, 2, 2)]);
    const contracts = contractsOf(contract("G", { minFullCols: 2 }));

    const full = projectLayout(layout, content, { targetColumns: 3, contracts });
    expect(projectedOf(full, "G")).toMatchObject({ colSpan: 2, rowSpan: 2, form: "full" });
    expect(full.issues).toEqual([]);

    const collapsed = projectLayout(layout, content, { targetColumns: 1, contracts });
    expect(projectedOf(collapsed, "G")).toMatchObject({ colSpan: 1, rowSpan: 1, form: "collapsed" });
    expect(reasonsOf(collapsed, "G")).toContain("container-narrow");
  });

  it("Carousel 容器同样保持完整/收缩语义", () => {
    const content = contentOf(
      [analysisCard("a"), analysisCard("b")],
      [carousel("Q", ["a", "b"])],
    );
    const layout = geometry(4, [object("Q", "carousel", 1, 2, 1)]);
    const full = projectLayout(layout, content, { targetColumns: 4 });
    expect(projectedOf(full, "Q")).toMatchObject({ colSpan: 2, rowSpan: 1, form: "full" });
  });

  it("Spacer 保留位置存在性；宽超限时夹宽且不当普通空格删除", () => {
    const content = contentOf([analysisCard("A")]);
    const layout = geometry(3, [
      object("A", "analysis-card", 1, 1, 1),
      object("S1", "spacer", 2, 3, 1),
    ]);
    const result = projectLayout(layout, content, { targetColumns: 2 });
    expect(projectedOf(result, "S1")).toMatchObject({ colSpan: 2, rowSpan: 1, form: "full" });
    expect(reasonsOf(result, "S1")).toContain("width-overflow");
  });
});

describe("migration-cases：无累计漂移", () => {
  it("同一权威主布局对多目标列数重复投影结果稳定，且不修改输入布局", () => {
    const layout = geometry(4, [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 4, 1, 1),
    ]);
    const before = JSON.stringify(layout);

    const targets = [2, 3, 4, 5, 6, 12];
    for (const target of targets) {
      const first = projectLayout(layout, CONTENT_ABC, { targetColumns: target });
      const second = projectLayout(layout, CONTENT_ABC, { targetColumns: target });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(validateGeometry(projectionToGeometry(first).objects, target)).toEqual([]);
    }
    expect(JSON.stringify(layout)).toBe(before);
  });
});
