/**
 * 布局编辑会话：**Agent D 的编辑器状态 + 命令**，加上 D 自己列为「待扩展」的几项操作的过渡适配。
 *
 * ⚠️ **不是第二套布局引擎。** 位置是否合法、是否重叠、是否越界，全部由 D 的
 * `applyCommand` / `validateGeometry` / `validateContentDocumentV1` 判断；撤销/重做用 D 的
 * `EditorState.history` 快照栈（上限同 D，50 步）。
 *
 * D 的命令目前只有 select / move / move-by / resize / set-presentation / insert-card /
 * insert-spacer / delete / undo / redo。D 设计稿 §6 自己登记了缺口：插入容器、容器内部增删排序、
 * 整组复制、配置面板提交。在 D 交付这些命令之前，下面的 `transact*` 函数把它们实现为
 * 「整份文档的一次转换 → 用 D 的校验器检查 → 合法才入撤销栈」，失败时状态原样返回。
 * D 交付正式命令后，只需把这些函数换成对应命令，界面不变。
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
  type LayoutCommand,
  type LayoutDocumentV1,
  type ObjectGeometry,
  type WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";

import { documentsProblems, type WorkbenchDocuments } from "./storage.js";
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

/** 与 D 的 `recordChange` 相同的语义：入栈当前快照、清空重做、限制深度。 */
function transact(
  state: EditorState,
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  selection: string | null,
): SessionResult {
  const problems = documentsProblems({ content, layout });
  if (problems.length > 0) {
    return { ok: false, state, problem: problems[0]?.split(":").pop() ?? "invalid" };
  }
  const limit = state.history.limit;
  const past = [...state.history.past, { content: state.content, layout: state.layout, selection: state.selection }].slice(-limit);
  return { ok: true, state: { content, layout, selection, history: { past, future: [], limit } }, problem: null };
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
// D 尚未提供的操作（过渡适配，见文件头）
// ---------------------------------------------------------------------------

/** 修改卡片自身的配置（标题、展示方式、时间策略、参数）；几何不变。 */
export function updateCard(state: EditorState, card: AnalysisCardNode): SessionResult {
  if (cardOf(state, card.objectId) === undefined) return { ok: false, state, problem: "unknown-object" };
  const content: WorkbenchContentDocumentV1 = {
    ...state.content,
    cards: state.content.cards.map((existing) => (existing.objectId === card.objectId ? card : existing)),
  };
  return transact(state, content, state.layout, state.selection);
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
  const place = anchor ?? earliestAnchor(state.layout, size);
  if (place === null) return { ok: false, state, problem: "invalid-anchor" };
  const content: WorkbenchContentDocumentV1 = {
    ...state.content,
    cards: [...state.content.cards, ...children],
    containers: [...state.content.containers, container],
  };
  const layout: LayoutDocumentV1 = {
    ...state.layout,
    main: {
      ...state.layout.main,
      objects: [
        ...state.layout.main.objects,
        { objectId: container.objectId, objectType: container.type, anchor: place, colSpan: size.colSpan, rowSpan: size.rowSpan },
      ],
    },
  };
  return transact(state, content, layout, container.objectId);
}

/**
 * 整体替换容器的子卡片（容器内部编辑「完成」时一次提交）：新增的卡片加入内容文档，
 * 移出的卡片连同其配置一起删除（它们没有独立的网格位置）。整次修改是一步撤销。
 */
export function replaceContainerChildren(
  state: EditorState,
  containerId: string,
  children: readonly AnalysisCardNode[],
): SessionResult {
  const container = containerOf(state, containerId);
  if (container === undefined) return { ok: false, state, problem: "unknown-object" };
  const keep = new Set(children.map((child) => child.objectId));
  const removed = new Set(container.children.filter((id) => !keep.has(id)));
  const existing = new Set(state.content.cards.map((card) => card.objectId));
  const updated = new Map(children.map((child) => [child.objectId, child] as const));
  const content: WorkbenchContentDocumentV1 = {
    ...state.content,
    cards: [
      ...state.content.cards.filter((card) => !removed.has(card.objectId)).map((card) => updated.get(card.objectId) ?? card),
      ...children.filter((child) => !existing.has(child.objectId)),
    ],
    containers: state.content.containers.map((item) =>
      item.objectId === containerId ? { ...item, children: children.map((child) => child.objectId) } : item,
    ),
  };
  return transact(state, content, state.layout, containerId);
}

/** 删除：卡片/Spacer 走 D 的 delete；容器连同内部卡片整组删除（一步撤销即可整组恢复）。 */
export function removeObject(state: EditorState, objectId: string): SessionResult {
  const container = containerOf(state, objectId);
  if (container === undefined) return command(state, { type: "delete", objectId });
  const children = new Set(container.children);
  const content: WorkbenchContentDocumentV1 = {
    ...state.content,
    cards: state.content.cards.filter((card) => !children.has(card.objectId)),
    containers: state.content.containers.filter((item) => item.objectId !== objectId),
  };
  const layout: LayoutDocumentV1 = {
    ...state.layout,
    main: { ...state.layout.main, objects: state.layout.main.objects.filter((object) => object.objectId !== objectId) },
  };
  return transact(state, content, layout, null);
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
