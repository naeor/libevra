/**
 * S17 模块化财务分析工作台——**底部「分析」Tab 的正式页面**（不是独立 Demo、没有第二个入口）。
 *
 * 三个状态都在同一页里切换（所有者草图 2026-10-26、交互补充 §2）：
 *
 * | 状态 | 入口 | 内容 |
 * |---|---|---|
 * | A 浏览 | 点底部「分析」 | 绿色页头（标题 + 漏斗 + 编辑）、生效条件摘要、已保存布局上的真实卡片、底部 Tab |
 * | B 筛选展开 | 点漏斗 | 页内展开筛选区，卡片自然下移；草稿 / 应用 / 撤销修改 / 收起 四件事分开 |
 * | C 布局编辑 | 点编辑 | 卡片原地换成结构编辑形态；点对象出快捷菜单；底部 Tab 让位给卡片抽屉 |
 *
 * 分层（总需求规格 §4）：计算在 compute.ts（只调 A/B/既有实现）、展示在 cards.tsx、布局几何与命令全部
 * 交给 Agent D（session.ts 只做 D 尚未提供的组合操作的过渡适配）、保存在 storage.ts（本机、按账号）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { endOfMonth, rangeForPreset, startOfMonth, type DateRange } from "@libellum/shared";
import {
  compactVertically,
  projectLayout,
  projectionToGeometry,
  type AnalysisCardNode,
  type ContainerNode,
  type GridSize,
  type LayoutDocumentV1,
} from "@libellum/shared/analysis/layout";

import { TabPage } from "../components/Layouts.js";
import { TabPageHeader } from "../components/TabPageHeader.js";
import { useI18n } from "../i18n/index.js";
import { formatLocalDate } from "../lib/datetime.js";
import { currencyName } from "../lib/format.js";
import { useLedger } from "../lib/queries.js";
import { cardTitle } from "../statsWorkbench/cards.js";
import { cardType, CONTAINER_DEFAULT_SIZE, CONTAINER_SIZES, type LayoutObjectChoice } from "../statsWorkbench/catalog.js";
import { currenciesUsed } from "../statsWorkbench/compute.js";
import { defaultWorkbench, newCard, newObjectId } from "../statsWorkbench/defaults.js";
import { cellAt, useDragController, type DragPayload, type DragState } from "../statsWorkbench/dnd.js";
import { Drawer, type ContainerScopeView, type DrawerHeight } from "../statsWorkbench/Drawer.js";
import { FilterPanel, timeLabel } from "../statsWorkbench/FilterPanel.js";
import { FxStatus } from "../statsWorkbench/FxStatus.js";
import { readFilters, sameFilters, writeFilters, type WorkbenchFilters } from "../statsWorkbench/filters.js";
import { BrowseGrid, EditGrid, GRID_GAP, sizeContracts, splitFor, type DropPreview } from "../statsWorkbench/Grid.js";
import { useWorkbenchScope, WorkbenchScopeProvider } from "../statsWorkbench/scope.js";
import {
  canRedo,
  canUndo,
  cardOf,
  command,
  containerOf,
  duplicateObject,
  geometryOf,
  insertContainer,
  isDirty,
  lastRow,
  placementProblem,
  removeObject,
  replaceContainerChildren,
  sessionDocuments,
  startSession,
  updateCard,
  type EditorState,
  type SessionResult,
} from "../statsWorkbench/session.js";
import { CollapsedContainerSheet, ConfigSheet, CustomCardSheet, DiscardSheet, LayoutSheet, ObjectMenuSheet, SizeSheet, type MenuAction } from "../statsWorkbench/Sheets.js";
import { readStored, saveWorkbench, type Stored, type WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { FunnelIcon, PencilIcon, RedoIcon, UndoIcon, useElementSize } from "../statsWorkbench/ui.js";

type ContainerEdit =
  | { readonly kind: "new"; readonly type: "carousel" | "grid-split"; readonly anchor: number; readonly size: GridSize; readonly children: readonly AnalysisCardNode[] }
  | { readonly kind: "existing"; readonly containerId: string; readonly type: "carousel" | "grid-split"; readonly children: readonly AnalysisCardNode[] };

const LIMITS = { carousel: { min: 2, max: 6 }, "grid-split": { min: 2, max: 4 } } as const;
const MIN_COLUMN_WIDTH = 104;

/** 从详情返回时恢复滚动位置与焦点（浏览状态，不写回布局）。 */
let returnPoint: { readonly accountScope: string | null; readonly top: number; readonly cardId: string } | null = null;
const carouselMemory = new Map<string, number>();

interface Toast {
  readonly text: string;
  readonly undo?: boolean;
  readonly key: number;
}

export function StatsPage(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ledger = useLedger();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const scope = useWorkbenchScope(filters);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridBox = useElementSize<HTMLDivElement>();

  // ---- 文档（每账号一套） ----
  const [stored, setStored] = useState<Stored>(() => readStored(scope.accountScope));
  useEffect(() => {
    if (stored.accountScope !== scope.accountScope) setStored(readStored(scope.accountScope));
  }, [scope.accountScope, stored.accountScope]);

  // ---- 筛选：生效条件在地址栏，草稿在这里 ----
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<WorkbenchFilters>(filters);
  const lastEffective = useRef(filters);
  useEffect(() => {
    // 生效条件被外部改变（返回、刷新）时，没有改动过的草稿跟着走；改动过的草稿保留。
    if (!sameFilters(lastEffective.current, filters)) {
      setDraft((current) => (sameFilters(current, lastEffective.current) ? filters : current));
      lastEffective.current = filters;
    }
  }, [filters]);
  const draftPending = !sameFilters(draft, filters);

  // ---- 编辑会话 ----
  const [session, setSession] = useState<EditorState | null>(null);
  const [startDocs, setStartDocs] = useState<WorkbenchDocuments | null>(null);
  const editing = session !== null;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [sizeFor, setSizeFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [collapsedOpen, setCollapsedOpen] = useState<string | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<DrawerHeight>("expanded");
  const drawerBeforeDrag = useRef<DrawerHeight | null>(null);
  const [containerEdit, setContainerEdit] = useState<ContainerEdit | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [carouselPages, setCarouselPages] = useState<ReadonlyMap<string, number>>(() => new Map(carouselMemory));

  const documents = session === null ? stored.documents : sessionDocuments(session);
  const dirty = session !== null && startDocs !== null && isDirty(session, startDocs);

  const say = useCallback((text: string, undo = false) => setToast({ text, undo, key: Date.now() }), []);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), toast.undo === true ? 5000 : 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  // 未保存的编辑：关闭或刷新页面前由浏览器确认。
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // 从详情返回：恢复滚动与焦点。
  useEffect(() => {
    const point = returnPoint;
    if (point === null || point.accountScope !== scope.accountScope) return;
    returnPoint = null;
    requestAnimationFrame(() => {
      if (scrollRef.current !== null) scrollRef.current.scrollTop = point.top;
      document.getElementById(`sw-card-${point.cardId}`)?.focus({ preventScroll: true });
    });
  }, [scope.accountScope]);

  const describe = (problem: string | null): string =>
    t(`statsWorkbench.problems.${(problem ?? "invalid") as "invalid"}`, { defaultValue: t("statsWorkbench.problems.invalid") });

  const apply = (result: SessionResult, success?: string, undoable = false): boolean => {
    if (!result.ok) {
      say(describe(result.problem));
      return false;
    }
    setSession(result.state);
    if (success !== undefined) say(success, undoable);
    return true;
  };

  // ---- 列数：浏览态按可用宽度投影（D），编辑态在权威主布局上操作 ----
  const width = gridBox.width;
  const maxColumns = width === 0 ? 2 : Math.max(1, Math.min(3, Math.floor((width + GRID_GAP) / (MIN_COLUMN_WIDTH + GRID_GAP))));
  const browseColumns = Math.max(1, Math.min(documents.layout.main.baseCols, maxColumns));

  // ---- 拖放 ----
  const objectSize = (id: string): GridSize | null => {
    const geometry = session === null ? undefined : geometryOf(session, id);
    return geometry === undefined ? null : { colSpan: geometry.colSpan, rowSpan: geometry.rowSpan };
  };

  const anchorFor = (state: DragState): { anchor: number; size: GridSize } | null => {
    const grid = gridRef.current;
    if (grid === null || session === null) return null;
    const columns = session.layout.main.baseCols;
    const cell = cellAt(grid, columns, state.x, state.y);
    if (cell === null) return null;
    const payload = state.payload;
    const size = { colSpan: Math.min(payload.size.colSpan, columns), rowSpan: payload.size.rowSpan };
    const grab = payload.kind === "object" ? payload.grab : { row: 0, col: 0 };
    const col = Math.max(1, Math.min(columns - size.colSpan + 1, cell.col - grab.col));
    const row = Math.max(1, cell.row - grab.row);
    return { anchor: (row - 1) * columns + col, size };
  };

  const drag = useDragController({
    scrollRef,
    onStart: (payload) => {
      setMenuFor(null);
      if (payload.kind !== "object") {
        // 从抽屉拖出时先把抽屉收起，给工作台留出放置空间（拖完恢复）。
        drawerBeforeDrag.current = drawerHeight;
        setDrawerHeight("collapsed");
      }
    },
    onMove: (state) => {
      const target = anchorFor(state);
      if (target === null || session === null) return setPreview(null);
      const id = state.payload.kind === "object" ? state.payload.objectId : null;
      setPreview({ anchor: target.anchor, size: target.size, legal: placementProblem(session.layout, id, target.anchor, target.size) === null });
    },
    onDrop: (state) => {
      setPreview(null);
      restoreDrawer();
      dropAt(state);
    },
    onCancel: () => {
      setPreview(null);
      restoreDrawer();
    },
  });

  function restoreDrawer(): void {
    if (drawerBeforeDrag.current !== null) {
      setDrawerHeight(drawerBeforeDrag.current);
      drawerBeforeDrag.current = null;
    }
  }

  function dropAt(state: DragState): void {
    if (session === null) return;
    const target = anchorFor(state);
    if (target === null) {
      say(t("statsWorkbench.edit.droppedOutside"));
      return;
    }
    const payload = state.payload;
    if (payload.kind === "object") {
      apply(command(session, { type: "move", objectId: payload.objectId, anchor: target.anchor }));
      return;
    }
    if (payload.kind === "new-card") {
      addCard(payload.analysisId, target.anchor);
      return;
    }
    addLayoutObject(payload.choice, target.anchor);
  }

  function addCard(analysisId: string, anchor?: number): void {
    if (session === null) return;
    const type = cardType(analysisId);
    if (type === null) return;
    const columns = session.layout.main.baseCols;
    const size = { colSpan: Math.min(type.defaultSize.colSpan, columns), rowSpan: type.defaultSize.rowSpan };
    const card = newCard(analysisId);
    const ok = apply(
      command(session, { type: "insert-card", card, size, ...(anchor === undefined ? {} : { anchor }) }),
      t("statsWorkbench.drawer.added", { name: cardTitle(card, t) }),
    );
    if (ok) revealLater(card.objectId);
  }

  function addLayoutObject(choice: LayoutObjectChoice, anchor?: number): void {
    if (session === null) return;
    const columns = session.layout.main.baseCols;
    const base = CONTAINER_DEFAULT_SIZE[choice];
    const size = { colSpan: Math.min(base.colSpan, columns), rowSpan: base.rowSpan };
    if (choice === "spacer") {
      const objectId = newObjectId("gap");
      if (apply(command(session, { type: "insert-spacer", objectId, size, ...(anchor === undefined ? {} : { anchor }) }), t("statsWorkbench.drawer.added", { name: t("statsWorkbench.containers.spacer") }))) {
        revealLater(objectId);
      }
      return;
    }
    // 容器先作为「待填充」草稿放在目标位置，凑够最少张数后再一次性写入（D 的校验要求 2 张起）。
    let place = anchor ?? null;
    if (place === null) {
      for (let candidate = 1; candidate <= (lastRow(session.layout) + size.rowSpan + 2) * columns; candidate += 1) {
        if (placementProblem(session.layout, null, candidate, size) === null) {
          place = candidate;
          break;
        }
      }
    }
    if (place === null || placementProblem(session.layout, null, place, size) !== null) {
      say(t("statsWorkbench.problems.overlap"));
      return;
    }
    setContainerEdit({ kind: "new", type: choice, anchor: place, size, children: [] });
    setDrawerHeight("expanded");
    requestAnimationFrame(() => {
      document.querySelector("[data-pending-container]")?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function revealLater(objectId: string): void {
    requestAnimationFrame(() => {
      document.querySelector(`[data-object-id="${objectId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  // ---- 进入 / 退出编辑 ----
  function enterEdit(): void {
    setFilterOpen(false);
    const docs = stored.documents;
    setStartDocs(docs);
    setSession(startSession(docs));
    setDrawerHeight("expanded");
  }

  function leaveEdit(): void {
    setSession(null);
    setStartDocs(null);
    setMenuFor(null);
    setMoveFor(null);
    setContainerEdit(null);
    setPreview(null);
  }

  function save(): void {
    if (session === null) return;
    if (!dirty) {
      leaveEdit();
      return;
    }
    if (scope.accountScope === null) {
      say(t("statsWorkbench.edit.saveNoAccount"));
      return;
    }
    const docs = sessionDocuments(session);
    const version = saveWorkbench(scope.accountScope, docs, stored.version);
    if (version === null) {
      say(t("statsWorkbench.edit.saveFailed"));
      return;
    }
    setStored({ accountScope: scope.accountScope, documents: docs, version, unreadable: false });
    leaveEdit();
    say(t("statsWorkbench.edit.saved"));
  }

  function cancel(): void {
    if (dirty) setDiscardOpen(true);
    else leaveEdit();
  }

  // ---- 菜单动作 ----
  function onMenu(objectId: string, action: MenuAction): void {
    // 菜单先关：删除后再撤销时，对象回来了，菜单不能跟着「复活」。
    setMenuFor(null);
    if (session === null) return;
    const geometry = geometryOf(session, objectId);
    const name = objectName(objectId);
    switch (action) {
      case "configure":
        setConfigFor(objectId);
        return;
      case "resize":
        setSizeFor(objectId);
        return;
      case "move":
        setMoveFor(objectId);
        say(t("statsWorkbench.edit.movingHint", { name }));
        return;
      case "duplicate":
        apply(duplicateObject(session, objectId), t("statsWorkbench.menu.duplicated", { name }));
        return;
      case "remove":
        apply(removeObject(session, objectId), t("statsWorkbench.menu.removed", { name }), true);
        return;
      case "collapse":
      case "expand":
        apply(command(session, { type: "set-presentation", objectId, presentation: action === "collapse" ? "collapsed" : "full" }));
        return;
      case "inside": {
        const container = containerOf(session, objectId);
        if (container === undefined || geometry === undefined) return;
        const children = container.children.map((id) => cardOf(session, id)).filter((card): card is AnalysisCardNode => card !== undefined);
        setContainerEdit({ kind: "existing", containerId: objectId, type: container.type, children });
        setDrawerHeight("expanded");
        return;
      }
    }
  }

  function objectName(objectId: string): string {
    if (session === null) return "";
    const card = cardOf(session, objectId);
    if (card !== undefined) return cardTitle(card, t);
    const container = containerOf(session, objectId);
    if (container !== undefined) return t(`statsWorkbench.containers.${container.type}`);
    return t("statsWorkbench.containers.spacer");
  }

  const moveTargets = useMemo(() => {
    if (session === null || moveFor === null) return null;
    const geometry = geometryOf(session, moveFor);
    if (geometry === undefined) return null;
    const size = { colSpan: geometry.colSpan, rowSpan: geometry.rowSpan };
    const columns = session.layout.main.baseCols;
    const targets = new Set<number>();
    const limit = (lastRow(session.layout) + 2) * columns;
    for (let anchor = 1; anchor <= limit; anchor += 1) {
      if (anchor !== geometry.anchor && placementProblem(session.layout, moveFor, anchor, size) === null) targets.add(anchor);
    }
    return targets;
  }, [session, moveFor]);

  useEffect(() => {
    if (moveFor === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveFor]);

  // ---- 容器内部编辑 ----
  function scopeView(): ContainerScopeView | null {
    if (containerEdit === null) return null;
    const limits = LIMITS[containerEdit.type];
    return {
      name: t(`statsWorkbench.containers.${containerEdit.type}`),
      kind: containerEdit.type,
      children: containerEdit.children,
      min: limits.min,
      max: limits.max,
      isNew: containerEdit.kind === "new",
    };
  }

  function finishContainer(): void {
    if (session === null || containerEdit === null) return;
    if (containerEdit.kind === "new") {
      const container: ContainerNode =
        containerEdit.type === "carousel"
          ? { objectId: newObjectId("box"), type: "carousel", children: containerEdit.children.map((child) => child.objectId) }
          : { objectId: newObjectId("box"), type: "grid-split", children: containerEdit.children.map((child) => child.objectId), split: splitFor(containerEdit.children.length) };
      if (apply(insertContainer(session, container, containerEdit.children, containerEdit.anchor, containerEdit.size), t("statsWorkbench.drawer.added", { name: t(`statsWorkbench.containers.${containerEdit.type}`) }))) {
        setContainerEdit(null);
      }
      return;
    }
    let result = replaceContainerChildren(session, containerEdit.containerId, containerEdit.children);
    if (result.ok && containerEdit.type === "grid-split") {
      // 分割方式随子卡片数量调整（两张左右分，三到四张田字格）。
      const container = containerOf(result.state, containerEdit.containerId);
      if (container !== undefined && container.type === "grid-split") {
        const next = { ...container, split: splitFor(container.children.length) };
        const content = { ...result.state.content, containers: result.state.content.containers.map((item) => (item.objectId === next.objectId ? next : item)) };
        result = { ok: true, problem: null, state: { ...result.state, content } };
      }
    }
    if (apply(result)) setContainerEdit(null);
  }

  // ---- 「调整行列」：列数迁移、紧凑排列与恢复默认，全部交给 D 的投影 / 紧凑函数 ----
  function changeColumns(columns: number): void {
    if (session === null || columns === session.layout.main.baseCols) return;
    const projection = projectLayout(session.layout.main, session.content, { targetColumns: columns, contracts: sizeContracts(session.content, session.layout) });
    const geometry = projectionToGeometry(projection);
    const presentations = new Map(session.layout.main.objects.map((object) => [object.objectId, object] as const));
    const layout: LayoutDocumentV1 = {
      ...session.layout,
      main: {
        baseCols: geometry.baseCols,
        objects: geometry.objects.map((object) => {
          const before = presentations.get(object.objectId);
          return before?.presentation === "collapsed" ? { ...object, presentation: "collapsed" as const, ...(before.expandedSize === undefined ? {} : { expandedSize: before.expandedSize }) } : object;
        }),
      },
    };
    applyLayout(layout, t("statsWorkbench.layout.columnsChanged", { count: columns }));
  }

  function compact(): void {
    if (session === null) return;
    const projection = projectLayout(session.layout.main, session.content, { targetColumns: session.layout.main.baseCols, contracts: sizeContracts(session.content, session.layout) });
    const result = compactVertically(projection.objects, session.layout.main.baseCols);
    const anchors = new Map(result.objects.map((object) => [object.objectId, object.anchor] as const));
    const layout: LayoutDocumentV1 = {
      ...session.layout,
      main: { ...session.layout.main, objects: session.layout.main.objects.map((object) => ({ ...object, anchor: anchors.get(object.objectId) ?? object.anchor })) },
    };
    applyLayout(layout, t("statsWorkbench.layout.compacted", { count: result.movedCount }));
  }

  function applyLayout(layout: LayoutDocumentV1, message: string): void {
    if (session === null) return;
    const problems = placementSafe(layout);
    if (!problems) {
      say(t("statsWorkbench.problems.invalid"));
      return;
    }
    const past = [...session.history.past, { content: session.content, layout: session.layout, selection: session.selection }].slice(-session.history.limit);
    setSession({ ...session, layout, history: { ...session.history, past, future: [] } });
    say(message);
  }

  function placementSafe(layout: LayoutDocumentV1): boolean {
    return layout.main.objects.every((object) => placementProblem(layout, object.objectId, object.anchor, { colSpan: object.colSpan, rowSpan: object.rowSpan }) === null);
  }

  function resetToDefault(): void {
    if (session === null) return;
    const docs = defaultWorkbench();
    const past = [...session.history.past, { content: session.content, layout: session.layout, selection: session.selection }].slice(-session.history.limit);
    setSession({ content: docs.content, layout: docs.layout, selection: null, history: { ...session.history, past, future: [] } });
    say(t("statsWorkbench.layout.resetDone"), true);
  }

  // ---- 浏览态动作 ----
  function openCard(cardId: string): void {
    returnPoint = { accountScope: scope.accountScope, top: scrollRef.current?.scrollTop ?? 0, cardId };
    const search = params.toString();
    void navigate(`/stats/cards/${encodeURIComponent(cardId)}${search === "" ? "" : `?${search}`}`);
  }

  const applyFilters = () => {
    setParams((previous) => writeFilters(previous, draft), { replace: true });
  };

  const summary = `${timeLabel(filters.time, t)} · ${t("statsWorkbench.summary.dates", {
    from: formatLocalDate(scope.range.from),
    to: formatLocalDate(scope.range.to),
  })} · ${scope.combined ? t("statsWorkbench.summary.combined", { currency: scope.currency }) : currencyName(scope.currency)}`;

  const menuObject = menuFor === null || session === null ? null : geometryOf(session, menuFor);
  const configCard = configFor === null || session === null ? undefined : cardOf(session, configFor);
  const sizeObject = sizeFor === null || session === null ? undefined : geometryOf(session, sizeFor);

  const objectProps = (objectId: string, label: string, size: GridSize): Record<string, unknown> => {
    if (moveFor !== null || containerEdit !== null) return {};
    return drag.sourceProps((point) => {
      const grid = gridRef.current;
      const geometry = session === null ? undefined : geometryOf(session, objectId);
      if (grid === null || session === null || geometry === undefined) return null;
      const columns = session.layout.main.baseCols;
      const cell = cellAt(grid, columns, point.clientX, point.clientY);
      const origin = { row: Math.floor((geometry.anchor - 1) / columns) + 1, col: ((geometry.anchor - 1) % columns) + 1 };
      const grab = cell === null ? { row: 0, col: 0 } : { row: Math.max(0, cell.row - origin.row), col: Math.max(0, cell.col - origin.col) };
      const payload: DragPayload = { kind: "object", objectId, size, grab, label };
      return payload;
    });
  };

  const pendingPlaceholder =
    containerEdit?.kind === "new"
      ? { anchor: containerEdit.anchor, size: containerEdit.size, label: t(`statsWorkbench.containers.${containerEdit.type}`), kind: containerEdit.type, count: containerEdit.children.length }
      : null;

  const view = scopeView();

  const drawer = editing ? (
    <Drawer
      height={drawerHeight}
      onHeight={setDrawerHeight}
      combined={scope.combined}
      drag={drag}
      onAddCard={(analysisId) => addCard(analysisId)}
      onAddLayout={(choice) => addLayoutObject(choice)}
      onCustom={() => setCustomOpen(true)}
      containerScope={view}
      onScopeAdd={(analysisId) =>
        setContainerEdit((current) => (current === null || current.children.length >= LIMITS[current.type].max ? current : { ...current, children: [...current.children, newCard(analysisId)] }))
      }
      onScopeMove={(index, delta) =>
        setContainerEdit((current) => {
          if (current === null) return current;
          const children = [...current.children];
          const [moved] = children.splice(index, 1);
          if (moved === undefined) return current;
          children.splice(index + delta, 0, moved);
          return { ...current, children };
        })
      }
      onScopeRemove={(index) => setContainerEdit((current) => (current === null ? current : { ...current, children: current.children.filter((_, at) => at !== index) }))}
      onScopeDone={finishContainer}
      onScopeCancel={() => setContainerEdit(null)}
    />
  ) : undefined;

  return (
    <WorkbenchScopeProvider value={scope}>
      <TabPage
        active="stats"
        onNavigate={(to) => {
          void navigate(to);
        }}
        currentBookName={ledger.data?.book.name}
        scrollRef={scrollRef}
        bottom={drawer}
      >
        {editing ? (
          <header className="sw-edit-bar sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3">
            <button type="button" className="sw-pill" onClick={() => setLayoutOpen(true)} disabled={containerEdit !== null}>
              {t("statsWorkbench.edit.adjust")}
            </button>
            <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.edit.undo")} disabled={!canUndo(session) || containerEdit !== null} onClick={() => apply(command(session, { type: "undo" }))}>
              <UndoIcon />
            </button>
            <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.edit.redo")} disabled={!canRedo(session) || containerEdit !== null} onClick={() => apply(command(session, { type: "redo" }))}>
              <RedoIcon />
            </button>
            <span className="flex-1" />
            <button type="button" className="sw-pill" onClick={cancel}>
              {t("statsWorkbench.edit.cancel")}
            </button>
            <button type="button" className="sw-pill sw-pill-primary" onClick={save} disabled={containerEdit !== null}>
              {t("statsWorkbench.edit.done")}
            </button>
          </header>
        ) : (
          <TabPageHeader
            title={t("stats.title")}
            subtitle={t("stats.subtitle")}
            action={
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className={`sw-head-button relative ${filterOpen ? "sw-head-button-on" : ""}`}
                  aria-label={t("statsWorkbench.header.filter")}
                  aria-expanded={filterOpen}
                  aria-controls="sw-filter-panel"
                  onClick={() => setFilterOpen((open) => !open)}
                >
                  <FunnelIcon />
                  {draftPending ? <span className="sw-badge-dot" aria-hidden="true" /> : null}
                </button>
                <button type="button" className="sw-head-button" aria-label={t("statsWorkbench.header.edit")} onClick={enterEdit}>
                  <PencilIcon />
                </button>
              </div>
            }
          />
        )}

        {!editing ? (
          <>
            <div className={`sw-collapse ${filterOpen ? "sw-collapse-open" : ""}`}>
              <div className="min-h-0 overflow-hidden">
                {filterOpen ? (
                  <FilterPanel
                    id="sw-filter-panel"
                    draft={draft}
                    effective={filters}
                    today={scope.today}
                    fxAvailable={scope.fxAvailable}
                    fxTarget={scope.combined ? scope.currency : scope.defaultCurrency}
                    defaultCurrency={scope.defaultCurrency}
                    currenciesInLedger={currenciesUsed(scope.entries)}
                    onDraft={setDraft}
                    onApply={applyFilters}
                    onRevert={() => setDraft(filters)}
                    onCollapse={() => setFilterOpen(false)}
                  />
                ) : null}
              </div>
            </div>
            <button type="button" className="sw-summary mx-6 mt-4 flex items-center gap-2 text-left" onClick={() => setFilterOpen(true)} aria-label={t("statsWorkbench.summary.open", { summary })}>
              <span className="min-w-0 flex-1 truncate text-helper text-muted">{summary}</span>
              {draftPending ? <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-helper text-warn-dark">{t("statsWorkbench.summary.pending")}</span> : null}
            </button>
            {scope.fx === null ? null : <FxStatus fx={scope.fx} />}
            {scope.coverageGap === null ? null : scope.repairing ? (
              <p role="status" className="mx-6 mt-3 rounded-field bg-brand-soft px-4 py-3 text-helper-relaxed text-ink">
                {t("statsWorkbench.coverage.repairing")}
              </p>
            ) : (
              <p role="status" className="mx-6 mt-3 rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-ink">
                {t("statsWorkbench.coverage.gap", { server: scope.coverageGap.server, local: scope.coverageGap.local })}
              </p>
            )}
            {stored.unreadable ? (
              <p role="status" className="mx-6 mt-3 rounded-field bg-brand-soft px-4 py-3 text-helper-relaxed text-ink">
                {t("statsWorkbench.restoreNotice")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="px-6 pt-3 text-helper-relaxed text-muted" aria-live="polite">
            {moveFor !== null
              ? t("statsWorkbench.edit.movingHint", { name: objectName(moveFor) })
              : containerEdit !== null
                ? t("statsWorkbench.containers.insideHint")
                : t("statsWorkbench.edit.hint")}
            {moveFor !== null ? (
              <button type="button" className="sw-link ml-2" onClick={() => setMoveFor(null)}>
                {t("statsWorkbench.edit.cancelMove")}
              </button>
            ) : null}
          </p>
        )}

        <div ref={gridBox.ref} className="px-6 pt-4">
          {editing && session !== null ? (
            <EditGrid
              content={session.content}
              layout={session.layout}
              selection={menuFor ?? moveFor}
              dimmed={containerEdit === null ? null : containerEdit.kind === "existing" ? containerEdit.containerId : "all"}
              draggingId={moveFor ?? (drag.drag?.payload.kind === "object" ? drag.drag.payload.objectId : null)}
              preview={preview}
              moveTargets={moveTargets}
              pendingPlaceholder={pendingPlaceholder}
              gridRef={gridRef}
              objectProps={objectProps}
              onSelect={(objectId) => {
                if (drag.consumeClick() || moveFor !== null || containerEdit !== null) return;
                apply(command(session, { type: "select", objectId }));
                setMenuFor(objectId);
              }}
              onPickTarget={(anchor) => {
                if (moveFor === null) return;
                if (apply(command(session, { type: "move", objectId: moveFor, anchor }))) setMoveFor(null);
              }}
            />
          ) : (
            <BrowseGrid
              content={documents.content}
              layout={documents.layout}
              columns={browseColumns}
              scope={scope}
              onOpenCard={openCard}
              onOpenCollapsed={setCollapsedOpen}
              carouselPages={carouselPages}
              onCarouselPage={(containerId, page) => {
                carouselMemory.set(containerId, page);
                setCarouselPages(new Map(carouselMemory));
              }}
            />
          )}
        </div>

        {drag.drag === null ? null : (
          <div className="sw-ghost" style={{ left: drag.drag.x, top: drag.drag.y }} aria-hidden="true">
            {drag.drag.payload.label}
          </div>
        )}

        {toast === null ? null : (
          <div key={toast.key} role="status" className={`sw-toast ${editing ? "sw-toast-edit" : ""}`}>
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.undo === true && session !== null ? (
              <button
                type="button"
                className="sw-link sw-toast-action"
                onClick={() => {
                  apply(command(session, { type: "undo" }));
                  setToast(null);
                }}
              >
                {t("statsWorkbench.edit.undo")}
              </button>
            ) : null}
          </div>
        )}

        {menuFor !== null && menuObject !== undefined && menuObject !== null ? (
          <ObjectMenuSheet
            title={objectName(menuFor)}
            kind={menuObject.objectType === "analysis-card" ? "card" : menuObject.objectType === "spacer" ? "spacer" : "container"}
            collapsed={menuObject.presentation === "collapsed"}
            onAction={(action) => onMenu(menuFor, action)}
            onClose={() => setMenuFor(null)}
          />
        ) : null}

        {configCard === undefined || session === null ? null : (
          <ConfigSheet card={configCard} today={scope.today} onSave={(card) => apply(updateCard(session, card), t("statsWorkbench.config.saved"))} onClose={() => setConfigFor(null)} />
        )}

        {sizeObject === undefined || session === null || sizeFor === null ? null : (
          <SizeSheet
            current={{ colSpan: sizeObject.colSpan, rowSpan: sizeObject.rowSpan }}
            sizes={(sizeObject.objectType === "analysis-card" ? (cardType(cardOf(session, sizeFor)?.analysis.analysisId ?? "")?.sizes ?? []) : CONTAINER_SIZES[sizeObject.objectType]).filter(
              (size) => size.colSpan <= session.layout.main.baseCols,
            )}
            problemFor={(size) => placementProblem(session.layout, sizeFor, sizeObject.anchor, size)}
            onPick={(size) => apply(command(session, { type: "resize", objectId: sizeFor, colSpan: size.colSpan, rowSpan: size.rowSpan }))}
            onClose={() => setSizeFor(null)}
          />
        )}

        {layoutOpen && session !== null ? (
          <LayoutSheet
            columns={session.layout.main.baseCols}
            maxColumns={maxColumns}
            onColumns={changeColumns}
            onCompact={compact}
            onReset={resetToDefault}
            onClose={() => setLayoutOpen(false)}
          />
        ) : null}

        {discardOpen ? <DiscardSheet onDiscard={leaveEdit} onClose={() => setDiscardOpen(false)} /> : null}
        {customOpen ? <CustomCardSheet onClose={() => setCustomOpen(false)} /> : null}
        {collapsedOpen === null ? null : (
          <CollapsedContainerSheetFor
            documents={documents}
            containerId={collapsedOpen}
            onOpenCard={openCard}
            onClose={() => setCollapsedOpen(null)}
          />
        )}
      </TabPage>
    </WorkbenchScopeProvider>
  );
}

function CollapsedContainerSheetFor({
  documents,
  containerId,
  onOpenCard,
  onClose,
}: {
  readonly documents: WorkbenchDocuments;
  readonly containerId: string;
  readonly onOpenCard: (cardId: string) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const container = documents.content.containers.find((item) => item.objectId === containerId);
  if (container === undefined) return null;
  const cards = container.children
    .map((id) => documents.content.cards.find((card) => card.objectId === id))
    .filter((card): card is AnalysisCardNode => card !== undefined);
  return <CollapsedContainerSheet container={container} cards={cards} onOpenCard={onOpenCard} onClose={onClose} />;
}

/** 旧分析页日历热力的两种视图（近一周 / 本月）；工作台的日历卡片按卡片区间画，这个纯函数保留给测试与旧链接。 */
export type HeatRange = "7d" | "month";

/**
 * The range the calendar heat map draws.
 *
 * Kept out of the component because the last day of a month is exactly the date
 * that is easy to build wrongly. The screen used to paste "-31" onto the month
 * string, so April asked for the 31st of April; JavaScript accepts that and
 * rolls it forward to the 1st of May, and the query then counted the next
 * month's first day towards this one. `endOfMonth` asks the calendar instead.
 */
export function heatRangeFor(heatRange: HeatRange, today: string): DateRange {
  return heatRange === "7d"
    ? rangeForPreset("7d", today)
    : { from: startOfMonth(today), to: endOfMonth(today) };
}
