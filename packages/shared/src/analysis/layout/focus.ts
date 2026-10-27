/**
 * S17 工作台布局编辑器：焦点模型与键盘映射（D-2 前置，headless 纯逻辑）。
 *
 * 权威依据：布局规格 §6「拖动/吸附/缩放/撤销」的键盘与单指针替代表
 * （方向键移动 1 格、Shift+方向键缩放、Delete 删除、菜单等同于键盘）、
 * 所有者规格 §40 D-2（无障碍、键盘替代、触摸与鼠标并行）。
 *
 * 设计边界：
 * - 纯函数，只操作 `EditorState`（不读 DOM、视口、时钟、随机）；
 * - 焦点与选中分离：焦点可移动到任意对象，选中才允许执行破坏性命令；
 * - 快捷键映射只是“默认草案”，最终以 Codex 视觉/交互规范与所有者确认为准。
 */

import type { EditorState, LayoutCommand } from "./commands.js";
import { positionToRowCol } from "./grid.js";
import type { GridSize, LayoutGeometry, ObjectGeometry } from "./types.js";

/** 方向键的四方向（与布局规格 §6 的键盘替代表一致）。 */
export type GridDirection = "up" | "down" | "left" | "right";

/** 键盘输入的最小描述（草案；真实事件由 UI 层归一化后传入）。 */
export interface KeyInput {
  readonly key: string;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
}

interface FocusPosition {
  readonly objectId: string;
  readonly row: number;
  readonly col: number;
  readonly centerRow: number;
  readonly centerCol: number;
}

function focusPositions(geometry: LayoutGeometry): readonly FocusPosition[] {
  const positions: FocusPosition[] = [];
  for (const object of geometry.objects) {
    const { row, col } = positionToRowCol(object.anchor, geometry.baseCols);
    positions.push({
      objectId: object.objectId,
      row,
      col,
      centerRow: row + (object.rowSpan - 1) / 2,
      centerCol: col + (object.colSpan - 1) / 2,
    });
  }
  return positions.sort((left, right) => {
    if (left.row !== right.row) {
      return left.row - right.row;
    }
    if (left.col !== right.col) {
      return left.col - right.col;
    }
    return left.objectId < right.objectId ? -1 : left.objectId > right.objectId ? 1 : 0;
  });
}

/** 当前选中的对象几何；未选中或对象不存在时为 undefined。 */
export function focusedGeometry(state: EditorState): ObjectGeometry | undefined {
  if (state.selection === null) {
    return undefined;
  }
  return state.layout.main.objects.find((object) => object.objectId === state.selection);
}

/** 当前焦点对象 ID；空布局返回 null。 */
export function currentFocus(state: EditorState): string | null {
  if (state.selection !== null) {
    return state.selection;
  }
  const positions = focusPositions(state.layout.main);
  return positions[0]?.objectId ?? null;
}

/**
 * 找当前焦点在指定方向上最近的邻居对象；没有邻居时返回 null。
 * 规则：主距离（该方向轴）优先，其次垂直轴距离，最后按 objectId 稳定排序。
 */
export function findDirectionalNeighbor(
  geometry: LayoutGeometry,
  fromObjectId: string | null,
  direction: GridDirection,
): string | null {
  const positions = focusPositions(geometry);
  if (positions.length === 0) {
    return null;
  }
  const from =
    fromObjectId === null
      ? undefined
      : positions.find((position) => position.objectId === fromObjectId);
  if (from === undefined) {
    return positions[0]?.objectId ?? null;
  }

  let best: FocusPosition | null = null;
  let bestPrimary = Number.POSITIVE_INFINITY;
  let bestSecondary = Number.POSITIVE_INFINITY;

  for (const position of positions) {
    if (position.objectId === from.objectId) {
      continue;
    }
    let primary: number;
    let secondary: number;
    if (direction === "up") {
      primary = from.centerRow - position.centerRow;
      secondary = Math.abs(from.centerCol - position.centerCol);
    } else if (direction === "down") {
      primary = position.centerRow - from.centerRow;
      secondary = Math.abs(from.centerCol - position.centerCol);
    } else if (direction === "left") {
      primary = from.centerCol - position.centerCol;
      secondary = Math.abs(from.centerRow - position.centerRow);
    } else {
      primary = position.centerCol - from.centerCol;
      secondary = Math.abs(from.centerRow - position.centerRow);
    }
    if (primary <= 0) {
      continue;
    }
    const better =
      primary < bestPrimary ||
      (primary === bestPrimary && secondary < bestSecondary) ||
      (primary === bestPrimary &&
        secondary === bestSecondary &&
        best !== null &&
        position.objectId < best.objectId) ||
      (primary === bestPrimary && secondary === bestSecondary && best === null);
    if (better) {
      best = position;
      bestPrimary = primary;
      bestSecondary = secondary;
    }
  }
  return best?.objectId ?? null;
}

/**
 * 移动焦点（不改变布局文档）。选中对象时方向键在编辑模式下是“移动对象”命令，
 * 这里只负责“浏览/无选中”时的焦点移动；UI 层按模式决定调用哪个函数。
 */
export function moveFocus(state: EditorState, direction: GridDirection): EditorState {
  const next = findDirectionalNeighbor(state.layout.main, state.selection, direction);
  if (next === null || next === state.selection) {
    return state;
  }
  return { ...state, selection: next };
}

function currentSize(state: EditorState, objectId: string): GridSize | undefined {
  const object = state.layout.main.objects.find((item) => item.objectId === objectId);
  if (object === undefined) {
    return undefined;
  }
  return { colSpan: object.colSpan, rowSpan: object.rowSpan };
}

/**
 * 编辑模式默认键盘映射（草案）：
 * - 方向键：对象移动 1 格（需有选中对象）；
 * - Shift+方向键：左/右改列跨度、上/下改行跨度（缩到 1 为下限，命令层再校验）；
 * - Delete/Backspace：删除选中对象；
 * - Ctrl/Cmd+Z：撤销；Ctrl/Cmd+Shift+Z 或 Ctrl+Y：重做；
 * - 无选中对象时方向键不改布局（由 UI 调用 `moveFocus` 移动焦点）。
 */
export function commandForKey(state: EditorState, input: KeyInput): LayoutCommand | null {
  const primaryModifier = input.ctrl === true || input.meta === true;
  const selection = state.selection;

  if (primaryModifier) {
    if (input.key === "z" || input.key === "Z") {
      return input.shift === true ? { type: "redo" } : { type: "undo" };
    }
    if (input.key === "y" || input.key === "Y") {
      return { type: "redo" };
    }
    return null;
  }
  if (input.alt === true) {
    return null;
  }
  if (input.key === "Delete" || input.key === "Backspace") {
    return selection === null ? null : { type: "delete", objectId: selection };
  }
  if (selection === null) {
    return null;
  }
  const size = currentSize(state, selection);
  if (size === undefined) {
    return null;
  }
  const shift = input.shift === true;
  switch (input.key) {
    case "ArrowUp":
      return shift
        ? { type: "resize", objectId: selection, rowSpan: Math.max(1, size.rowSpan - 1) }
        : { type: "move-by", objectId: selection, rowDelta: -1, colDelta: 0 };
    case "ArrowDown":
      return shift
        ? { type: "resize", objectId: selection, rowSpan: size.rowSpan + 1 }
        : { type: "move-by", objectId: selection, rowDelta: 1, colDelta: 0 };
    case "ArrowLeft":
      return shift
        ? { type: "resize", objectId: selection, colSpan: Math.max(1, size.colSpan - 1) }
        : { type: "move-by", objectId: selection, rowDelta: 0, colDelta: -1 };
    case "ArrowRight":
      return shift
        ? { type: "resize", objectId: selection, colSpan: size.colSpan + 1 }
        : { type: "move-by", objectId: selection, rowDelta: 0, colDelta: 1 };
    default:
      return null;
  }
}
