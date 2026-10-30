/**
 * 编辑态的各个面板：快捷菜单、尺寸、行列、放弃确认、收缩容器的完整查看。
 * 卡片配置与自定义卡片（含组合卡片）统一在 `CardEditor.tsx`（1.17.10 起取代旧的「配置卡片」与单指标弹窗）。
 * 全部用既有 `BottomSheet`（同一套圆角、遮罩、进出动画与 Esc 关闭），不另立视觉。
 */
import type { AnalysisCardNode, ContainerNode, GridSize } from "@libellum/shared/analysis/layout";

import { BottomSheet } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { cardTitle } from "./cards.js";
import { sizeKey } from "./catalog.js";
import {
  DuplicateGlyph,
  EnterGlyph,
  GridGlyph,
  MoveGlyph,
  ResizeGlyph,
  SlidersGlyph,
  TrashGlyph,
} from "./ui.js";

export function SheetHeader({ title, subtitle }: { readonly title: string; readonly subtitle?: string }): React.JSX.Element {
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

/** 编辑中这一份排列的来源（`StatsPage` 按 `commitLayoutEdit` 的同一判断算出）。 */
export interface LayoutArrangement {
  /** canonical = 基础排列；override = 这个列数的专属排列；projection = 由基础排列自动生成；rebase = 卡片有增删。 */
  readonly kind: "canonical" | "override" | "projection" | "rebase";
  /** 基础排列的列数。 */
  readonly base: number;
}

/**
 * 「调整行列」（1.18.01）：自动调整列数开关 + 离散整数滑条（取代原来的 2 / 3 列按钮）。
 * 改的是本工作区的列数显示偏好，不改布局；滑条上限由当前宽度决定。有未保存的修改时禁用（说明原因），
 * 保证每次保存针对的列数就是用户正在看的列数。
 */
export function LayoutSheet({
  columns,
  maxColumns,
  automatic,
  locked,
  sparse,
  arrangement,
  onColumns,
  onRestoreAutomatic,
  onCompact,
  onReset,
  onClose,
}: {
  readonly columns: number;
  readonly maxColumns: number;
  readonly automatic: boolean;
  /** 有未保存的修改：不能切换列数。 */
  readonly locked: boolean;
  /** 当前列数下有卡片被拉得很扁或很高：滑条旁给出非阻断提示。 */
  readonly sparse: boolean;
  readonly arrangement: LayoutArrangement | null;
  readonly onColumns: (preference: "auto" | number) => void;
  /** 这个列数有专属排列时才提供。 */
  readonly onRestoreAutomatic: (() => void) | null;
  readonly onCompact: () => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const upper = Math.max(maxColumns, columns);
  return (
    <BottomSheet label={t("statsWorkbench.layout.title")} onClose={onClose}>
      {(close) => (
        <>
          <SheetHeader title={t("statsWorkbench.layout.title")} />
          <div className="flex flex-col gap-5 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <fieldset className="flex flex-col gap-3" disabled={locked}>
              <legend className="flex w-full items-baseline justify-between pb-1.5 text-helper text-muted">
                <span>{t("statsWorkbench.layout.columns")}</span>
                <span className="text-body font-medium tabular-nums text-ink" data-testid="layout-columns-value">
                  {t("statsWorkbench.layout.columnsCount", { count: columns })}
                </span>
              </legend>
              <label className="flex min-h-11 items-center gap-3 text-body text-ink">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-brand"
                  checked={automatic}
                  onChange={(event) => onColumns(event.target.checked ? "auto" : columns)}
                />
                {t("statsWorkbench.layout.automatic")}
              </label>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="w-4 text-center text-helper tabular-nums text-muted">1</span>
                <input
                  type="range"
                  min={1}
                  max={upper}
                  step={1}
                  value={columns}
                  disabled={locked || upper <= 1}
                  aria-label={t("statsWorkbench.layout.slider")}
                  aria-valuetext={t("statsWorkbench.layout.columnsCount", { count: columns })}
                  className="min-h-11 flex-1 accent-brand"
                  onChange={(event) => onColumns(Number(event.target.value))}
                />
                <span aria-hidden="true" className="w-4 text-center text-helper tabular-nums text-muted">{upper}</span>
              </div>
              {locked ? <p className="text-helper-relaxed text-muted">{t("statsWorkbench.layout.locked")}</p> : null}
              {sparse ? <p role="status" className="text-helper-relaxed text-warn-dark">{t("statsWorkbench.layout.sparse")}</p> : null}
              {arrangement === null ? null : (
                <p className="text-helper-relaxed text-muted" data-testid="layout-arrangement" data-kind={arrangement.kind}>
                  {t(`statsWorkbench.layout.arrangement.${arrangement.kind}`, { columns, base: arrangement.base })}
                </p>
              )}
            </fieldset>
            {onRestoreAutomatic === null ? null : (
              <button
                type="button"
                className="flex min-h-12 flex-col items-start rounded-field border border-line px-4 py-2.5 text-left transition hover:bg-canvas"
                onClick={() => {
                  onRestoreAutomatic();
                  close();
                }}
              >
                <span className="text-body text-ink">{t("statsWorkbench.layout.restoreAuto")}</span>
                <span className="text-helper text-muted">{t("statsWorkbench.layout.restoreAutoHint", { columns })}</span>
              </button>
            )}
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
