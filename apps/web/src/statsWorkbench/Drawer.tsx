/**
 * 编辑态底部的卡片抽屉（草图第三屏下方）：**同一页面里的抽屉，不是另一个管理页面。**
 *
 * - 两类入口：分析卡片（系统推荐 / 全部分析 / 我的自定义）与布局容器（滑动卡片组 / 分割卡片组 /
 *   留白——留白只是放在这个分组里，不是容器）；
 * - 每一项都有「点 ＋ 放到第一个空位」的非拖动路径；拖动是快捷方式（触摸需长按，见 dnd.ts）；
 * - 默认收起为胶囊工具条，展开按所属工作区限宽限高；拖动来源 DOM 始终保留；
 * - 进入容器内部编辑时，抽屉切换成「正在编辑：某容器」，只提供首版允许放进容器的分析卡片。
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useI18n } from "../i18n/index.js";
import { cardTitle } from "./cards.js";
import { CARD_TYPES, CONTAINER_DEFAULT_SIZE, type CardGroup, type CardType, type LayoutObjectChoice } from "./catalog.js";
import type { DragController, DragPayload } from "./dnd.js";
import { readComposition } from "./composition.js";
import { useDrawerGesture } from "./drawerGesture.js";
import { usePane, usePaneSize } from "../workspace/context.js";
import { drawerGeometry, drawerModeFor, type DrawerMode } from "./drawerLayout.js";
import {
  ChartGlyph,
  ComposeGlyph,
  CarouselGlyph,
  ChevronDown,
  ChevronUp,
  PlusGlyph,
  PresetGlyph,
  SpacerGlyph,
  SplitGlyph,
  XGlyph,
} from "./ui.js";

export type DrawerHeight = "collapsed" | "expanded";

export interface ContainerScopeView {
  readonly name: string;
  readonly kind: "carousel" | "grid-split";
  readonly children: readonly AnalysisCardNode[];
  readonly min: number;
  readonly max: number;
  readonly isNew: boolean;
}

export function Drawer({
  height,
  onHeight,
  combined,
  drag,
  onAddCard,
  onAddLayout,
  onCustom,
  customCards = [],
  onConfigureCustom,
  onDuplicateCustom,
  containerScope,
  onScopeAdd,
  onScopeMove,
  onScopeRemove,
  onScopeDone,
  onScopeCancel,
  onPresets,
}: {
  readonly height: DrawerHeight;
  readonly onHeight: (height: DrawerHeight) => void;
  readonly combined: boolean;
  readonly drag: DragController;
  readonly onAddCard: (analysisId: string) => void;
  readonly onAddLayout: (choice: LayoutObjectChoice) => void;
  readonly onCustom: () => void;
  readonly customCards?: readonly AnalysisCardNode[];
  readonly onConfigureCustom?: (objectId: string) => void;
  readonly onDuplicateCustom?: (card: AnalysisCardNode) => void;
  readonly containerScope: ContainerScopeView | null;
  readonly onScopeAdd: (analysisId: string) => void;
  readonly onScopeMove: (index: number, delta: -1 | 1) => void;
  readonly onScopeRemove: (index: number) => void;
  readonly onScopeDone: () => void;
  readonly onScopeCancel: () => void;
  /** 工作台布局预设入口（标题栏右侧的轻量按钮）；不传则不显示。 */
  readonly onPresets?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<"analysis" | "layout">("analysis");
  const [group, setGroup] = useState<"recommended" | "all" | "mine">("recommended");
  const [query, setQuery] = useState("");
  const expanded = height === "expanded";
  const pane = usePane();
  const paneSize = usePaneSize();
  const [mode, setMode] = useState<DrawerMode>(() => drawerModeFor(paneSize.width));
  useEffect(() => setMode((previous) => drawerModeFor(paneSize.width, previous)), [paneSize.width]);
  const geometry = drawerGeometry(paneSize.width || 320, paneSize.height || 640);
  const bodyId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const positions = useRef(new Map<string, number>());
  const restoreFocus = useRef(false);
  const scrollKey = containerScope === null ? `${tab}:${group}` : "scope";
  useLayoutEffect(() => {
    if (expanded && scrollRef.current !== null) scrollRef.current.scrollTop = positions.current.get(scrollKey) ?? 0;
  }, [expanded, scrollKey]);
  const rememberScroll = () => {
    if (expanded && scrollRef.current !== null) positions.current.set(scrollKey, scrollRef.current.scrollTop);
  };

  const library = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return CARD_TYPES.filter((type) => (group === "recommended" ? type.recommended : true)).filter((type) => {
      if (needle === "") return true;
      const title = t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`).toLocaleLowerCase();
      const desc = t(`statsWorkbench.cards.${type.id as "AN-B01"}.desc`).toLocaleLowerCase();
      return title.includes(needle) || desc.includes(needle);
    });
  }, [group, query, t]);

  const grouped = useMemo(() => {
    const order: CardGroup[] = ["basic", "insight", "advanced", "professional"];
    return order.map((key) => ({ key, items: library.filter((type) => type.group === key) })).filter((section) => section.items.length > 0);
  }, [library]);

  const scope = containerScope;
  const full = scope !== null && scope.children.length >= scope.max;
  const gesture = useDrawerGesture({ expanded, onEnd: (end) => {
    if (end === "collapsed") restoreFocus.current = gesture.sectionRef.current?.contains(document.activeElement) ?? false;
    onHeight(end);
  } });
  useLayoutEffect(() => {
    const section = gesture.sectionRef.current;
    if (expanded) section?.querySelector<HTMLButtonElement>(".sw-drawer-expanded-head button")?.focus();
    else if (restoreFocus.current) section?.querySelector<HTMLButtonElement>("[data-drawer-opener]")?.focus();
    restoreFocus.current = false;
  }, [expanded, gesture.sectionRef]);
  const toggleLabel = expanded ? t("statsWorkbench.drawer.collapse") : t("statsWorkbench.drawer.expand");
  const close = () => {
    if (drag.drag !== null) return;
    const section = gesture.sectionRef.current;
    restoreFocus.current = section?.contains(document.activeElement) ?? false;
    onHeight("collapsed");
  };
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      const section = gesture.sectionRef.current;
      const target = event.target;
      if (drag.drag !== null || !(target instanceof Node) || section?.contains(target)) return;
      if (section?.closest("[data-workbench-frame]")?.contains(target)) onHeight("collapsed");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded, drag.drag, onHeight, gesture.sectionRef]);
  const style = {
    "--sw-drawer-max": `${geometry.expanded}px`,
    "--sw-drawer-min": `${geometry.collapsed}px`,
    "--sw-library-width": `${geometry.width}px`,
    "--sw-safe-bottom": pane.split === "column" && pane.role === "primary" ? "0px" : "env(safe-area-inset-bottom, 0px)",
  } as CSSProperties;

  return (
    <section
      ref={gesture.sectionRef as React.RefObject<HTMLElement>}
      className="sw-drawer"
      style={style}
      data-mode={mode}
      data-icon-only={paneSize.width > 0 && paneSize.width < 360 ? "true" : undefined}
      data-lv-bottom-bar=""
      data-state={expanded ? "expanded" : "collapsed"}
      aria-label={scope === null ? t("statsWorkbench.drawer.title") : t("statsWorkbench.containers.insideTitle", { name: scope.name })}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded && drag.drag === null) {
          event.preventDefault(); event.stopPropagation(); close();
        }
      }}
    >
      <div className="sw-drawer-heading">
        <div className="sw-drawer-toolbar" inert={expanded} aria-hidden={expanded ? true : undefined}>
          <button type="button" data-drawer-opener aria-label={scope === null ? t("statsWorkbench.drawer.addCards") : t("statsWorkbench.containers.insideTitle", { name: scope.name })} title={scope === null ? t("statsWorkbench.drawer.addCards") : scope.name} aria-controls={bodyId} aria-expanded={expanded} onClick={() => { setTab("analysis"); onHeight("expanded"); }}>
            <PlusGlyph /><span>{scope === null ? t("statsWorkbench.drawer.addCards") : t("statsWorkbench.containers.insideTitle", { name: scope.name })}</span>
          </button>
          {scope !== null ? null : <>
            <button type="button" aria-label={t("statsWorkbench.drawer.layout")} title={t("statsWorkbench.drawer.layout")} aria-controls={bodyId} aria-expanded={expanded} onClick={() => { setTab("layout"); onHeight("expanded"); }}>
              <SplitGlyph /><span>{t("statsWorkbench.drawer.compactLayout")}</span>
            </button>
            {onPresets === undefined ? null : <button type="button" aria-label={t("statsWorkbench.presets.entry")} title={t("statsWorkbench.presets.entry")} onClick={onPresets}><PresetGlyph /><span>{t("statsWorkbench.presets.entry")}</span></button>}
          </>}
        </div>
        <div className="sw-drawer-expanded-head sw-drawer-grab" {...gesture.grabProps} inert={!expanded} aria-hidden={!expanded ? true : undefined}>
            <div className="sw-drawer-open-layer">
              {scope === null ? (
                <div className="sw-segment" role="tablist" aria-label={t("statsWorkbench.drawer.title")}>
                  {(["analysis", "layout"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      className={tab === key ? "sw-segment-on" : ""}
                      onClick={() => setTab(key)}
                    >
                      {t(`statsWorkbench.drawer.${key}`)}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-ink">{t("statsWorkbench.containers.insideTitle", { name: scope.name })}</p>
                  <p className="truncate text-helper text-muted">
                    {scope.children.length < scope.min
                      ? t("statsWorkbench.containers.needMore", { count: scope.min - scope.children.length })
                      : t("statsWorkbench.containers.range", { count: scope.children.length, max: scope.max })}
                  </p>
                </div>
              )}
            </div>
          {scope === null ? (
            onPresets === undefined ? null : (
              <button type="button" className="sw-drawer-preset" aria-label={t("statsWorkbench.presets.entry")} onClick={onPresets}>
                <PresetGlyph width={16} height={16} aria-hidden="true" />
                <span>{t("statsWorkbench.presets.entry")}</span>
              </button>
            )
          ) : (
            <div className="sw-drawer-scope-actions">
              <button type="button" className="sw-pill sw-pill-sm" onClick={onScopeCancel}>
                {scope.isNew ? t("statsWorkbench.containers.cancelNew") : t("statsWorkbench.edit.cancel")}
              </button>
              <button type="button" className="sw-pill sw-pill-sm sw-pill-primary" disabled={scope.children.length < scope.min} onClick={onScopeDone}>
                {t("statsWorkbench.edit.done")}
              </button>
            </div>
          )}
          <button type="button" className="sw-drawer-close" aria-label={toggleLabel} aria-controls={bodyId} aria-expanded={expanded} onClick={close}><ChevronDown /></button>
        </div>
      </div>

      {scope === null ? (
        <>
          {/* 保留列表 DOM 和滚动位置；收起时 inert，不留下可点的透明层。拖动时不自动收起。 */}
          {(
            <div id={bodyId} className="sw-drawer-body" inert={!expanded} aria-hidden={expanded ? undefined : true}>
              {tab === "analysis" ? (
                <>
                  <div className="sw-drawer-categories">
                    {(["recommended", "all", "mine"] as const).map((key) => (
                      <button key={key} type="button" aria-pressed={group === key} className={`sw-chip ${group === key ? "sw-chip-on" : ""}`} onClick={() => setGroup(key)}>
                        {t(`statsWorkbench.drawer.${key}`)}
                      </button>
                    ))}
                  </div>
                  <div ref={scrollRef} className="sw-drawer-scroll" onScroll={rememberScroll}>
                  {group === "all" ? (
                    <div className="px-5 pt-2">
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("statsWorkbench.drawer.search")}
                        aria-label={t("statsWorkbench.drawer.search")}
                        className="min-h-11 w-full rounded-field border border-line bg-surface px-3.5 py-2 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
                      />
                    </div>
                  ) : null}
                  {group === "mine" ? (
                    <div className="flex flex-col gap-3 px-5 pt-3">
                      <p className="text-helper-relaxed text-muted">{t(customCards.length === 0 ? "statsWorkbench.drawer.mineEmpty" : "statsWorkbench.custom.libraryHint")}</p>
                      {customCards.map((card) => {
                        const read = readComposition(card);
                        const multi = read.source === "composite" && read.slots.length > 1;
                        return (
                        <div key={card.objectId} className="sw-tile">
                          {multi ? <ComposeGlyph className="shrink-0 text-brand-dark" /> : <ChartGlyph family={card.chart.chartFamily} className="shrink-0 text-brand-dark" />}
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onConfigureCustom?.(card.objectId)}>
                            <span className="block truncate text-body font-medium text-ink">{cardTitle(card, t)}</span>
                            <span className="block truncate text-helper text-muted">
                              {multi ? t("statsWorkbench.composite.editTile", { count: read.slots.length, template: t(`statsWorkbench.composite.templates.${read.template}.name`) }) : t("statsWorkbench.editor.titleEdit")}
                            </span>
                          </button>
                          <button type="button" className="sw-add-button" aria-label={t("statsWorkbench.drawer.add", { name: cardTitle(card, t) })} onClick={() => onDuplicateCustom?.(card)}>
                            <PlusGlyph width={18} height={18} />
                          </button>
                        </div>
                        );
                      })}
                      <button type="button" className="sw-new-custom" onClick={onCustom}>
                        <PlusGlyph />
                        <span>{t("statsWorkbench.drawer.newCustom")}</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="px-5 pt-2 text-helper text-muted">{t("statsWorkbench.drawer.dragHint")}</p>
                      {grouped.length === 0 ? <p className="px-5 pt-3 text-helper text-muted">{t("statsWorkbench.drawer.noMatches")}</p> : null}
                      {grouped.map((section) => (
                        <div key={section.key} className="px-5 pt-3">
                          {group === "all" ? <h4 className="pb-1.5 text-helper font-medium text-muted">{t(`statsWorkbench.drawer.groups.${section.key}`)}</h4> : null}
                          <div className="sw-tiles">
                            {section.items.map((type) => (
                              <LibraryTile key={type.id} type={type} combined={combined} drag={drag} onAdd={() => onAddCard(type.id)} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  </div>
                </>
              ) : (
                <div ref={scrollRef} className="sw-drawer-scroll px-5 pt-1" onScroll={rememberScroll}>
                  <div className="sw-tiles">
                    {(["carousel", "grid-split", "spacer"] as const).map((choice) => (
                      <LayoutTile key={choice} choice={choice} drag={drag} onAdd={() => onAddLayout(choice)} />
                    ))}
                  </div>
                  <p className="pt-3 text-helper-relaxed text-muted">{t("statsWorkbench.drawer.layoutHint")}</p>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div id={bodyId} className="sw-drawer-body" inert={!expanded} aria-hidden={expanded ? undefined : true}>
            <div ref={scrollRef} className="sw-drawer-scroll" onScroll={rememberScroll}>
            <ol className="flex flex-col gap-2 px-5 pt-2" aria-label={t("statsWorkbench.containers.childrenList")}>
              {scope.children.length === 0 ? <li className="text-helper text-muted">{t("statsWorkbench.containers.emptyHint")}</li> : null}
              {scope.children.map((child, index) => (
                <li key={child.objectId} className="flex items-center gap-2 rounded-field border border-line bg-surface px-3 py-2">
                  <span className="sw-order">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{cardTitle(child, t)}</span>
                  <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.containers.moveUp")} disabled={index === 0} onClick={() => onScopeMove(index, -1)}>
                    <ChevronUp />
                  </button>
                  <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.containers.moveDown")} disabled={index === scope.children.length - 1} onClick={() => onScopeMove(index, 1)}>
                    <ChevronDown />
                  </button>
                  <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.containers.removeChild")} onClick={() => onScopeRemove(index)}>
                    <XGlyph />
                  </button>
                </li>
              ))}
            </ol>
            <h4 className="px-5 pt-4 pb-1.5 text-helper font-medium text-muted">{full ? t("statsWorkbench.containers.limit", { count: scope.max }) : t("statsWorkbench.containers.addInside")}</h4>
            <div className="sw-tiles px-5">
              {CARD_TYPES.filter((type) => type.recommended).map((type) => (
                <button key={type.id} type="button" className="sw-tile" disabled={full} onClick={() => onScopeAdd(type.id)} aria-label={t("statsWorkbench.drawer.add", { name: t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`) })}>
                  <ChartGlyph family={type.families[0] ?? "number"} className="shrink-0 text-brand-dark" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-helper font-medium text-ink">{t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`)}</span>
                  </span>
                  <PlusGlyph className="shrink-0 text-brand" />
                </button>
              ))}
            </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function LibraryTile({ type, combined, drag, onAdd }: { readonly type: CardType; readonly combined: boolean; readonly drag: DragController; readonly onAdd: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const title = t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`);
  const payload = (): DragPayload => ({ kind: "new-card", analysisId: type.id, size: type.defaultSize, label: title });
  return (
    <div className="sw-tile sw-draggable" {...drag.sourceProps(payload)}>
      <ChartGlyph family={type.families[0] ?? "number"} className="shrink-0 text-brand-dark" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-helper font-medium text-ink">{title}</span>
        <span className="block truncate text-helper text-muted">
          {`${String(type.defaultSize.colSpan)}×${String(type.defaultSize.rowSpan)}`}
          {combined && !type.combined ? ` · ${t("statsWorkbench.drawer.originalOnly")}` : ""}
        </span>
      </span>
      <button
        type="button"
        className="sw-add-button"
        aria-label={t("statsWorkbench.drawer.add", { name: title })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (!drag.consumeClick()) onAdd();
        }}
      >
        <PlusGlyph width={18} height={18} />
      </button>
    </div>
  );
}

function LayoutTile({ choice, drag, onAdd }: { readonly choice: LayoutObjectChoice; readonly drag: DragController; readonly onAdd: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const Glyph = choice === "carousel" ? CarouselGlyph : choice === "grid-split" ? SplitGlyph : SpacerGlyph;
  const title = t(`statsWorkbench.containers.${choice}`);
  const payload = (): DragPayload => ({ kind: "new-layout", choice, size: CONTAINER_DEFAULT_SIZE[choice], label: title });
  return (
    <div className="sw-tile sw-draggable" {...drag.sourceProps(payload)}>
      <Glyph className="shrink-0 text-brand-dark" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-helper font-medium text-ink">{title}</span>
        <span className="block text-helper text-muted">{t(`statsWorkbench.containers.${choice}Desc`)}</span>
      </span>
      <button
        type="button"
        className="sw-add-button"
        aria-label={t("statsWorkbench.drawer.add", { name: title })}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (!drag.consumeClick()) onAdd();
        }}
      >
        <PlusGlyph width={18} height={18} />
      </button>
    </div>
  );
}
