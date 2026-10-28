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
  planSmartPlacement,
  placementCells,
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
import { useLedger } from "../lib/queries.js";
import { CardActionsContext, cardTitle, type CardActions } from "../statsWorkbench/cards.js";
import { cardType, CONTAINER_DEFAULT_SIZE, CONTAINER_SIZES, type LayoutObjectChoice } from "../statsWorkbench/catalog.js";
import { currenciesUsed } from "../statsWorkbench/compute.js";
import { defaultWorkbench, newCard, newObjectId } from "../statsWorkbench/defaults.js";
import { cellAt, useDragController, type DragPayload, type DragState } from "../statsWorkbench/dnd.js";
import { Drawer, type ContainerScopeView, type DrawerHeight } from "../statsWorkbench/Drawer.js";
import { FilterPanel, timeLabel, type FilterOption } from "../statsWorkbench/FilterPanel.js";
import { StatBar, StatsSettingsSheet } from "../statsWorkbench/StatsControls.js";
import { customRangeProblem, filterIds, filterUrlProblem, followDraft, readFilters, sameFilters, writeFilters, type WorkbenchFilters } from "../statsWorkbench/filters.js";
import { BrowseGrid, EditGrid, GRID_GAP, gridMetricsFor, sizeContracts, splitFor, type DropPreview } from "../statsWorkbench/Grid.js";
import { useScope, useWorkbenchScope, WorkbenchScopeProvider } from "../statsWorkbench/scope.js";
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
  reconfigureCard,
  type EditorState,
  type SessionResult,
} from "../statsWorkbench/session.js";
import { CollapsedContainerSheet, DiscardSheet, LayoutSheet, ObjectMenuSheet, SizeSheet, type MenuAction } from "../statsWorkbench/Sheets.js";
import { CardEditor } from "../statsWorkbench/CardEditor.js";
import { cardSizing, readComposition, recommendSize, type GridMetrics } from "../statsWorkbench/composition.js";
import { customCardsIn } from "../statsWorkbench/customCards.js";
import { readStored, saveWorkbenchSafely, type Stored, type WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { FunnelIcon, GridGlyph, PencilIcon, RedoIcon, UndoIcon, useElementSize } from "../statsWorkbench/ui.js";

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
  const [params] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const scope = useWorkbenchScope(filters);
  // 账号/游客身份改变即销毁整份编辑状态；旧账号草稿不可显示或保存到新账号。
  return <WorkbenchScopeProvider value={scope}><AccountWorkbench key={scope.accountScope ?? "pending"} /></WorkbenchScopeProvider>;
}

function AccountWorkbench(): React.JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const ledger = useLedger();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const urlProblem = filterUrlProblem(params);
  const scope = useScope();
  const cardActions = useMemo<CardActions>(
    () => ({
      // 卡片上的「改用原币查看」：只改生效筛选；没动过的筛选草稿会跟着变（见下方草稿同步）。
      showOriginalCurrency: () => {
        setParams((previous) => writeFilters(previous, { ...readFilters(previous), combined: false }), { replace: true });
      },
    }),
    [setParams],
  );
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
    const previous = lastEffective.current;
    if (!sameFilters(previous, filters)) {
      // 注意：更新函数在下一次渲染时才执行，必须比较「变化前」的生效条件（不能在函数里读 ref，它已被改成新值）。
      setDraft((current) => followDraft(current, previous, filters));
      lastEffective.current = filters;
    }
  }, [filters]);
  const draftPending = !sameFilters(draft, filters);

  // ---- W5 维度筛选的候选项：来自账本元数据（不是从交易里现猜），标签带颜色。 ----
  const categoryOptions = useMemo<readonly FilterOption[]>(
    () => (ledger.data?.categories ?? []).map((category) => ({ id: category.id, name: category.name, archived: category.isArchived })),
    [ledger.data?.categories],
  );
  const paymentMethodOptions = useMemo<readonly FilterOption[]>(
    () => (ledger.data?.paymentMethods ?? []).map((method) => ({ id: method.id, name: method.name, archived: method.isArchived })),
    [ledger.data?.paymentMethods],
  );
  const tagOptions = useMemo<readonly FilterOption[]>(
    () => (ledger.data?.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    [ledger.data?.tags],
  );

  // ---- 编辑会话 ----
  const [session, setSession] = useState<EditorState | null>(null);
  const latestSession = useRef(session);
  latestSession.current = session;
  const [saving, setSaving] = useState(false);
  const saveAlive = useRef(true);
  useEffect(() => { saveAlive.current = true; return () => { saveAlive.current = false; }; }, []);
  const [startDocs, setStartDocs] = useState<WorkbenchDocuments | null>(null);
  const editing = session !== null;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 自定义卡片编辑器：`cardId === null` 为新建，否则编辑这张卡片（任何卡片都可以在这里加内容、换形式）。 */
  const [editor, setEditor] = useState<{ readonly cardId: string | null } | null>(null);
  const [sizeFor, setSizeFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsedOpen, setCollapsedOpen] = useState<string | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<DrawerHeight>("expanded");
  const drawerBeforeDrag = useRef<DrawerHeight | null>(null);
  const [containerEdit, setContainerEdit] = useState<ContainerEdit | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const dragBaseline = useRef<EditorState | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAnchor = useRef<number | null>(null);
  useEffect(() => () => { if (previewTimer.current !== null) clearTimeout(previewTimer.current); }, []);
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
  const gridMetrics: GridMetrics | null = gridMetricsFor(width, browseColumns, typeof window === "undefined" ? 0 : window.innerWidth);

  // ---- 拖放 ----
  const objectSize = (id: string): GridSize | null => {
    const geometry = session === null ? undefined : geometryOf(session, id);
    return geometry === undefined ? null : { colSpan: geometry.colSpan, rowSpan: geometry.rowSpan };
  };

  const anchorFor = (state: DragState): { anchor: number; size: GridSize } | null => {
    const grid = gridRef.current;
    const baseline = dragBaseline.current ?? session;
    if (grid === null || baseline === null) return null;
    const columns = baseline.layout.main.baseCols;
    const cell = cellAt(grid, columns, state.x, state.y);
    if (cell === null) return null;
    const payload = state.payload;
    const size = payload.size;
    const grab = payload.kind === "object" ? payload.grab : { row: 0, col: 0 };
    const col = Math.max(1, Math.min(columns - size.colSpan + 1, cell.col - grab.col));
    const row = Math.max(1, cell.row - grab.row);
    return { anchor: (row - 1) * columns + col, size };
  };

  const drag = useDragController({
    scrollRef,
    onStart: (payload) => {
      dragBaseline.current = session;
      previewAnchor.current = null;
      setMenuFor(null);
      if (payload.kind !== "object") {
        // 从抽屉拖出时先把抽屉收起，给工作台留出放置空间（拖完恢复）。
        drawerBeforeDrag.current = drawerHeight;
        setDrawerHeight("collapsed");
      }
    },
    onMove: (state) => {
      const target = anchorFor(state);
      const baseline = dragBaseline.current;
      if (target === null || baseline === null) { clearDropPreview(); return; }
      if (previewAnchor.current === target.anchor) return;
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
      previewAnchor.current = target.anchor;
      const payload = state.payload;
      const result = previewDrop(baseline, payload, target.anchor, target.size);
      const sourceId = payload.kind === "object" ? payload.objectId : null;
      const targetId = baseline.layout.main.objects.find((item) => item.objectId !== sourceId &&
        placementCells(item.anchor, item, baseline.layout.main.baseCols).includes(target.anchor))?.objectId;
      const hint: DropPreview = { anchor: target.anchor, size: target.size, legal: result.ok, ...(targetId === undefined ? {} : { targetId }) };
      setPreview(hint);
      // 命中只取拖动起点的网格坐标；预览移动的卡片不会反过来改变目标。
      if (result.ok) previewTimer.current = setTimeout(() => {
        const rootIds = new Set(baseline.layout.main.objects.map((item) => item.objectId));
        setPreview({ ...hint, layout: { ...result.state.layout, main: { ...result.state.layout.main, objects: result.state.layout.main.objects.filter((item) => rootIds.has(item.objectId)) } } });
      }, 140);
    },
    onDrop: (state) => {
      clearDropPreview();
      restoreDrawer();
      dropAt(state);
      dragBaseline.current = null;
    },
    onCancel: () => {
      clearDropPreview();
      dragBaseline.current = null;
      restoreDrawer();
    },
  });

  function clearDropPreview(): void {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    previewAnchor.current = null;
    setPreview(null);
  }

  /** 预览直接预演D命令，包含文档容量校验；不把结果提交到会话或历史。 */
  function previewDrop(baseline: EditorState, payload: DragPayload, anchor: number, size: GridSize): SessionResult {
    if (payload.kind === "object") return command(baseline, { type: "move", objectId: payload.objectId, anchor, collisionPolicy: "reflow" });
    const usedIds = new Set([...baseline.content.cards, ...baseline.content.containers, ...baseline.layout.main.objects].map((item) => item.objectId));
    const temporaryId = (prefix: string): string => {
      let id = prefix;
      while (usedIds.has(id)) id += "_";
      usedIds.add(id);
      return id;
    };
    const objectId = temporaryId("__drop-preview__");
    if (payload.kind === "new-card") return command(baseline, { type: "insert-card", card: newCard(payload.analysisId, objectId), anchor, size, collisionPolicy: "reflow" });
    if (payload.choice === "spacer") return command(baseline, { type: "insert-spacer", objectId, anchor, size, collisionPolicy: "reflow" });
    // 新容器先检查最少两张卡片能否建立；后续内部选卡仍逐次校验正式上限。
    const children = [newCard("AN-B01", temporaryId("__preview-child-one__")), newCard("AN-B02", temporaryId("__preview-child-two__"))];
    const container: ContainerNode = payload.choice === "carousel"
      ? { objectId, type: "carousel", children: children.map((card) => card.objectId) }
      : { objectId, type: "grid-split", children: children.map((card) => card.objectId), split: splitFor(2) };
    return command(baseline, { type: "insert-container", container, children, anchor, size, collisionPolicy: "reflow" });
  }

  function restoreDrawer(): void {
    if (drawerBeforeDrag.current !== null) {
      setDrawerHeight(drawerBeforeDrag.current);
      drawerBeforeDrag.current = null;
    }
  }

  function dropAt(state: DragState): void {
    if (session === null) return;
    // 预览期间若通过其他入口编辑过文档，取消这次拖放，避免把旧快照覆盖回来。
    if (dragBaseline.current !== null && session !== dragBaseline.current) return;
    const target = anchorFor(state);
    if (target === null) {
      say(t("statsWorkbench.edit.droppedOutside"));
      return;
    }
    const payload = state.payload;
    if (payload.kind === "object") {
      apply(command(session, { type: "move", objectId: payload.objectId, anchor: target.anchor, collisionPolicy: "reflow" }));
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
    const size = anchor === undefined ? { colSpan: Math.min(type.defaultSize.colSpan, columns), rowSpan: type.defaultSize.rowSpan } : type.defaultSize;
    const card = newCard(analysisId);
    const ok = apply(
      command(session, { type: "insert-card", card, size, collisionPolicy: "reflow", ...(anchor === undefined ? {} : { anchor }) }),
      t("statsWorkbench.drawer.added", { name: cardTitle(card, t) }),
    );
    if (ok) revealLater(card.objectId);
  }

  /** 自定义卡片放到第一个空位；尺寸由编辑器按当前设备推荐（或用户选择），复制品按同一规则推荐。 */
  function addCustomCard(card: AnalysisCardNode, size?: GridSize): boolean {
    if (session === null) return false;
    const read = readComposition(card);
    const columns = session.layout.main.baseCols;
    const chosen = size ?? recommendSize(read.template, read.slots, gridMetrics);
    const fitted = { colSpan: Math.min(chosen.colSpan, columns), rowSpan: chosen.rowSpan };
    const ok = apply(command(session, { type: "insert-card", card, size: fitted, collisionPolicy: "reflow" }), t("statsWorkbench.drawer.added", { name: cardTitle(card, t) }));
    if (ok) revealLater(card.objectId);
    return ok;
  }

  function saveEditedCard(card: AnalysisCardNode, size: GridSize): boolean {
    if (session === null) return false;
    return apply(reconfigureCard(session, card, size), t("statsWorkbench.config.saved"));
  }

  function addLayoutObject(choice: LayoutObjectChoice, anchor?: number): void {
    if (session === null) return;
    const columns = session.layout.main.baseCols;
    const base = CONTAINER_DEFAULT_SIZE[choice];
    const size = anchor === undefined ? { colSpan: Math.min(base.colSpan, columns), rowSpan: base.rowSpan } : base;
    if (choice === "spacer") {
      const objectId = newObjectId("gap");
      if (apply(command(session, { type: "insert-spacer", objectId, size, collisionPolicy: "reflow", ...(anchor === undefined ? {} : { anchor }) }), t("statsWorkbench.drawer.added", { name: t("statsWorkbench.containers.spacer") }))) {
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
    const plan = place === null ? null : previewDrop(session, { kind: "new-layout", choice, size, label: "" }, place, size);
    if (place === null || plan === null || !plan.ok) {
      say(describe(plan?.problem ?? "invalid-anchor"));
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
    clearDropPreview();
    dragBaseline.current = null;
    setSession(null);
    setStartDocs(null);
    setMenuFor(null);
    setMoveFor(null);
    setContainerEdit(null);
    setPreview(null);
  }

  async function save(): Promise<void> {
    if (session === null || saving) return;
    if (!dirty) {
      leaveEdit();
      return;
    }
    if (scope.accountScope === null) {
      say(t("statsWorkbench.edit.saveNoAccount"));
      return;
    }
    const docs = sessionDocuments(session);
    setSaving(true);
    const version = await saveWorkbenchSafely(scope.accountScope, docs, stored.version);
    if (!saveAlive.current) return;
    setSaving(false);
    if (version === null) {
      say(t("statsWorkbench.edit.saveFailed"));
      return;
    }
    setStored({ accountScope: scope.accountScope, documents: docs, version, unreadable: false });
    // 等待跨标签页锁时若继续编辑，只确认刚保存的快照，不丢弃随后产生的编辑。
    if (latestSession.current !== session) {
      if (latestSession.current !== null) setStartDocs(docs);
      say(t("statsWorkbench.edit.saved"));
      return;
    }
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
        setEditor({ cardId: objectId });
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
    const columns = session.layout.main.baseCols;
    const targets = new Set<number>();
    const limit = (lastRow(session.layout) + 2) * columns;
    for (let anchor = 1; anchor <= limit; anchor += 1) {
      if (anchor !== geometry.anchor && planSmartPlacement(session.layout.main, { ...geometry, anchor }).ok) targets.add(anchor);
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
    const result = replaceContainerChildren(session, containerEdit.containerId, containerEdit.children,
      containerEdit.type === "grid-split" ? splitFor(containerEdit.children.length) : undefined);
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
    if (draft.time.kind === "custom" && customRangeProblem(draft.time.from, draft.time.to) !== null) return;
    setParams((previous) => writeFilters(previous, draft), { replace: true });
  };

  // 币种与统计方式在下方统计控制条上显示，这里只写时间与维度，不重复。
  const summary = `${timeLabel(filters.time, t)} · ${t("statsWorkbench.summary.dates", {
    from: formatLocalDate(scope.range.from),
    to: formatLocalDate(scope.range.to),
  })}${dimensionSummaryOf(filters)}`;

  /**
   * W5：生效条件摘要必须让用户知道「排除了什么」。维度不限时不写，空集写 0，
   * 否则同屏合计无法解释（能力目录 §4.1 / ACC-02）。
   */
  function dimensionSummaryOf(current: WorkbenchFilters): string {
    const ids = filterIds(current);
    const parts: string[] = [];
    if (ids.categoryIds !== null) parts.push(t("statsWorkbench.summary.categoryCount", { count: ids.categoryIds.length }));
    if (ids.paymentMethodIds !== null) parts.push(t("statsWorkbench.summary.paymentMethodCount", { count: ids.paymentMethodIds.length }));
    if (ids.tagIds !== null) parts.push(t("statsWorkbench.summary.tagCount", { count: ids.tagIds.length }));
    return parts.length === 0 ? "" : ` · ${parts.join(" · ")}`;
  }

  const menuObject = menuFor === null || session === null ? null : geometryOf(session, menuFor);
  const editorCard = editor === null || editor.cardId === null || session === null ? undefined : cardOf(session, editor.cardId);
  const editorGeometry = editorCard === undefined || session === null ? undefined : geometryOf(session, editorCard.objectId);
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
      onCustom={() => setEditor({ cardId: null })}
      customCards={customCardsIn(session?.content.cards ?? [])}
      onConfigureCustom={(objectId) => setEditor({ cardId: objectId })}
      onDuplicateCustom={(card) => {
        const geometry = session === null ? undefined : geometryOf(session, card.objectId);
        addCustomCard({ ...card, objectId: newObjectId("card") }, geometry === undefined ? undefined : { colSpan: geometry.colSpan, rowSpan: geometry.rowSpan });
      }}
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
      <CardActionsContext.Provider value={cardActions}>
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
          <header className="sw-edit-bar sticky top-0 z-20 flex items-center gap-1.5 border-b border-line bg-canvas px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 min-[380px]:gap-2">
            {/* 窄屏（< 380px，如 320px 宽的旧手机、英文界面）只留图标，保证「取消 / 完成」始终可见。 */}
            <button
              type="button"
              className="sw-pill sw-pill-adjust"
              aria-label={t("statsWorkbench.edit.adjust")}
              onClick={() => setLayoutOpen(true)}
              disabled={containerEdit !== null}
            >
              <GridGlyph width={16} height={16} className="shrink-0" />
              <span className="max-[379px]:sr-only">{t("statsWorkbench.edit.adjust")}</span>
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
            <button type="button" className="sw-pill sw-pill-primary" onClick={() => { void save(); }} disabled={containerEdit !== null || saving}>
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
                    currenciesInLedger={scope.ledgerCurrencies ?? currenciesUsed(scope.entries)}
                    categories={categoryOptions}
                    paymentMethods={paymentMethodOptions}
                    tags={tagOptions}
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
            {urlProblem === null ? null : <p role="alert" className="mx-6 mt-3 rounded-field bg-warn-soft px-4 py-3 text-helper-relaxed text-ink">{t("statsWorkbench.filter.invalidUrl")} {t(`statsWorkbench.filter.problems.${urlProblem}`)}</p>}
            {/* 统计控制区默认一行：币种与方式、刷新、设置入口；来源、原币合计、未折算清单等在「统计设置」里。 */}
            <StatBar scope={scope} onSettings={() => setSettingsOpen(true)} />
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
                if (apply(command(session, { type: "move", objectId: moveFor, anchor, collisionPolicy: "reflow" }))) setMoveFor(null);
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

        {editor === null || session === null || (editor.cardId !== null && editorCard === undefined) ? null : (
          <CardEditor
            key={editor.cardId ?? "new"}
            card={editorCard}
            currentSize={editorGeometry === undefined ? undefined : { colSpan: editorGeometry.colSpan, rowSpan: editorGeometry.rowSpan }}
            today={scope.today}
            scope={scope}
            metrics={gridMetrics}
            onSave={(card, size) => (editorCard === undefined ? addCustomCard(card, size) : saveEditedCard(card, size))}
            onClose={() => setEditor(null)}
          />
        )}

        {sizeObject === undefined || session === null || sizeFor === null ? null : (
          <SizeSheet
            current={{ colSpan: sizeObject.colSpan, rowSpan: sizeObject.rowSpan }}
            sizes={(sizeObject.objectType === "analysis-card" ? (() => { const card = cardOf(session, sizeFor); return card === undefined ? [] : cardSizing(card).sizes; })() : CONTAINER_SIZES[sizeObject.objectType]).filter(
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
        {settingsOpen ? (
          <StatsSettingsSheet
            scope={scope}
            currenciesInLedger={scope.ledgerCurrencies ?? currenciesUsed(scope.entries)}
            onChoose={({ combined, currency }) => {
              // 统计方式与币种立即生效，写入地址栏（与筛选面板同一组参数）；未应用的筛选草稿跟着生效条件走。
              setParams((previous) => writeFilters(previous, { ...readFilters(previous), combined, currency }), { replace: true });
            }}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
        {collapsedOpen === null ? null : (
          <CollapsedContainerSheetFor
            documents={documents}
            containerId={collapsedOpen}
            onOpenCard={openCard}
            onClose={() => setCollapsedOpen(null)}
          />
        )}
      </TabPage>
      </CardActionsContext.Provider>
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
