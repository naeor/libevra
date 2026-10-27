/**
 * 迁移/投影夹具（D-1）：规格 §19.3 的 TC-07…TC-22 中不依赖未决 OQ 数值的部分。
 *
 * 夹具记号：`ID@锚点(宽×高)`；`S` = Spacer；目标列数写在测试名里。
 * 未实现/待 W5 的夹具（TC-07 的 L 策略、TC-15、TC-18、TC-19、TC-23、TC-24）
 * 见 `docs/specs/product/s17-agents/S17-Agent-D-D1-属性测试与夹具-v1.md` 的延后清单。
 */

import { describe, expect, it } from "vitest";
import { projectLayout, projectionToGeometry } from "./projection.js";
import { validateGeometry } from "./grid.js";
import {
  analysisCard,
  anchorsOf,
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
  sizesOf,
} from "./test-support.js";
import type { ProjectOptions } from "./types.js";

const CARD_CONTRACT = { minSize: size(1, 1), sizeLadder: [] } as const;

describe("TC-07a 行尾放不下（4→3，策略 S 尺寸优先）", () => {
  it("保持尺寸、移动到最早合法空位", () => {
    const content = contentOf([analysisCard("A"), analysisCard("W")]);
    const layout = geometry(4, [
      object("A", "analysis-card", 1, 1, 1),
      object("W", "analysis-card", 3, 2, 1),
    ]);
    const result = projectLayout(layout, content, {
      targetColumns: 3,
      contracts: contractsOf(
        contract("A", { minSize: size(1, 1), sizeLadder: [] }),
        contract("W", { minSize: size(1, 1), sizeLadder: [], compatSize: size(1, 1) }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ A: 1, W: 2 });
    expect(projectedOf(result, "W").form).toBe("full");
    expect(projectedOf(result, "W").colSpan).toBe(2);
  });
});

describe("TC-07b 行尾放不下（4→3，策略 P 位置优先）", () => {
  it("保持位置、退到 1×1 兼容形态", () => {
    const content = contentOf([analysisCard("A"), analysisCard("W")]);
    const layout = geometry(4, [
      object("A", "analysis-card", 1, 1, 1),
      object("W", "analysis-card", 3, 2, 1),
    ]);
    const result = projectLayout(layout, content, {
      targetColumns: 3,
      strategy: "position-first",
      contracts: contractsOf(
        contract("A", { minSize: size(1, 1), sizeLadder: [] }),
        contract("W", { minSize: size(1, 1), sizeLadder: [], compatSize: size(1, 1) }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ A: 1, W: 3 });
    expect(projectedOf(result, "W").form).toBe("compat");
    expect(projectedOf(result, "W").colSpan).toBe(1);
  });
});

describe("TC-08a 宽度超过总列数（3→2，尺寸档降级）", () => {
  it("用家族尺寸档降到 2×1", () => {
    const content = contentOf([analysisCard("W")]);
    const layout = geometry(3, [object("W", "analysis-card", 2, 3, 1)]);
    const result = projectLayout(layout, content, {
      targetColumns: 2,
      contracts: contractsOf(
        contract("W", { minSize: size(1, 1), sizeLadder: [size(2, 1)], compatSize: size(1, 1) }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ W: 1 });
    expect(projectedOf(result, "W").form).toBe("compact");
    expect(sizesOf(result)["W"]).toEqual({ colSpan: 2, rowSpan: 1 });
    expect(reasonsOf(result, "W")).toContain("width-overflow");
  });
});

describe("TC-08b 宽度超过总列数（3→2，无契约兜底兼容入口）", () => {
  it("无尺寸契约时落 1×1 兼容入口且位置保留", () => {
    const content = contentOf([analysisCard("W")]);
    const layout = geometry(3, [object("W", "analysis-card", 2, 3, 1)]);
    const result = projectLayout(layout, content, { targetColumns: 2 });
    expect(anchorsOf(result)).toEqual({ W: 2 });
    expect(projectedOf(result, "W").form).toBe("compat");
    expect(reasonsOf(result, "W")).toContain("missing-contract");
  });
});

describe("TC-09 锚点缺失", () => {
  it("无有效位置的对象排最后，并记录 source-invalid", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B")]);
    const layout = geometry(2, [
      object("A", "analysis-card", 1, 1, 1),
      object("B", "analysis-card", 0, 1, 1),
    ]);
    const result = projectLayout(layout, content, {
      targetColumns: 2,
      contracts: contractsOf(contract("A", CARD_CONTRACT), contract("B", CARD_CONTRACT)),
    });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 2 });
    expect(projectedOf(result, "B").sourceAnchor).toBeNull();
    expect(reasonsOf(result, "B")).toContain("source-invalid");
  });
});

describe("TC-10 混合尺寸（2×2 / 2×1 / 3×1 / 1×1）在多种列数下", () => {
  it("4 列保持原样，3 列与 2 列仍全部可访问且不重叠", () => {
    const content = contentOf([
      analysisCard("P"),
      analysisCard("Q"),
      analysisCard("R"),
      analysisCard("S"),
    ]);
    const layout = geometry(4, [
      object("P", "analysis-card", 1, 2, 2),
      object("Q", "analysis-card", 3, 2, 1),
      object("R", "analysis-card", 9, 3, 1),
      object("S", "analysis-card", 12, 1, 1),
    ]);
    const contracts = contractsOf(
      contract("P", { minSize: size(1, 1), sizeLadder: [] }),
      contract("Q", { minSize: size(1, 1), sizeLadder: [] }),
      contract("R", { minSize: size(1, 1), sizeLadder: [size(2, 1)], compatSize: size(1, 1) }),
      contract("S", { minSize: size(1, 1), sizeLadder: [] }),
    );
    const atFour = projectLayout(layout, content, { targetColumns: 4, contracts });
    expect(anchorsOf(atFour)).toEqual({ P: 1, Q: 3, R: 9, S: 12 });
    expect(sizesOf(atFour)["R"]).toEqual({ colSpan: 3, rowSpan: 1 });

    for (const columns of [3, 2]) {
      const result = projectLayout(layout, content, { targetColumns: columns, contracts });
      expect(validateGeometry(projectionToGeometry(result).objects, columns)).toEqual([]);
      expect(result.objects.length).toBe(4);
      expect(sizesOf(result)["P"]).toEqual({ colSpan: 2, rowSpan: 2 });
    }
    const atTwo = projectLayout(layout, content, { targetColumns: 2, contracts });
    expect(projectedOf(atTwo, "R").form).toBe("compact");
    expect(sizesOf(atTwo)["R"]).toEqual({ colSpan: 2, rowSpan: 1 });
  });
});

describe("TC-11 Spacer 保位", () => {
  it("Spacer 不被自动紧凑消除，目标列数不变时位置保持", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B")]);
    const layout = geometry(2, [
      object("A", "analysis-card", 1, 1, 1),
      object("S1", "spacer", 2, 1, 1),
      object("B", "analysis-card", 3, 1, 1),
    ]);
    const result = projectLayout(layout, content, {
      targetColumns: 2,
      contracts: contractsOf(
        contract("A", { minSize: size(1, 1), sizeLadder: [] }),
        contract("B", { minSize: size(1, 1), sizeLadder: [] }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ A: 1, S1: 2, B: 3 });
    expect(projectedOf(result, "S1").form).toBe("full");
  });
});

describe("TC-12a Spacer 宽度夹窄", () => {
  it("Spacer 目标列数不足时夹宽，不删除", () => {
    const content = contentOf([]);
    const layout = geometry(3, [object("S1", "spacer", 1, 3, 1)]);
    const result = projectLayout(layout, content, { targetColumns: 2 });
    expect(anchorsOf(result)).toEqual({ S1: 1 });
    expect(sizesOf(result)["S1"]).toEqual({ colSpan: 2, rowSpan: 1 });
    expect(reasonsOf(result, "S1")).toContain("width-overflow");
  });
});

describe("TC-12b Spacer 同锚点冲突", () => {
  it("按优先级先到者占位，Spacer 后移但不删除", () => {
    const content = contentOf([analysisCard("A")]);
    const layout = geometry(2, [
      object("A", "analysis-card", 1, 1, 1),
      object("S1", "spacer", 1, 1, 1),
    ]);
    const result = projectLayout(layout, content, {
      targetColumns: 2,
      contracts: contractsOf(contract("A", { minSize: size(1, 1), sizeLadder: [] })),
    });
    expect(anchorsOf(result)).toEqual({ A: 1, S1: 2 });
    expect(projectedOf(result, "S1").form).toBe("full");
  });
});

describe("TC-13 容器保持完整（4→3）", () => {
  it("minFullCols 满足时容器保持完整形态与内部配置", () => {
    const content = contentOf([analysisCard("c1"), analysisCard("c2")], [
      gridSplit("G", ["c1", "c2"]),
    ]);
    const layout = geometry(4, [object("G", "grid-split", 1, 2, 2)]);
    const result = projectLayout(layout, content, {
      targetColumns: 3,
      contracts: contractsOf(
        contract("G", { minSize: size(1, 1), sizeLadder: [], collapsedSize: size(1, 1), minFullCols: 2 }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ G: 1 });
    expect(sizesOf(result)["G"]).toEqual({ colSpan: 2, rowSpan: 2 });
    expect(projectedOf(result, "G").form).toBe("full");
    expect(JSON.stringify(content.containers[0])).toContain("c1");
  });
});

describe("TC-14 容器必须收缩（4→1）", () => {
  it("目标列数不足时收缩为 1×1 入口且记录 container-narrow", () => {
    const content = contentOf([analysisCard("c1"), analysisCard("c2")], [
      gridSplit("G", ["c1", "c2"]),
    ]);
    const layout = geometry(4, [object("G", "grid-split", 1, 2, 2)]);
    const result = projectLayout(layout, content, {
      targetColumns: 1,
      contracts: contractsOf(
        contract("G", { minSize: size(1, 1), sizeLadder: [], collapsedSize: size(1, 1), minFullCols: 2 }),
      ),
    });
    expect(anchorsOf(result)).toEqual({ G: 1 });
    expect(sizesOf(result)["G"]).toEqual({ colSpan: 1, rowSpan: 1 });
    expect(projectedOf(result, "G").form).toBe("collapsed");
    expect(reasonsOf(result, "G")).toContain("container-narrow");
  });
});

describe("TC-16 宽屏恢复（2→1→2）", () => {
  it("窄屏投影不改权威布局，回到 2 列时恢复原锚点", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B"), analysisCard("C")]);
    const layout = geometry(2, [
      object("A", "analysis-card", 1, 1, 1),
      object("B", "analysis-card", 2, 1, 1),
      object("C", "analysis-card", 3, 1, 1),
    ]);
    const contracts = contractsOf(
      contract("A", { minSize: size(1, 1), sizeLadder: [] }),
      contract("B", { minSize: size(1, 1), sizeLadder: [] }),
      contract("C", { minSize: size(1, 1), sizeLadder: [] }),
    );
    const atOne = projectLayout(layout, content, { targetColumns: 1, contracts });
    expect(atOne.objects.length).toBe(3);
    const atTwo = projectLayout(layout, content, { targetColumns: 2, contracts });
    expect(anchorsOf(atTwo)).toEqual({ A: 1, B: 2, C: 3 });
  });
});

describe("TC-17 无漂移（3→4→2→3）", () => {
  it("每次从权威布局重算：经过其它列数后再投影回 3 列结果不变", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B"), analysisCard("C")]);
    const layout = geometry(3, [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 6, 1, 1),
      object("S1", "spacer", 7, 1, 1),
    ]);
    const contracts = contractsOf(
      contract("A", { minSize: size(1, 1), sizeLadder: [] }),
      contract("B", { minSize: size(1, 1), sizeLadder: [] }),
      contract("C", { minSize: size(1, 1), sizeLadder: [] }),
    );
    const snapshot = JSON.stringify(layout);
    projectLayout(layout, content, { targetColumns: 4, contracts });
    projectLayout(layout, content, { targetColumns: 2, contracts });
    const back = projectLayout(layout, content, { targetColumns: 3, contracts });
    expect(anchorsOf(back)).toEqual({ A: 1, B: 3, C: 6, S1: 7 });
    expect(JSON.stringify(layout)).toBe(snapshot);
  });
});

describe("TC-20 单列下所有对象类型可访问", () => {
  it("卡片/自由分割/滑动抽屉/Spacer 都保留并纵向堆叠", () => {
    const content = contentOf(
      [analysisCard("C"), analysisCard("c1"), analysisCard("c2"), analysisCard("m1"), analysisCard("m2")],
      [gridSplit("G", ["c1", "c2"]), carousel("Q", ["m1", "m2"])],
    );
    const layout = geometry(4, [
      object("C", "analysis-card", 1, 1, 1),
      object("G", "grid-split", 2, 2, 2),
      object("Q", "carousel", 4, 1, 1),
      object("S1", "spacer", 5, 1, 1),
    ]);
    const contracts = contractsOf(
      contract("C", { minSize: size(1, 1), sizeLadder: [] }),
      contract("G", { minSize: size(1, 1), sizeLadder: [], collapsedSize: size(1, 1), minFullCols: 2 }),
      contract("Q", { minSize: size(1, 1), sizeLadder: [], collapsedSize: size(1, 1), minFullCols: 2 }),
    );
    const result = projectLayout(layout, content, { targetColumns: 1, contracts });
    expect(result.objects.length).toBe(4);
    expect(anchorsOf(result)).toEqual({ C: 1, G: 2, Q: 4, S1: 5 });
    expect(projectedOf(result, "G").form).toBe("collapsed");
    expect(projectedOf(result, "Q").form).toBe("collapsed");
    for (const projected of result.objects) {
      expect(projected.colSpan).toBe(1);
    }
  });
});

describe("TC-22 单遍优先级贪心（对照两遍法）", () => {
  it("按源位置顺序单遍放置，冲突对象后移而不回头移动已放置对象", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B"), analysisCard("C")]);
    const layout = geometry(4, [
      object("A", "analysis-card", 1, 2, 2),
      object("B", "analysis-card", 3, 1, 1),
      object("C", "analysis-card", 4, 1, 1),
    ]);
    const contracts = contractsOf(
      contract("A", { minSize: size(1, 1), sizeLadder: [] }),
      contract("B", { minSize: size(1, 1), sizeLadder: [] }),
      contract("C", { minSize: size(1, 1), sizeLadder: [] }),
    );
    const result = projectLayout(layout, content, { targetColumns: 3, contracts });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 3, C: 6 });
  });
});

describe("TC-25 迁移契约与视口高度无关", () => {
  it("附加 viewportHeight 不改变投影结果（函数签名没有高度参数）", () => {
    const content = contentOf([analysisCard("A")]);
    const layout = geometry(2, [object("A", "analysis-card", 1, 2, 1)]);
    const base: ProjectOptions = { targetColumns: 2 };
    const withHeight = { ...base, viewportHeight: 812 } as unknown as ProjectOptions;
    expect(projectLayout(layout, content, withHeight)).toEqual(projectLayout(layout, content, base));
  });
});

describe("TC-26 同列数投影幂等", () => {
  it("在权威布局的 baseCols 下投影等于自身", () => {
    const content = contentOf([analysisCard("A"), analysisCard("B")]);
    const layout = geometry(3, [
      object("A", "analysis-card", 1, 2, 1),
      object("B", "analysis-card", 4, 1, 1),
    ]);
    const result = projectLayout(layout, content, { targetColumns: 3 });
    expect(anchorsOf(result)).toEqual({ A: 1, B: 4 });
    expect(sizesOf(result)["A"]).toEqual({ colSpan: 2, rowSpan: 1 });
    // 保留 spacer 占位在几何上不影响结果
    expect(projectionToGeometry(result).baseCols).toBe(3);
  });
});
