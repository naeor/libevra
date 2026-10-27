/**
 * S17 工作台布局编辑核心命令（D-2 前置，headless 纯逻辑）。
 *
 * 权威依据：
 * - `docs/specs/product/s17-agents/S17-Agent-D-完整开发规格-所有者-20261027.md`
 *   §40 D-2（显式编辑模式、移动/缩放/保存取消/撤销重做/键盘替代）、§7（位置冲突未决）。
 * - `docs/specs/design/S17-工作台布局与格式模板规格.md` §3（模式）、§6（拖动/键盘/撤销）、
 *   §10（保存）、§13–§15（迁移与降级）。
 *
 * 设计边界：
 * - **纯函数**：命令只做“文档转换”，不改入参对象、不读时钟/视口/随机/账务数据；
 * - 每次命令都经过「结构校验 + 几何校验 + 内容/布局一致性校验」，失败时**返回原状态**并给出问题；
 * - 不写 UI 视觉/样式/动效；不接页面；不冻结公共接口（草案，S-03 评审后再定）；
 * - 撤销/重做用快照栈（上限默认 50，候选值，规格 §6）。草稿是否落本地仍是 OQ-CF-02（先不落）。
 */

import type {
  AnalysisCardNode,
  GridSize,
  LayoutDocumentV1,
  LayoutGeometry,
  LayoutValidationIssue,
  MigrationStrategy,
  ObjectGeometry,
  ObjectSizeContract,
  ProjectionResult,
  WorkbenchContentDocumentV1,
} from "./types.js";
import {
  MAX_CONTAINERS_PER_WORKBENCH,
  MAX_OBJECTS_PER_WORKBENCH,
  MAX_ROW_SPAN,
} from "./types.js";
import {
  findEarliestFreeAnchor,
  placementCells,
  positionToRowCol,
  rowColToPosition,
  validateGeometry,
} from "./grid.js";
import { validateContentDocumentV1, validateLayoutDocumentV1 } from "./validation.js";
import { projectLayout } from "./projection.js";

/** 撤销栈上限候选值（布局规格 §6：10–50，先取 50；最终由所有者/原型确认）。 */
export const DEFAULT_UNDO_LIMIT = 50;

/** 撤销/重做使用的文档快照（内容 + 布局 + 选中对象）。 */
export interface EditorSnapshot {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
  readonly selection: string | null;
}

export interface EditorHistory {
  readonly past: readonly EditorSnapshot[];
  readonly future: readonly EditorSnapshot[];
  readonly limit: number;
}

/**
 * 编辑器状态：权威文档 + 当前选中对象 + 撤销栈。
 * 编辑会话本身（模式、手势阶段）在 `machine.ts`，两者通过 UI 层组合，互不依赖。
 */
export interface EditorState {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
  readonly selection: string | null;
  readonly history: EditorHistory;
}

export interface CreateEditorStateOptions {
  /** 撤销栈上限（候选值 50）；用于测试缩小栈验证截断。 */
  readonly undoLimit?: number;
}

/** 命令执行结果；失败时 `state` 原样返回，`issues` 说明原因。 */
export interface CommandResult {
  readonly ok: boolean;
  readonly state: EditorState;
  readonly issues: readonly LayoutValidationIssue[];
  /** 仅在调用方给出 `targetColumns` 时附带，便于编辑器预览“当前列数下的结果”。 */
  readonly projection?: ProjectionResult;
}

/** 创建编辑器初始状态：不修改入参，不自动补位。 */
export function createEditorState(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  options: CreateEditorStateOptions = {},
): EditorState {
  return {
    content,
    layout,
    selection: null,
    history: { past: [], future: [], limit: options.undoLimit ?? DEFAULT_UNDO_LIMIT },
  };
}

/** 编辑命令（草案）。insert/delete 只覆盖空对象与卡片；容器插入留 W5（见 D-2 文档）。 */
export type LayoutCommand =
  | { readonly type: "select"; readonly objectId: string | null }
  | { readonly type: "move"; readonly objectId: string; readonly anchor: number }
  | {
      readonly type: "move-by";
      readonly objectId: string;
      readonly rowDelta: number;
      readonly colDelta: number;
    }
  | {
      readonly type: "resize";
      readonly objectId: string;
      readonly colSpan?: number;
      readonly rowSpan?: number;
    }
  | {
      readonly type: "set-presentation";
      readonly objectId: string;
      readonly presentation: "full" | "collapsed";
    }
  | {
      readonly type: "insert-card";
      readonly card: AnalysisCardNode;
      readonly anchor?: number;
      readonly size?: GridSize;
    }
  | {
      readonly type: "insert-spacer";
      readonly objectId: string;
      readonly anchor?: number;
      readonly size?: GridSize;
    }
  | { readonly type: "delete"; readonly objectId: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export interface ApplyCommandOptions {
  /** 覆盖撤销栈上限（默认取状态中的 limit）。 */
  readonly historyLimit?: number;
  /** 给出目标列数时附带投影预览（不写回、不改变编辑命令语义）。 */
  readonly targetColumns?: number;
  readonly contracts?: Readonly<Record<string, ObjectSizeContract>>;
  readonly strategy?: MigrationStrategy;
}

const INSERT_DEFAULT_SIZE: GridSize = { colSpan: 1, rowSpan: 1 };

function issue(code: string, detail: string, objectId?: string): LayoutValidationIssue {
  return objectId === undefined ? { code, detail } : { objectId, code, detail };
}

function snapshotOf(state: EditorState): EditorSnapshot {
  return { content: state.content, layout: state.layout, selection: state.selection };
}

/** 应用一次新文档：入栈当前快照、清空 redo、限制栈深度。 */
function recordChange(
  state: EditorState,
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  selection: string | null,
  historyLimit?: number,
): EditorState {
  const limit = Math.max(1, historyLimit ?? state.history.limit);
  const past = [...state.history.past, snapshotOf(state)].slice(-limit);
  return { content, layout, selection, history: { past, future: [], limit } };
}

function findGeometry(layout: LayoutDocumentV1, objectId: string): ObjectGeometry | undefined {
  return layout.main.objects.find((object) => object.objectId === objectId);
}

function withMain(layout: LayoutDocumentV1, main: LayoutGeometry): LayoutDocumentV1 {
  return { ...layout, main };
}

function occupiedCells(geometry: LayoutGeometry): Set<number> {
  const cells = new Set<number>();
  for (const object of geometry.objects) {
    for (const cell of placementCells(
      object.anchor,
      { colSpan: object.colSpan, rowSpan: object.rowSpan },
      geometry.baseCols,
    )) {
      cells.add(cell);
    }
  }
  return cells;
}

/** 内容/布局交叉一致性：布局对象必须能在内容文档中找到来源（Spacer 除外）。 */
function crossDocumentIssues(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
): readonly LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];
  const cardIds = new Set(content.cards.map((card) => card.objectId));
  const containerIds = new Set(content.containers.map((container) => container.objectId));
  const seen = new Set<string>();
  for (const object of layout.main.objects) {
    if (seen.has(object.objectId)) {
      issues.push(
        issue("duplicate-object-id", "布局对象 objectId 重复", object.objectId),
      );
      continue;
    }
    seen.add(object.objectId);
    if (object.objectType === "analysis-card" && !cardIds.has(object.objectId)) {
      issues.push(
        issue("orphan-dropped", "布局里有卡片，但内容文档中不存在该卡片", object.objectId),
      );
    }
    if (
      (object.objectType === "grid-split" || object.objectType === "carousel") &&
      !containerIds.has(object.objectId)
    ) {
      issues.push(
        issue("orphan-dropped", "布局里有容器，但内容文档中不存在该容器", object.objectId),
      );
    }
  }
  const duplicatedCards = new Set<string>();
  for (const card of content.cards) {
    if (duplicatedCards.has(card.objectId)) {
      issues.push(issue("duplicate-object-id", "内容文档卡片 objectId 重复", card.objectId));
    }
    duplicatedCards.add(card.objectId);
  }
  return issues;
}

/** 校验文档结构与几何（不写回、不抛异常）。 */
function documentIssues(
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
): readonly LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];

  const contentResult = validateContentDocumentV1(content);
  if (!contentResult.ok) {
    for (const problem of contentResult.issues) {
      issues.push(issue(problem.code, `内容文档 ${problem.path}：${problem.detail}`));
    }
  }

  const layoutResult = validateLayoutDocumentV1(layout);
  if (!layoutResult.ok) {
    for (const problem of layoutResult.issues) {
      issues.push(issue(problem.code, `布局文档 ${problem.path}：${problem.detail}`));
    }
  }

  issues.push(...validateGeometry(layout.main.objects, layout.main.baseCols));
  for (const profile of layout.profiles ?? []) {
    const profileIssues = validateGeometry(profile.geometry.objects, profile.geometry.baseCols);
    for (const profileIssue of profileIssues) {
      issues.push(
        issue(profileIssue.code, `档案 ${profile.profileKey}：${profileIssue.detail}`, profileIssue.objectId),
      );
    }
  }

  issues.push(...crossDocumentIssues(content, layout));
  return issues;
}

/** 构造成功结果；根据 options 附带投影预览。 */
function successResult(
  state: EditorState,
  options: ApplyCommandOptions,
): CommandResult {
  const projection =
    options.targetColumns === undefined
      ? undefined
      : projectLayout(state.layout.main, state.content, {
          targetColumns: options.targetColumns,
          ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
          ...(options.strategy === undefined ? {} : { strategy: options.strategy }),
        });
  return projection === undefined
    ? { ok: true, state, issues: [] }
    : { ok: true, state, issues: [], projection };
}

function failure(state: EditorState, issues: readonly LayoutValidationIssue[]): CommandResult {
  return { ok: false, state, issues };
}

/** 应用命令：文档转换 → 校验 →（可选）投影。失败时状态不变。 */
export function applyCommand(
  state: EditorState,
  command: LayoutCommand,
  options: ApplyCommandOptions = {},
): CommandResult {
  switch (command.type) {
    case "select": {
      if (command.objectId === null) {
        return { ok: true, state: { ...state, selection: null }, issues: [] };
      }
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "选中对象不在布局中", command.objectId)]);
      }
      if (state.selection === command.objectId) {
        return { ok: true, state, issues: [] };
      }
      return successResult({ ...state, selection: command.objectId }, options);
    }

    case "move": {
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "移动对象不在布局中", command.objectId)]);
      }
      if (target.anchor === command.anchor) {
        return { ok: true, state, issues: [] };
      }
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: state.layout.main.objects.map((object) =>
          object.objectId === command.objectId ? { ...object, anchor: command.anchor } : object,
        ),
      });
      return commitMutation(state, state.content, main, command.objectId, options);
    }

    case "move-by": {
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "移动对象不在布局中", command.objectId)]);
      }
      const { row, col } = positionToRowCol(target.anchor, state.layout.main.baseCols);
      const nextRow = row + command.rowDelta;
      const nextCol = col + command.colDelta;
      if (nextRow < 1 || nextCol < 1 || nextCol > state.layout.main.baseCols) {
        return failure(state, [
          issue(
            "invalid-anchor",
            `移动后位置越界（行 ${String(nextRow)}，列 ${String(nextCol)}，列数 ${String(state.layout.main.baseCols)}）`,
            command.objectId,
          ),
        ]);
      }
      const anchor = rowColToPosition(nextRow, nextCol, state.layout.main.baseCols);
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: state.layout.main.objects.map((object) =>
          object.objectId === command.objectId ? { ...object, anchor } : object,
        ),
      });
      return commitMutation(state, state.content, main, command.objectId, options);
    }

    case "resize": {
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "缩放对象不在布局中", command.objectId)]);
      }
      if (target.presentation === "collapsed") {
        return failure(state, [
          issue(
            "user-collapsed",
            "用户主动收缩的容器需先恢复完整形态再调整尺寸（OQ-LM-06 暂定口径）",
            command.objectId,
          ),
        ]);
      }
      const colSpan = command.colSpan ?? target.colSpan;
      const rowSpan = command.rowSpan ?? target.rowSpan;
      if (colSpan === target.colSpan && rowSpan === target.rowSpan) {
        return { ok: true, state, issues: [] };
      }
      if (!Number.isInteger(colSpan) || !Number.isInteger(rowSpan) || colSpan < 1 || rowSpan < 1) {
        return failure(state, [issue("invalid-size", "占格必须是正整数", command.objectId)]);
      }
      if (rowSpan > MAX_ROW_SPAN) {
        return failure(state, [
          issue("row-span-too-large", `行跨度超过上限 ${MAX_ROW_SPAN}`, command.objectId),
        ]);
      }
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: state.layout.main.objects.map((object) =>
          object.objectId === command.objectId ? { ...object, colSpan, rowSpan } : object,
        ),
      });
      return commitMutation(state, state.content, main, command.objectId, options);
    }

    case "set-presentation": {
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "对象不在布局中", command.objectId)]);
      }
      if (target.objectType !== "grid-split" && target.objectType !== "carousel") {
        return failure(state, [
          issue("invalid-presentation", "只有容器支持 1×1 收缩入口", command.objectId),
        ]);
      }
      if (command.presentation === "collapsed") {
        if (target.presentation === "collapsed") {
          return { ok: true, state, issues: [] };
        }
        const main = withMain(state.layout, {
          ...state.layout.main,
          objects: state.layout.main.objects.map((object) =>
            object.objectId === command.objectId
              ? {
                  ...object,
                  presentation: "collapsed" as const,
                  expandedSize: { colSpan: object.colSpan, rowSpan: object.rowSpan },
                  colSpan: 1,
                  rowSpan: 1,
                }
              : object,
          ),
        });
        return commitMutation(state, state.content, main, command.objectId, options);
      }
      if (target.presentation !== "collapsed") {
        return { ok: true, state, issues: [] };
      }
      const restored = target.expandedSize ?? { colSpan: 1, rowSpan: 1 };
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: state.layout.main.objects.map((object) => {
          if (object.objectId !== command.objectId) {
            return object;
          }
          const { presentation: _presentation, expandedSize: _expandedSize, ...rest } = object;
          return { ...rest, colSpan: restored.colSpan, rowSpan: restored.rowSpan };
        }),
      });
      return commitMutation(state, state.content, main, command.objectId, options);
    }

    case "insert-card": {
      const duplicated =
        state.layout.main.objects.some((object) => object.objectId === command.card.objectId) ||
        state.content.cards.some((card) => card.objectId === command.card.objectId) ||
        state.content.containers.some((container) => container.objectId === command.card.objectId);
      if (duplicated) {
        return failure(state, [
          issue("duplicate-object-id", "卡片 objectId 已存在", command.card.objectId),
        ]);
      }
      if (state.content.cards.length >= MAX_OBJECTS_PER_WORKBENCH) {
        return failure(state, [
          issue("too-many-objects", `卡片数量超过上限 ${MAX_OBJECTS_PER_WORKBENCH}`),
        ]);
      }
      const placement = resolveInsertion(state.layout.main, command.size ?? INSERT_DEFAULT_SIZE, command.anchor);
      if (!placement.ok) {
        return failure(state, placement.issues);
      }
      const nextContent: WorkbenchContentDocumentV1 = {
        ...state.content,
        cards: [...state.content.cards, command.card],
      };
      const geometry: ObjectGeometry = {
        objectId: command.card.objectId,
        objectType: "analysis-card",
        anchor: placement.anchor,
        colSpan: placement.size.colSpan,
        rowSpan: placement.size.rowSpan,
      };
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: [...state.layout.main.objects, geometry],
      });
      return commitMutation(state, nextContent, main, command.card.objectId, options);
    }

    case "insert-spacer": {
      if (state.layout.main.objects.some((object) => object.objectId === command.objectId)) {
        return failure(state, [
          issue("duplicate-object-id", "Spacer objectId 已存在", command.objectId),
        ]);
      }
      const placement = resolveInsertion(state.layout.main, command.size ?? INSERT_DEFAULT_SIZE, command.anchor);
      if (!placement.ok) {
        return failure(state, placement.issues);
      }
      const geometry: ObjectGeometry = {
        objectId: command.objectId,
        objectType: "spacer",
        anchor: placement.anchor,
        colSpan: placement.size.colSpan,
        rowSpan: placement.size.rowSpan,
      };
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: [...state.layout.main.objects, geometry],
      });
      return commitMutation(state, state.content, main, command.objectId, options);
    }

    case "delete": {
      const target = findGeometry(state.layout, command.objectId);
      if (target === undefined) {
        return failure(state, [issue("unknown-object", "删除对象不在布局中", command.objectId)]);
      }
      const nextContent: WorkbenchContentDocumentV1 = {
        ...state.content,
        cards: state.content.cards.filter((card) => card.objectId !== command.objectId),
        containers: state.content.containers.filter(
          (container) => container.objectId !== command.objectId,
        ),
      };
      const main = withMain(state.layout, {
        ...state.layout.main,
        objects: state.layout.main.objects.filter((object) => object.objectId !== command.objectId),
      });
      const selection = state.selection === command.objectId ? null : state.selection;
      return commitMutation(state, nextContent, main, selection, options);
    }

    case "undo": {
      const previous = state.history.past[state.history.past.length - 1];
      if (previous === undefined) {
        return failure(state, [issue("undo-empty", "没有可撤销的编辑")]);
      }
      const future = [...state.history.future, snapshotOf(state)].slice(-state.history.limit);
      return successResult(
        {
          content: previous.content,
          layout: previous.layout,
          selection: previous.selection,
          history: {
            past: state.history.past.slice(0, -1),
            future,
            limit: state.history.limit,
          },
        },
        options,
      );
    }

    case "redo": {
      const next = state.history.future[state.history.future.length - 1];
      if (next === undefined) {
        return failure(state, [issue("redo-empty", "没有可重做的编辑")]);
      }
      const past = [...state.history.past, snapshotOf(state)].slice(-state.history.limit);
      return successResult(
        {
          content: next.content,
          layout: next.layout,
          selection: next.selection,
          history: {
            past,
            future: state.history.future.slice(0, -1),
            limit: state.history.limit,
          },
        },
        options,
      );
    }
  }
}

type InsertionPlan =
  | { readonly ok: true; readonly anchor: number; readonly size: GridSize }
  | { readonly ok: false; readonly issues: readonly LayoutValidationIssue[] };

/** 计算插入位置：显式锚点必须合法；否则找最早空位。 */
function resolveInsertion(
  geometry: LayoutGeometry,
  rawSize: GridSize,
  anchor: number | undefined,
): InsertionPlan {
  const colSpan = rawSize.colSpan;
  const rowSpan = rawSize.rowSpan;
  if (!Number.isInteger(colSpan) || !Number.isInteger(rowSpan) || colSpan < 1 || rowSpan < 1) {
    return { ok: false, issues: [issue("invalid-size", "占格必须是正整数")] };
  }
  if (colSpan > geometry.baseCols) {
    return {
      ok: false,
      issues: [
        issue("width-overflow", `宽度 ${colSpan} 超过当前列数 ${geometry.baseCols}`),
      ],
    };
  }
  if (rowSpan > MAX_ROW_SPAN) {
    return { ok: false, issues: [issue("row-span-too-large", `行跨度超过上限 ${MAX_ROW_SPAN}`)] };
  }
  const size: GridSize = { colSpan, rowSpan };
  if (anchor !== undefined) {
    return { ok: true, anchor, size };
  }
  const candidate = findEarliestFreeAnchor(occupiedCells(geometry), size, geometry.baseCols);
  if (candidate === null) {
    return { ok: false, issues: [issue("invalid-anchor", "找不到可用空位")] };
  }
  return { ok: true, anchor: candidate, size };
}

function commitMutation(
  state: EditorState,
  content: WorkbenchContentDocumentV1,
  layout: LayoutDocumentV1,
  selection: string | null,
  options: ApplyCommandOptions,
): CommandResult {
  const issues = documentIssues(content, layout);
  if (issues.length > 0) {
    return failure(state, issues);
  }
  const next = recordChange(state, content, layout, selection, options.historyLimit);
  return successResult(next, options);
}
