/**
 * 属性测试（D-1）：投影/迁移的确定性、不变量、幂等/无漂移、配置安全。
 *
 * 每个 describe 独立生成固定种子的随机场景；四组共 4 × 2600 = 10,400 个场景，
 * 满足「≥10⁴ 用例」要求（规格 §19.5）。生成器只用于测试，生产代码不带随机数。
 */

import { describe, expect, it } from "vitest";
import {
  findEarliestFreeAnchor,
  placementCells,
  placementFitsColumns,
  validateGeometry,
} from "./grid.js";
import { projectLayout, projectionToGeometry } from "./projection.js";
import {
  analysisCard,
  carousel,
  contentOf,
  contract,
  contractsOf,
  geometry,
  gridSplit,
  object,
  size,
} from "./test-support.js";
import type { SizeContractOptions } from "./test-support.js";
import { createTestPrng } from "./test-prng.js";
import type {
  AnalysisCardNode,
  ContainerNode,
  GridSize,
  LayoutGeometry,
  ObjectGeometry,
  ObjectSizeContract,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "./types.js";
import { MAX_COLUMNS, MAX_ROW_SPAN } from "./types.js";

const SCENARIO_COUNT = 2600;

const SEED_DETERMINISM = 0x5f17d001;
const SEED_INVARIANTS = 0x5f17d002;
const SEED_IDEMPOTENCE = 0x5f17d003;
const SEED_SAFETY = 0x5f17d004;

interface Scenario {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutGeometry;
  readonly contracts: Readonly<Record<string, ObjectSizeContract>>;
  readonly targetColumns: number;
}

/** 生成一个合法的随机场景（内容、权威布局、尺寸契约、目标列数）。 */
function buildScenario(rng: ReturnType<typeof createTestPrng>): Scenario {
  const baseCols = rng.nextInt(1, 6);
  const targetColumns = rng.nextInt(1, MAX_COLUMNS);

  const cardCount = rng.nextInt(1, 6);
  const cards: AnalysisCardNode[] = [];
  for (let index = 0; index < cardCount; index += 1) {
    cards.push(analysisCard(`c${index}`));
  }

  const containers: ContainerNode[] = [];
  const shuffledCards = rng.shuffle(cards);
  let cursor = 0;
  const containerBudget = rng.nextInt(0, 2);
  for (let index = 0; index < containerBudget; index += 1) {
    const remaining = shuffledCards.length - cursor;
    if (remaining < 2) {
      break;
    }
    const isSplit = rng.chance(0.5);
    const maxChildren = isSplit ? 4 : 6;
    const childCount = rng.nextInt(2, Math.min(maxChildren, remaining));
    const children = shuffledCards
      .slice(cursor, cursor + childCount)
      .map((card) => card.objectId);
    cursor += childCount;
    containers.push(
      isSplit ? gridSplit(`g${index}`, children) : carousel(`q${index}`, children),
    );
  }
  const content = contentOf(cards, containers);

  const objects: ObjectGeometry[] = [];
  const occupied = new Set<number>();

  const place = (
    objectId: string,
    objectType: ObjectGeometry["objectType"],
    colSpan: number,
    rowSpan: number,
  ): void => {
    const desired: GridSize = size(colSpan, rowSpan);
    const randomAnchor = rng.nextInt(1, Math.max(1, baseCols * 6));
    let anchor: number | null = null;
    if (placementFitsColumns(randomAnchor, desired, baseCols)) {
      const cells = placementCells(randomAnchor, desired, baseCols);
      if (cells.every((cell) => !occupied.has(cell))) {
        anchor = randomAnchor;
      }
    }
    if (anchor === null) {
      anchor = findEarliestFreeAnchor(occupied, desired, baseCols);
    }
    if (anchor === null) {
      return;
    }
    for (const cell of placementCells(anchor, desired, baseCols)) {
      occupied.add(cell);
    }
    objects.push(object(objectId, objectType, anchor, colSpan, rowSpan));
  };

  for (const card of cards) {
    place(card.objectId, "analysis-card", rng.nextInt(1, Math.min(3, baseCols)), rng.nextInt(1, 2));
  }
  for (const containerNode of containers) {
    place(containerNode.objectId, containerNode.type, rng.nextInt(1, baseCols), rng.nextInt(1, 2));
  }
  const spacerCount = rng.nextInt(0, 3);
  for (let index = 0; index < spacerCount; index += 1) {
    place(`s${index}`, "spacer", rng.nextInt(1, baseCols), 1);
  }

  const contractList: ObjectSizeContract[] = [];
  for (const card of cards) {
    const options: {
      minSize: GridSize;
      sizeLadder: readonly GridSize[];
      compatSize?: GridSize;
    } = {
      minSize: size(rng.nextInt(1, 2), rng.nextInt(1, 2)),
      sizeLadder: Array.from({ length: rng.nextInt(0, 2) }, () =>
        size(rng.nextInt(1, 3), rng.nextInt(1, 2)),
      ),
    };
    if (rng.chance(0.5)) {
      options.compatSize = size(1, 1);
    }
    contractList.push(contract(card.objectId, options));
  }
  for (const containerNode of containers) {
    const options: SizeContractOptions = {
      minSize: size(1, 1),
      sizeLadder: rng.chance(0.5) ? [size(2, 1)] : [],
      collapsedSize: size(1, 1),
      minFullCols: rng.nextInt(1, 3),
    };
    contractList.push(contract(containerNode.objectId, options));
  }

  return {
    content,
    layout: geometry(baseCols, rng.shuffle(objects)),
    contracts: contractsOf(...contractList),
    targetColumns,
  };
}

function tupleOf(result: ProjectionResult): readonly string[] {
  return result.objects
    .map((item) => `${item.objectId}:${item.anchor}:${item.colSpan}:${item.rowSpan}`)
    .sort();
}

describe("属性：确定性（2,600 场景）", () => {
  it("同一输入多次投影逐字节相同，且与对象数组顺序无关", () => {
    let checked = 0;
    for (let index = 0; index < SCENARIO_COUNT; index += 1) {
      const scenario = buildScenario(createTestPrng(SEED_DETERMINISM + index));
      const options = { targetColumns: scenario.targetColumns, contracts: scenario.contracts };
      const first = projectLayout(scenario.layout, scenario.content, options);
      const second = projectLayout(scenario.layout, scenario.content, options);
      expect(second).toEqual(first);
      expect(first.columns).toBe(scenario.targetColumns);

      const reordered = geometry(
        scenario.layout.baseCols,
        createTestPrng(SEED_DETERMINISM + index + 0x100000).shuffle(scenario.layout.objects),
      );
      expect(projectLayout(reordered, scenario.content, options)).toEqual(first);
      checked += 1;
    }
    expect(checked).toBe(SCENARIO_COUNT);
  }, 120_000);
});

describe("属性：不变量（2,600 场景）", () => {
  it("投影无重叠、无越界、不丢对象、全部可访问", () => {
    let checked = 0;
    for (let index = 0; index < SCENARIO_COUNT; index += 1) {
      const scenario = buildScenario(createTestPrng(SEED_INVARIANTS + index));
      const result = projectLayout(scenario.layout, scenario.content, {
        targetColumns: scenario.targetColumns,
        contracts: scenario.contracts,
      });
      const projectedGeometry = projectionToGeometry(result);
      expect(validateGeometry(projectedGeometry.objects, result.columns)).toEqual([]);

      const sourceIds = new Set(scenario.layout.objects.map((item) => item.objectId));
      expect(result.objects.length).toBe(sourceIds.size);
      for (const item of result.objects) {
        expect(sourceIds.has(item.objectId)).toBe(true);
        expect(item.anchor).toBeGreaterThan(0);
        expect(item.colSpan).toBeGreaterThanOrEqual(1);
        expect(item.colSpan).toBeLessThanOrEqual(result.columns);
        expect(item.rowSpan).toBeGreaterThanOrEqual(1);
        expect(item.rowSpan).toBeLessThanOrEqual(MAX_ROW_SPAN);
      }
      expect(result.issues.filter((issue) => issue.reason === "source-invalid")).toEqual([]);
      checked += 1;
    }
    expect(checked).toBe(SCENARIO_COUNT);
  }, 120_000);
});

describe("属性：幂等与无漂移（2,600 场景）", () => {
  it("同列数投影幂等；经过其它列数也不改变权威布局（不链式推导）", () => {
    let checked = 0;
    for (let index = 0; index < SCENARIO_COUNT; index += 1) {
      const scenario = buildScenario(createTestPrng(SEED_IDEMPOTENCE + index));
      const options = { targetColumns: scenario.targetColumns, contracts: scenario.contracts };
      const snapshot = JSON.stringify(scenario.layout);

      const first = projectLayout(scenario.layout, scenario.content, options);
      const again = projectLayout(
        projectionToGeometry(first),
        scenario.content,
        options,
      );
      expect(tupleOf(again)).toEqual(tupleOf(first));

      const otherColumns = scenario.targetColumns === 1 ? 2 : 1;
      projectLayout(scenario.layout, scenario.content, { ...options, targetColumns: otherColumns });
      expect(JSON.stringify(scenario.layout)).toBe(snapshot);

      expect(projectLayout(scenario.layout, scenario.content, options)).toEqual(first);
      checked += 1;
    }
    expect(checked).toBe(SCENARIO_COUNT);
  }, 120_000);
});

describe("属性：配置安全（2,600 场景）", () => {
  it("投影不丢对象/不改内容配置；容器只在目标列数不足时收缩", () => {
    let checked = 0;
    for (let index = 0; index < SCENARIO_COUNT; index += 1) {
      const scenario = buildScenario(createTestPrng(SEED_SAFETY + index));
      const contentSnapshot = JSON.stringify(scenario.content);
      const result = projectLayout(scenario.layout, scenario.content, {
        targetColumns: scenario.targetColumns,
        contracts: scenario.contracts,
      });
      expect(JSON.stringify(scenario.content)).toBe(contentSnapshot);
      expect(result.objects.length).toBe(scenario.layout.objects.length);

      for (const containerNode of scenario.content.containers) {
        const projected = result.objects.find((item) => item.objectId === containerNode.objectId);
        if (projected === undefined) {
          continue;
        }
        const containerContract = scenario.contracts[containerNode.objectId];
        const minFullCols = containerContract?.minFullCols ?? 1;
        const sourceGeometry = scenario.layout.objects.find(
          (item) => item.objectId === containerNode.objectId,
        );
        if (projected.form === "collapsed") {
          // 收缩只有两种合法触发：目标列数低于完整尺寸最小列数，
          // 或完整宽度超过目标列数且没有可用的紧凑档（宽度不足）。
          const widthExceedsTarget =
            sourceGeometry !== undefined && sourceGeometry.colSpan > scenario.targetColumns;
          expect(scenario.targetColumns < minFullCols || widthExceedsTarget).toBe(true);
        } else {
          expect(projected.colSpan).toBeGreaterThanOrEqual(1);
        }
      }

      for (const projected of result.objects) {
        if (projected.objectType === "analysis-card") {
          expect(projected.form).not.toBe("collapsed");
        }
        if (projected.objectType === "spacer") {
          expect(projected.form).toBe("full");
        }
      }
      checked += 1;
    }
    expect(checked).toBe(SCENARIO_COUNT);
  }, 120_000);
});

describe("属性测试规模", () => {
  it("四组属性测试累计场景 ≥ 10^4", () => {
    expect(SCENARIO_COUNT * 4).toBeGreaterThanOrEqual(10_000);
  });
});
