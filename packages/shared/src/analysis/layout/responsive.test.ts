/**
 * S18 · 1.18.01 响应式布局引擎：基础权威布局 + 列数专属布局 + 响应式投影。
 *
 * 覆盖重构提示 §15：容器宽度 320–1500、列数 1–8、各种卡片组合、十五条布局性质，以及
 * 「3 列基础 → 6 列移动 A → 5 列移动 B → 4 / 3 / 6 / 5 / 8 列查看 → 6 列新增」这条核心流程。
 */
import { describe, expect, it } from "vitest";

import { validateGeometry, positionToRowCol } from "./grid.js";
import {
  chooseAutoColumns,
  columnOverrideFor,
  columnOverrideKey,
  columnOverrideList,
  commitLayoutEdit,
  displayGeometry,
  editingLayout,
  geometryQuality,
  gridCellWidth,
  gridColumnLimit,
  gridRowHeight,
  layoutQuality,
  layoutRootObjectIds,
  reflowLayout,
  resolveDisplayLayout,
  sameLayoutGeometry,
  scoreColumns,
  withColumnOverride,
  type EditOrigin,
  type LayoutDocuments,
} from "./responsive.js";
import { analysisCard, carousel, contentOf, geometry, gridSplit, layoutOf, object, size } from "./test-support.js";
import { createTestPrng } from "./test-prng.js";
import type { AnalysisCardNode, GridSize, LayoutDocumentV1, LayoutGeometry, ObjectGeometry, ObjectSizeContract, ProjectionResult, WorkbenchContentDocumentV1 } from "./types.js";

const GAP = 12;
const WIDTHS = [320, 375, 450, 600, 800, 1000, 1200, 1500] as const;
const COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** 与 Web 端卡片目录一致的两类尺寸约束：数字卡片与图表卡片。 */
const NUMBER: Omit<ObjectSizeContract, "objectId"> = {
  minSize: size(1, 1),
  sizeLadder: [size(2, 2), size(2, 1), size(1, 2), size(1, 1)],
  compatSize: size(1, 1),
};
const CHART: Omit<ObjectSizeContract, "objectId"> = {
  minSize: size(2, 1),
  sizeLadder: [size(2, 3), size(2, 2), size(2, 1), size(1, 2)],
  compatSize: size(1, 1),
};

type Spec = readonly [id: string, kind: "number" | "chart", anchor: number, colSpan: number, rowSpan: number];

interface Fixture {
  readonly docs: LayoutDocuments;
  readonly contracts: Readonly<Record<string, ObjectSizeContract>>;
}

function fixture(baseCols: number, specs: readonly Spec[]): Fixture {
  const content = contentOf(specs.map(([id]) => analysisCard(id)));
  const main = geometry(baseCols, specs.map(([id, , anchor, colSpan, rowSpan]) => object(id, "analysis-card", anchor, colSpan, rowSpan)));
  const contracts: Record<string, ObjectSizeContract> = {};
  for (const [id, kind] of specs) contracts[id] = { objectId: id, ...(kind === "number" ? NUMBER : CHART) };
  return { docs: { content, layout: layoutOf(main) }, contracts };
}

/** 读出投影里某个对象的行列（1 起）。 */
function cellOf(projection: ProjectionResult, id: string): { readonly row: number; readonly col: number } {
  const found = projection.objects.find((item) => item.objectId === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return positionToRowCol(found.anchor, projection.columns);
}

function asGeometry(projection: ProjectionResult): LayoutGeometry {
  return { baseCols: projection.columns, objects: projection.objects.map(({ objectId, objectType, anchor, colSpan, rowSpan }) => ({ objectId, objectType, anchor, colSpan, rowSpan })) };
}

/** 深冻结：证明函数不改输入（「不写回」）。 */
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) freeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

// 卡片组合（§15）
const MIXED = fixture(2, [
  ["chartA", "chart", 1, 2, 2],
  ["numB", "number", 5, 1, 1],
  ["numC", "number", 6, 1, 1],
  ["numD", "number", 7, 1, 1],
  ["chartE", "chart", 9, 2, 2],
  ["chartF", "chart", 13, 2, 1],
  ["chartG", "chart", 15, 2, 2],
  ["chartH", "chart", 19, 2, 2],
]);
const NUMBERS_ONLY = fixture(3, Array.from({ length: 9 }, (_, index): Spec => [`n${String(index)}`, "number", index + 1, 1, 1]));
const CHARTS_ONLY = fixture(2, Array.from({ length: 6 }, (_, index): Spec => [`c${String(index)}`, "chart", index * 4 + 1, 2, 2]));
const SPANS = fixture(3, [
  ["wide", "chart", 1, 2, 1],
  ["tall", "number", 3, 1, 2],
  ["big", "chart", 4, 2, 3],
  ["n1", "number", 12, 1, 1],
  ["n2", "number", 13, 2, 1],
  ["c1", "chart", 16, 2, 2],
]);
const BIG_FIRST = fixture(2, [["big", "chart", 1, 2, 3], ["a", "number", 7, 1, 1], ["b", "number", 8, 1, 1], ["c", "number", 9, 1, 1]]);
const BIG_LAST = fixture(2, [["a", "number", 1, 1, 1], ["b", "number", 2, 1, 1], ["c", "number", 3, 1, 1], ["big", "chart", 5, 2, 3]]);
const WITH_HOLES = fixture(3, [["a", "number", 1, 1, 1], ["b", "chart", 5, 2, 2], ["c", "number", 13, 1, 1], ["d", "chart", 17, 2, 1]]);
const SINGLE = fixture(2, [["only", "chart", 1, 2, 2]]);
const MANY = fixture(
  4,
  Array.from({ length: 40 }, (_, index): Spec => (index % 3 === 0 ? [`m${String(index)}`, "chart", index * 2 + 1, 2, 2] : [`m${String(index)}`, "number", index * 2 + 1, 1, 1])),
);
/** 系统预设的样子：全部是两格宽的模块。 */
const MODULES = fixture(2, [
  ["m1", "chart", 1, 2, 2],
  ["m2", "chart", 5, 2, 2],
  ["m3", "chart", 9, 2, 2],
  ["m4a", "number", 13, 1, 1],
  ["m4b", "number", 14, 1, 1],
  ["m5", "chart", 15, 2, 2],
  ["m6", "chart", 19, 2, 2],
  ["m7", "chart", 23, 2, 2],
]);

const COMBOS: Readonly<Record<string, Fixture>> = { MIXED, NUMBERS_ONLY, CHARTS_ONLY, SPANS, BIG_FIRST, BIG_LAST, WITH_HOLES, SINGLE, MANY, MODULES };

function expectInvariants(name: string, fx: Fixture, columns: number, projection: ProjectionResult): void {
  const label = `${name} @${String(columns)}`;
  // 1. 无重叠、2. 无越界
  expect(validateGeometry(asGeometry(projection).objects, columns), label).toEqual([]);
  // 每个根对象恰好出现一次（不丢卡片、不重复）
  const ids = projection.objects.map((item) => item.objectId).sort();
  expect(ids, label).toEqual([...layoutRootObjectIds(fx.docs.content)].sort());
  for (const item of projection.objects) {
    expect(item.colSpan, label).toBeLessThanOrEqual(columns);
    // 3. 无不可读的极小卡片：不低于最小尺寸（目标列数比最小宽度还窄时按目标列数），1×1 兼容入口除外
    const contract = fx.contracts[item.objectId];
    if (contract !== undefined && item.form !== "compat") {
      expect(item.colSpan, label).toBeGreaterThanOrEqual(Math.min(contract.minSize.colSpan, columns));
      expect(item.rowSpan, label).toBeGreaterThanOrEqual(contract.minSize.rowSpan);
    }
  }
}

describe("reflowLayout：不变量（10 种卡片组合 × 1–8 列）", () => {
  for (const [name, fx] of Object.entries(COMBOS)) {
    it(`${name}：无重叠 / 无越界 / 不丢卡片 / 不低于最小尺寸 / 确定性 / 不改输入`, () => {
      const layout = freeze(fx.docs.layout);
      const content = freeze(fx.docs.content);
      for (const columns of COLUMNS) {
        const first = reflowLayout(layout.main, content, { targetColumns: columns, contracts: fx.contracts });
        expectInvariants(name, fx, columns, first);
        // 4. 同样输入输出一致
        expect(reflowLayout(layout.main, content, { targetColumns: columns, contracts: fx.contracts })).toEqual(first);
        expect(first.issues.filter((issue) => issue.detail.includes("不变量"))).toEqual([]);
      }
    });
  }

  it("阅读顺序基本保持：按源位置排序的名次与投影后的名次相差不超过 2", () => {
    for (const [name, fx] of Object.entries(COMBOS)) {
      const source = [...fx.docs.layout.main.objects].sort((a, b) => a.anchor - b.anchor).map((item) => item.objectId);
      for (const columns of COLUMNS) {
        const projection = reflowLayout(fx.docs.layout.main, fx.docs.content, { targetColumns: columns, contracts: fx.contracts });
        const order = [...projection.objects].sort((a, b) => a.anchor - b.anchor).map((item) => item.objectId);
        for (const id of source) {
          expect(Math.abs(order.indexOf(id) - source.indexOf(id)), `${name} @${String(columns)} ${id}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("旧算法的根因不再出现：三列第 7 格的卡片换到五列后不会落到第 2 行第 2 列造成大片空白", () => {
    const fx = fixture(3, [
      ["a", "chart", 1, 2, 2],
      ["b", "number", 3, 1, 1],
      ["c", "number", 6, 1, 1],
      ["d", "chart", 7, 2, 2],
      ["e", "chart", 10, 2, 2],
    ]);
    const projection = reflowLayout(fx.docs.layout.main, fx.docs.content, { targetColumns: 5, contracts: fx.contracts });
    // 按阅读顺序紧凑排在前两行：a、b、c 在第 1 行，d 紧随其后，没有被包围的空洞。
    expect(cellOf(projection, "a")).toEqual({ row: 1, col: 1 });
    expect(cellOf(projection, "b").row).toBe(1);
    expect(cellOf(projection, "d").row).toBeLessThanOrEqual(2);
    expect(layoutQuality(projection).holes).toBe(0);
  });

  it("全是两格宽模块的预设：2 / 4 / 6 列下排得严丝合缝", () => {
    for (const columns of [2, 4, 6]) {
      const display = resolveDisplayLayout(MODULES.docs.layout, MODULES.docs.content, { targetColumns: columns, contracts: MODULES.contracts });
      const quality = layoutQuality(display.projection);
      expect(quality.holes + quality.tail, `@${String(columns)}`).toBe(0);
    }
  });

  it("只横向加宽去补被包围的空洞，且只用卡片自己声明过的尺寸；页尾留白不补", () => {
    const projection = reflowLayout(MIXED.docs.layout.main, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts });
    for (const item of projection.objects) {
      const original = MIXED.docs.layout.main.objects.find((source) => source.objectId === item.objectId)!;
      expect(item.rowSpan).toBe(original.rowSpan);
      const ladder = MIXED.contracts[item.objectId]!.sizeLadder;
      const same = item.colSpan === original.colSpan;
      expect(same || ladder.some((entry) => entry.colSpan === item.colSpan && entry.rowSpan === item.rowSpan)).toBe(true);
    }
    expect(layoutQuality(projection).holes).toBe(0);
  });

  it("Spacer 不参与跨列投影（留白只在它所在的那份几何里有意义）", () => {
    const content = contentOf([analysisCard("a"), analysisCard("b")]);
    const main = geometry(2, [object("a", "analysis-card", 1, 1, 1), object("gap", "spacer", 2, 1, 1), object("b", "analysis-card", 3, 1, 1)]);
    const projection = reflowLayout(main, content, { targetColumns: 4 });
    expect(projection.objects.map((item) => item.objectId)).toEqual(["a", "b"]);
  });

  it("超出范围的列数安全处理（0、13、非整数）", () => {
    for (const columns of [0, 13, 2.5, Number.NaN]) {
      const projection = reflowLayout(MIXED.docs.layout.main, MIXED.docs.content, { targetColumns: columns, contracts: MIXED.contracts });
      expect(validateGeometry(asGeometry(projection).objects, projection.columns)).toEqual([]);
      expect(projection.issues.some((issue) => issue.reason === "source-invalid")).toBe(true);
    }
  });

  it("1 列时图表用尺寸档里的 1 格宽版本，容器收起为入口，内容不丢", () => {
    const content = contentOf([analysisCard("chart"), analysisCard("x"), analysisCard("y")], [gridSplit("split", ["x", "y"])]);
    const main = geometry(2, [object("chart", "analysis-card", 1, 2, 2), object("split", "grid-split", 5, 2, 2)]);
    const contracts = { chart: { objectId: "chart", ...CHART }, split: { objectId: "split", minSize: size(1, 1), sizeLadder: [size(2, 2)], collapsedSize: size(1, 1), minFullCols: 2 } };
    const projection = reflowLayout(main, content, { targetColumns: 1, contracts });
    expect(projection.objects.find((item) => item.objectId === "chart")).toMatchObject({ colSpan: 1, rowSpan: 2, form: "compact" });
    expect(projection.objects.find((item) => item.objectId === "split")).toMatchObject({ colSpan: 1, rowSpan: 1, form: "collapsed" });
  });

  it("40 张卡片 × 8 种列数 × 300 个随机布局：不变量全部成立", () => {
    const prng = createTestPrng(20261030);
    for (let round = 0; round < 300; round += 1) {
      const baseCols = prng.nextInt(1, 6);
      const count = prng.nextInt(1, 40);
      const specs: Spec[] = [];
      const occupied = new Set<number>();
      let cursor = 1;
      for (let index = 0; index < count; index += 1) {
        const kind = prng.chance(0.5) ? "number" : "chart";
        const colSpan = Math.min(baseCols, kind === "chart" ? 2 : prng.nextInt(1, 2));
        const rowSpan = prng.nextInt(1, 3);
        // 找一个不重叠的位置（偶尔跳过几格制造空洞）
        cursor += prng.chance(0.2) ? prng.nextInt(1, 3) : 0;
        for (;;) {
          const { col } = positionToRowCol(cursor, baseCols);
          const cells: number[] = [];
          for (let r = 0; r < rowSpan; r += 1) for (let c = 0; c < colSpan; c += 1) cells.push(cursor + r * baseCols + c);
          if (col + colSpan - 1 <= baseCols && cells.every((cell) => !occupied.has(cell))) {
            for (const cell of cells) occupied.add(cell);
            break;
          }
          cursor += 1;
        }
        specs.push([`r${String(index)}`, kind, cursor, colSpan, rowSpan]);
      }
      const fx = fixture(baseCols, specs);
      for (const columns of COLUMNS) {
        expectInvariants(`random#${String(round)}`, fx, columns, resolveDisplayLayout(fx.docs.layout, fx.docs.content, { targetColumns: columns, contracts: fx.contracts }).projection);
      }
    }
  });
});

describe("resolveDisplayLayout：规则 A → B → C，永远从基础布局推导", () => {
  it("目标列数等于基础列数：基础布局原样（不重排，包括用户留的空位）", () => {
    const display = resolveDisplayLayout(WITH_HOLES.docs.layout, WITH_HOLES.docs.content, { targetColumns: 3, contracts: WITH_HOLES.contracts });
    expect(display.source).toBe("canonical");
    expect(sameLayoutGeometry(displayGeometry(display, WITH_HOLES.docs.layout, WITH_HOLES.docs.content), WITH_HOLES.docs.layout.main)).toBe(true);
  });

  it("5. 不产生连续投影累计失真：3 → 6 → 4 → 8 → 3 回到基础布局；每一步都等于直接从基础布局推导", () => {
    const fx = SPANS;
    for (const columns of [6, 4, 8]) {
      const display = resolveDisplayLayout(fx.docs.layout, fx.docs.content, { targetColumns: columns, contracts: fx.contracts });
      expect(display.source).toBe("projection");
      expect(display.projection).toEqual(reflowLayout(fx.docs.layout.main, fx.docs.content, { targetColumns: columns, contracts: fx.contracts }));
    }
    const back = resolveDisplayLayout(fx.docs.layout, fx.docs.content, { targetColumns: 3, contracts: fx.contracts });
    expect(sameLayoutGeometry(asGeometry(back.projection), fx.docs.layout.main)).toBe(true);
  });

  it("7. 专属布局只在对应列数使用；其它列数不从它推导", () => {
    const six = displayGeometry(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }), MIXED.docs.layout, MIXED.docs.content);
    const moved: LayoutGeometry = { ...six, objects: swap(six.objects, "chartA", "chartH") };
    const layout = withColumnOverride(MIXED.docs.layout, 6, moved);
    expect(layout.mode).toBe("independent");
    expect(resolveDisplayLayout(layout, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }).source).toBe("override");
    for (const columns of [3, 4, 5, 7, 8]) {
      const display = resolveDisplayLayout(layout, MIXED.docs.content, { targetColumns: columns, contracts: MIXED.contracts });
      expect(display.source).toBe("projection");
      expect(display.projection).toEqual(reflowLayout(MIXED.docs.layout.main, MIXED.docs.content, { targetColumns: columns, contracts: MIXED.contracts }));
    }
  });

  it("与卡片集合不符的专属布局（例如旧版本客户端在别处加了卡片）不使用，按基础布局推导", () => {
    const six = displayGeometry(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }), MIXED.docs.layout, MIXED.docs.content);
    const withSix = withColumnOverride(MIXED.docs.layout, 6, six);
    // 旧客户端不认识专属布局：把新卡片写进内容与基础布局，专属布局原样留着。
    const layout: LayoutDocumentV1 = { ...withSix, main: { ...withSix.main, objects: [...withSix.main.objects, object("fresh", "analysis-card", 23, 1, 1)] } };
    const content = contentOf([...MIXED.docs.content.cards, analysisCard("fresh")]);
    expect(columnOverrideFor(layout, content, 6)).toBeNull();
    expect(columnOverrideList(layout, content)).toEqual([]);
    expect(resolveDisplayLayout(layout, content, { targetColumns: 6, contracts: MIXED.contracts }).source).toBe("projection");
  });

  it("内容里有、基础布局里没有位置的对象（未定位，本来就不显示）不会让专属布局失效", () => {
    const six = displayGeometry(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }), MIXED.docs.layout, MIXED.docs.content);
    const layout = withColumnOverride(MIXED.docs.layout, 6, six);
    const content = contentOf([...MIXED.docs.content.cards, analysisCard("unplaced")]);
    expect(columnOverrideFor(layout, content, 6)).not.toBeNull();
    expect(resolveDisplayLayout(layout, content, { targetColumns: 6, contracts: MIXED.contracts }).source).toBe("override");
  });

  it("旧数据：unified 模式下即使带着档案也不当作专属布局（S17 的档案从未启用过）", () => {
    const six = displayGeometry(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }), MIXED.docs.layout, MIXED.docs.content);
    const legacy = layoutOf(MIXED.docs.layout.main, { mode: "unified", profiles: [{ profileKey: columnOverrideKey(6), geometry: six }] });
    expect(resolveDisplayLayout(legacy, MIXED.docs.content, { targetColumns: 6, contracts: MIXED.contracts }).source).toBe("projection");
    // 写入新的专属布局时，旧的未启用档案不会突然生效。
    const written = withColumnOverride(legacy, 5, displayGeometry(resolveDisplayLayout(legacy, MIXED.docs.content, { targetColumns: 5, contracts: MIXED.contracts }), legacy, MIXED.docs.content));
    expect(written.profiles?.map((profile) => profile.profileKey)).toEqual([columnOverrideKey(5)]);
  });

  it("用户主动收起的容器在显示几何里保留收起状态与展开尺寸", () => {
    const content = contentOf([analysisCard("x"), analysisCard("y")], [carousel("drawer", ["x", "y"])]);
    const layout = layoutOf(geometry(2, [object("drawer", "carousel", 1, 1, 1, { presentation: "collapsed", expandedSize: size(2, 2) })]));
    for (const columns of [2, 4]) {
      const display = resolveDisplayLayout(layout, content, { targetColumns: columns });
      expect(displayGeometry(display, layout, content).objects[0]).toMatchObject({ presentation: "collapsed", expandedSize: { colSpan: 2, rowSpan: 2 } });
    }
  });
});

describe("网格尺寸与自动列数（容器宽度 320–1500）", () => {
  it("行高随格宽平缓增加：手机不变，宽格子封顶", () => {
    expect(gridRowHeight(gridCellWidth(327, 2, GAP))).toBe(116);
    expect(gridRowHeight(185)).toBe(116);
    expect(gridRowHeight(190)).toBe(116);
    expect(gridRowHeight(216)).toBe(125);
    expect(gridRowHeight(264)).toBe(142);
    expect(gridRowHeight(600)).toBe(168);
    expect(gridRowHeight(0)).toBe(116);
  });

  it("列数上限按每格最窄 104px 计算，最多 8 列，至少 1 列", () => {
    expect(WIDTHS.map((width) => gridColumnLimit(width, GAP))).toEqual([2, 3, 3, 5, 7, 8, 8, 8]);
    expect(gridColumnLimit(90, GAP)).toBe(1);
    expect(gridColumnLimit(0, GAP)).toBe(1);
  });

  it("各宽度下自动列数在允许范围内、确定，且手机宽度保持两列", () => {
    for (const [name, fx] of Object.entries(COMBOS)) {
      for (const width of WIDTHS) {
        const options = { width, gap: GAP, contracts: fx.contracts };
        const columns = chooseAutoColumns(fx.docs.layout, fx.docs.content, options);
        expect(columns, `${name} ${String(width)}`).toBeGreaterThanOrEqual(1);
        expect(columns, `${name} ${String(width)}`).toBeLessThanOrEqual(gridColumnLimit(width, GAP));
        expect(chooseAutoColumns(fx.docs.layout, fx.docs.content, options)).toBe(columns);
      }
    }
    for (const fx of [MIXED, CHARTS_ONLY, MODULES, BIG_FIRST]) {
      expect(chooseAutoColumns(fx.docs.layout, fx.docs.content, { width: 327, gap: GAP, contracts: fx.contracts })).toBe(2);
      expect(chooseAutoColumns(fx.docs.layout, fx.docs.content, { width: 375 - 48, gap: GAP, contracts: fx.contracts })).toBe(2);
    }
  });

  it("宽工作区不死守基础列数，也不是「能放几列就放几列」", () => {
    // 2 列基础布局在 1200px 宽的工作区里：用更多列，但不是上限 8 列。
    const wide = chooseAutoColumns(MODULES.docs.layout, MODULES.docs.content, { width: 1200, gap: GAP, contracts: MODULES.contracts });
    expect(wide).toBeGreaterThan(2);
    expect(wide).toBeLessThan(gridColumnLimit(1200, GAP));
    // 3 列基础布局在 iPad 横屏宽度下不坚持 3 列。
    expect(chooseAutoColumns(SPANS.docs.layout, SPANS.docs.content, { width: 1200, gap: GAP, contracts: SPANS.contracts })).toBeGreaterThan(3);
    // 全是两格宽模块时避开会空出整列的奇数列数。
    for (const width of WIDTHS) {
      const columns = chooseAutoColumns(MODULES.docs.layout, MODULES.docs.content, { width, gap: GAP, contracts: MODULES.contracts });
      expect(columns % 2, String(width)).toBe(0);
    }
  });

  it("格宽舒适时优先用户亲手排的列数（基础 / 专属），并在分数接近时保持上一次的选择", () => {
    // 排得整齐的 3 列基础布局在约 414px 的手机上仍是 3 列（与 1.17 相同）。
    expect(chooseAutoColumns(NUMBERS_ONLY.docs.layout, NUMBERS_ONLY.docs.content, { width: 366, gap: GAP, contracts: NUMBERS_ONLY.contracts })).toBe(3);
    const scores = scoreColumns(MODULES.docs.layout, MODULES.docs.content, { width: 1000, gap: GAP, contracts: MODULES.contracts });
    const best = [...scores].sort((a, b) => a.score - b.score)[0]!;
    const near = scores.find((item) => item.columns !== best.columns && item.score <= best.score + 0.08);
    if (near !== undefined) {
      expect(chooseAutoColumns(MODULES.docs.layout, MODULES.docs.content, { width: 1000, gap: GAP, contracts: MODULES.contracts, previous: near.columns })).toBe(near.columns);
    }
    // 宽度还没测出来（首帧）：沿用基础列数，最多 2 列。
    expect(chooseAutoColumns(SPANS.docs.layout, SPANS.docs.content, { width: 0, gap: GAP })).toBe(2);
  });

  it("14. 宽度在同一列数内微小变化：显示布局完全相同（只是格子像素变了）", () => {
    const a = chooseAutoColumns(MIXED.docs.layout, MIXED.docs.content, { width: 1180, gap: GAP, contracts: MIXED.contracts });
    const b = chooseAutoColumns(MIXED.docs.layout, MIXED.docs.content, { width: 1186, gap: GAP, contracts: MIXED.contracts, previous: a });
    expect(b).toBe(a);
    expect(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: b, contracts: MIXED.contracts }))
      .toEqual(resolveDisplayLayout(MIXED.docs.layout, MIXED.docs.content, { targetColumns: a, contracts: MIXED.contracts }));
  });

  it("geometryQuality 能识别「三列里全是两格宽卡片、右边整列空着」", () => {
    const three = asGeometry(reflowLayout(MODULES.docs.layout.main, MODULES.docs.content, { targetColumns: 3, contracts: MODULES.contracts }));
    const quality = geometryQuality(three);
    expect(quality.tail + quality.holes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 保存：按编辑行为决定写到哪里
// ---------------------------------------------------------------------------

function swap(objects: readonly ObjectGeometry[], first: string, second: string): readonly ObjectGeometry[] {
  const a = objects.find((item) => item.objectId === first)!;
  const b = objects.find((item) => item.objectId === second)!;
  if (a.colSpan !== b.colSpan || a.rowSpan !== b.rowSpan) throw new Error("swap 需要同尺寸");
  return objects.map((item) => (item.objectId === first ? { ...item, anchor: b.anchor } : item.objectId === second ? { ...item, anchor: a.anchor } : item));
}

function sameCardStructureIds(left: LayoutDocuments, right: LayoutDocuments): boolean {
  return [...left.content.cards.map((card) => card.objectId)].sort().join() === [...right.content.cards.map((card) => card.objectId)].sort().join();
}

/** 把一个对象挪到最后一行下面的新行（总是合法的「只调整位置」）。 */
function moveToEnd(geometryValue: LayoutGeometry, id: string): LayoutGeometry {
  const bottom = Math.max(...geometryValue.objects.map((item) => positionToRowCol(item.anchor, geometryValue.baseCols).row + item.rowSpan - 1));
  return { ...geometryValue, objects: geometryValue.objects.map((item) => (item.objectId === id ? { ...item, anchor: bottom * geometryValue.baseCols + 1 } : item)) };
}

function origin(docs: LayoutDocuments, columns: number, contracts: Readonly<Record<string, ObjectSizeContract>>): EditOrigin {
  const display = resolveDisplayLayout(docs.layout, docs.content, { targetColumns: columns, contracts });
  return { documents: docs, start: displayGeometry(display, docs.layout, docs.content) };
}

/** 模拟一次编辑会话：在 `columns` 列打开，`edit` 改几何 / 内容，然后点「完成」。 */
function session(
  docs: LayoutDocuments,
  columns: number,
  contracts: Readonly<Record<string, ObjectSizeContract>>,
  edit: (start: LayoutGeometry, content: WorkbenchContentDocumentV1) => { readonly geometry: LayoutGeometry; readonly content?: WorkbenchContentDocumentV1 },
  replaced: LayoutDocuments | null = null,
) {
  const startFrom = origin(replaced ?? docs, columns, contracts);
  const result = edit(startFrom.start, startFrom.documents.content);
  const edited: LayoutDocuments = { content: result.content ?? startFrom.documents.content, layout: editingLayout(startFrom.documents.layout, result.geometry) };
  return commitLayoutEdit({ columns, origin: startFrom, edited, contracts });
}

describe("commitLayoutEdit：专属布局生命周期（场景 A–K 与核心流程）", () => {
  const BASE = fixture(3, [
    ["A", "chart", 1, 2, 2],
    ["B", "number", 3, 1, 1],
    ["C", "number", 6, 1, 1],
    ["D", "chart", 7, 2, 2],
    ["E", "number", 9, 1, 1],
    ["F", "chart", 13, 2, 1],
  ]);
  const contracts: Record<string, ObjectSizeContract> = { ...BASE.contracts, NEW: { objectId: "NEW", ...CHART } };
  const at = (docs: LayoutDocuments, columns: number) => resolveDisplayLayout(docs.layout, docs.content, { targetColumns: columns, contracts });
  const positionIn = (docs: LayoutDocuments, columns: number, id: string) => cellOf(at(docs, columns).projection, id);

  it("核心流程：3 列基础 → 6 列移动 A → 5 列移动 B → 查看 4 / 3 / 6 / 5 / 8 列 → 6 列新增卡片", () => {
    const s0 = BASE.docs;
    // 场景 A：首次进入 6 列——自动生成，不写任何东西。
    expect(at(s0, 6).source).toBe("projection");

    // 场景 B：6 列移动 A 并保存 → 6 列专属布局；基础 3 列不变。
    const c1 = session(s0, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") }));
    expect(c1.target).toBe("override");
    const s1 = c1.documents;
    expect(s1.layout.main).toEqual(s0.layout.main);
    expect(columnOverrideList(s1.layout, s1.content)).toEqual([6]);
    const aAt6 = positionIn(s1, 6, "A");

    // 场景 D / E：5 列仍从基础 3 列推导（不是从 6 列专属布局）；移动 B 并保存 → 5 列专属布局。
    expect(at(s1, 5).source).toBe("projection");
    expect(at(s1, 5).projection).toEqual(reflowLayout(s0.layout.main, s0.content, { targetColumns: 5, contracts }));
    const c2 = session(s1, 5, contracts, (start) => ({ geometry: moveToEnd(start, "B") }));
    expect(c2.target).toBe("override");
    const s2 = c2.documents;
    expect(s2.layout.main).toEqual(s0.layout.main);
    expect(columnOverrideList(s2.layout, s2.content)).toEqual([5, 6]);
    const bAt5 = positionIn(s2, 5, "B");

    // 4 列：只查看，不保存——从基础推导，存储不变。
    expect(at(s2, 4).projection).toEqual(reflowLayout(s0.layout.main, s0.content, { targetColumns: 4, contracts }));
    // 3 列：基础排列原样。
    expect(asGeometry(at(s2, 3).projection).objects).toEqual(s0.layout.main.objects);
    // 场景 C：再次进入 6 列读专属布局；5 列读它自己的专属布局。
    expect(at(s2, 6).source).toBe("override");
    expect(positionIn(s2, 6, "A")).toEqual(aAt6);
    expect(positionIn(s2, 5, "B")).toEqual(bAt5);
    // 8 列：仍由基础 3 列生成。
    expect(at(s2, 8).projection).toEqual(reflowLayout(s0.layout.main, s0.content, { targetColumns: 8, contracts }));

    // 场景 G：6 列新增一张卡片并保存 → 编辑结果成为新的基础布局（6 列），旧专属布局全部失效。
    const c3 = session(s2, 6, contracts, (start, content) => ({
      content: { ...content, cards: [...content.cards, analysisCard("NEW")] },
      geometry: { ...start, objects: [...start.objects, object("NEW", "analysis-card", 61, 2, 2)] },
    }));
    expect(c3.target).toBe("rebased");
    const s3 = c3.documents;
    expect(s3.layout.main.baseCols).toBe(6);
    expect(s3.layout.mode).toBe("unified");
    expect(s3.layout.profiles).toBeUndefined();
    expect(at(s3, 6).source).toBe("canonical");
    for (const columns of [1, 2, 3, 4, 5, 7, 8]) {
      const display = at(s3, columns);
      expect(display.source).toBe("projection");
      expect(display.projection.objects.some((item) => item.objectId === "NEW")).toBe(true);
      expect(display.projection).toEqual(reflowLayout(s3.layout.main, s3.content, { targetColumns: columns, contracts }));
    }
  });

  it("场景 F / 9：在基础列数下调整排列 → 更新基础布局，已有专属布局继续有效", () => {
    const withSix = session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents;
    const commit = session(withSix, 3, contracts, (start) => ({ geometry: moveToEnd(start, "C") }));
    expect(commit.target).toBe("canonical");
    expect(commit.documents.layout.main).not.toEqual(BASE.docs.layout.main);
    expect(columnOverrideList(commit.documents.layout, commit.documents.content)).toEqual([6]);
    // 没有专属布局的列数用更新后的基础布局重新计算。
    expect(at(commit.documents, 4).projection).toEqual(reflowLayout(commit.documents.layout.main, commit.documents.content, { targetColumns: 4, contracts }));
  });

  it("场景 H：在 6 列删除卡片 → 新基础布局，不留下已删除的卡片 ID", () => {
    const withOverrides = session(session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents, 5, contracts, (start) => ({ geometry: moveToEnd(start, "B") })).documents;
    const commit = session(withOverrides, 6, contracts, (start, content) => ({
      content: { ...content, cards: content.cards.filter((card) => card.objectId !== "E") },
      geometry: { ...start, objects: start.objects.filter((item) => item.objectId !== "E") },
    }));
    expect(commit.target).toBe("rebased");
    expect(JSON.stringify(commit.documents)).not.toContain("\"E\"");
    expect(commit.documents.layout.profiles).toBeUndefined();
  });

  it("场景 I / 12：只改卡片内容（标题）→ 布局原样、各列数看到同一份新内容", () => {
    const withSix = session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents;
    const commit = session(withSix, 6, contracts, (start, content) => ({
      geometry: start,
      content: { ...content, cards: content.cards.map((card): AnalysisCardNode => (card.objectId === "B" ? { ...card, title: { kind: "custom", text: "新标题" } } : card)) },
    }));
    expect(commit.target).toBe("none");
    expect(commit.documents.layout).toEqual(withSix.layout);
    expect(commit.documents.content.cards.find((card) => card.objectId === "B")?.title?.text).toBe("新标题");
  });

  it("场景 J / 6：取消编辑、缩放工作区都不写任何东西（解析是纯函数）", () => {
    const layout = freeze(BASE.docs.layout);
    const content = freeze(BASE.docs.content);
    for (const width of WIDTHS) {
      const columns = chooseAutoColumns(layout, content, { width, gap: GAP, contracts });
      resolveDisplayLayout(layout, content, { targetColumns: columns, contracts });
    }
    // 打开编辑、什么也不改、点「完成」：布局原样。
    expect(session(BASE.docs, 6, contracts, (start) => ({ geometry: start })).target).toBe("none");
  });

  it("场景 K：恢复此列数的自动排列 → 只删除这个列数的专属布局", () => {
    const withBoth = session(session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents, 5, contracts, (start) => ({ geometry: moveToEnd(start, "B") })).documents;
    const automatic = displayGeometry({ columns: 6, source: "projection", projection: reflowLayout(withBoth.layout.main, withBoth.content, { targetColumns: 6, contracts }) }, withBoth.layout, withBoth.content);
    const commit = session(withBoth, 6, contracts, () => ({ geometry: automatic }));
    expect(commit.target).toBe("override-cleared");
    expect(columnOverrideList(commit.documents.layout, commit.documents.content)).toEqual([5]);
    expect(commit.documents.layout.main).toEqual(BASE.docs.layout.main);
  });

  it("编辑中新增又撤销（最终卡片集合不变）：按最终结果判断，不升级为新的基础布局", () => {
    const commit = session(BASE.docs, 6, contracts, (start, content) => {
      const added = { ...content, cards: [...content.cards, analysisCard("TEMP")] };
      const undone = { ...added, cards: added.cards.filter((card) => card.objectId !== "TEMP") };
      return { content: undone, geometry: moveToEnd(start, "D") };
    });
    expect(commit.target).toBe("override");
    expect(commit.documents.layout.main.baseCols).toBe(3);
  });

  it("基础列数下保存时，同列数的专属布局（只可能来自导入）一并删除，否则它会挡住修改", () => {
    const three = displayGeometry(at(BASE.docs, 3), BASE.docs.layout, BASE.docs.content);
    const imported: LayoutDocuments = { content: BASE.docs.content, layout: withColumnOverride(BASE.docs.layout, 3, moveToEnd(three, "B")) };
    const commit = session(imported, 3, contracts, (start) => ({ geometry: moveToEnd(start, "C") }));
    expect(commit.target).toBe("canonical");
    expect(commit.documents.layout.profiles).toBeUndefined();
    expect(at(commit.documents, 3).source).toBe("canonical");
  });

  it("保存时清理已与卡片集合不符的专属布局（旧版本客户端在别处加过卡片）", () => {
    const withSix = session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents;
    // 旧客户端：只改了内容与基础布局（加了一张卡片），专属布局原样留着。
    const legacyEdited: LayoutDocuments = {
      content: { ...withSix.content, cards: [...withSix.content.cards, analysisCard("NEW")] },
      layout: { ...withSix.layout, main: { ...withSix.layout.main, objects: [...withSix.layout.main.objects, object("NEW", "analysis-card", 22, 2, 2)] } },
    };
    expect(at(legacyEdited, 6).source).toBe("projection");
    const commit = session(legacyEdited, 4, contracts, (start) => ({ geometry: moveToEnd(start, "A") }));
    expect(commit.target).toBe("override");
    expect(commit.documents.layout.profiles?.map((profile) => profile.profileKey)).toEqual([columnOverrideKey(4)]);
  });

  it("套用模板（整份替换）：以模板自己的基础布局与专属布局为起点", () => {
    const template = fixture(2, [["t1", "chart", 1, 2, 2], ["t2", "number", 5, 1, 1], ["t3", "number", 6, 1, 1]]);
    const all = { ...contracts, ...template.contracts };
    // 套用后什么都不改：保存的就是模板本身（基础 2 列，没有专属布局）。
    const plain = session(BASE.docs, 6, all, (start) => ({ geometry: start }), template.docs);
    expect(plain.target).toBe("none");
    expect(plain.documents).toEqual(template.docs);
    // 套用后在 6 列调整：模板基础不变 + 6 列专属布局。
    const moved = session(BASE.docs, 6, all, (start) => ({ geometry: moveToEnd(start, "t1") }), template.docs);
    expect(moved.target).toBe("override");
    expect(moved.documents.layout.main).toEqual(template.docs.layout.main);
    expect(columnOverrideList(moved.documents.layout, moved.documents.content)).toEqual([6]);
  });

  it("恢复默认：即使已保存的卡片 ID 与默认完全相同（只挪过位置），也以默认为起点——基础与专属布局一并恢复", () => {
    // 已保存：从默认起步，只在 3 列挪过 C，又在 6 列存过专属布局。
    const moved = session(BASE.docs, 3, contracts, (start) => ({ geometry: moveToEnd(start, "C") })).documents;
    const userDocs = session(moved, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents;
    expect(sameCardStructureIds(userDocs, BASE.docs)).toBe(true);
    // 在 4 列点「恢复默认」后什么也不改就「完成」：保存的就是默认本身（不是 4 列专属布局）。
    const commit = session(userDocs, 4, contracts, (start) => ({ geometry: start }), BASE.docs);
    expect(commit.target).toBe("none");
    expect(commit.documents).toEqual(BASE.docs);
  });

  it("unified 模式下的旧档案：在基础列数下保存不会把它们「激活」", () => {
    const three = displayGeometry(at(BASE.docs, 3), BASE.docs.layout, BASE.docs.content);
    const dormant: LayoutDocuments = {
      content: BASE.docs.content,
      layout: layoutOf(BASE.docs.layout.main, { mode: "unified", profiles: [{ profileKey: columnOverrideKey(6), geometry: { ...three, baseCols: 3 } }] }),
    };
    const commit = session(dormant, 3, contracts, (start) => ({ geometry: moveToEnd(start, "B") }));
    expect(commit.target).toBe("canonical");
    expect(commit.documents.layout.mode).toBe("unified");
    expect(at(commit.documents, 6).source).toBe("projection");
  });

  it("10. 写入的文档始终合法（每份几何都通过校验，专属布局的列数与键一致）", () => {
    const docs = session(session(BASE.docs, 6, contracts, (start) => ({ geometry: moveToEnd(start, "A") })).documents, 5, contracts, (start) => ({ geometry: moveToEnd(start, "B") })).documents;
    const all: LayoutDocumentV1 = docs.layout;
    expect(validateGeometry(all.main.objects, all.main.baseCols)).toEqual([]);
    for (const profile of all.profiles ?? []) {
      expect(profile.profileKey).toBe(columnOverrideKey(profile.geometry.baseCols));
      expect(validateGeometry(profile.geometry.objects, profile.geometry.baseCols)).toEqual([]);
    }
  });

  it("sameLayoutGeometry 不计对象顺序，但区分位置、跨度与收起状态", () => {
    const g = BASE.docs.layout.main;
    expect(sameLayoutGeometry(g, { ...g, objects: [...g.objects].reverse() })).toBe(true);
    expect(sameLayoutGeometry(g, moveToEnd(g, "A"))).toBe(false);
    const sized: GridSize = size(1, 1);
    expect(sameLayoutGeometry(g, { ...g, objects: g.objects.map((item) => (item.objectId === "B" ? { ...item, presentation: "collapsed", expandedSize: sized } : item)) })).toBe(false);
  });
});
