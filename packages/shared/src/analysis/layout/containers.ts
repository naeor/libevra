/**
 * D-3.2：容器数据模型与占位语义（headless，不做视觉）。
 *
 * 覆盖：
 * - GridSplit 千分比归一化与槽位语义；
 * - 容器子对象结构校验（数量/重复/嵌套/引用），失败码与 D-1 校验口径一致；
 * - 容器展示形态派生（full/compact/collapsed）与 1×1 占位/恢复的纯数据操作；
 * - 用户主动收缩（`presentation`/`expandedSize`）与自动收缩（投影派生）严格分离。
 *
 * 约束：纯函数、不读写账务数据、不依赖 DOM/视口/时钟；投影仍是唯一“自动收缩”来源，
 * 本模块不写回任何文档，仅为编辑器/集成层提供数据语义与测试锚点。
 */

import type {
  DegradeReason,
  DisplayForm,
  GridSize,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  MAX_CAROUSEL_PAGES,
  MAX_COLUMNS,
  MAX_GRID_SPLIT_CHILDREN,
  MAX_ROW_SPAN,
  MIN_CAROUSEL_PAGES,
  MIN_COLUMNS,
} from "./types.js";
import type { GridSplitConfig } from "./types.js";
import type { ObjectGeometry, ObjectSizeContract } from "./types.js";

/** 容器数据模型的失败码（与 D-1 校验、D-3 修复顺序语义一致；新增项追加在末尾）。 */
export type ContainerFailureCode =
  | "invalid-container-type"
  | "invalid-children-count"
  | "duplicate-child"
  | "child-not-found"
  | "container-nesting"
  | "invalid-split-ratio"
  | "invalid-expanded-size"
  | "invalid-collapsed-size";

/** 容器数据模型问题（路径形如 `$.containers[0].children`，不抛异常）。 */
export interface ContainerIssue {
  readonly path: string;
  readonly code: ContainerFailureCode;
  readonly detail: string;
}

/** GridSplit 的槽位语义：无分割=1、单线=2、两线对齐=4（首期不建模“1大+2小”非对齐槽位）。 */
export interface GridSplitSlots {
  readonly columns: 1 | 2;
  readonly rows: 1 | 2;
  readonly slots: 1 | 2 | 4;
}

/** 容器展示形态的派生结果：form + 实际占格 + 可观察原因。 */
export interface ContainerDisplay {
  readonly form: Exclude<DisplayForm, "compat">;
  readonly size: GridSize;
  readonly reasons: readonly DegradeReason[];
}

const DEFAULT_SPLIT_PERMILLE = 500;

function clampPermille(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.round(value);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 1000) {
    return 1000;
  }
  return rounded;
}

function sanitizeColumns(columns: number): number {
  if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
    return 2;
  }
  return columns;
}

function isPositiveSpan(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

/**
 * GridSplit 千分比归一化：取整、夹到 0–1000；两个方向同时为 0 视为非法，
 * 回退为等分 500/500 并登记 `invalid-split-ratio`（不静默保留不可用配置）。
 */
export function normalizeGridSplitRatios(split: GridSplitConfig): {
  readonly config: GridSplitConfig;
  readonly changed: boolean;
  readonly issues: readonly ContainerIssue[];
} {
  const columnSplitPermille = clampPermille(split.columnSplitPermille);
  const rowSplitPermille = clampPermille(split.rowSplitPermille);
  const issues: ContainerIssue[] = [];
  let nextColumn = columnSplitPermille;
  let nextRow = rowSplitPermille;
  if (columnSplitPermille === 0 && rowSplitPermille === 0) {
    nextColumn = DEFAULT_SPLIT_PERMILLE;
    nextRow = DEFAULT_SPLIT_PERMILLE;
    issues.push({
      path: "split",
      code: "invalid-split-ratio",
      detail: "两个方向的分割比例同时为 0，已回退为等分 500/500",
    });
  }
  const changed = nextColumn !== split.columnSplitPermille || nextRow !== split.rowSplitPermille;
  return {
    config: { columnSplitPermille: nextColumn, rowSplitPermille: nextRow },
    changed,
    issues,
  };
}

/** 由分割线派生槽位语义（只描述几何结构，不约束 children 的分配方式）。 */
export function describeGridSplitSlots(split: GridSplitConfig): GridSplitSlots {
  const columns: 1 | 2 = split.columnSplitPermille > 0 ? 2 : 1;
  const rows: 1 | 2 = split.rowSplitPermille > 0 ? 2 : 1;
  const slots = (columns * rows) as GridSplitSlots["slots"];
  return { columns, rows, slots };
}

/** 容器的子对象数量上下限（错误码与 D-1 校验保持一致）。 */
export function containerChildBounds(
  container: WorkbenchContentDocumentV1["containers"][number],
): { readonly min: number; readonly max: number } {
  if (container.type === "carousel") {
    return { min: MIN_CAROUSEL_PAGES, max: MAX_CAROUSEL_PAGES };
  }
  if (container.type === "grid-split") {
    return { min: 2, max: MAX_GRID_SPLIT_CHILDREN };
  }
  return { min: 1, max: 1 };
}

/**
 * 容器树结构校验（无异常抛出）：数量/重复/引用缺失/嵌套容器。
 * 只做数据语义检查，不检查卡片内容与图表配置（由 D-1 校验负责）。
 */
export function validateContainerTree(
  content: WorkbenchContentDocumentV1,
): readonly ContainerIssue[] {
  const issues: ContainerIssue[] = [];
  const cardIds = new Set(content.cards.map((card) => card.objectId));
  const containerIds = new Set(content.containers.map((container) => container.objectId));
  content.containers.forEach((container, index) => {
    const path = `$.containers[${String(index)}]`;
    if (container.type !== "grid-split" && container.type !== "carousel") {
      issues.push({
        path: `${path}.type`,
        code: "invalid-container-type",
        detail: `未知容器类型：${String((container as { type?: unknown }).type)}`,
      });
      return;
    }
    const bounds = containerChildBounds(container);
    if (container.children.length < bounds.min || container.children.length > bounds.max) {
      issues.push({
        path: `${path}.children`,
        code: "invalid-children-count",
        detail: `${container.type} 子对象数量 ${String(container.children.length)} 不在 ${String(bounds.min)}–${String(bounds.max)} 范围`,
      });
    }
    const seen = new Set<string>();
    for (const childId of container.children) {
      if (seen.has(childId)) {
        issues.push({
          path: `${path}.children`,
          code: "duplicate-child",
          detail: `容器内重复子对象：${childId}`,
        });
        continue;
      }
      seen.add(childId);
      if (containerIds.has(childId)) {
        issues.push({
          path: `${path}.children`,
          code: "container-nesting",
          detail: `首版不允许容器嵌套容器：${childId}`,
        });
        continue;
      }
      if (!cardIds.has(childId)) {
        issues.push({
          path: `${path}.children`,
          code: "child-not-found",
          detail: `容器子对象不存在于内容文档：${childId}`,
        });
      }
    }
  });
  return issues;
}

/**
 * 容器展示形态派生（与投影规则一致，供编辑器/集成层复用）：
 * - 用户主动 `presentation === "collapsed"` → collapsed（`user-collapsed`，不可被自动恢复）；
 * - 完整宽度大于目标列数且无合法紧凑档 → collapsed（`width-overflow`）；
 * - 目标列数小于容器 `minFullCols` → collapsed（`container-narrow`）；
 * - 有合法紧凑档 → compact；否则 full。
 */
export function deriveContainerDisplay(
  geometry: ObjectGeometry,
  targetColumns: number,
  contract?: ObjectSizeContract,
): ContainerDisplay {
  const columns = sanitizeColumns(targetColumns);
  const collapsedSize = sanitizeCollapsedSize(contract?.collapsedSize);
  if (geometry.presentation === "collapsed") {
    return { form: "collapsed", size: collapsedSize, reasons: ["user-collapsed"] };
  }
  const fullSize: GridSize = geometry.expandedSize ?? {
    colSpan: geometry.colSpan,
    rowSpan: geometry.rowSpan,
  };
  const reasons: DegradeReason[] = [];
  if (contract?.minFullCols !== undefined && columns < contract.minFullCols) {
    return {
      form: "collapsed",
      size: collapsedSize,
      reasons: ["container-narrow"],
    };
  }
  if (fullSize.colSpan > columns) {
    reasons.push("width-overflow");
    const ladder = contract?.sizeLadder ?? [];
    for (const candidate of ladder) {
      if (candidate.colSpan <= columns && candidate.colSpan >= 1 && candidate.rowSpan >= 1) {
        return { form: "compact", size: candidate, reasons };
      }
    }
    return { form: "collapsed", size: collapsedSize, reasons };
  }
  return { form: "full", size: fullSize, reasons };
}

function sanitizeCollapsedSize(size: GridSize | undefined): GridSize {
  if (size === undefined) {
    return { colSpan: 1, rowSpan: 1 };
  }
  if (!isPositiveSpan(size.colSpan, MAX_COLUMNS) || !isPositiveSpan(size.rowSpan, MAX_ROW_SPAN)) {
    return { colSpan: 1, rowSpan: 1 };
  }
  return { colSpan: size.colSpan, rowSpan: size.rowSpan };
}

/**
 * 用户主动收缩：记录 `expandedSize` 并把占格改为收缩尺寸（默认 1×1）。
 * 已是 collapsed 时原样返回（幂等）；纯函数，不修改输入。
 */
export function collapseContainerGeometry(
  geometry: ObjectGeometry,
  collapsedSize: GridSize = { colSpan: 1, rowSpan: 1 },
): ObjectGeometry {
  if (geometry.presentation === "collapsed") {
    return geometry;
  }
  const size = sanitizeCollapsedSize(collapsedSize);
  return {
    objectId: geometry.objectId,
    objectType: geometry.objectType,
    anchor: geometry.anchor,
    colSpan: size.colSpan,
    rowSpan: size.rowSpan,
    presentation: "collapsed",
    expandedSize: {
      colSpan: geometry.expandedSize?.colSpan ?? geometry.colSpan,
      rowSpan: geometry.expandedSize?.rowSpan ?? geometry.rowSpan,
    },
  };
}

/**
 * 用户主动恢复：使用 `expandedSize` 还原完整尺寸并清除收缩字段。
 * 非 collapsed 时原样返回（幂等）；纯函数，不修改输入。
 */
export function restoreContainerGeometry(geometry: ObjectGeometry): ObjectGeometry {
  if (geometry.presentation !== "collapsed") {
    return geometry;
  }
  const size = geometry.expandedSize ?? {
    colSpan: geometry.colSpan,
    rowSpan: geometry.rowSpan,
  };
  return {
    objectId: geometry.objectId,
    objectType: geometry.objectType,
    anchor: geometry.anchor,
    colSpan: size.colSpan,
    rowSpan: size.rowSpan,
  };
}

/** 是否为用户主动收缩（权威布局字段，非投影派生）。 */
export function isUserCollapsed(geometry: ObjectGeometry): boolean {
  return geometry.presentation === "collapsed";
}

/** 是否为 1×1 占位形态（投影形态或权威尺寸任一成立即可，用于入口按钮显示判断）。 */
export function isPlaceholderForm(form: DisplayForm, size: GridSize): boolean {
  return form === "collapsed" || (size.colSpan === 1 && size.rowSpan === 1);
}
