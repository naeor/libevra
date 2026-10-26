/**
 * 纯几何布局（C-3 草案，web 侧）：旭日图 / 矩形树图 / 层级桑基图。
 *
 * 只接收**已归一化的 number**（0..1 份额与像素尺寸），返回 SVG 坐标。
 * 不做任何财务计算：金额/占比 → 归一化在适配层完成；这里只负责
 * 「摆在哪里、多宽多高、弧从几度到几度」。因此几何层可脱离 DOM 单测，
 * 也不会把「金额权威」偷偷搬到 web（与 geometry.ts/geometry2/3 同一原则）。
 */

import type { LayoutBox } from "./geometry.js";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number, received: ${String(value)}`);
  }
}

/* ------------------------------------------------------------------------- *
 * 旭日图（P05 / CF-09 变体）
 * ------------------------------------------------------------------------- */

/** 旭日图节点输入：只含画图需要的结构，份额已由适配层算好。 */
export interface SunburstArcNode {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly depth: number;
  /** 占父节点子树金额的份额（0..1）；根节点为 null。 */
  readonly fractionOfParent: number | null;
}

export interface SunburstLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** 中心内半径占外半径的比例，默认 0.18。 */
  readonly innerRadiusRatio?: number;
  /** 兄弟弧之间留的角隙（占父弧跨度的比例），默认 0。 */
  readonly gapFraction?: number;
}

export interface SunburstArc {
  readonly nodeId: string;
  /** 环号：0 = 根（中心环），1 = 顶层分类，… */
  readonly ringIndex: number;
  /** 角度制；0° 向上、顺时针增大（与 `lib/chart/geometry` 的 polarToCartesian 一致）。 */
  readonly startAngle: number;
  readonly endAngle: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
}

/**
 * 计算旭日图每个节点的扇区。
 *
 * 子节点按份额降序、`nodeId` 升序稳定排序；父级扇区跨度 × 子份额 = 子扇区跨度。
 * 份额之和小于 1 时余量留空（不把缺失画成某个分类）；大于 1 的输入按 1 截断。
 */
export function computeSunburstArcs(
  nodes: readonly SunburstArcNode[],
  options: SunburstLayoutOptions,
): readonly SunburstArc[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");
  if (nodes.length === 0) return [];

  const outerRadius = Math.min(options.width, options.height) / 2;
  const innerRatio = clamp01(options.innerRadiusRatio ?? 0.18);
  const gapFraction = clamp01(options.gapFraction ?? 0);

  const maxDepth = nodes.reduce((max, node) => (node.depth > max ? node.depth : max), 0);
  const ringCount = maxDepth + 1;
  const innerBase = outerRadius * Math.min(innerRatio, 0.8);
  const ringWidth = (outerRadius - innerBase) / ringCount;

  const ids = new Set(nodes.map((node) => node.nodeId));
  const childrenOf = new Map<string, SunburstArcNode[]>();
  const roots: SunburstArcNode[] = [];

  for (const node of nodes) {
    if (node.parentId === null || !ids.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    const bucket = childrenOf.get(node.parentId);
    if (bucket === undefined) childrenOf.set(node.parentId, [node]);
    else bucket.push(node);
  }

  const sortSiblings = (siblings: SunburstArcNode[]): void => {
    siblings.sort((left, right) => {
      const leftFraction = left.fractionOfParent ?? 0;
      const rightFraction = right.fractionOfParent ?? 0;
      if (leftFraction !== rightFraction) return rightFraction - leftFraction;
      return left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0;
    });
  };

  const arcs: SunburstArc[] = [];

  const visit = (node: SunburstArcNode, startAngle: number, span: number): void => {
    const ringIndex = Math.max(0, node.depth);
    const innerRadius = innerBase + ringIndex * ringWidth;
    const outer = innerBase + (ringIndex + 1) * ringWidth;
    const gap = Math.max(0, span * gapFraction);

    arcs.push({
      nodeId: node.nodeId,
      ringIndex,
      startAngle: startAngle + gap / 2,
      endAngle: startAngle + span - gap / 2,
      innerRadius,
      outerRadius: outer,
    });

    const children = childrenOf.get(node.nodeId);
    if (children === undefined || children.length === 0) return;

    sortSiblings(children);
    let cursor = startAngle;
    for (const child of children) {
      const childSpan = span * clamp01(child.fractionOfParent ?? 0);
      visit(child, cursor, childSpan);
      cursor += childSpan;
    }
  };

  const rootSpan = 360 / roots.length;
  roots.forEach((root, index) => {
    visit(root, index * rootSpan, rootSpan);
  });

  arcs.sort((left, right) => {
    if (left.ringIndex !== right.ringIndex) return left.ringIndex - right.ringIndex;
    return left.startAngle - right.startAngle;
  });

  return arcs;
}

/* ------------------------------------------------------------------------- *
 * 矩形树图（P06 / CF-09）
 * ------------------------------------------------------------------------- */

export interface TreemapItem {
  readonly nodeId: string;
  /** 占总金额的份额（0..1）。 */
  readonly fractionOfTotal: number;
}

export interface TreemapLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** 矩形之间的间隙（像素），默认 0。 */
  readonly gap?: number;
}

export interface TreemapBox {
  readonly nodeId: string;
  readonly box: LayoutBox;
}

/**
 * 用 squarified 算法把「金额占比」铺成面积成比例的矩形。
 *
 * 面积 = 份额 × 画布面积（有 gap 时向内收缩）；排序用份额降序 + nodeId 升序，
 * 保证同样输入永远得到同一组矩形（与视图渲染顺序无关）。
 */
export function computeTreemapBoxes(
  items: readonly TreemapItem[],
  options: TreemapLayoutOptions,
): readonly TreemapBox[] {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  const gap = Math.max(0, options.gap ?? 0);
  const positive = items
    .filter((item) => Number.isFinite(item.fractionOfTotal) && item.fractionOfTotal > 0)
    .sort((left, right) => {
      if (left.fractionOfTotal !== right.fractionOfTotal) {
        return right.fractionOfTotal - left.fractionOfTotal;
      }
      return left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0;
    });

  if (positive.length === 0) return [];

  const fractionSum = positive.reduce((sum, item) => sum + item.fractionOfTotal, 0);
  const totalArea = options.width * options.height;
  const scale = totalArea / fractionSum;
  const values = positive.map((item) => ({
    nodeId: item.nodeId,
    value: item.fractionOfTotal * scale,
  }));

  const results: TreemapBox[] = [];
  const shrink = (box: LayoutBox): LayoutBox => {
    const half = gap / 2;
    return {
      x: box.x + half,
      y: box.y + half,
      width: Math.max(0, box.width - gap),
      height: Math.max(0, box.height - gap),
    };
  };

  let rect: LayoutBox = { x: 0, y: 0, width: options.width, height: options.height };
  let index = 0;

  const worstOf = (row: readonly { value: number }[], side: number): number => {
    const total = row.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) return Number.POSITIVE_INFINITY;
    let max = 0;
    let min = Number.POSITIVE_INFINITY;
    for (const item of row) {
      if (item.value > max) max = item.value;
      if (item.value < min) min = item.value;
    }
    if (min <= 0) return Number.POSITIVE_INFINITY;
    const sideSquared = side * side;
    return Math.max(
      (sideSquared * max) / (total * total),
      (total * total) / (sideSquared * min),
    );
  };

  while (index < values.length) {
    const row: { nodeId: string; value: number }[] = [];
    const side = Math.max(1, Math.min(rect.width, rect.height));

    while (index < values.length) {
      const candidate = values[index];
      if (candidate === undefined) break;
      if (row.length === 0) {
        row.push(candidate);
        index += 1;
        continue;
      }
      const withCandidate = worstOf([...row, candidate], side);
      if (withCandidate <= worstOf(row, side)) {
        row.push(candidate);
        index += 1;
      } else {
        break;
      }
    }

    const rowTotal = row.reduce((sum, item) => sum + item.value, 0);
    if (rowTotal <= 0) break;

    if (rect.width >= rect.height) {
      const rowWidth = Math.min(rect.width, rowTotal / Math.max(1, rect.height));
      let y = rect.y;
      for (const item of row) {
        const height = item.value / Math.max(1e-9, rowWidth);
        results.push({
          nodeId: item.nodeId,
          box: shrink({ x: rect.x, y, width: rowWidth, height }),
        });
        y += height;
      }
      rect = {
        x: rect.x + rowWidth,
        y: rect.y,
        width: Math.max(0, rect.width - rowWidth),
        height: rect.height,
      };
    } else {
      const rowHeight = Math.min(rect.height, rowTotal / Math.max(1, rect.width));
      let x = rect.x;
      for (const item of row) {
        const width = item.value / Math.max(1e-9, rowHeight);
        results.push({
          nodeId: item.nodeId,
          box: shrink({ x, y: rect.y, width, height: rowHeight }),
        });
        x += width;
      }
      rect = {
        x: rect.x,
        y: rect.y + rowHeight,
        width: rect.width,
        height: Math.max(0, rect.height - rowHeight),
      };
    }
  }

  return results;
}

/* ------------------------------------------------------------------------- *
 * 层级桑基图（P07 / CF-09）
 * ------------------------------------------------------------------------- */

export interface SankeyLayoutNodeInput {
  readonly nodeId: string;
  readonly depth: number;
  /** max(流入, 流出) / 总额（0..1）；用于节点高度。 */
  readonly valueFraction: number;
}

export interface SankeyLayoutLinkInput {
  readonly fromId: string;
  readonly toId: string;
  /** 连线金额 / 总额（0..1）；用于连线厚度。 */
  readonly fractionOfTotal: number;
}

export interface SankeyLayoutOptions {
  readonly width: number;
  readonly height: number;
  /** 节点宽度占画布宽的比例，默认 0.14。 */
  readonly nodeWidthRatio?: number;
  /** 同列节点之间的竖向间隙（像素），默认 6。 */
  readonly rowGap?: number;
}

export interface SankeyNodeBox {
  readonly nodeId: string;
  readonly depth: number;
  readonly box: LayoutBox;
}

export interface SankeyLinkGeometry {
  readonly fromId: string;
  readonly toId: string;
  readonly thickness: number;
  readonly sourceX: number;
  readonly targetX: number;
  readonly sourceTop: number;
  readonly targetTop: number;
}

export interface SankeyLayout {
  readonly nodes: readonly SankeyNodeBox[];
  readonly links: readonly SankeyLinkGeometry[];
  readonly nodeWidth: number;
  readonly columnX: readonly number[];
  /** 每列的像素/份额比例（用于测试与调试；不参与业务金额）。 */
  readonly columnScale: readonly number[];
}

/**
 * 计算层级桑基的节点矩形与连线端点。
 *
 * 每列独立按该列份额之和缩放到画布高度（守恒时各列总和相同），同列节点按
 * 输入顺序自上而下排列；连线厚度 = 金额份额 × 源列比例，同一节点的流出厚度
 * 之和等于该节点高度（守恒的可视化条件）。
 */
export function computeSankeyLayout(
  nodes: readonly SankeyLayoutNodeInput[],
  links: readonly SankeyLayoutLinkInput[],
  options: SankeyLayoutOptions,
): SankeyLayout {
  assertPositive(options.width, "width");
  assertPositive(options.height, "height");

  if (nodes.length === 0) {
    return { nodes: [], links: [], nodeWidth: 0, columnX: [], columnScale: [] };
  }

  const nodeWidthRatio = clamp01(options.nodeWidthRatio ?? 0.14) || 0.14;
  const rowGap = Math.max(0, options.rowGap ?? 6);
  const maxDepth = nodes.reduce((max, node) => (node.depth > max ? node.depth : max), 0);
  const columnCount = maxDepth + 1;
  const nodeWidth = Math.max(1, Math.min(options.width, options.width * nodeWidthRatio));
  const columnGap =
    columnCount > 1 ? Math.max(0, (options.width - nodeWidth * columnCount) / (columnCount - 1)) : 0;

  const columnX = Array.from({ length: columnCount }, (_, index) => index * (nodeWidth + columnGap));

  const byDepth = new Map<number, SankeyLayoutNodeInput[]>();
  for (const node of nodes) {
    const depth = Math.max(0, Math.min(maxDepth, node.depth));
    const bucket = byDepth.get(depth);
    if (bucket === undefined) byDepth.set(depth, [node]);
    else bucket.push(node);
  }

  const boxes = new Map<string, SankeyNodeBox>();
  const columnScale: number[] = [];

  for (let depth = 0; depth < columnCount; depth += 1) {
    const columnNodes = byDepth.get(depth) ?? [];
    const total = columnNodes.reduce((sum, node) => sum + Math.max(0, node.valueFraction), 0);
    const usable = Math.max(0, options.height - rowGap * Math.max(0, columnNodes.length - 1));
    // 份额本身是「占总额」的比例：分母用 max(列合计, 1)，不做逐列拉满。
    // 这样各列同一比例尺，守恒时列高正好铺满；不完整列留白而不是被放大。
    const scale = total > 0 ? usable / Math.max(total, 1) : 0;
    columnScale[depth] = scale;

    let cursor = 0;
    for (const node of columnNodes) {
      const height = Math.max(0, node.valueFraction) * scale;
      const box: LayoutBox = {
        x: columnX[depth] ?? 0,
        y: cursor,
        width: nodeWidth,
        height,
      };
      boxes.set(node.nodeId, { nodeId: node.nodeId, depth, box });
      cursor += height + rowGap;
    }
  }

  const outflowCursor = new Map<string, number>();
  const inflowCursor = new Map<string, number>();
  const linkGeometries: SankeyLinkGeometry[] = [];

  for (const link of links) {
    const source = boxes.get(link.fromId);
    const target = boxes.get(link.toId);
    if (source === undefined || target === undefined) continue;

    const sourceScale = columnScale[source.depth] ?? 0;
    const thickness = Math.max(0, link.fractionOfTotal) * sourceScale;
    const sourceY = outflowCursor.get(link.fromId) ?? source.box.y;
    const targetY = inflowCursor.get(link.toId) ?? target.box.y;

    linkGeometries.push({
      fromId: link.fromId,
      toId: link.toId,
      thickness,
      sourceX: source.box.x + source.box.width,
      targetX: target.box.x,
      sourceTop: sourceY,
      targetTop: targetY,
    });

    outflowCursor.set(link.fromId, sourceY + thickness);
    inflowCursor.set(link.toId, targetY + thickness);
  }

  return {
    nodes: [...boxes.values()],
    links: linkGeometries,
    nodeWidth,
    columnX,
    columnScale,
  };
}
