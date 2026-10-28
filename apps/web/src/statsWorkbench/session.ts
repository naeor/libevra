/**
 * 页面会话只转发 D 的正式命令；所有文档转换、校验、历史提交由 D 统一处理。
 * 复制时页面仅提供新身份，复用 insert-card/insert-container，不自行维护快照栈。
 */
import {
  applyCommand,
  createEditorState,
  findEarliestFreeAnchor,
  placementCells,
  validateGeometry,
  type AnalysisCardNode,
  type ContainerNode,
  type EditorState,
  type GridSize,
  type GridSplitConfig,
  type LayoutCommand,
  type LayoutDocumentV1,
  type ObjectGeometry,
} from "@libellum/shared/analysis/layout";

import type { WorkbenchDocuments } from "./storage.js";
import { newObjectId } from "./defaults.js";

export type { EditorState };

export interface SessionResult {
  readonly ok: boolean;
  readonly state: EditorState;
  /** 失败原因的稳定代码（D 的问题码），界面据此给出说明。 */
  readonly problem: string | null;
}

export function startSession(documents: WorkbenchDocuments): EditorState {
  return createEditorState(documents.content, documents.layout);
}

export function sessionDocuments(state: EditorState): WorkbenchDocuments {
  return { content: state.content, layout: state.layout };
}

export function command(state: EditorState, next: LayoutCommand): SessionResult {
  const result = applyCommand(state, next);
  return { ok: result.ok, state: result.state, problem: result.issues[0]?.code ?? null };
}

export function geometryOf(state: EditorState, objectId: string): ObjectGeometry | undefined {
  return state.layout.main.objects.find((object) => object.objectId === objectId);
}

export function containerOf(state: EditorState, objectId: string): ContainerNode | undefined {
  return state.content.containers.find((container) => container.objectId === objectId);
}

export function cardOf(state: EditorState, objectId: string): AnalysisCardNode | undefined {
  return state.content.cards.find((card) => card.objectId === objectId);
}

/** 某张卡片所在的容器（根网格上的卡片返回 `undefined`）。 */
export function parentOf(state: EditorState, cardId: string): ContainerNode | undefined {
  return state.content.containers.find((container) => container.children.includes(cardId));
}

/**
 * 把对象（或新对象）放到 `anchor` 是否合法：**由 D 的 `validateGeometry` 回答**。
 * `objectId` 为 `null` 表示还不在布局里的新对象。
 */
export function placementProblem(
  layout: LayoutDocumentV1,
  objectId: string | null,
  anchor: number,
  size: GridSize,
): string | null {
  const columns = layout.main.baseCols;
  const others = layout.main.objects.filter((object) => object.objectId !== objectId);
  const candidate: ObjectGeometry = {
    objectId: objectId ?? "__candidate__",
    objectType: "spacer",
    anchor,
    colSpan: size.colSpan,
    rowSpan: size.rowSpan,
  };
  const issues = validateGeometry([...others, candidate], columns);
  return issues[0]?.code ?? null;
}

/** 当前占用到的最后一行（编辑态据此在下方多画两行空位，供放置新对象）。 */
export function lastRow(layout: LayoutDocumentV1): number {
  const columns = layout.main.baseCols;
  let last = 0;
  for (const object of layout.main.objects) {
    for (const cell of placementCells(object.anchor, { colSpan: object.colSpan, rowSpan: object.rowSpan }, columns)) {
      last = Math.max(last, Math.ceil(cell / columns));
    }
  }
  return last;
}

/** 新对象默认放在最早的空位（D 的 `findEarliestFreeAnchor`）。 */
export function earliestAnchor(layout: LayoutDocumentV1, size: GridSize, ignoring: string | null = null): number | null {
  const columns = layout.main.baseCols;
  const occupied = new Set<number>();
  for (const object of layout.main.objects) {
    if (object.objectId === ignoring) continue;
    for (const cell of placementCells(object.anchor, { colSpan: object.colSpan, rowSpan: object.rowSpan }, columns)) {
      occupied.add(cell);
    }
  }
  return findEarliestFreeAnchor(occupied, size, columns);
}

/** 原对象之后最近的合法位置（复制品放在原件旁边，而不是跳回页首的空洞）。 */
function anchorAfter(layout: LayoutDocumentV1, from: number, size: GridSize): number | null {
  const limit = (lastRow(layout) + size.rowSpan + 2) * layout.main.baseCols;
  for (let anchor = from; anchor <= limit; anchor += 1) {
    if (placementProblem(layout, null, anchor, size) === null) return anchor;
  }
  return earliestAnchor(layout, size);
}

// ---------------------------------------------------------------------------
// D 正式文档命令的页面适配
// ---------------------------------------------------------------------------

/** 修改卡片自身的配置（标题、展示方式、时间策略、参数）；几何不变。 */
export function updateCard(state: EditorState, card: AnalysisCardNode): SessionResult {
  return command(state, { type: "update-card", card });
}

/**
 * 自定义卡片编辑器的「保存修改」：卡片配置与（必要时的）新尺寸作为**一步**撤销。
 *
 * - 尺寸不变：就是一次 `update-card`；
 * - 尺寸变了：先 `update-card`，再在原位置 `resize`；原位置放不下（邻居挡住）时，用 D 的正式命令在
 *   **同一锚点**重新放入并让后面的对象顺延（`delete` + `insert-card` reflow），卡片身份不变；
 * - 三条命令的历史合并为一条，撤销一次就回到修改前（D 的命令负责全部几何校验，这里不自行改几何）。
 */
export function reconfigureCard(state: EditorState, card: AnalysisCardNode, size: GridSize): SessionResult {
  const geometry = geometryOf(state, card.objectId);
  // 容器里的卡片没有自己的网格位置：只更新配置，尺寸由容器决定。
  if (geometry === undefined) return command(state, { type: "update-card", card });
  const updated = command(state, { type: "update-card", card });
  if (!updated.ok) return updated;
  if (geometry.colSpan === size.colSpan && geometry.rowSpan === size.rowSpan) return updated;
  let resized = command(updated.state, { type: "resize", objectId: card.objectId, colSpan: size.colSpan, rowSpan: size.rowSpan });
  if (!resized.ok) {
    const removed = command(updated.state, { type: "delete", objectId: card.objectId });
    if (!removed.ok) return { ok: false, state, problem: removed.problem };
    // 放回原位置；变宽后从原列放不下（例如右列的 1×1 改成 2×1）就放到同一行的行首，再不行交给 D 找最早的空位。
    const baseCols = removed.state.layout.main.baseCols;
    const rowStart = geometry.anchor - ((geometry.anchor - 1) % baseCols);
    const anchors: (number | undefined)[] = [geometry.anchor, ...(rowStart === geometry.anchor ? [] : [rowStart]), undefined];
    for (const anchor of anchors) {
      resized = command(removed.state, { type: "insert-card", card, size, collisionPolicy: "reflow", ...(anchor === undefined ? {} : { anchor }) });
      if (resized.ok) break;
    }
    if (!resized.ok) return { ok: false, state, problem: resized.problem };
  }
  const past = [...state.history.past, { content: state.content, layout: state.layout, selection: state.selection }].slice(-state.history.limit);
  return { ok: true, state: { ...resized.state, history: { ...resized.state.history, past, future: [] } }, problem: null };
}

/**
 * 插入一个**已填好子卡片**的容器（Carousel 2–6 张、GridSplit 2–4 张，D 的校验规则）。
 * 空容器先在界面的「待填充」草稿里组装，满足最少张数后再一次性插入（OQ-UI-10 的过渡做法）。
 */
export function insertContainer(
  state: EditorState,
  container: ContainerNode,
  children: readonly AnalysisCardNode[],
  anchor: number | null,
  size: GridSize,
): SessionResult {
  return command(state, { type: "insert-container", container, children, size, collisionPolicy: "reflow", ...(anchor === null ? {} : { anchor }) });
}

/**
 * 整体替换容器的子卡片（容器内部编辑「完成」时一次提交）：新增的卡片加入内容文档，
 * 移出的卡片连同其配置一起删除（它们没有独立的网格位置）。整次修改是一步撤销。
 */
export function replaceContainerChildren(
  state: EditorState,
  containerId: string,
  children: readonly AnalysisCardNode[],
  split?: GridSplitConfig,
): SessionResult {
  return command(state, { type: "replace-container-children", containerId, children, ...(split === undefined ? {} : { split }) });
}

/** 删除：卡片/Spacer 走 D 的 delete；容器连同内部卡片整组删除（一步撤销即可整组恢复）。 */
export function removeObject(state: EditorState, objectId: string): SessionResult {
  return command(state, { type: "delete", objectId });
}

/**
 * 复制：生成全新的对象 ID；容器整组深复制（每张子卡片也是新 ID，配置独立，不共享可变对象）。
 * 只复制定义与展示配置，**不复制任何结果**——复制品打开时自己重新计算（OQ-UI-06 建议）。
 */
export function duplicateObject(state: EditorState, objectId: string): SessionResult {
  const geometry = geometryOf(state, objectId);
  if (geometry === undefined) return { ok: false, state, problem: "unknown-object" };
  const size = { colSpan: geometry.colSpan, rowSpan: geometry.rowSpan };
  const anchor = anchorAfter(state.layout, geometry.anchor + 1, size);
  if (anchor === null) return { ok: false, state, problem: "invalid-anchor" };

  if (geometry.objectType === "spacer") {
    return command(state, { type: "insert-spacer", objectId: newObjectId("gap"), anchor, size });
  }
  if (geometry.objectType === "analysis-card") {
    const card = cardOf(state, objectId);
    if (card === undefined) return { ok: false, state, problem: "unknown-object" };
    return command(state, { type: "insert-card", card: { ...structuredClone(card), objectId: newObjectId("card") }, anchor, size });
  }
  const container = containerOf(state, objectId);
  if (container === undefined) return { ok: false, state, problem: "unknown-object" };
  const children = container.children
    .map((id) => cardOf(state, id))
    .filter((card): card is AnalysisCardNode => card !== undefined)
    .map((card) => ({ ...structuredClone(card), objectId: newObjectId("card") }));
  const copy: ContainerNode = { ...structuredClone(container), objectId: newObjectId("box"), children: children.map((child) => child.objectId) };
  return insertContainer(state, copy, children, anchor, size);
}

export function canUndo(state: EditorState): boolean {
  return state.history.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.history.future.length > 0;
}

/** 会话是否与开始时不同（决定「取消」时要不要确认）。 */
export function isDirty(state: EditorState, start: WorkbenchDocuments): boolean {
  return state.content !== start.content || state.layout !== start.layout;
}
