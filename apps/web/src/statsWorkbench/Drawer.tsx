/**
 * 编辑态底部的卡片抽屉（草图第三屏下方）：**同一页面里的抽屉，不是另一个管理页面。**
 *
 * - 两类入口：分析卡片（系统推荐 / 全部分析 / 我的自定义）与布局容器（滑动卡片组 / 分割卡片组 /
 *   留白——留白只是放在这个分组里，不是容器）；
 * - 每一项都有「点 ＋ 放到第一个空位」的非拖动路径；拖动是快捷方式（触摸需长按，见 dnd.ts）；
 * - 可以展开、收起：收起时只留一条标题栏，把空间还给上方的工作台；从抽屉拖出时自动收起；
 * - 进入容器内部编辑时，抽屉切换成「正在编辑：某容器」，只提供首版允许放进容器的分析卡片。
 */
import { useMemo, useState } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useI18n } from "../i18n/index.js";
import { cardTitle } from "./cards.js";
import { CARD_TYPES, CONTAINER_DEFAULT_SIZE, type CardGroup, type CardType, type LayoutObjectChoice } from "./catalog.js";
import type { DragController, DragPayload } from "./dnd.js";
import {
  CardGlyph,
  CarouselGlyph,
  ChevronDown,
  ChevronUp,
  PlusGlyph,
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
  containerScope,
  onScopeAdd,
  onScopeMove,
  onScopeRemove,
  onScopeDone,
  onScopeCancel,
}: {
  readonly height: DrawerHeight;
  readonly onHeight: (height: DrawerHeight) => void;
  readonly combined: boolean;
  readonly drag: DragController;
  readonly onAddCard: (analysisId: string) => void;
  readonly onAddLayout: (choice: LayoutObjectChoice) => void;
  readonly onCustom: () => void;
  readonly containerScope: ContainerScopeView | null;
  readonly onScopeAdd: (analysisId: string) => void;
  readonly onScopeMove: (index: number, delta: -1 | 1) => void;
  readonly onScopeRemove: (index: number) => void;
  readonly onScopeDone: () => void;
  readonly onScopeCancel: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<"analysis" | "layout">("analysis");
  const [group, setGroup] = useState<"recommended" | "all" | "mine">("recommended");
  const [query, setQuery] = useState("");
  const expanded = height === "expanded";

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
    const order: CardGroup[] = ["basic", "insight", "advanced"];
    return order.map((key) => ({ key, items: library.filter((type) => type.group === key) })).filter((section) => section.items.length > 0);
  }, [library]);

  const scope = containerScope;
  const full = scope !== null && scope.children.length >= scope.max;

  return (
    <section
      className={`sw-drawer ${expanded ? "sw-drawer-expanded" : "sw-drawer-collapsed"}`}
      aria-label={scope === null ? t("statsWorkbench.drawer.title") : t("statsWorkbench.containers.insideTitle", { name: scope.name })}
    >
      <button
        type="button"
        className="sw-drawer-handle"
        aria-expanded={expanded}
        aria-label={expanded ? t("statsWorkbench.drawer.collapse") : t("statsWorkbench.drawer.expand")}
        onClick={() => onHeight(expanded ? "collapsed" : "expanded")}
      >
        <span aria-hidden="true" />
      </button>

      {scope === null ? (
        <>
          <header className="flex items-center justify-between gap-3 px-5">
            <div className="sw-segment" role="tablist" aria-label={t("statsWorkbench.drawer.title")}>
              {(["analysis", "layout"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "sw-segment-on" : ""}
                  onClick={() => {
                    setTab(key);
                    onHeight("expanded");
                  }}
                >
                  {t(`statsWorkbench.drawer.${key}`)}
                </button>
              ))}
            </div>
            <button type="button" className="sw-icon-button" aria-label={expanded ? t("statsWorkbench.drawer.collapse") : t("statsWorkbench.drawer.expand")} onClick={() => onHeight(expanded ? "collapsed" : "expanded")}>
              {expanded ? <ChevronDown /> : <ChevronUp />}
            </button>
          </header>

          {expanded ? (
            <div className="sw-drawer-body">
              {tab === "analysis" ? (
                <>
                  <div className="flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(["recommended", "all", "mine"] as const).map((key) => (
                      <button key={key} type="button" aria-pressed={group === key} className={`sw-chip ${group === key ? "sw-chip-on" : ""}`} onClick={() => setGroup(key)}>
                        {t(`statsWorkbench.drawer.${key}`)}
                      </button>
                    ))}
                  </div>
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
                      <p className="text-helper-relaxed text-muted">{t("statsWorkbench.drawer.mineEmpty")}</p>
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
                </>
              ) : (
                <div className="px-5 pt-1">
                  <div className="sw-tiles">
                    {(["carousel", "grid-split", "spacer"] as const).map((choice) => (
                      <LayoutTile key={choice} choice={choice} drag={drag} onAdd={() => onAddLayout(choice)} />
                    ))}
                  </div>
                  <p className="pt-3 text-helper-relaxed text-muted">{t("statsWorkbench.drawer.layoutHint")}</p>
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <header className="flex items-center justify-between gap-3 px-5">
            <div className="min-w-0">
              <p className="truncate text-body font-medium text-ink">{t("statsWorkbench.containers.insideTitle", { name: scope.name })}</p>
              <p className="text-helper text-muted">
                {scope.children.length < scope.min
                  ? t("statsWorkbench.containers.needMore", { count: scope.min - scope.children.length })
                  : t("statsWorkbench.containers.range", { count: scope.children.length, max: scope.max })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="sw-pill" onClick={onScopeCancel}>
                {scope.isNew ? t("statsWorkbench.containers.cancelNew") : t("statsWorkbench.edit.cancel")}
              </button>
              <button type="button" className="sw-pill sw-pill-primary" disabled={scope.children.length < scope.min} onClick={onScopeDone}>
                {t("statsWorkbench.edit.done")}
              </button>
            </div>
          </header>
          <div className="sw-drawer-body">
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
                  <CardGlyph className="shrink-0 text-brand-dark" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-helper font-medium text-ink">{t(`statsWorkbench.cards.${type.id as "AN-B01"}.title`)}</span>
                  </span>
                  <PlusGlyph className="shrink-0 text-brand" />
                </button>
              ))}
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
      <CardGlyph className="shrink-0 text-brand-dark" />
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
