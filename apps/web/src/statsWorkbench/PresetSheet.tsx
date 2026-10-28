/**
 * 「布局预设」页（1.17.12）：一页、上下两条横向滑轨——上面「系统预设」（新手 / 进阶 / 专业），
 * 下面「我的预设」（第一张永远是「＋ 添加自定义预设」）。
 *
 * - **先预览、再应用**：点任何预设都先进入预览（按当前账本真实计算的工作台），确认后才替换编辑会话里的
 *   工作台；没确认就返回，编辑状态不变。预览里可以「先保存当前布局」，存完回到同一个预览。
 * - **我的预设**：预览 / 应用（在预览里）/ 重命名 / 用当前工作台更新 / 删除；删除只删预设本身。
 * - 布局预设管理整张工作台；单张卡片内部的排布是「新建自定义卡片」里的卡片内容模板（T1–T8），两者不混用。
 * - 手机上两条滑轨可横滑、按卡片吸附；桌面有左右按钮；宽屏时三套系统预设并排显示。
 */
import { positionToRowCol, type LayoutDocumentV1, type WorkbenchContentDocumentV1 } from "@libellum/shared/analysis/layout";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomSheet } from "../components/BottomSheet.js";
import { ExchangePanel } from "./ExchangePanel.js";
import { SyncControls } from "./SyncControls.js";
import { WORKBENCH_INSTALLED } from "./configEvents.js";
import { downloadWorkspaceFile, exportWorkspaceFile, presetEntry } from "./exchange.js";
import { currentLocale, useI18n } from "../i18n/index.js";
import { BrowseGrid, browseColumnsFor } from "./Grid.js";
import {
  buildSystemPreset,
  createPreset,
  deletePreset,
  loadPresets,
  MAX_USER_PRESETS,
  PRESET_DESCRIPTION_MAX,
  PRESET_NAME_MAX,
  renamePreset,
  SYSTEM_PRESET_IDS,
  updatePresetDocuments,
  type PresetStore,
  type PresetWriteProblem,
  type SystemPresetId,
  type UserPreset,
} from "./presets.js";
import type { WorkbenchScope } from "./scope.js";
import { lastRow } from "./session.js";
import type { WorkbenchDocuments } from "./storage.js";
import {
  ChevronLeft,
  ChevronRight,
  InfoGlyph,
  MoreGlyph,
  NetworkGlyph,
  PencilGlyph,
  PlusGlyph,
  SaveGlyph,
  SproutGlyph,
  TrashGlyph,
  TrendGlyph,
  useElementSize,
} from "./ui.js";

type Source = { readonly kind: "system"; readonly id: SystemPresetId } | { readonly kind: "user"; readonly id: string };

type View =
  | { readonly kind: "list" }
  | { readonly kind: "preview"; readonly source: Source }
  | { readonly kind: "form"; readonly mode: "create" | "rename"; readonly presetId?: string; readonly back: View }
  | { readonly kind: "actions"; readonly presetId: string }
  | { readonly kind: "confirm"; readonly action: "update" | "delete"; readonly presetId: string };

const SYSTEM_ICONS: Record<SystemPresetId, (props: { readonly className?: string }) => React.JSX.Element> = {
  beginner: SproutGlyph,
  advanced: TrendGlyph,
  professional: NetworkGlyph,
};

export function PresetSheet({
  accountScope,
  current,
  filters,
  scope,
  onApply,
  onClose,
}: {
  readonly accountScope: string | null;
  /** 编辑会话里当前的工作台（保存 / 更新预设用它）。 */
  readonly current: WorkbenchDocuments;
  /** 当前生效的筛选条件（地址栏参数串）。 */
  readonly filters: string;
  readonly scope: WorkbenchScope;
  /** 确认应用：整份替换编辑会话（一步撤销）；`filters` 不为 null 时一起换成保存时的筛选。成功返回 true。 */
  readonly onApply: (documents: WorkbenchDocuments, name: string, filters: string | null) => boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const translate = (key: string) => t(key as never);
  const [store, setStore] = useState<PresetStore>(() => loadPresets(accountScope));
  const [view, setView] = useState<View>({ kind: "list" });
  const [status, setStatus] = useState<{ readonly text: string; readonly tone: "ok" | "warn"; readonly key: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 系统预设的文档按当前语言生成一次（标题写入卡片）；只用于缩略图与预览，应用时另换新 ID。
  const systemDocs = useMemo(() => new Map(SYSTEM_PRESET_IDS.map((id) => [id, buildSystemPreset(id, translate)] as const)), [t]);
  const reload = () => setStore(loadPresets(accountScope));
  useEffect(() => {
    const installed = (event: Event) => { if ((event as CustomEvent<string>).detail === accountScope) setStore(loadPresets(accountScope)); };
    window.addEventListener(WORKBENCH_INSTALLED, installed);
    return () => window.removeEventListener(WORKBENCH_INSTALLED, installed);
  }, [accountScope]);
  const say = (text: string, tone: "ok" | "warn" = "ok") => setStatus({ text, tone, key: Date.now() });
  const problemText = (problem: PresetWriteProblem) =>
    problem === "full"
      ? t("statsWorkbench.presets.problems.full", { count: MAX_USER_PRESETS })
      : problem === "name"
        ? t("statsWorkbench.presets.problems.name", { count: PRESET_NAME_MAX })
        : t(`statsWorkbench.presets.problems.${problem}`);
  const presetById = (id: string) => store.presets.find((preset) => preset.id === id);
  const systemName = (id: SystemPresetId) => t(`statsWorkbench.presets.system_${id}`);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => setStatus(null), 3600);
    return () => clearTimeout(timer);
  }, [status]);

  // 换页时回到顶部（预览很长）。
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [view.kind]);

  const go = (next: View) => {
    setStatus(null);
    setView(next);
  };

  return (
    <BottomSheet label={t("statsWorkbench.presets.title")} onClose={onClose} dialogClassName="sw-presets h-[92dvh] max-h-[92dvh] sm:h-[86dvh] sm:max-h-[86dvh] md:max-w-4xl">
      {(close) => (
        <div className="flex h-full min-h-0 flex-col">
          {view.kind === "list" ? (
            <header className="px-5 pt-5 pb-1 sm:px-6">
              <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line" aria-hidden="true" />
              <div className="flex items-center gap-2">
                <h2 className="text-section-title text-ink">{t("statsWorkbench.presets.title")}</h2>
                <button type="button" className="sw-icon-button sw-icon-button-sm text-muted" aria-label={t("statsWorkbench.presets.helpButton")} aria-expanded={helpOpen} onClick={() => setHelpOpen((open) => !open)}>
                  <InfoGlyph width={16} height={16} />
                </button>
                <button type="button" className="sw-pill sw-pill-sm ml-auto" onClick={close}>
                  {t("common.action.done")}
                </button>
              </div>
              {helpOpen ? <p className="mt-1 text-helper-relaxed text-muted">{t("statsWorkbench.presets.help")}</p> : null}
            </header>
          ) : (
            <header className="flex items-center gap-1 px-3 pt-4 pb-2 sm:px-4">
              <button
                type="button"
                className="sw-icon-button"
                aria-label={t("common.a11y.back")}
                onClick={() => go(view.kind === "form" ? view.back : view.kind === "confirm" ? { kind: "actions", presetId: view.presetId } : { kind: "list" })}
              >
                <ChevronLeft width={18} height={18} />
              </button>
              <h2 className="min-w-0 flex-1 truncate text-section-title text-ink">
                {view.kind === "preview"
                  ? t("statsWorkbench.presets.previewTitle", { name: view.source.kind === "system" ? systemName(view.source.id) : presetById(view.source.id)?.name ?? "" })
                  : view.kind === "form"
                    ? t(view.mode === "create" ? "statsWorkbench.presets.form.createTitle" : "statsWorkbench.presets.form.renameTitle")
                    : presetById(view.presetId)?.name ?? store.unreadable.find((item) => item.id === view.presetId)?.name ?? ""}
              </h2>
            </header>
          )}

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {view.kind === "list" ? (
              <div className="flex flex-col gap-5 pt-3 pb-6">
                <div className="px-5 sm:px-6"><SyncControls /></div>
                <section aria-labelledby="sw-presets-system" className="flex flex-col gap-2.5">
                  <h3 id="sw-presets-system" className="px-5 text-helper font-medium text-muted sm:px-6">{t("statsWorkbench.presets.system")}</h3>
                  <PresetRail label={t("statsWorkbench.presets.system")} wide>
                    {SYSTEM_PRESET_IDS.map((id) => {
                      const documents = systemDocs.get(id)!;
                      const Glyph = SYSTEM_ICONS[id];
                      return (
                        <PresetCard
                          key={id}
                          title={systemName(id)}
                          description={t(`statsWorkbench.presets.system_${id}Desc`)}
                          icon={<Glyph className="text-brand" />}
                          documents={documents}
                          onOpen={() => go({ kind: "preview", source: { kind: "system", id } })}
                        />
                      );
                    })}
                  </PresetRail>
                </section>

                <section aria-labelledby="sw-presets-mine" className="flex flex-col gap-2.5">
                  <h3 id="sw-presets-mine" className="px-5 text-helper font-medium text-muted sm:px-6">
                    {t("statsWorkbench.presets.mine")}
                    {store.presets.length + store.unreadable.length > 0 ? <span className="ml-1.5 tabular-nums">{`${String(store.presets.length + store.unreadable.length)}/${String(MAX_USER_PRESETS)}`}</span> : null}
                  </h3>
                  <PresetRail label={t("statsWorkbench.presets.mine")}>
                    <AddPresetCard
                      full={store.presets.length + store.unreadable.length >= MAX_USER_PRESETS}
                      locked={store.locked || accountScope === null}
                      onAdd={() => go({ kind: "form", mode: "create", back: { kind: "list" } })}
                    />
                    {store.presets.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        title={preset.name}
                        description={preset.description}
                        meta={t("statsWorkbench.presets.updatedAt", { date: shortDate(preset.updatedAt) })}
                        documents={preset.documents}
                        onOpen={() => go({ kind: "preview", source: { kind: "user", id: preset.id } })}
                        onMore={() => go({ kind: "actions", presetId: preset.id })}
                        moreLabel={t("statsWorkbench.presets.actions", { name: preset.name })}
                      />
                    ))}
                    {store.unreadable.map((item) => (
                      <article key={item.id} className="sw-preset-card sw-preset-card-muted">
                        <h4 className="truncate text-body font-medium text-ink">{item.name === "" ? "—" : item.name}</h4>
                        <p className="text-helper text-muted">{t("statsWorkbench.presets.unreadable")}</p>
                        <button type="button" className="sw-pill sw-pill-sm mt-auto self-start text-danger" onClick={() => go({ kind: "confirm", action: "delete", presetId: item.id })}>
                          {t("statsWorkbench.presets.delete")}
                        </button>
                      </article>
                    ))}
                  </PresetRail>
                </section>
                <ExchangePanel accountScope={accountScope} scope={scope} onApply={onApply} onChanged={reload} />
              </div>
            ) : view.kind === "preview" ? (
              <PresetPreview
                key={view.source.kind === "system" ? view.source.id : view.source.id}
                documents={view.source.kind === "system" ? systemDocs.get(view.source.id)! : presetById(view.source.id)?.documents ?? null}
                savedFilters={view.source.kind === "user" ? presetById(view.source.id)?.filters ?? null : null}
                scope={scope}
                canSaveCurrent={!store.locked && accountScope !== null && store.presets.length + store.unreadable.length < MAX_USER_PRESETS}
                onSaveCurrent={() => go({ kind: "form", mode: "create", back: view })}
                onApply={(documents, useFilters) => {
                  const name = view.source.kind === "system" ? systemName(view.source.id) : presetById(view.source.id)?.name ?? "";
                  const filtersToUse = useFilters && view.source.kind === "user" ? presetById(view.source.id)?.filters ?? null : null;
                  if (onApply(documents, name, filtersToUse)) close();
                  else say(t("statsWorkbench.presets.problems.apply"), "warn");
                }}
              />
            ) : view.kind === "form" ? (
              <PresetForm
                mode={view.mode}
                initial={view.presetId === undefined ? undefined : presetById(view.presetId)}
                onCancel={() => go(view.back)}
                onSave={(input) => {
                  if (accountScope === null) return problemText("locked");
                  if (view.mode === "create") {
                    const created = createPreset(accountScope, { name: input.name, description: input.description, documents: current, filters: input.includeFilters ? filters : null });
                    if (typeof created === "string") return problemText(created);
                    reload();
                    setView(view.back);
                    say(t("statsWorkbench.presets.created", { name: created.name }));
                    return null;
                  }
                  const problem = renamePreset(accountScope, view.presetId ?? "", input);
                  if (problem !== null) return problemText(problem);
                  reload();
                  setView(view.back);
                  say(t("statsWorkbench.presets.renamed", { name: input.name.trim() }));
                  return null;
                }}
              />
            ) : view.kind === "actions" ? (
              <PresetActions
                preset={presetById(view.presetId)}
                onPreview={() => go({ kind: "preview", source: { kind: "user", id: view.presetId } })}
                onRename={() => go({ kind: "form", mode: "rename", presetId: view.presetId, back: { kind: "list" } })}
                onUpdate={() => go({ kind: "confirm", action: "update", presetId: view.presetId })}
                onDelete={() => go({ kind: "confirm", action: "delete", presetId: view.presetId })}
                onExport={() => {
                  const preset = presetById(view.presetId);
                  if (!preset) return;
                  try { downloadWorkspaceFile(exportWorkspaceFile("preset", [presetEntry(preset)])); say(t("statsWorkbench.transfer.exported")); }
                  catch { say(t("statsWorkbench.transfer.invalid"), "warn"); }
                }}
              />
            ) : (
              <ConfirmPanel
                text={t(view.action === "update" ? "statsWorkbench.presets.confirmUpdate" : "statsWorkbench.presets.confirmDelete", {
                  name: presetById(view.presetId)?.name ?? store.unreadable.find((item) => item.id === view.presetId)?.name ?? "",
                })}
                danger={view.action === "delete"}
                onCancel={() => go({ kind: "list" })}
                onConfirm={() => {
                  if (accountScope === null) return;
                  const name = presetById(view.presetId)?.name ?? store.unreadable.find((item) => item.id === view.presetId)?.name ?? "";
                  // 更新：换成当前工作台；原来保存了筛选的，筛选也换成当前的；原来没保存筛选的仍不保存。
                  const problem = view.action === "update" ? updatePresetDocuments(accountScope, view.presetId, current, presetById(view.presetId)?.filters === null ? null : filters) : deletePreset(accountScope, view.presetId);
                  if (problem !== null) {
                    say(problemText(problem), "warn");
                    return;
                  }
                  reload();
                  setView({ kind: "list" });
                  say(t(view.action === "update" ? "statsWorkbench.presets.updated" : "statsWorkbench.presets.deleted", { name }));
                }}
              />
            )}
          </div>

          <p
            key={status?.key}
            role="status"
            aria-live="polite"
            className={`px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-helper sm:px-6 ${status === null ? "sr-only" : status.tone === "warn" ? "pt-2 text-warn-dark" : "pt-2 text-brand-dark"}`}
          >
            {status?.text ?? ""}
          </p>
        </div>
      )}
    </BottomSheet>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), { month: "numeric", day: "numeric" }).format(date);
}

// ---------------------------------------------------------------------------
// 横向滑轨：手机横滑吸附，桌面左右按钮；`wide` 时宽屏三张并排
// ---------------------------------------------------------------------------

function PresetRail({ label, wide = false, children }: { readonly label: string; readonly wide?: boolean; readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => {
      const max = element.scrollWidth - element.clientWidth;
      setEdges({ start: element.scrollLeft > 2, end: element.scrollLeft < max - 2 });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  const scrollBy = (direction: 1 | -1) => {
    const element = ref.current;
    if (element === null) return;
    const card = element.firstElementChild as HTMLElement | null;
    const step = card === null ? element.clientWidth * 0.8 : card.offsetWidth + 12;
    element.scrollBy({ left: direction * step, behavior: "smooth" });
  };
  return (
    <div className="sw-preset-rail-wrap relative">
      <div
        ref={ref}
        role="list"
        aria-label={label}
        className={`sw-rail sw-preset-rail ${wide ? "sw-preset-rail-wide" : ""} ${edges.start ? "sw-rail-fade-start" : ""} ${edges.end ? "sw-rail-fade-end" : ""}`}
      >
        {children}
      </div>
      {edges.start ? (
        <button type="button" className="sw-preset-rail-arrow sw-preset-rail-arrow-start" aria-label={t("statsWorkbench.presets.railPrevious")} onClick={() => scrollBy(-1)}>
          <ChevronLeft width={16} height={16} />
        </button>
      ) : null}
      {edges.end ? (
        <button type="button" className="sw-preset-rail-arrow sw-preset-rail-arrow-end" aria-label={t("statsWorkbench.presets.railNext")} onClick={() => scrollBy(1)}>
          <ChevronRight width={16} height={16} />
        </button>
      ) : null}
    </div>
  );
}

function PresetCard({
  title,
  description,
  meta,
  icon,
  documents,
  onOpen,
  onMore,
  moreLabel,
}: {
  readonly title: string;
  readonly description: string;
  readonly meta?: string;
  readonly icon?: React.ReactNode;
  readonly documents: WorkbenchDocuments;
  readonly onOpen: () => void;
  readonly onMore?: () => void;
  readonly moreLabel?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const rows = lastRow(documents.layout);
  return (
    <article role="listitem" className="sw-preset-card group" aria-label={title}>
      <button type="button" className="sw-card-hit" aria-label={`${t("statsWorkbench.presets.preview")} · ${title}`} onClick={onOpen} />
      <div className="pointer-events-none relative flex min-w-0 items-center gap-2">
        {icon === undefined ? null : <span className="sw-preset-icon">{icon}</span>}
        <h4 className="min-w-0 flex-1 truncate text-body font-medium text-ink">{title}</h4>
        {onMore === undefined ? null : (
          <button
            type="button"
            className="sw-icon-button sw-icon-button-sm pointer-events-auto -my-1 -mr-1.5 text-muted"
            aria-label={moreLabel}
            onClick={(event) => {
              event.stopPropagation();
              onMore();
            }}
          >
            <MoreGlyph width={18} height={18} />
          </button>
        )}
      </div>
      {description === "" ? null : <p className="pointer-events-none relative line-clamp-2 text-helper text-muted">{description}</p>}
      <LayoutThumb content={documents.content} layout={documents.layout} />
      {meta === undefined ? null : <p className="pointer-events-none relative truncate text-helper text-muted">{meta}</p>}
      <p className="pointer-events-none relative mt-auto flex items-center justify-between gap-2 text-helper text-muted">
        <span className="truncate">
          {t("statsWorkbench.presets.rows", { count: rows })} · {t("statsWorkbench.presets.cards", { count: documents.content.cards.length })}
        </span>
        <span className="shrink-0 font-medium text-brand-dark">{t("statsWorkbench.presets.preview")}</span>
      </p>
    </article>
  );
}

function AddPresetCard({ full, locked, onAdd }: { readonly full: boolean; readonly locked: boolean; readonly onAdd: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const disabled = full || locked;
  return (
    <div role="listitem" className="sw-preset-card sw-preset-add-wrap">
      <button type="button" className="sw-preset-add" disabled={disabled} onClick={onAdd}>
        <span className="sw-preset-add-icon" aria-hidden="true">
          <PlusGlyph width={18} height={18} />
        </span>
        <span className="text-body font-medium text-ink">{t("statsWorkbench.presets.add")}</span>
        <span className="text-helper text-muted">
          {full ? t("statsWorkbench.presets.full", { count: MAX_USER_PRESETS }) : locked ? t("statsWorkbench.presets.problems.locked") : t("statsWorkbench.presets.addHint")}
        </span>
      </button>
    </div>
  );
}

/** 布局缩略图：按真实布局文档画格子（不画数据）；横向滑动抽屉画成带页码点的格子。 */
export function LayoutThumb({ content, layout }: { readonly content: WorkbenchContentDocumentV1; readonly layout: LayoutDocumentV1 }): React.JSX.Element {
  const columns = layout.main.baseCols;
  const rows = Math.max(1, lastRow(layout));
  // 一行画得比一列矮（行高约是列宽的四分之一），十几行的布局在卡片里也不会被压成细长一条。
  const columnWidth = 44;
  const unit = 6;
  const gap = 1.5;
  const width = columns * columnWidth + (columns - 1) * gap;
  const height = rows * unit + (rows - 1) * gap;
  const carousels = new Map(content.containers.filter((container) => container.type === "carousel").map((container) => [container.objectId, container.children.length] as const));
  return (
    <svg className="sw-preset-thumb pointer-events-none relative" viewBox={`0 0 ${String(width)} ${String(height)}`} preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      {layout.main.objects.map((object) => {
        const { row, col } = positionToRowCol(object.anchor, columns);
        const x = (col - 1) * (columnWidth + gap);
        const y = (row - 1) * (unit + gap);
        const w = object.colSpan * columnWidth + (object.colSpan - 1) * gap;
        const h = object.rowSpan * unit + (object.rowSpan - 1) * gap;
        if (object.objectType === "spacer") return <rect key={object.objectId} x={x} y={y} width={w} height={h} rx={2} className="sw-thumb-spacer" />;
        const pages = carousels.get(object.objectId);
        return (
          <g key={object.objectId}>
            <rect x={x} y={y} width={w} height={h} rx={2} className={pages === undefined ? "sw-thumb-card" : "sw-thumb-drawer"} />
            {pages === undefined
              ? null
              : Array.from({ length: pages }, (_, index) => (
                  <circle key={index} cx={x + w / 2 + (index - (pages - 1) / 2) * 2.6} cy={y + h - 2.2} r={index === 0 ? 0.9 : 0.65} className="sw-thumb-dot" />
                ))}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 预览
// ---------------------------------------------------------------------------

function PresetPreview({
  documents,
  savedFilters,
  scope,
  canSaveCurrent,
  onSaveCurrent,
  onApply,
}: {
  readonly documents: WorkbenchDocuments | null;
  /** 预设里保存的筛选（`null` = 没有保存筛选，不显示「同时使用」选项）。 */
  readonly savedFilters: string | null;
  readonly scope: WorkbenchScope;
  readonly canSaveCurrent: boolean;
  readonly onSaveCurrent: () => void;
  readonly onApply: (documents: WorkbenchDocuments, useFilters: boolean) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const box = useElementSize<HTMLDivElement>();
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const [useFilters, setUseFilters] = useState(false);
  if (documents === null) return <p className="px-5 py-6 text-body text-muted">{t("statsWorkbench.presets.problems.missing")}</p>;
  const columns = browseColumnsFor(box.width, documents.layout.main.baseCols);
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pb-2 sm:px-6">
        <p className="text-helper-relaxed text-muted">{t("statsWorkbench.presets.previewNote")}</p>
      </div>
      <div ref={box.ref} className="sw-preset-preview mx-2.5 mb-4 sm:mx-6">
        {box.width === 0 ? null : (
          <BrowseGrid
            content={documents.content}
            layout={documents.layout}
            columns={columns}
            scope={scope}
            onOpenCard={() => undefined}
            onOpenCollapsed={() => undefined}
            carouselPages={pages}
            onCarouselPage={(containerId, page) => setPages((current) => new Map(current).set(containerId, page))}
          />
        )}
      </div>
      <footer className="sw-preset-footer mt-auto flex flex-col gap-2.5 px-4 pt-3 pb-1 sm:px-6">
        <p className="text-helper text-warn-dark">{t("statsWorkbench.presets.previewReplace")}</p>
        {savedFilters === null ? null : (
          <label className="flex items-start gap-2.5 text-body text-ink">
            <input type="checkbox" checked={useFilters} onChange={(event) => setUseFilters(event.target.checked)} className="mt-1 size-4 shrink-0 accent-brand" />
            <span className="flex flex-col">
              {t("statsWorkbench.presets.useSavedFilters")}
              <span className="text-helper text-muted">{t("statsWorkbench.presets.useSavedFiltersHint")}</span>
            </span>
          </label>
        )}
        <div className="flex gap-2">
          {canSaveCurrent ? (
            <button type="button" className="sw-pill flex-1" onClick={onSaveCurrent}>
              <SaveGlyph width={16} height={16} />
              {t("statsWorkbench.presets.saveCurrentFirst")}
            </button>
          ) : null}
          <button type="button" className="sw-pill sw-pill-primary flex-1" onClick={() => onApply(documents, useFilters)}>
            {t("statsWorkbench.presets.applyThis")}
          </button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 保存 / 重命名、更多操作、确认
// ---------------------------------------------------------------------------

function PresetForm({
  mode,
  initial,
  onCancel,
  onSave,
}: {
  readonly mode: "create" | "rename";
  readonly initial: UserPreset | undefined;
  readonly onCancel: () => void;
  /** 返回错误文案（显示在表单里），成功返回 null。 */
  readonly onSave: (input: { readonly name: string; readonly description: string; readonly includeFilters: boolean }) => string | null;
}): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [includeFilters, setIncludeFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      className="flex flex-col gap-4 px-5 pt-2 pb-4 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(onSave({ name, description, includeFilters }));
      }}
    >
      <label className="flex flex-col gap-1.5 text-helper text-muted">
        {t("statsWorkbench.presets.form.name")}
        <input
          ref={inputRef}
          value={name}
          maxLength={PRESET_NAME_MAX}
          required
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder={t("statsWorkbench.presets.form.namePlaceholder")}
          className="min-h-11 rounded-field border border-line bg-surface px-3.5 py-2 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-helper text-muted">
        {t("statsWorkbench.presets.form.description")}
        <input
          value={description}
          maxLength={PRESET_DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("statsWorkbench.presets.form.descriptionPlaceholder")}
          className="min-h-11 rounded-field border border-line bg-surface px-3.5 py-2 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
        />
      </label>
      {mode === "create" ? (
        <label className="flex items-start gap-2.5 text-body text-ink">
          <input type="checkbox" checked={includeFilters} onChange={(event) => setIncludeFilters(event.target.checked)} className="mt-1 size-4 shrink-0 accent-brand" />
          <span className="flex flex-col">
            {t("statsWorkbench.presets.form.includeFilters")}
            <span className="text-helper text-muted">{t("statsWorkbench.presets.form.includeFiltersHint")}</span>
          </span>
        </label>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-helper text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" className="sw-pill flex-1" onClick={onCancel}>
          {t("statsWorkbench.presets.form.cancel")}
        </button>
        <button type="submit" className="sw-pill sw-pill-primary flex-1" disabled={name.trim() === ""}>
          {t("statsWorkbench.presets.form.save")}
        </button>
      </div>
    </form>
  );
}

function PresetActions({
  preset,
  onPreview,
  onRename,
  onUpdate,
  onDelete,
  onExport,
}: {
  readonly preset: UserPreset | undefined;
  readonly onPreview: () => void;
  readonly onRename: () => void;
  readonly onUpdate: () => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  if (preset === undefined) return <p className="px-5 py-6 text-body text-muted">{t("statsWorkbench.presets.problems.missing")}</p>;
  const items = [
    { key: "export", label: t("statsWorkbench.transfer.exportPreset"), icon: <SaveGlyph />, onClick: onExport, danger: false },
    { key: "preview", label: `${t("statsWorkbench.presets.preview")} / ${t("statsWorkbench.presets.apply")}`, icon: <ChevronRight />, onClick: onPreview, danger: false },
    { key: "rename", label: t("statsWorkbench.presets.rename"), icon: <PencilGlyph />, onClick: onRename, danger: false },
    { key: "update", label: t("statsWorkbench.presets.update"), icon: <SaveGlyph />, onClick: onUpdate, danger: false },
    { key: "delete", label: t("statsWorkbench.presets.delete"), icon: <TrashGlyph />, onClick: onDelete, danger: true },
  ];
  return (
    <div className="flex flex-col gap-3 px-3 pb-4">
      <div className="flex flex-col gap-1 px-2">
        {preset.description === "" ? null : <p className="text-helper-relaxed text-muted">{preset.description}</p>}
        <LayoutThumb content={preset.documents.content} layout={preset.documents.layout} />
      </div>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              className={`flex min-h-12 w-full items-center gap-3 rounded-field px-3 text-left text-body transition hover:bg-canvas ${item.danger ? "text-danger" : "text-ink"}`}
              onClick={item.onClick}
            >
              <span className={item.danger ? "text-danger" : "text-brand-dark"}>{item.icon}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmPanel({ text, danger, onCancel, onConfirm }: { readonly text: string; readonly danger: boolean; readonly onCancel: () => void; readonly onConfirm: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 px-5 pt-2 pb-4 sm:px-6">
      <p className="text-body-relaxed text-ink">{text}</p>
      <div className="flex gap-2">
        <button type="button" className="sw-pill flex-1" onClick={onCancel}>
          {t("statsWorkbench.presets.form.cancel")}
        </button>
        <button type="button" className={`sw-pill flex-1 ${danger ? "sw-pill-danger" : "sw-pill-primary"}`} onClick={onConfirm}>
          {t("statsWorkbench.presets.confirmYes")}
        </button>
      </div>
    </div>
  );
}
