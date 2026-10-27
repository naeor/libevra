/**
 * D-3.2：容器数据模型与占位语义测试。
 *
 * 覆盖：GridSplit 比例归一化与槽位语义、容器子树结构校验（数量/重复/嵌套/引用）、
 * 展示形态派生（full/compact/collapsed）、用户主动收缩↔恢复的纯数据往返、
 * 以及确定性与幂等属性测试。
 */

import { describe, expect, it } from "vitest";
import {
  collapseContainerGeometry,
  containerChildBounds,
  deriveContainerDisplay,
  describeGridSplitSlots,
  isPlaceholderForm,
  isUserCollapsed,
  normalizeGridSplitRatios,
  restoreContainerGeometry,
  validateContainerTree,
} from "./containers.js";
import { createTestPrng } from "./test-prng.js";
import {
  analysisCard,
  carousel,
  contentOf,
  contract,
  gridSplit,
  object,
  size,
} from "./test-support.js";

const CONTENT = contentOf(
  [
    analysisCard("a"),
    analysisCard("b"),
    analysisCard("c"),
    analysisCard("d"),
  ],
  [
    gridSplit("g", ["a", "b", "c", "d"]),
    carousel("q", ["a", "b"]),
  ],
);

describe("containers：GridSplit 比例归一化", () => {
  it("合法值原样返回且不登记问题", () => {
    const result = normalizeGridSplitRatios({ columnSplitPermille: 300, rowSplitPermille: 700 });
    expect(result.config).toEqual({ columnSplitPermille: 300, rowSplitPermille: 700 });
    expect(result.changed).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("两个方向同时为 0 → 回退等分并登记 invalid-split-ratio", () => {
    const result = normalizeGridSplitRatios({ columnSplitPermille: 0, rowSplitPermille: 0 });
    expect(result.config).toEqual({ columnSplitPermille: 500, rowSplitPermille: 500 });
    expect(result.changed).toBe(true);
    expect(result.issues.map((item) => item.code)).toEqual(["invalid-split-ratio"]);
  });

  it("越界值夹紧、浮点取整", () => {
    expect(normalizeGridSplitRatios({ columnSplitPermille: -50, rowSplitPermille: 1200 })).toMatchObject({
      config: { columnSplitPermille: 0, rowSplitPermille: 1000 },
      changed: true,
    });
    expect(normalizeGridSplitRatios({ columnSplitPermille: 499.6, rowSplitPermille: 500.4 })).toMatchObject({
      config: { columnSplitPermille: 500, rowSplitPermille: 500 },
      changed: true,
    });
  });

  it("归一化幂等（第二次不再变化）", () => {
    const first = normalizeGridSplitRatios({ columnSplitPermille: 0, rowSplitPermille: 0 });
    const second = normalizeGridSplitRatios(first.config);
    expect(second.changed).toBe(false);
    expect(second.config).toEqual(first.config);
  });
});

describe("containers：槽位语义与子对象数量边界", () => {
  it("按两条分割线派生 1/2/4 槽位", () => {
    expect(describeGridSplitSlots({ columnSplitPermille: 0, rowSplitPermille: 0 })).toEqual({
      columns: 1,
      rows: 1,
      slots: 1,
    });
    expect(describeGridSplitSlots({ columnSplitPermille: 500, rowSplitPermille: 0 })).toEqual({
      columns: 2,
      rows: 1,
      slots: 2,
    });
    expect(describeGridSplitSlots({ columnSplitPermille: 0, rowSplitPermille: 500 })).toEqual({
      columns: 1,
      rows: 2,
      slots: 2,
    });
    expect(describeGridSplitSlots({ columnSplitPermille: 500, rowSplitPermille: 500 })).toEqual({
      columns: 2,
      rows: 2,
      slots: 4,
    });
  });

  it("子对象数量上下限：grid-split 2–4，carousel 2–6", () => {
    const grid = CONTENT.containers[0];
    const drawer = CONTENT.containers[1];
    expect(grid && containerChildBounds(grid)).toEqual({ min: 2, max: 4 });
    expect(drawer && containerChildBounds(drawer)).toEqual({ min: 2, max: 6 });
  });
});

describe("containers：容器树结构校验", () => {
  it("合法内容文档无问题", () => {
    expect(validateContainerTree(CONTENT)).toEqual([]);
  });

  it("重复子对象 → duplicate-child", () => {
    const content = contentOf(
      [analysisCard("a"), analysisCard("b")],
      [gridSplit("g", ["a", "a"])],
    );
    expect(validateContainerTree(content).map((item) => item.code)).toContain("duplicate-child");
  });

  it("引用缺失 → child-not-found；嵌套容器 → container-nesting", () => {
    const missing = contentOf([analysisCard("a"), analysisCard("b")], [gridSplit("g", ["a", "x"])]);
    expect(validateContainerTree(missing).map((item) => item.code)).toContain("child-not-found");

    const nested = contentOf(
      [analysisCard("a"), analysisCard("b")],
      [gridSplit("g", ["a", "h"]), carousel("h", ["a", "b"])],
    );
    expect(validateContainerTree(nested).map((item) => item.code)).toContain("container-nesting");
  });

  it("数量越界 → invalid-children-count（carousel 只有 1 张）", () => {
    const content = contentOf([analysisCard("a")], [carousel("q", ["a"])]);
    expect(validateContainerTree(content).map((item) => item.code)).toContain("invalid-children-count");
  });
});

describe("containers：展示形态派生（与投影口径一致）", () => {
  const contractOf = (options: Parameters<typeof contract>[1]) => contract("g", options);

  it("放得下 → full（使用 expandedSize 优先）", () => {
    const geometry = object("g", "grid-split", 1, 2, 2);
    const display = deriveContainerDisplay(geometry, 4, contractOf({ minSize: size(1, 1), sizeLadder: [] }));
    expect(display).toEqual({ form: "full", size: { colSpan: 2, rowSpan: 2 }, reasons: [] });
  });

  it("用户主动收缩 → collapsed(user-collapsed)，尺寸取 collapsedSize", () => {
    const geometry = object("g", "carousel", 1, 2, 2, {
      presentation: "collapsed",
      expandedSize: size(2, 2),
    });
    const display = deriveContainerDisplay(
      geometry,
      4,
      contractOf({ minSize: size(1, 1), sizeLadder: [], collapsedSize: size(1, 1) }),
    );
    expect(display.form).toBe("collapsed");
    expect(display.reasons).toEqual(["user-collapsed"]);
  });

  it("目标列数小于 minFullCols → collapsed(container-narrow)", () => {
    const geometry = object("g", "grid-split", 1, 2, 2);
    const display = deriveContainerDisplay(geometry, 3, contractOf({ minSize: size(1, 1), sizeLadder: [], minFullCols: 4 }));
    expect(display.form).toBe("collapsed");
    expect(display.reasons).toEqual(["container-narrow"]);
    expect(display.size).toEqual({ colSpan: 1, rowSpan: 1 });
  });

  it("宽度不足且有合法紧凑档 → compact(width-overflow)", () => {
    const geometry = object("g", "grid-split", 1, 3, 1);
    const display = deriveContainerDisplay(
      geometry,
      2,
      contractOf({ minSize: size(1, 1), sizeLadder: [size(2, 1)] }),
    );
    expect(display.form).toBe("compact");
    expect(display.reasons).toEqual(["width-overflow"]);
    expect(display.size).toEqual({ colSpan: 2, rowSpan: 1 });
  });

  it("宽度不足且无紧凑档 → collapsed(width-overflow)", () => {
    const geometry = object("g", "carousel", 1, 3, 1);
    const display = deriveContainerDisplay(
      geometry,
      2,
      contractOf({ minSize: size(1, 1), sizeLadder: [] }),
    );
    expect(display.form).toBe("collapsed");
    expect(display.reasons).toEqual(["width-overflow"]);
  });
});

describe("containers：用户主动收缩↔恢复（纯数据）", () => {
  it("折叠记录 expandedSize 并变 1×1，恢复还原原始尺寸", () => {
    const geometry = object("g", "grid-split", 5, 3, 2);
    const collapsed = collapseContainerGeometry(geometry);
    expect(collapsed).toMatchObject({
      anchor: 5,
      colSpan: 1,
      rowSpan: 1,
      presentation: "collapsed",
      expandedSize: { colSpan: 3, rowSpan: 2 },
    });
    expect(isUserCollapsed(collapsed)).toBe(true);
    const restored = restoreContainerGeometry(collapsed);
    expect(restored).toEqual(geometry);
  });

  it("重复折叠/恢复幂等且返回原引用", () => {
    const geometry = object("g", "carousel", 1, 2, 2);
    const collapsed = collapseContainerGeometry(geometry);
    expect(collapseContainerGeometry(collapsed)).toBe(collapsed);
    const restored = restoreContainerGeometry(collapsed);
    expect(restoreContainerGeometry(restored)).toBe(restored);
  });

  it("1×1 占位判定", () => {
    expect(isPlaceholderForm("collapsed", size(2, 2))).toBe(true);
    expect(isPlaceholderForm("full", size(1, 2))).toBe(false);
    expect(isPlaceholderForm("compact", size(1, 1))).toBe(true);
  });
});

describe("containers：属性测试", () => {
  it("随机容器几何：折叠→恢复往返一致、归一化幂等、派生形态合法（200 场景）", () => {
    const prng = createTestPrng(0x5f17d2b1);
    let checked = 0;
    for (let scenario = 0; scenario < 200; scenario += 1) {
      const geometry = object(
        "g",
        prng.chance(0.5) ? "grid-split" : "carousel",
        prng.nextInt(1, 30),
        prng.nextInt(1, 4),
        prng.nextInt(1, 3),
      );
      const collapsed = collapseContainerGeometry(geometry);
      expect(restoreContainerGeometry(collapsed)).toEqual(geometry);

      const split = normalizeGridSplitRatios({
        columnSplitPermille: prng.nextInt(-100, 1100),
        rowSplitPermille: prng.nextInt(-100, 1100),
      });
      expect(normalizeGridSplitRatios(split.config).changed).toBe(false);
      expect(split.config.columnSplitPermille).toBeGreaterThanOrEqual(0);
      expect(split.config.columnSplitPermille).toBeLessThanOrEqual(1000);
      expect(split.config.rowSplitPermille).toBeGreaterThanOrEqual(0);
      expect(split.config.rowSplitPermille).toBeLessThanOrEqual(1000);

      const display = deriveContainerDisplay(geometry, prng.nextInt(1, 6));
      expect(["full", "compact", "collapsed"]).toContain(display.form);
      expect(display.size.colSpan).toBeGreaterThanOrEqual(1);
      expect(display.size.rowSpan).toBeGreaterThanOrEqual(1);
      checked += 1;
    }
    expect(checked).toBe(200);
  });
});
