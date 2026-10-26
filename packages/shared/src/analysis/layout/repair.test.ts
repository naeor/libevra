/**
 * D-3 确定性修复（导入/损坏数据路径）：
 * 固定修复顺序、幂等、不修改输入、不写回权威布局；
 * 修复后的几何与直接投影原始几何结果等价。
 */

import { describe, expect, it } from "vitest";
import { GEOMETRY_REPAIR_ORDER, repairLayoutGeometry } from "./repair.js";
import { projectLayout } from "./projection.js";
import {
  analysisCard,
  contentOf,
  geometry,
  object,
} from "./test-support.js";
import type { LayoutGeometry } from "./types.js";

const CONTENT = contentOf([analysisCard("a"), analysisCard("b")]);

describe("修复顺序按 GEOMETRY_REPAIR_ORDER 且确定性", () => {
  it("导出顺序即文档承诺顺序", () => {
    expect(GEOMETRY_REPAIR_ORDER).toEqual([
      "invalid-columns",
      "duplicate-object-id",
      "invalid-anchor",
      "invalid-size",
      "row-span-too-large",
    ]);
  });

  it("同一对象的多项修复按 invalid-anchor → invalid-size → row-span-too-large 排列", () => {
    const result = repairLayoutGeometry(
      geometry(3, [object("a", "analysis-card", 0, 0, 99)]),
    );
    expect(result.repairs.map((repair) => repair.code)).toEqual([
      "invalid-anchor",
      "invalid-size",
      "row-span-too-large",
    ]);
  });

  it("非法 baseCols 最先修复为 2 列，并记 invalid-columns", () => {
    const result = repairLayoutGeometry({ baseCols: 0, objects: [] });
    expect(result.geometry.baseCols).toBe(2);
    expect(result.repairs.map((repair) => repair.code)).toEqual(["invalid-columns"]);
  });

  it("修复结果与输入相同则无修复记录", () => {
    const layout = geometry(2, [object("a", "analysis-card", 1, 1, 1)]);
    const result = repairLayoutGeometry(layout);
    expect(result.repairs).toEqual([]);
    expect(result.geometry).toEqual(layout);
  });
});

describe("各项修复的确定性口径", () => {
  it("重复 objectId 只保留首次出现，其余丢弃并逐条记录", () => {
    const layout = geometry(2, [
      object("a", "analysis-card", 1, 1, 1),
      object("a", "analysis-card", 5, 1, 1),
      object("a", "analysis-card", 7, 1, 1),
    ]);
    const result = repairLayoutGeometry(layout);
    expect(result.geometry.objects).toEqual([object("a", "analysis-card", 1, 1, 1)]);
    expect(result.repairs.map((repair) => repair.code)).toEqual([
      "duplicate-object-id",
      "duplicate-object-id",
    ]);
  });

  it("非正锚点置 0（未定位），由投影重新补位", () => {
    const result = repairLayoutGeometry(geometry(2, [object("b", "analysis-card", -3, 1, 1)]));
    expect(result.geometry.objects[0]?.anchor).toBe(0);
    expect(result.repairs[0]?.code).toBe("invalid-anchor");
    expect(result.repairs[0]?.objectId).toBe("b");
  });

  it("非正跨度置 1；rowSpan 超上限夹到 8", () => {
    const result = repairLayoutGeometry(
      geometry(3, [object("a", "analysis-card", 1, 0, 99)]),
    );
    expect(result.geometry.objects[0]?.colSpan).toBe(1);
    expect(result.geometry.objects[0]?.rowSpan).toBe(8);
    expect(result.repairs.map((repair) => repair.code)).toEqual([
      "invalid-size",
      "row-span-too-large",
    ]);
  });

  it("输入对象与数组不被修改，重复调用结果逐字节相同", () => {
    const layout: LayoutGeometry = geometry(0, [
      object("a", "analysis-card", 0, 0, 99),
      object("a", "analysis-card", 1, 1, 1),
    ]);
    const before = JSON.stringify(layout);
    const first = repairLayoutGeometry(layout);
    const second = repairLayoutGeometry(layout);
    expect(JSON.stringify(layout)).toBe(before);
    expect(second).toEqual(first);
  });
});

describe("修复后的投影与直接投影原始几何等价（两层防御确定性）", () => {
  it("损坏布局：修复副本与原始布局投影出的几何一致", () => {
    const raw: LayoutGeometry = {
      baseCols: 0,
      objects: [
        object("a", "analysis-card", 0, 0, 99),
        object("b", "analysis-card", 2, 1, 1),
        object("a", "analysis-card", 5, 1, 1),
      ],
    };
    const repaired = repairLayoutGeometry(raw).geometry;

    const direct = projectLayout(raw, CONTENT, { targetColumns: 2 });
    const viaRepair = projectLayout(repaired, CONTENT, { targetColumns: 2 });
    const geometryProjection = (result: typeof direct) =>
      result.objects.map((item) => ({
        objectId: item.objectId,
        anchor: item.anchor,
        colSpan: item.colSpan,
        rowSpan: item.rowSpan,
        form: item.form,
        sourceAnchor: item.sourceAnchor,
      }));
    expect(geometryProjection(viaRepair)).toEqual(geometryProjection(direct));
  });

  it("未定位对象（anchor 0）投影为 sourceAnchor=null 并排到已定位对象之后", () => {
    const layout = geometry(2, [
      object("lost", "analysis-card", 0, 1, 1),
      object("a", "analysis-card", 3, 1, 1),
    ]);
    const content = contentOf([analysisCard("lost"), analysisCard("a")]);
    const result = projectLayout(layout, content, { targetColumns: 2 });
    const lost = result.objects.find((item) => item.objectId === "lost");
    const a = result.objects.find((item) => item.objectId === "a");
    expect(lost?.sourceAnchor).toBeNull();
    expect(lost?.degradedReasons).toContain("source-invalid");
    expect(a?.anchor).toBe(3);
  });
});
