/**
 * 工作台网格：浏览态画 **D 投影后的布局**，编辑态画 **D 的权威主布局**加辅助格线与落位预览。
 *
 * - 浏览态：`projectLayout(main, content, { targetColumns })`——屏幕可用列数少于保存时的列数时，
 *   由 D 的确定性迁移重排（不写回、不累计漂移）；容器空间不足时 D 给出 `collapsed` 形态，这里画成
 *   1×1 入口，内容不丢。
 * - 编辑态：对象统一换成「结构编辑形态」：类型图标、名称、占格 `宽×高`、半透明底色与柔和虚线，
 *   **不渲染图表**，也不把未渲染当成 0。
 */
import { useMemo, useState } from "react";
import {
  placementCells,
  planSmartPlacement,
  positionToRowCol,
  projectLayout,
  type AnalysisCardNode,
  type ContainerNode,
  type GridSize,
  type LayoutDocumentV1,
  type ObjectSizeContract,
  type WorkbenchContentDocumentV1,
} from "@libellum/shared/analysis/layout";

import { useI18n } from "../i18n/index.js";
import { CardBody, cardSubtitle, cardTitle, familyOf } from "./cards.js";
import { cardType, CONTAINER_SIZES, sizeKey } from "./catalog.js";
import type { WorkbenchScope } from "./scope.js";
import { lastRow } from "./session.js";
import {
  ChartGlyph,
  CarouselGlyph,
  ChevronLeft,
  ChevronRight,
  densityFor,
  SpacerGlyph,
  SplitGlyph,
  useElementSize,
} from "./ui.js";

export const GRID_GAP = 12;

/** 每个对象对布局层声明的尺寸约束（卡片规格 §5.6；数值为首版原型值）。 */
export function sizeContracts(content: WorkbenchContentDocumentV1, layout: LayoutDocumentV1): Record<string, ObjectSizeContract> {
  const contracts: Record<string, ObjectSizeContract> = {};
  const ladder = (sizes: readonly GridSize[]) =>
    [...sizes].sort((a, b) => b.colSpan * b.rowSpan - a.colSpan * a.rowSpan || b.colSpan - a.colSpan);
  for (const card of content.cards) {
    const type = cardType(card.analysis.analysisId);
    contracts[card.objectId] = {
      objectId: card.objectId,
      minSize: type?.minSize ?? { colSpan: 1, rowSpan: 1 },
      sizeLadder: ladder(type?.sizes ?? [{ colSpan: 1, rowSpan: 1 }]),
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
  layout,
  columns,
  scope,
  onOpenCard,
  onOpenCollapsed,
  carouselPages,
  onCarouselPage,
}: {
  readonly content: WorkbenchContentDocumentV1;
  readonly layout: LayoutDocumentV1;
  readonly columns: number;
  readonly scope: WorkbenchScope;
  readonly onOpenCard: (cardId: string) => void;
  readonly onOpenCollapsed: (containerId: string) => void;
  readonly carouselPages: ReadonlyMap<string, number>;
  readonly onCarouselPage: (containerId: string, page: number) => void;
}): React.JSX.Element {
  const projection = useMemo(
    () => projectLayout(layout.main, content, { targetColumns: columns, contracts: sizeContracts(content, layout) }),
    [layout, content, columns],
  );
  const cards = useMemo(() => new Map(content.cards.map((card) => [card.objectId, card] as const)), [content]);
  const containers = useMemo(() => new Map(content.containers.map((item) => [item.objectId, item] as const)), [content]);

  return (
    <div className="sw-grid" style={{ gridTemplateColumns: `repeat(${String(projection.columns)}, minmax(0, 1fr))` }}>
      {projection.objects.map((object) => {
        const style = placementStyle(object.anchor, object.colSpan, object.rowSpan, projection.columns);
        if (object.objectType === "spacer") return <div key={object.objectId} aria-hidden="true" style={style} />;
        if (object.objectType === "analysis-card") {
          const card = cards.get(object.objectId);
          if (card === undefined) return null;
          return (
            <div key={object.objectId} style={style} className="min-h-0 min-w-0">
              <CardTile card={card} scope={scope} compat={object.form === "compat"} onOpen={() => onOpenCard(card.objectId)} />
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
}: {
  readonly card: AnalysisCardNode;
  readonly scope: WorkbenchScope;
  readonly compat?: boolean;
  readonly onOpen: () => void;
  /** 在容器里时不再画外框（容器自己有）。 */
  readonly bare?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const body = useElementSize<HTMLDivElement>();
  const title = cardTitle(card, t);
  const subtitle = cardSubtitle(card, scope, t);
  return (
    <article
      className={`sw-card group relative flex h-full min-h-0 flex-col ${bare ? "px-3.5 pt-3 pb-0" : "rounded-card border border-line bg-surface p-3.5 sm:p-4"}`}
      aria-label={title}
    >
      <button
        type="button"
        id={`sw-card-${card.objectId}`}
        className="sw-card-hit"
        aria-label={t("statsWorkbench.card.openNamed", { name: title })}
        onClick={onOpen}
      />
      <header className="pointer-events-none relative flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-helper font-medium break-words text-ink">{title}</h3>
          {subtitle === "" ? null : <p className="truncate text-helper text-muted">{subtitle}</p>}
        </span>
        <ChevronRight width={14} height={14} className="sw-card-chevron mt-0.5 shrink-0 text-muted" />
      </header>
      <div ref={body.ref} className="sw-card-body relative mt-2 min-h-0 flex-1 overflow-hidden">
        {compat ? (
          <p className="text-helper text-muted">{t("statsWorkbench.states.tooSmall")}</p>
        ) : body.width === 0 ? null : (
          <CardBody card={card} scope={scope} density={densityFor(body.width, body.height)} height={body.height} width={body.width} />
        )}
      </div>
    </article>
  );
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

/**
 * 滑动卡片组：同一位置左右切换。**只切页，不聚合**；切页是浏览状态，不写回布局。
 * 横滑与页面纵滚先判方向（横向位移明显大于纵向才算翻页），同时提供按钮与页码点，不只靠手势。
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
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const index = Math.max(0, Math.min(page, cards.length - 1));
  const current = cards[index];
  const go = (next: number) => onPage(Math.max(0, Math.min(cards.length - 1, next)));
  return (
    <section
      className="sw-carousel flex h-full min-h-0 flex-col rounded-card border border-line bg-surface"
      aria-roledescription="carousel"
      aria-label={containerName(container, t)}
      onPointerDown={(event) => setStart({ x: event.clientX, y: event.clientY })}
      onPointerUp={(event) => {
        if (start === null) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        setStart(null);
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
      }}
      onPointerCancel={() => setStart(null)}
    >
      <div className="min-h-0 flex-1" key={current?.objectId}>
        {current === undefined ? null : <CardTile card={current} scope={scope} bare onOpen={() => onOpenCard(current.objectId)} />}
      </div>
      <footer className="flex h-7 shrink-0 items-center justify-between gap-2 px-1.5 pb-1">
        <button type="button" className="sw-icon-button sw-icon-button-sm" aria-label={t("statsWorkbench.card.previous")} disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft width={14} height={14} />
        </button>
        <span className="flex items-center gap-1.5" role="status" aria-label={t("statsWorkbench.card.carouselPage", { page: index + 1, total: cards.length })}>
          {cards.map((card, dot) => (
            <span key={card.objectId} className={`sw-page-dot ${dot === index ? "sw-page-dot-active" : ""}`} aria-hidden="true" />
          ))}
        </span>
        <button type="button" className="sw-icon-button sw-icon-button-sm" aria-label={t("statsWorkbench.card.next")} disabled={index >= cards.length - 1} onClick={() => go(index + 1)}>
          <ChevronRight width={14} height={14} />
        </button>
      </footer>
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
          <CardTile card={card} scope={scope} onOpen={() => onOpenCard(card.objectId)} />
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
  readonly layout: LayoutDocumentV1;
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
      style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${String(rows)}, var(--sw-row))` }}
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
        const kindLabel =
          object.objectType === "analysis-card"
            ? t(`statsWorkbench.config.families.${card === undefined ? "number" : familyOf(card, cardType(card.analysis.analysisId))}`)
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
              {Glyph === null ? <ChartGlyph family={card === undefined ? "number" : familyOf(card, cardType(card.analysis.analysisId))} className="sw-edit-glyph shrink-0 text-brand-dark" /> : <Glyph className="sw-edit-glyph shrink-0 text-brand-dark" />}
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
