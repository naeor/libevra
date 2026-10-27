/**
 * 编辑态的各个面板：快捷菜单、配置、尺寸、行列、放弃确认、自定义卡片入口、收缩容器的完整查看。
 * 全部用既有 `BottomSheet`（同一套圆角、遮罩、进出动画与 Esc 关闭），不另立视觉。
 */
import { useState } from "react";
import type { AnalysisCardNode, ContainerNode, GridSize } from "@libellum/shared/analysis/layout";

import { BottomSheet } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { cardTitle } from "./cards.js";
import { cardType, sizeKey } from "./catalog.js";
import { customRangeProblem, previousMonth } from "./filters.js";
import { endOfMonth, startOfMonth } from "@libellum/shared";
import {
  DuplicateGlyph,
  EnterGlyph,
  GridGlyph,
  MoveGlyph,
  ResizeGlyph,
  SlidersGlyph,
  TrashGlyph,
} from "./ui.js";

function SheetHeader({ title, subtitle }: { readonly title: string; readonly subtitle?: string }): React.JSX.Element {
  return (
    <header className="px-6 pt-5 pb-2">
      <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" aria-hidden="true" />
      <h2 className="text-section-title text-ink">{title}</h2>
      {subtitle === undefined ? null : <p className="mt-1 text-helper-relaxed text-muted">{subtitle}</p>}
    </header>
  );
}

export type MenuAction = "configure" | "duplicate" | "remove" | "move" | "resize" | "inside" | "collapse" | "expand";

export function ObjectMenuSheet({
  title,
  kind,
  collapsed,
  onAction,
  onClose,
}: {
  readonly title: string;
  readonly kind: "card" | "container" | "spacer";
  readonly collapsed: boolean;
  readonly onAction: (action: MenuAction) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const items: { readonly action: MenuAction; readonly icon: React.ReactNode; readonly danger?: boolean }[] = [
    ...(kind === "container" ? [{ action: "inside" as const, icon: <EnterGlyph /> }] : []),
    ...(kind === "card" ? [{ action: "configure" as const, icon: <SlidersGlyph /> }] : []),
    { action: "move", icon: <MoveGlyph /> },
    ...(collapsed ? [] : [{ action: "resize" as const, icon: <ResizeGlyph /> }]),
    ...(kind === "container" ? [{ action: collapsed ? ("expand" as const) : ("collapse" as const), icon: <GridGlyph /> }] : []),
    { action: "duplicate", icon: <DuplicateGlyph /> },
    { action: "remove", icon: <TrashGlyph />, danger: true },
  ];
  return (
    <BottomSheet label={title} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={title} subtitle={t("statsWorkbench.menu.subtitle")} />
          <ul className="flex flex-col px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {items.map((item) => (
              <li key={item.action}>
                <button
                  type="button"
                  className={`flex min-h-12 w-full items-center gap-3 rounded-field px-3 text-left text-body transition hover:bg-canvas ${item.danger === true ? "text-danger" : "text-ink"}`}
                  onClick={() => {
                    onAction(item.action);
                    close();
                  }}
                >
                  <span className={item.danger === true ? "text-danger" : "text-brand-dark"}>{item.icon}</span>
                  {t(`statsWorkbench.menu.${item.action}`)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}

export function SizeSheet({
  current,
  sizes,
  problemFor,
  onPick,
  onClose,
}: {
  readonly current: GridSize;
  readonly sizes: readonly GridSize[];
  /** 由 D 的几何校验给出：这个尺寸在当前位置放不放得下。 */
  readonly problemFor: (size: GridSize) => string | null;
  readonly onPick: (size: GridSize) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet label={t("statsWorkbench.size.title")} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.size.title")} subtitle={t("statsWorkbench.size.hint")} />
          <div className="grid grid-cols-2 gap-3 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            {sizes.map((size) => {
              const active = size.colSpan === current.colSpan && size.rowSpan === current.rowSpan;
              const problem = active ? null : problemFor(size);
              return (
                <button
                  key={sizeKey(size)}
                  type="button"
                  disabled={problem !== null}
                  aria-pressed={active}
                  onClick={() => {
                    onPick(size);
                    close();
                  }}
                  className={`flex min-h-20 flex-col items-start justify-between gap-2 rounded-field border p-3 text-left transition ${
                    active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-canvas"
                  } disabled:opacity-45`}
                >
                  <span className="sw-mini-grid" style={{ gridTemplateColumns: "repeat(2, 0.75rem)", gridTemplateRows: "repeat(3, 0.75rem)" }} aria-hidden="true">
                    <span style={{ gridColumn: `1 / span ${String(size.colSpan)}`, gridRow: `1 / span ${String(size.rowSpan)}` }} />
                  </span>
                  <span className="text-body font-medium text-ink">{sizeKey(size)}</span>
                  <span className="text-helper text-muted">
                    {active ? t("statsWorkbench.size.current") : problem === null ? t("statsWorkbench.size.fits") : t("statsWorkbench.size.blocked")}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </BottomSheet>
  );
}

export function ConfigSheet({
  card,
  today,
  onSave,
  onClose,
}: {
  readonly card: AnalysisCardNode;
  readonly today: string;
  readonly onSave: (card: AnalysisCardNode) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const type = cardType(card.analysis.analysisId);
  const [name, setName] = useState(card.title?.kind === "custom" ? (card.title.text ?? "") : "");
  const [family, setFamily] = useState(card.chart.chartFamily);
  const [pinned, setPinned] = useState(card.rangePolicy === "pinned");
  const [from, setFrom] = useState(card.pinnedRange?.from ?? startOfMonth(today));
  const [to, setTo] = useState(card.pinnedRange?.to ?? today);
  const problem = pinned ? customRangeProblem(from, to) : null;
  const preset = { ...card, title: { kind: "preset" as const } };
  const defaultName = cardTitle(preset, t);
  const lastMonth = previousMonth(today);

  return (
    <BottomSheet label={t("statsWorkbench.config.title")} onClose={onClose}>
      {(close) => (
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem !== null) return;
            const trimmed = name.trim();
            const next: AnalysisCardNode = {
              objectId: card.objectId,
              type: "analysis-card",
              analysis: card.analysis,
              chart: { ...card.chart, chartFamily: family },
              title: trimmed === "" ? { kind: "preset" } : { kind: "custom", text: trimmed.slice(0, 40) },
              rangePolicy: pinned ? "pinned" : "inherit",
              ...(pinned ? { pinnedRange: { from, to } } : {}),
            };
            onSave(next);
            close();
          }}
        >
          <SheetHeader title={t("statsWorkbench.config.title")} subtitle={defaultName} />
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pb-4">
            <label className="flex flex-col gap-1.5 text-helper text-muted">
              {t("statsWorkbench.config.name")}
              <input
                value={name}
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                placeholder={defaultName}
                className="min-h-11 rounded-field border border-line bg-surface px-3.5 py-2 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
              />
              <span>{t("statsWorkbench.config.nameHint")}</span>
            </label>

            {type !== null && type.families.length > 1 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.config.display")}</legend>
                <div className="flex flex-wrap gap-2">
                  {type.families.map((option) => (
                    <button key={option} type="button" aria-pressed={family === option} className={`sw-chip ${family === option ? "sw-chip-on" : ""}`} onClick={() => setFamily(option)}>
                      {t(`statsWorkbench.config.families.${option}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.config.time")}</legend>
              {type?.ownWindow === "12m" ? (
                <p className="text-helper-relaxed text-muted">{t("statsWorkbench.config.ownWindow")}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" aria-pressed={!pinned} className={`sw-chip ${!pinned ? "sw-chip-on" : ""}`} onClick={() => setPinned(false)}>
                      {t("statsWorkbench.config.inherit")}
                    </button>
                    <button type="button" aria-pressed={pinned} className={`sw-chip ${pinned ? "sw-chip-on" : ""}`} onClick={() => setPinned(true)}>
                      {t("statsWorkbench.config.pinned")}
                    </button>
                  </div>
                  {pinned ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="sw-chip" onClick={() => { setFrom(startOfMonth(today)); setTo(endOfMonth(today)); }}>{t("statsWorkbench.time.thisMonth")}</button>
                        <button type="button" className="sw-chip" onClick={() => { setFrom(`${lastMonth}-01`); setTo(endOfMonth(`${lastMonth}-01`)); }}>{t("statsWorkbench.time.lastMonth")}</button>
                        <button type="button" className="sw-chip" onClick={() => { setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); }}>{t("statsWorkbench.time.yearToDate")}</button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
                          {t("statsWorkbench.time.from")}
                          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
                          {t("statsWorkbench.time.to")}
                          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
                        </label>
                      </div>
                      {problem === null ? (
                        <p className="text-helper text-muted">{t("statsWorkbench.config.pinnedHint")}</p>
                      ) : (
                        <p role="alert" className="text-helper text-danger">{t(`statsWorkbench.filter.problems.${problem}`)}</p>
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </fieldset>
          </div>
          <footer className="flex gap-3 border-t border-line px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <button type="button" className="sw-pill flex-1" onClick={close}>
              {t("statsWorkbench.edit.cancel")}
            </button>
            <button type="submit" className="sw-pill sw-pill-primary flex-1" disabled={problem !== null}>
              {t("statsWorkbench.config.save")}
            </button>
          </footer>
        </form>
      )}
    </BottomSheet>
  );
}

export function LayoutSheet({
  columns,
  maxColumns,
  onColumns,
  onCompact,
  onReset,
  onClose,
}: {
  readonly columns: number;
  readonly maxColumns: number;
  readonly onColumns: (columns: number) => void;
  readonly onCompact: () => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet label={t("statsWorkbench.layout.title")} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.layout.title")} />
          <div className="flex flex-col gap-5 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.layout.columns")}</legend>
              <div className="flex gap-2">
                {[2, 3].map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={columns === option}
                    disabled={option > maxColumns}
                    className={`sw-chip ${columns === option ? "sw-chip-on" : ""}`}
                    onClick={() => {
                      onColumns(option);
                      close();
                    }}
                  >
                    {t("statsWorkbench.layout.columnsCount", { count: option })}
                  </button>
                ))}
              </div>
              <p className="text-helper-relaxed text-muted">{t("statsWorkbench.layout.columnsHint")}</p>
            </fieldset>
            <button
              type="button"
              className="flex min-h-12 flex-col items-start rounded-field border border-line px-4 py-2.5 text-left transition hover:bg-canvas"
              onClick={() => {
                onCompact();
                close();
              }}
            >
              <span className="text-body text-ink">{t("statsWorkbench.layout.compact")}</span>
              <span className="text-helper text-muted">{t("statsWorkbench.layout.compactHint")}</span>
            </button>
            <button
              type="button"
              className="flex min-h-12 flex-col items-start rounded-field border border-line px-4 py-2.5 text-left transition hover:bg-canvas"
              onClick={() => {
                onReset();
                close();
              }}
            >
              <span className="text-body text-ink">{t("statsWorkbench.layout.reset")}</span>
              <span className="text-helper text-muted">{t("statsWorkbench.layout.resetHint")}</span>
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

export function DiscardSheet({ onDiscard, onClose }: { readonly onDiscard: () => void; readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet label={t("statsWorkbench.edit.discardTitle")} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.edit.discardTitle")} subtitle={t("statsWorkbench.edit.discardBody")} />
          <div className="flex gap-3 px-6 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <button type="button" className="sw-pill flex-1" onClick={close}>
              {t("statsWorkbench.edit.keep")}
            </button>
            <button
              type="button"
              className="sw-pill sw-pill-danger flex-1"
              onClick={() => {
                onDiscard();
                close();
              }}
            >
              {t("statsWorkbench.edit.discard")}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

/** 自定义卡片：保留正式入口与接口说明；完整创建器等所有者确认流程后再做（不擅自设计复杂页面）。 */
export function CustomCardSheet({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <BottomSheet label={t("statsWorkbench.custom.title")} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.custom.title")} subtitle={t("statsWorkbench.custom.body")} />
          <ol className="flex flex-col gap-2 px-6 pb-2">
            {(["step1", "step2", "step3", "step4", "step5"] as const).map((step, index) => (
              <li key={step} className="flex gap-3 text-body text-ink">
                <span className="sw-order">{index + 1}</span>
                <span>{t(`statsWorkbench.custom.${step}`)}</span>
              </li>
            ))}
          </ol>
          <p className="px-6 pt-2 text-helper-relaxed text-muted">{t("statsWorkbench.custom.pending")}</p>
          <div className="px-6 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <button type="button" className="sw-pill sw-pill-primary w-full" onClick={close}>
              {t("statsWorkbench.custom.close")}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

/** 浏览态里被收缩成 1×1 的容器：打开后能访问全部子卡片（不丢卡片，布局规格 §17）。 */
export function CollapsedContainerSheet({
  container,
  cards,
  onOpenCard,
  onClose,
}: {
  readonly container: ContainerNode;
  readonly cards: readonly AnalysisCardNode[];
  readonly onOpenCard: (cardId: string) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const name = t(container.type === "carousel" ? "statsWorkbench.containers.carousel" : "statsWorkbench.containers.grid-split");
  return (
    <BottomSheet label={name} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={name} subtitle={t("statsWorkbench.card.collapsedEntry", { count: cards.length })} />
          <ul className="flex flex-col px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {cards.map((card) => (
              <li key={card.objectId}>
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-field px-3 text-left text-body text-ink transition hover:bg-canvas"
                  onClick={() => {
                    close();
                    onOpenCard(card.objectId);
                  }}
                >
                  {cardTitle(card, t)}
                  <span className="text-helper text-brand">{t("statsWorkbench.card.open")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </BottomSheet>
  );
}
