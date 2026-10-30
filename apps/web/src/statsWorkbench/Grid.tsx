/**
 * 工作台网格：浏览态画**解析后的显示布局**，编辑态画**编辑列数下的那一份几何**加辅助格线与落位预览。
 *
 * - 浏览态（1.18.01）：列数由容器的实际宽度决定（自动，或本工作区记住的手动列数），布局由 D 的
 *   `resolveDisplayLayout` 解析——这个列数的专属布局 → 基础布局原样 → 从基础布局响应式排出（见
 *   `@libellum/shared/analysis/layout` 的 `responsive.ts`）。不写回、不链式派生；容器空间不足时给出
 *   `collapsed` 形态，这里画成 1×1 入口，内容不丢。
 * - 行高随格宽变化（`gridRowHeight`），浏览与编辑用同一套轨道，所以编辑时看到的格子就是浏览时的格子。
 * - 编辑态：对象统一换成「结构编辑形态」：类型图标、名称、占格 `宽×高`、半透明底色与柔和虚线，
 *   **不渲染图表**，也不把未渲染当成 0。
 */
import { useContext, useMemo, useRef, useState } from "react";
import {
  chooseAutoColumns,
  geometryQuality,
  gridCellWidth,
  gridColumnLimit,
  gridRowHeight,
  placementCells,
  planSmartPlacement,
  positionToRowCol,
  resolveDisplayLayout,
  type AnalysisCardNode,
  type ContainerNode,
  type DisplayLayout,
  type GridSize,
  type LayoutDocumentV1,
  type LayoutGeometry,
  type ObjectSizeContract,
  type WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";

import { UNSAFE_LocationContext } from "react-router";

import { useI18n } from "../i18n/index.js";
import { useOpenDrag } from "../workspace/openDrag.js";
import { resistedOffset, swipeAxis, swipeTarget, type SwipeAxis } from "./carouselGesture.js";
import { CardBody, cardSubtitle, cardTitle, familyOf } from "./cards.js";
import { cardType, CONTAINER_SIZES, sizeKey } from "./catalog.js";
import { CompositeBody } from "./CompositeCard.js";
import { cardSizing, isMultiSlot, readComposition, singlePresentation, slotSpecs, type GridMetrics } from "./composition.js";
import type { WorkbenchScope } from "./scope.js";
import { SlotPresentationContext } from "./slotContext.js";
import { lastRow } from "./session.js";
import {
  ChartGlyph,
  CarouselGlyph,
  ChevronLeft,
  ChevronRight,
  ComposeGlyph,
  densityFor,
  SpacerGlyph,
  SplitGlyph,
  useElementSize,
} from "./ui.js";

export const GRID_GAP = 12;

/** 一份工作台文档（内容 + 布局），与 `storage.ts` 的 `WorkbenchDocuments` 同形。 */
interface GridDocuments {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
}

/**
 * 自动列数：按**网格容器的实际宽度**（ResizeObserver 测得，不是窗口宽度；两个工作区各算各的）评分选择，
 * 不是「能放几列就放几列」（见 `chooseAutoColumns`）。`previous` 是上一次的结果，分数接近时保持，避免抖动。
 * 宽度还没测出来时（首帧）沿用基础列数（最多 2 列），与以前的首帧一致。
 */
export function autoColumnsFor(documents: GridDocuments, gridWidth: number, previous: number | null = null): number {
  return chooseAutoColumns(documents.layout, documents.content, {
    width: gridWidth,
    gap: GRID_GAP,
    contracts: sizeContracts(documents.content, documents.layout),
    previous,
  });
}

/** 这个宽度最多能选几列（每格不窄于可读下限，最多 8 列；窄到放不下两列时是 1 列）。 */
export function columnLimitFor(gridWidth: number): number {
  return gridColumnLimit(gridWidth, GRID_GAP);
}

/** 某个列数下要显示的布局：专属布局 → 基础布局原样 → 从基础布局排出（规则 A / B / C）。 */
export function displayFor(documents: GridDocuments, columns: number): DisplayLayout {
  return resolveDisplayLayout(documents.layout, documents.content, { targetColumns: columns, contracts: sizeContracts(documents.content, documents.layout) });
}

/** 网格轨道：每格宽度与行高。行高随格宽变（手机上仍是 116px），浏览与编辑共用。 */
export interface GridTrack {
  readonly columns: number;
  readonly cellWidth: number;
  readonly rowHeight: number;
}

export function gridTrack(gridWidth: number, columns: number): GridTrack {
  const cellWidth = gridCellWidth(gridWidth, columns, GRID_GAP);
  return { columns, cellWidth, rowHeight: gridRowHeight(cellWidth) };
}

/**
 * 当前设备上工作台网格的像素度量（组合卡片的尺寸推荐与「能否完整显示」按它算）。
 * 卡片外框：内边距 14px（≥ 640px 时 16px）、标题一行约 18px、标题与内容间距 8px。
 */
export function gridMetricsFor(gridWidth: number, columns: number, viewportWidth: number): GridMetrics | null {
  if (gridWidth <= 0 || columns <= 0) return null;
  const padding = viewportWidth >= 640 ? 16 : 14;
  const track = gridTrack(gridWidth, columns);
  return {
    columnWidth: track.cellWidth,
    rowHeight: track.rowHeight,
    gap: GRID_GAP,
    columns,
    chromeWidth: padding * 2,
    chromeHeight: padding * 2 + 18 + 8,
  };
}

/** 卡片在这条轨道上的宽高比超过它就算「扁长 / 细高」（滑条附近的提示据此判断）。 */
const SPARSE_ASPECT = 4;
/** 空洞与整列空白合计达到排布面积的这个比例，也算宽松。 */
const SPARSE_BLANK = 0.2;
/** 每格宽过它（约为自动列数目标格宽的 1.75 倍）：卡片里的内容会显得空旷。 */
const SPARSE_CELL = 300;

/**
 * 当前列数下排布是否明显宽松：每格过宽、有卡片被拉成很扁或很高的形状，或大片空白（例如三列里全是两格宽的
 * 卡片，右边整列空着）。只用于编辑器滑条旁的非阻断提示，判断依据是实际像素尺寸与排布，不是「列数是不是 2」。
 */
export function layoutLooksSparse(geometry: LayoutGeometry, track: GridTrack): boolean {
  if (track.cellWidth <= 0) return false;
  if (track.cellWidth > SPARSE_CELL) return true;
  const quality = geometryQuality(geometry);
  if (quality.holeRatio + quality.tailRatio >= SPARSE_BLANK) return true;
  return geometry.objects.some((object) => {
    if (object.objectType === "spacer") return false;
    const width = object.colSpan * track.cellWidth + (object.colSpan - 1) * GRID_GAP;
    const height = object.rowSpan * track.rowHeight + (object.rowSpan - 1) * GRID_GAP;
    return width / height > SPARSE_ASPECT || height / width > SPARSE_ASPECT;
  });
}

/** 每个对象对布局层声明的尺寸约束（卡片规格 §5.6；数值为首版原型值）。 */
export function sizeContracts(content: WorkbenchContentDocumentV1, layout: LayoutDocumentV1): Record<string, ObjectSizeContract> {
  const contracts: Record<string, ObjectSizeContract> = {};
  const ladder = (sizes: readonly GridSize[]) =>
    [...sizes].sort((a, b) => b.colSpan * b.rowSpan - a.colSpan * a.rowSpan || b.colSpan - a.colSpan);
  for (const card of content.cards) {
    // 组合卡片按模板的尺寸约束；单项卡片按分析与展示形式（数字选成图表时用图表尺寸）。未知分析按 1×1 占位。
    const sizing = cardType(card.analysis.analysisId) === null && !isMultiSlot(card) ? null : cardSizing(card);
    contracts[card.objectId] = {
      objectId: card.objectId,
      minSize: sizing?.minSize ?? { colSpan: 1, rowSpan: 1 },
      sizeLadder: ladder(sizing?.sizes ?? [{ colSpan: 1, rowSpan: 1 }]),
      compatSize: { colSpan: 1, rowSpan: 1 },
    };
  }
  for (const container of content.containers) {
    contracts[container.objectId] = {
      objectId: container.objectId,
      minSize: { colSpan: 1, rowSpan: 1 },
      sizeLadder: ladder(CONTAINER_SIZES[container.type]),
      collapsedSize: { colSpan: 1, rowSpan: 1 },
      minFullCols: container.type === "grid-split" ? 2 : 1,
    };
  }
  for (const object of layout.main.objects) {
    if (object.objectType === "spacer") {
      contracts[object.objectId] = {
        objectId: object.objectId,
        minSize: { colSpan: 1, rowSpan: 1 },
        sizeLadder: [{ colSpan: object.colSpan, rowSpan: object.rowSpan }],
      };
    }
  }
  return contracts;
}

function placementStyle(anchor: number, colSpan: number, rowSpan: number, columns: number): React.CSSProperties {
  const { row, col } = positionToRowCol(anchor, columns);
  return { gridColumn: `${String(col)} / span ${String(colSpan)}`, gridRow: `${String(row)} / span ${String(rowSpan)}` };
}

// ---------------------------------------------------------------------------
// 浏览态
// ---------------------------------------------------------------------------

export function BrowseGrid({
  content,
  display,
  rowHeight,
  scope,
  onOpenCard,
  onOpenCollapsed,
  carouselPages,
  onCarouselPage,
}: {
  readonly content: WorkbenchContentDocumentV1;
  /** 已解析的显示布局（`displayFor`）：这里只画，不再自己决定列数或位置。 */
  readonly display: DisplayLayout;
  /** 行高（px，`gridTrack`）。 */
  readonly rowHeight: number;
  readonly scope: WorkbenchScope;
  readonly onOpenCard: (cardId: string) => void;
  readonly onOpenCollapsed: (containerId: string) => void;
  readonly carouselPages: ReadonlyMap<string, number>;
  readonly onCarouselPage: (containerId: string, page: number) => void;
}): React.JSX.Element {
  const projection = display.projection;
  const cards = useMemo(() => new Map(content.cards.map((card) => [card.objectId, card] as const)), [content]);
  const containers = useMemo(() => new Map(content.containers.map((item) => [item.objectId, item] as const)), [content]);

  return (
    <div
      className="sw-grid"
      data-columns={projection.columns}
      data-layout-source={display.source}
      style={{ gridTemplateColumns: `repeat(${String(projection.columns)}, minmax(0, 1fr))`, ["--sw-row" as string]: `${String(rowHeight)}px` }}
    >
      {projection.objects.map((object) => {
        const style = placementStyle(object.anchor, object.colSpan, object.rowSpan, projection.columns);
        if (object.objectType === "spacer") return <div key={object.objectId} aria-hidden="true" style={style} />;
        if (object.objectType === "analysis-card") {
          const card = cards.get(object.objectId);
          if (card === undefined) return null;
          return (
            <div key={object.objectId} style={style} className="min-h-0 min-w-0">
              <CardTile card={card} scope={scope} compat={object.form === "compat"} oneRow={object.rowSpan === 1} draggable onOpen={() => onOpenCard(card.objectId)} />
            </div>
          );
        }
        const container = containers.get(object.objectId);
        if (container === undefined) return null;
        const children = container.children.map((id) => cards.get(id)).filter((card): card is AnalysisCardNode => card !== undefined);
        return (
          <div key={object.objectId} style={style} className="min-h-0 min-w-0">
            {object.form === "collapsed" ? (
              <CollapsedContainer container={container} count={children.length} onOpen={() => onOpenCollapsed(container.objectId)} />
            ) : container.type === "carousel" ? (
              <CarouselView
                container={container}
                cards={children}
                scope={scope}
                page={carouselPages.get(container.objectId) ?? 0}
                onPage={(page) => onCarouselPage(container.objectId, page)}
                onOpenCard={onOpenCard}
              />
            ) : (
              <SplitView container={container} cards={children} scope={scope} onOpenCard={onOpenCard} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 一张浏览态卡片：整卡是「查看详情」的入口；内部图表交互不冒泡（cards.tsx 里 stopPropagation）。 */
export function CardTile({
  card,
  scope,
  compat = false,
  onOpen,
  bare = false,
  aside,
  oneRow = false,
  draggable = false,
}: {
  readonly card: AnalysisCardNode;
  readonly scope: WorkbenchScope;
  readonly compat?: boolean;
  readonly onOpen: () => void;
  /** 在容器里时不再画外框（容器自己有）。 */
  readonly bare?: boolean;
  /** 标题行右侧换成别的内容（横向滑动抽屉的页码点），代替「查看详情」箭头。 */
  readonly aside?: React.ReactNode;
  /**
   * 只占一行高（1×1 / 2×1）：标题收成一行（完整名称在 title 与读屏名称里）。320px 窄屏上 7 个字的标题会
   * 折成两行，带时间副标题的一行高卡片就放不下数值了（1.17.12 浏览器实测）。
   */
  readonly oneRow?: boolean;
  /**
   * S18 第二轮：浏览态卡片可以在大屏上长按 / 拖动到另一个工作区打开它的详情（带着当前筛选）。编辑态、
   * 编辑器里的预览不参与——那里的拖动属于 S17 的卡片排版。
   */
  readonly draggable?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const body = useElementSize<HTMLDivElement>();
  const title = cardTitle(card, t);
  // 编辑器里的静态预览不在路由里：那里没有位置，也不参与拖动。
  const search = (useContext(UNSAFE_LocationContext) as { location?: { search?: string } } | null)?.location?.search ?? "";
  const drag = useOpenDrag({ path: `/stats/cards/${encodeURIComponent(card.objectId)}${search}`, title, disabled: !draggable });
  const subtitle = cardSubtitle(card, scope, t);
  const singleLineTitle = oneRow || isMultiSlot(card);
  return (
    <article
      className={`sw-card group relative flex h-full min-h-0 flex-col ${bare ? "px-3.5 pt-3 pb-2" : "rounded-card border border-line bg-surface p-3.5 sm:p-4"}`}
      aria-label={title}
      data-one-row={oneRow ? "" : undefined}
    >
      <button
        type="button"
        id={`sw-card-${card.objectId}`}
        className={drag.bind === null ? "sw-card-hit" : "sw-card-hit lv-draggable"}
        aria-label={t("statsWorkbench.card.openNamed", { name: title })}
        onClick={onOpen}
        {...drag.bind}
      />
      {drag.menu}
      <header className="pointer-events-none relative flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1">
          {/* 组合卡片的标题收成一行（完整名称在 aria-label 与 title 里）：内容排布按一行标题计算，
              自动标题较长时换行会挤掉槽位。 */}
          <h3 className={`${singleLineTitle ? "truncate" : "line-clamp-2 break-words"} text-helper font-medium text-ink`} title={singleLineTitle ? title : undefined}>{title}</h3>
          {subtitle === "" ? null : <p className="truncate text-helper text-muted">{subtitle}</p>}
        </span>
        {aside ?? <ChevronRight width={14} height={14} className="sw-card-chevron mt-0.5 shrink-0 text-muted" />}
      </header>
      <div ref={body.ref} className="sw-card-body relative mt-2 min-h-0 flex-1 overflow-hidden">
        {compat ? (
          <p className="text-helper text-muted">{t("statsWorkbench.states.tooSmall")}</p>
        ) : body.width === 0 ? null : isMultiSlot(card) ? (
          <CompositeBody card={card} scope={scope} width={body.width} height={body.height} />
        ) : (
          <SingleCardBody card={card} scope={scope} width={body.width} height={body.height} />
        )}
      </div>
    </article>
  );
}

/**
 * 单项卡片正文：图表放不下完整绘图区时，时间趋势改画迷你趋势，其它图形写「空间不足，点开查看」，
 * 不把图裁掉（与编辑器的尺寸检查同一判断，见 `singlePresentation`）。
 */
function SingleCardBody({ card, scope, width, height }: { readonly card: AnalysisCardNode; readonly scope: WorkbenchScope; readonly width: number; readonly height: number }): React.JSX.Element {
  const { t } = useI18n();
  const read = readComposition(card);
  const spec = slotSpecs(read.slots)[0];
  const presentation = spec === undefined ? "full" : singlePresentation(spec, width, height);
  if (presentation === "too-small") return <p className="text-helper text-muted">{t("statsWorkbench.states.tooSmall")}</p>;
  const body = <CardBody card={card} scope={scope} density={densityFor(width, height)} height={height} width={width} />;
  return presentation === "spark" ? <SlotPresentationContext.Provider value={{ mode: "spark" }}>{body}</SlotPresentationContext.Provider> : body;
}

function containerName(container: ContainerNode, t: ReturnType<typeof useI18n>["t"]): string {
  return t(container.type === "carousel" ? "statsWorkbench.containers.carousel" : "statsWorkbench.containers.grid-split");
}

function CollapsedContainer({ container, count, onOpen }: { readonly container: ContainerNode; readonly count: number; readonly onOpen: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const Glyph = container.type === "carousel" ? CarouselGlyph : SplitGlyph;
  return (
    <button type="button" onClick={onOpen} className="flex h-full w-full flex-col items-start justify-between rounded-card border border-line bg-surface p-3.5 text-left transition hover:bg-canvas">
      <Glyph className="text-brand" />
      <span className="flex flex-col">
        <span className="text-helper font-medium text-ink">{containerName(container, t)}</span>
        <span className="text-helper text-muted">{t("statsWorkbench.card.collapsedEntry", { count })}</span>
      </span>
    </button>
  );
}

interface Swipe {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly width: number;
  axis: SwipeAxis;
  dx: number;
}

/**
 * 横向滑动抽屉：同一位置左右切换。**只切页，不聚合**；切页是浏览状态，不写回布局。
 *
 * - 手机：手指左右滑动，卡片**跟手**移动，松手吸附到相邻一页或弹回（`carouselGesture.ts`）；先判方向，
 *   纵向滑动照常滚动页面（`touch-action: pan-y`）。拖动中不触发 React 渲染，位移写到 CSS 变量。
 * - 页码点在卡片标题行右侧（克制，不另占一行，留给图表的高度不变）；点它可以直接跳页。
 * - 桌面：鼠标悬停时两侧出现上一张 / 下一张按钮；键盘焦点在抽屉里时左右方向键翻页。
 * - 只渲染当前页与相邻两页，其它页留空位（不提前计算看不到的卡片）。
 */
export function CarouselView({
  container,
  cards,
  scope,
  page,
  onPage,
  onOpenCard,
}: {
  readonly container: ContainerNode;
  readonly cards: readonly AnalysisCardNode[];
  readonly scope: WorkbenchScope;
  readonly page: number;
  readonly onPage: (page: number) => void;
  readonly onOpenCard: (cardId: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<Swipe | null>(null);
  const swallowClick = useRef(false);
  const index = Math.max(0, Math.min(page, cards.length - 1));
  const go = (next: number) => onPage(Math.max(0, Math.min(cards.length - 1, next)));
  const setOffset = (px: number, dragging: boolean) => {
    const track = trackRef.current;
    if (track === null) return;
    track.style.setProperty("--sw-carousel-offset", `${String(px)}px`);
    if (dragging) track.dataset["dragging"] = "";
    else delete track.dataset["dragging"];
  };
  const end = (commit: boolean) => {
    const current = swipe.current;
    swipe.current = null;
    if (current === null || current.axis !== "x") return;
    swallowClick.current = true;
    setOffset(0, false);
    if (commit) go(swipeTarget(index, cards.length, current.dx, performance.now() - current.time, current.width));
  };
  const dots = (
    <span className="sw-carousel-dots" role="group" aria-label={t("statsWorkbench.card.carouselPage", { page: index + 1, total: cards.length })}>
      {cards.map((card, dot) => (
        <button
          key={card.objectId}
          type="button"
          className="sw-carousel-dot"
          aria-label={t("statsWorkbench.card.carouselPage", { page: dot + 1, total: cards.length })}
          aria-current={dot === index ? "true" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            go(dot);
          }}
        >
          <span className={`sw-page-dot ${dot === index ? "sw-page-dot-active" : ""}`} aria-hidden="true" />
        </button>
      ))}
    </span>
  );
  return (
    <section
      className="sw-carousel relative flex h-full min-h-0 flex-col rounded-card border border-line bg-surface"
      aria-roledescription="carousel"
      aria-label={containerName(container, t)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          go(index - 1);
        } else if (event.key === "ArrowRight" && index < cards.length - 1) {
          event.preventDefault();
          go(index + 1);
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        swallowClick.current = false;
        swipe.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), width: event.currentTarget.clientWidth, axis: null, dx: 0 };
      }}
      onPointerMove={(event) => {
        const current = swipe.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.x;
        if (current.axis === null) {
          current.axis = swipeAxis(dx, event.clientY - current.y);
          if (current.axis === "y") {
            swipe.current = null;
            return;
          }
          if (current.axis === "x") event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (current.axis !== "x") return;
        current.dx = dx;
        setOffset(resistedOffset(dx, index, cards.length), true);
      }}
      onPointerUp={(event) => {
        if (swipe.current?.pointerId === event.pointerId) end(true);
      }}
      onPointerCancel={(event) => {
        if (swipe.current?.pointerId === event.pointerId) end(false);
      }}
      onClickCapture={(event) => {
        // 横滑翻页后松手的那一下不是「点开卡片」。
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="sw-carousel-viewport min-h-0 flex-1">
        <div ref={trackRef} className="sw-carousel-track" style={{ "--sw-carousel-index": index } as React.CSSProperties}>
          {cards.map((card, slide) => (
            <div key={card.objectId} className="sw-carousel-slide" inert={slide !== index} aria-hidden={slide !== index ? "true" : undefined}>
              {Math.abs(slide - index) > 1 ? null : (
                <CardTile card={card} scope={scope} bare draggable onOpen={() => onOpenCard(card.objectId)} aside={dots} />
              )}
            </div>
          ))}
        </div>
      </div>
      <button type="button" className="sw-carousel-arrow sw-carousel-arrow-start" aria-label={t("statsWorkbench.card.previous")} disabled={index === 0} onClick={() => go(index - 1)}>
        <ChevronLeft width={14} height={14} />
      </button>
      <button type="button" className="sw-carousel-arrow sw-carousel-arrow-end" aria-label={t("statsWorkbench.card.next")} disabled={index >= cards.length - 1} onClick={() => go(index + 1)}>
        <ChevronRight width={14} height={14} />
      </button>
    </section>
  );
}

/** 分割卡片组：按 D 的千分比分槽（首期两线对齐：1×2 / 2×1 / 2×2）。 */
export function SplitView({
  container,
  cards,
  scope,
  onOpenCard,
}: {
  readonly container: ContainerNode;
  readonly cards: readonly AnalysisCardNode[];
  readonly scope: WorkbenchScope;
  readonly onOpenCard: (cardId: string) => void;
}): React.JSX.Element {
  const split = container.type === "grid-split" ? container.split : { columnSplitPermille: 500, rowSplitPermille: 0 };
  const cols = split.columnSplitPermille > 0 && split.columnSplitPermille < 1000 ? 2 : 1;
  const rows = split.rowSplitPermille > 0 && split.rowSplitPermille < 1000 ? 2 : 1;
  const colTemplate = cols === 2 ? `${String(split.columnSplitPermille)}fr ${String(1000 - split.columnSplitPermille)}fr` : "1fr";
  const rowTemplate = rows === 2 ? `${String(split.rowSplitPermille)}fr ${String(1000 - split.rowSplitPermille)}fr` : "1fr";
  return (
    <div className="grid h-full min-h-0 gap-2" style={{ gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}>
      {cards.slice(0, cols * rows).map((card) => (
        <div key={card.objectId} className="min-h-0 min-w-0">
          <CardTile card={card} scope={scope} draggable onOpen={() => onOpenCard(card.objectId)} />
        </div>
      ))}
    </div>
  );
}

/** GridSplit 的分割方式：两张左右分，三到四张田字格（首期对齐式，D 的千分比）。 */
export function splitFor(count: number): { readonly columnSplitPermille: number; readonly rowSplitPermille: number } {
  return count <= 2 ? { columnSplitPermille: 500, rowSplitPermille: 0 } : { columnSplitPermille: 500, rowSplitPermille: 500 };
}

// ---------------------------------------------------------------------------
// 编辑态
// ---------------------------------------------------------------------------

export interface DropPreview {
  readonly anchor: number;
  readonly size: GridSize;
  readonly legal: boolean;
  readonly layout?: LayoutDocumentV1;
  readonly targetId?: string;
}

export function EditGrid({
  content,
  layout,
  rowHeight,
  selection,
  dimmed,
  draggingId,
  preview,
  moveTargets,
  pendingPlaceholder,
  gridRef,
  objectProps,
  onSelect,
  onPickTarget,
}: {
  readonly content: WorkbenchContentDocumentV1;
  /** 编辑会话的布局文档：`main` 是编辑列数下的那一份几何（`main.baseCols` = 编辑列数）。 */
  readonly layout: LayoutDocumentV1;
  /** 行高（px），与浏览态同一条轨道（`gridTrack`）。 */
  readonly rowHeight: number;
  readonly selection: string | null;
  /** 容器内部编辑时，外层对象变淡且不可点（父容器暂停编辑）。 */
  readonly dimmed: string | null | "all";
  readonly draggingId: string | null;
  readonly preview: DropPreview | null;
  /** 「移动」模式下可放置的位置（由 D 判定合法的锚点）。 */
  readonly moveTargets: ReadonlySet<number> | null;
  readonly pendingPlaceholder: { readonly anchor: number; readonly size: GridSize; readonly label: string; readonly kind: "carousel" | "grid-split"; readonly count: number } | null;
  readonly gridRef: React.RefObject<HTMLDivElement | null>;
  readonly objectProps: (objectId: string, label: string, size: GridSize) => Record<string, unknown>;
  readonly onSelect: (objectId: string) => void;
  readonly onPickTarget: (anchor: number) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const columns = layout.main.baseCols;
  const pendingPlan = pendingPlaceholder === null ? null : planSmartPlacement(layout.main, {
    objectId: "__pending-container__", objectType: "spacer", anchor: pendingPlaceholder.anchor,
    colSpan: pendingPlaceholder.size.colSpan, rowSpan: pendingPlaceholder.size.rowSpan,
  });
  const shownLayout = preview?.legal === true && preview.layout !== undefined
    ? preview.layout
    : pendingPlan?.ok === true
      ? { ...layout, main: { ...pendingPlan.geometry, objects: pendingPlan.geometry.objects.filter((item) => item.objectId !== "__pending-container__") } }
      : layout;
  const pendingRows = pendingPlaceholder === null ? 0 : positionToRowCol(pendingPlaceholder.anchor, columns).row + pendingPlaceholder.size.rowSpan - 1;
  const rows = Math.max(lastRow(layout), lastRow(shownLayout), pendingRows) + 2;
  const cards = new Map(content.cards.map((card) => [card.objectId, card] as const));
  const containers = new Map(content.containers.map((item) => [item.objectId, item] as const));
  const covered = new Set<number>();
  for (const object of shownLayout.main.objects) {
    if (object.objectId === draggingId) continue;
    for (const cell of placementCells(object.anchor, { colSpan: object.colSpan, rowSpan: object.rowSpan }, columns)) covered.add(cell);
  }
  if (pendingPlaceholder !== null) {
    for (const cell of placementCells(pendingPlaceholder.anchor, pendingPlaceholder.size, columns)) covered.add(cell);
  }

  return (
    <div
      ref={gridRef}
      className="sw-grid sw-grid-edit"
      data-columns={columns}
      style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${String(rows)}, var(--sw-row))`, ["--sw-row" as string]: `${String(rowHeight)}px` }}
    >
      {Array.from({ length: rows * columns }, (_, index) => {
        const anchor = index + 1;
        const target = moveTargets?.has(anchor) === true;
        // 格线只画在空位上：对象底下不再透出格子边，2×2 的对象看起来是一个整体。
        if (!target && covered.has(anchor)) return null;
        return (
          <button
            key={`cell-${String(anchor)}`}
            type="button"
            tabIndex={target ? 0 : -1}
            aria-hidden={target ? undefined : true}
            aria-label={target ? t("statsWorkbench.edit.placeAt", { anchor }) : undefined}
            disabled={!target}
            onClick={() => onPickTarget(anchor)}
            className={`sw-cell ${target ? "sw-cell-target" : ""}`}
            style={placementStyle(anchor, 1, 1, columns)}
          />
        );
      })}

      {shownLayout.main.objects.map((object) => {
        const size = { colSpan: object.colSpan, rowSpan: object.rowSpan };
        const card = object.objectType === "analysis-card" ? cards.get(object.objectId) : undefined;
        const container = containers.get(object.objectId);
        const label =
          object.objectType === "spacer"
            ? t("statsWorkbench.containers.spacer")
            : card !== undefined
              ? cardTitle(card, t)
              : container !== undefined
                ? containerName(container, t)
                : object.objectId;
        const Glyph = object.objectType === "spacer" ? SpacerGlyph : object.objectType === "carousel" ? CarouselGlyph : object.objectType === "grid-split" ? SplitGlyph : null;
        const faded = dimmed === "all" || (dimmed !== null && dimmed !== object.objectId);
        const composite = card !== undefined && isMultiSlot(card) ? readComposition(card) : null;
        const kindLabel =
          object.objectType === "analysis-card"
            ? composite !== null
              ? t("statsWorkbench.composite.editTile", { count: composite.slots.length, template: t(`statsWorkbench.composite.templates.${composite.template}.name`) })
              : t(`statsWorkbench.config.families.${card === undefined ? "number" : familyOf(card, cardType(card.analysis.analysisId))}`)
            : container !== undefined
              ? t("statsWorkbench.containers.children", { count: container.children.length })
              : t("statsWorkbench.containers.spacerShort");
        return (
          <button
            key={object.objectId}
            type="button"
            data-object-id={object.objectId}
            data-size={sizeKey(size)}
            className={`sw-edit-tile ${object.objectType === "spacer" ? "sw-edit-spacer" : ""} ${selection === object.objectId || preview?.targetId === object.objectId ? "sw-edit-selected" : ""} ${draggingId === object.objectId ? "sw-edit-dragging" : ""} ${faded ? "sw-edit-faded" : ""}`}
            style={placementStyle(object.anchor, object.colSpan, object.rowSpan, columns)}
            aria-label={t("statsWorkbench.edit.objectLabel", { name: label, size: sizeKey(size) })}
            aria-haspopup="dialog"
            disabled={faded}
            onClick={() => onSelect(object.objectId)}
            {...objectProps(object.objectId, label, size)}
          >
            <span className="flex items-start justify-between gap-2">
              {Glyph === null ? composite !== null ? <ComposeGlyph className="sw-edit-glyph shrink-0 text-brand-dark" /> : <ChartGlyph family={card === undefined ? "number" : familyOf(card, cardType(card.analysis.analysisId))} className="sw-edit-glyph shrink-0 text-brand-dark" /> : <Glyph className="sw-edit-glyph shrink-0 text-brand-dark" />}
              <span className="sw-size-badge">{sizeKey(size)}</span>
            </span>
            <span className="mt-auto flex min-w-0 flex-col items-start text-left">
              <span className="sw-edit-title line-clamp-2 w-full font-medium break-words text-ink">{label}</span>
              {object.colSpan * object.rowSpan <= 1 ? null : <span className="w-full truncate text-helper text-muted">{object.presentation === "collapsed" ? t("statsWorkbench.edit.collapsedTag") : kindLabel}</span>}
            </span>
          </button>
        );
      })}

      {pendingPlaceholder === null ? null : (
        <div className="sw-edit-tile sw-edit-pending" data-pending-container="true" style={placementStyle(pendingPlaceholder.anchor, pendingPlaceholder.size.colSpan, pendingPlaceholder.size.rowSpan, columns)}>
          <span className="flex items-start justify-between gap-2">
            {pendingPlaceholder.kind === "carousel" ? <CarouselGlyph className="text-brand-dark" /> : <SplitGlyph className="text-brand-dark" />}
            <span className="sw-size-badge">{sizeKey(pendingPlaceholder.size)}</span>
          </span>
          <span className="mt-auto flex flex-col items-start text-left">
            <span className="text-helper font-medium text-ink">{pendingPlaceholder.label}</span>
            <span className="text-helper text-muted">{t("statsWorkbench.containers.children", { count: pendingPlaceholder.count })}</span>
          </span>
        </div>
      )}

      {preview === null ? null : (
        <div
          aria-hidden="true"
          className={`sw-drop ${preview.legal ? "sw-drop-legal" : "sw-drop-illegal"}`}
          style={placementStyle(preview.anchor, preview.size.colSpan, preview.size.rowSpan, columns)}
        >
          <span>{preview.legal ? t("statsWorkbench.edit.dropHere") : t("statsWorkbench.edit.illegal")}</span>
        </div>
      )}
    </div>
  );
}
