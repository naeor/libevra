/**
 * 测试夹具构造器：只服务本目录的 *.test.ts，不进入生产代码路径。
 * 保持与 `types.ts` 同形，方便测试用简短声明表达布局场景。
 */

import type {
  AnalysisCardNode,
  CarouselNode,
  ContainerNode,
  DegradeReason,
  GridSize,
  GridSplitConfig,
  GridSplitNode,
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutProfile,
  ObjectGeometry,
  ObjectSizeContract,
  ProjectedObject,
  ProjectionResult,
  SpacerNode,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  LAYOUT_ALGORITHM_VERSION,
  LAYOUT_SCHEMA_VERSION,
} from "./types.js";

export const UNIT: GridSize = { colSpan: 1, rowSpan: 1 };

/** 左右两栏、不横向分割。 */
export const SPLIT_HALF: GridSplitConfig = { columnSplitPermille: 500, rowSplitPermille: 0 };

export function size(colSpan: number, rowSpan: number): GridSize {
  return { colSpan, rowSpan };
}

export function analysisCard(objectId: string, analysisId = "an-b01"): AnalysisCardNode {
  return {
    objectId,
    type: "analysis-card",
    analysis: { analysisId, params: {} },
    chart: { chartFamily: "cf-02" },
    rangePolicy: "inherit",
  };
}

export function pinnedCard(objectId: string, from: string, to: string): AnalysisCardNode {
  return {
    ...analysisCard(objectId),
    rangePolicy: "pinned",
    pinnedRange: { from, to },
  };
}

export function gridSplit(
  objectId: string,
  children: readonly string[],
  split: GridSplitConfig = SPLIT_HALF,
): GridSplitNode {
  return { objectId, type: "grid-split", children, split };
}

export function carousel(objectId: string, children: readonly string[]): CarouselNode {
  return { objectId, type: "carousel", children };
}

export function spacer(objectId: string): SpacerNode {
  return { objectId, type: "spacer" };
}

export function contentOf(
  cards: readonly AnalysisCardNode[],
  containers: readonly ContainerNode[] = [],
): WorkbenchContentDocumentV1 {
  return { schemaVersion: 1, cards, containers };
}

export interface ObjectGeometryOptions {
  readonly presentation?: "full" | "collapsed";
  readonly expandedSize?: GridSize;
}

export function object(
  objectId: string,
  objectType: ObjectGeometry["objectType"],
  anchor: number,
  colSpan: number,
  rowSpan: number,
  options: ObjectGeometryOptions = {},
): ObjectGeometry {
  const geometry: {
    objectId: string;
    objectType: ObjectGeometry["objectType"];
    anchor: number;
    colSpan: number;
    rowSpan: number;
    presentation?: "full" | "collapsed";
    expandedSize?: GridSize;
  } = { objectId, objectType, anchor, colSpan, rowSpan };
  if (options.presentation !== undefined) {
    geometry.presentation = options.presentation;
  }
  if (options.expandedSize !== undefined) {
    geometry.expandedSize = options.expandedSize;
  }
  return geometry;
}

export function geometry(baseCols: number, objects: readonly ObjectGeometry[]): LayoutGeometry {
  return { baseCols, objects };
}

export interface LayoutDocumentOptions {
  readonly mode?: "unified" | "independent";
  readonly profiles?: readonly LayoutProfile[];
  readonly previousMain?: LayoutGeometry;
}

/** 构造一份合法的最小布局文档（版本号由调用方按需覆盖）。 */
export function layoutOf(
  main: LayoutGeometry,
  options: LayoutDocumentOptions = {},
): LayoutDocumentV1 {
  const document: {
    schemaVersion: number;
    layoutAlgorithmVersion: number;
    mode: "unified" | "independent";
    main: LayoutGeometry;
    profiles?: readonly LayoutProfile[];
    previousMain?: LayoutGeometry;
  } = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    layoutAlgorithmVersion: LAYOUT_ALGORITHM_VERSION,
    mode: options.mode ?? "unified",
    main,
  };
  if (options.profiles !== undefined) {
    document.profiles = options.profiles;
  }
  if (options.previousMain !== undefined) {
    document.previousMain = options.previousMain;
  }
  return document;
}

export interface SizeContractOptions {
  readonly minSize?: GridSize;
  readonly sizeLadder?: readonly GridSize[];
  readonly compatSize?: GridSize;
  readonly collapsedSize?: GridSize;
  readonly minFullCols?: number;
}

export function contract(objectId: string, options: SizeContractOptions = {}): ObjectSizeContract {
  const result: {
    objectId: string;
    minSize: GridSize;
    sizeLadder: readonly GridSize[];
    compatSize?: GridSize;
    collapsedSize?: GridSize;
    minFullCols?: number;
  } = {
    objectId,
    minSize: options.minSize ?? UNIT,
    sizeLadder: options.sizeLadder ?? [],
  };
  if (options.compatSize !== undefined) {
    result.compatSize = options.compatSize;
  }
  if (options.collapsedSize !== undefined) {
    result.collapsedSize = options.collapsedSize;
  }
  if (options.minFullCols !== undefined) {
    result.minFullCols = options.minFullCols;
  }
  return result;
}

export function contractsOf(
  ...contracts: readonly ObjectSizeContract[]
): Readonly<Record<string, ObjectSizeContract>> {
  const record: Record<string, ObjectSizeContract> = {};
  for (const item of contracts) {
    record[item.objectId] = item;
  }
  return record;
}

export function anchorsOf(result: ProjectionResult): Readonly<Record<string, number>> {
  const anchors: Record<string, number> = {};
  for (const projected of result.objects) {
    anchors[projected.objectId] = projected.anchor;
  }
  return anchors;
}

export function projectedOf(result: ProjectionResult, objectId: string): ProjectedObject {
  const projected = result.objects.find((item) => item.objectId === objectId);
  if (projected === undefined) {
    throw new Error(`投影结果缺少对象 ${objectId}`);
  }
  return projected;
}

export function reasonsOf(result: ProjectionResult, objectId: string): readonly DegradeReason[] {
  return projectedOf(result, objectId).degradedReasons;
}

export function sizesOf(result: ProjectionResult): Readonly<Record<string, GridSize>> {
  const sizes: Record<string, GridSize> = {};
  for (const projected of result.objects) {
    sizes[projected.objectId] = { colSpan: projected.colSpan, rowSpan: projected.rowSpan };
  }
  return sizes;
}
