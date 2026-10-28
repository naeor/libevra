/**
 * 自定义卡片编辑器（1.17.10）：**在同一个面板里**完成「选内容 → 定展示形式 → 选模板 → 预览与微调 → 添加」。
 *
 * 逻辑顺序（任务 §3）不是分页向导：
 * - 已选内容、模板与尺寸、实时预览、名称与时间、指标目录都在同一个可滚动面板里（宽屏左右两栏）；
 * - **简单路径**：点一个指标 → 默认展示形式 + 默认模板 + 推荐尺寸已经就绪 → 直接「添加到工作台」；
 * - 加减内容后自动重新推荐模板与尺寸；用户手动选过的模板只要还装得下就保留；
 * - 换模板、换展示形式、调整顺序、替换某一项都**不清空**其它配置；
 * - 只有点「添加到工作台 / 保存修改」才生成卡片；工作台本身仍要点「完成」才保存到本机。
 */
import { useMemo, useRef, useState } from "react";
import { endOfMonth, startOfMonth } from "@libellum/shared";
import type { AnalysisCardNode, GridSize } from "@libellum/shared/analysis/layout";

import { BottomSheet } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { analysisTitle, cardTitle } from "./cards.js";
import { cardType, sizeKey, type CardType, type ChartFamily } from "./catalog.js";
import {
  CARD_TEMPLATES,
  checkSizes,
  countSlots,
  MAX_CHART_SLOTS,
  MAX_NUMBER_SLOTS,
  MAX_SLOTS,
  nextSlotId,
  readComposition,
  recommendSize,
  recommendTemplate,
  sizeAllowed,
  slotKindOf,
  templateFit,
  type CompositionSlot,
  type GridMetrics,
  type TemplateId,
} from "./composition.js";
import { buildCard, CUSTOM_NAME_MAX, draftProblem, isSelectableAnalysis, type CompositeDraft } from "./customCards.js";
import { customRangeProblem, previousMonth } from "./filters.js";
import { CardTile } from "./Grid.js";
import { directorySections, primarySectionOf, searchDirectory, type DirectorySectionId } from "./metricCatalog.js";
import type { WorkbenchScope } from "./scope.js";
import { ChartGlyph, ChevronDown, ChevronUp, ComposeGlyph, PlusGlyph, SearchGlyph, SwapGlyph, XGlyph } from "./ui.js";

export interface CardEditorProps {
  /** 编辑已有卡片；缺省为新建。 */
  readonly card?: AnalysisCardNode | undefined;
  /** 已有卡片当前的占格。 */
  readonly currentSize?: GridSize | undefined;
  readonly today: string;
  /** 实时预览用的工作台作用域（真实账目、当前筛选）。 */
  readonly scope: WorkbenchScope;
  /** 当前设备上的网格像素度量；尺寸推荐与「能否完整显示」都按它算。 */
  readonly metrics: GridMetrics | null;
  readonly onSave: (card: AnalysisCardNode, size: GridSize) => boolean;
  readonly onClose: () => void;
}

type Translate = ReturnType<typeof useI18n>["t"];

const TEMPLATE_ORDER: readonly TemplateId[] = ["single", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];

function sameSize(a: GridSize, b: GridSize): boolean {
  return a.colSpan === b.colSpan && a.rowSpan === b.rowSpan;
}

export function CardEditor({ card, currentSize, today, scope, metrics, onSave, onClose }: CardEditorProps): React.JSX.Element {
  const { t } = useI18n();
  const initial = useMemo(() => (card === undefined ? null : readComposition(card)), [card]);
  const readOnly = initial?.source === "future";
  const [slots, setSlots] = useState<readonly CompositionSlot[]>(() => initial?.slots ?? []);
  const [chosenTemplate, setChosenTemplate] = useState<TemplateId | null>(() => (initial !== null && initial.source === "composite" ? initial.template : null));
  const [name, setName] = useState(card?.title?.kind === "custom" ? (card.title.text ?? "") : "");
  const [pinned, setPinned] = useState(card?.rangePolicy === "pinned");
  const [from, setFrom] = useState(card?.pinnedRange?.from ?? startOfMonth(today));
  const [to, setTo] = useState(card?.pinnedRange?.to ?? today);
  const [chosenSize, setChosenSize] = useState<GridSize | null>(null);
  const [section, setSection] = useState<DirectorySectionId>("numbers");
  const [query, setQuery] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [allTemplates, setAllTemplates] = useState(false);
  const catalogRef = useRef<HTMLDivElement | null>(null);

  const counts = countSlots(slots);
  const recommended = recommendTemplate(counts);
  // 用户手动选的模板：还能装下（ok / 还需再加）就保留；装不下才退回推荐模板。
  const chosenFit = chosenTemplate === null ? null : templateFit(CARD_TEMPLATES.find((item) => item.id === chosenTemplate)!, counts);
  const template: TemplateId = chosenTemplate !== null && chosenFit !== null && chosenFit.status !== "excess" ? chosenTemplate : (recommended ?? "single");
  const draft: CompositeDraft = { template, slots, name, ...(pinned ? { pinnedRange: { from, to } } : {}) };
  const problem = slots.length === 0 ? "empty" : draftProblem(draft);
  const rangeProblem = pinned ? customRangeProblem(from, to) : null;

  // 尺寸：已有卡片保留原尺寸（仍合法时）；否则按当前设备推荐；用户选过的尺寸只要合法就保留。
  const recommendedSize = slots.length === 0 ? null : recommendSize(template, slots, metrics);
  const keepCurrent = currentSize !== undefined && slots.length > 0 && sizeAllowed(template, slots, currentSize) && (metrics === null || currentSize.colSpan <= metrics.columns);
  const size: GridSize | null = slots.length === 0
    ? null
    : chosenSize !== null && sizeAllowed(template, slots, chosenSize)
      ? chosenSize
      : keepCurrent && currentSize !== undefined
        ? currentSize
        : recommendedSize;
  const sizeChecks = slots.length === 0 || metrics === null ? [] : checkSizes(template, slots, metrics);
  const sizeCheck = size === null ? undefined : sizeChecks.find((check) => sameSize(check.size, size));

  // 预览总能画：模板还缺内容时先按推荐模板画，固定日期还没填好时先跟随顶部筛选。
  const previewTemplate: TemplateId = problem === "template" ? (recommended ?? "single") : template;
  // 模板列表：推荐的在前，其次可用、还差内容的；放不下现有内容的默认收起（选它会丢内容，本来就不能选）。
  const templateOrder = [...TEMPLATE_ORDER].sort((a, b) => templateRank(a) - templateRank(b));
  const hiddenTemplates = TEMPLATE_ORDER.filter((id) => templateFit(CARD_TEMPLATES.find((item) => item.id === id)!, counts).status === "excess").length;
  function templateRank(id: TemplateId): number {
    if (id === recommended) return 0;
    const status = templateFit(CARD_TEMPLATES.find((item) => item.id === id)!, counts).status;
    return (status === "ok" ? 1 : status === "needs" ? 2 : 3) * 10 + TEMPLATE_ORDER.indexOf(id);
  }
  const previewCard = useMemo(() => {
    if (slots.length === 0) return null;
    const previewDraft: CompositeDraft = {
      template: previewTemplate,
      slots,
      name: name.slice(0, CUSTOM_NAME_MAX),
      ...(pinned && rangeProblem === null ? { pinnedRange: { from, to } } : {}),
    };
    return buildCard(previewDraft, card, "preview");
  }, [slots, previewTemplate, name, pinned, from, to, card, rangeProblem]);

  function say(text: string): void {
    setNotice(text);
  }

  /** 加内容或改展示形式后，手动模板装不下了：退回推荐模板并说明（内容一项不丢）。 */
  function afterChange(next: readonly CompositionSlot[]): void {
    if (chosenTemplate === null) return;
    const fit = templateFit(CARD_TEMPLATES.find((item) => item.id === chosenTemplate)!, countSlots(next));
    if (fit.status === "excess") {
      setChosenTemplate(null);
      const nextRecommended = recommendTemplate(countSlots(next));
      if (nextRecommended !== null) say(t("statsWorkbench.editor.templateSwitched", { template: t(`statsWorkbench.composite.templates.${nextRecommended}.name`) }));
    }
  }

  /** 加入（或把某一项换成）这种展示形式后会不会超过上限；超过时说明原因，不静默丢弃。 */
  function limitProblem(family: ChartFamily, ignoring: string | null): string | null {
    const others = slots.filter((slot) => slot.id !== ignoring);
    const after = countSlots([...others, { family }]);
    if (others.length + 1 > MAX_SLOTS) return t("statsWorkbench.editor.limitTotal", { count: MAX_SLOTS });
    if (after.numbers > MAX_NUMBER_SLOTS) return t("statsWorkbench.editor.limitNumbers", { count: MAX_NUMBER_SLOTS });
    if (after.charts > MAX_CHART_SLOTS) return t("statsWorkbench.editor.limitCharts", { count: MAX_CHART_SLOTS });
    return null;
  }

  function pick(type: CardType): void {
    if (readOnly) return;
    const family = type.families[0] ?? "number";
    if (replacing !== null) {
      const target = slots.find((slot) => slot.id === replacing);
      if (target === undefined) {
        setReplacing(null);
        return;
      }
      // 替换时尽量保留原来的展示种类（数字换数字、图表换图表）；新指标不支持时用它的默认形式。
      const keepKind = type.families.find((option) => slotKindOf(option) === slotKindOf(target.family));
      const nextFamily = type.families.includes(target.family) ? target.family : (keepKind ?? family);
      const blocked = limitProblem(nextFamily, target.id);
      if (blocked !== null) {
        say(blocked);
        return;
      }
      const next = slots.map((slot) => (slot.id === target.id ? { id: slot.id, analysisId: type.id, family: nextFamily } : slot));
      setSlots(next);
      afterChange(next);
      setReplacing(null);
      say(t("statsWorkbench.editor.replaced", { from: analysisTitle(target.analysisId, t), to: analysisTitle(type.id, t) }));
      return;
    }
    const blocked = limitProblem(family, null);
    if (blocked !== null) {
      say(blocked);
      return;
    }
    const next = [...slots, { id: nextSlotId(slots), analysisId: type.id, family }];
    setSlots(next);
    afterChange(next);
    say(t("statsWorkbench.editor.added", { name: analysisTitle(type.id, t), count: next.length }));
  }

  function setFamily(slotId: string, family: ChartFamily): void {
    const target = slots.find((slot) => slot.id === slotId);
    if (target === undefined || target.family === family) return;
    if (slotKindOf(family) !== slotKindOf(target.family)) {
      const blocked = limitProblem(family, slotId);
      if (blocked !== null) {
        say(blocked);
        return;
      }
    }
    const next = slots.map((slot) => (slot.id === slotId ? { ...slot, family } : slot));
    setSlots(next);
    afterChange(next);
  }

  function move(index: number, delta: -1 | 1): void {
    const next = [...slots];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + delta, 0, moved);
    setSlots(next);
  }

  function remove(slotId: string): void {
    const target = slots.find((slot) => slot.id === slotId);
    const next = slots.filter((slot) => slot.id !== slotId);
    setSlots(next);
    if (replacing === slotId) setReplacing(null);
    if (target !== undefined) say(t("statsWorkbench.editor.removed", { name: analysisTitle(target.analysisId, t) }));
  }

  function startReplace(slotId: string): void {
    setReplacing(slotId);
    requestAnimationFrame(() => catalogRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  const problemText = (() => {
    if (readOnly) return t("statsWorkbench.editor.futureVersion");
    if (problem === null) return null;
    if (problem === "template") {
      const fit = templateFit(CARD_TEMPLATES.find((item) => item.id === template)!, counts);
      return fit.status === "needs" ? needsText(fit.numbers, fit.charts, t) : t("statsWorkbench.custom.problems.template");
    }
    return t(`statsWorkbench.custom.problems.${problem}`);
  })();

  return (
    <BottomSheet label={card === undefined ? t("statsWorkbench.editor.titleNew") : t("statsWorkbench.editor.titleEdit")} onClose={onClose} dialogClassName="sw-editor h-[94dvh] max-h-[94dvh] sm:h-[88dvh] sm:max-h-[88dvh] md:max-w-5xl">
      {(close) => (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            if (readOnly || problem !== null || size === null) return;
            const built = buildCard(draft, card);
            if (built === null) return;
            // 工作台放不下时面板不关，并在面板里说明（页面的提示条在面板下面看不到）。
            if (onSave(built, size)) close();
            else say(t("statsWorkbench.editor.saveFailed"));
          }}
        >
          <header className="flex items-start gap-3 px-5 pt-4 pb-2 sm:px-6">
            <span className="mt-0.5 shrink-0 text-brand-dark"><ComposeGlyph /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-section-title text-ink">{card === undefined ? t("statsWorkbench.editor.titleNew") : t("statsWorkbench.editor.titleEdit")}</h2>
              <p className="mt-0.5 text-helper-relaxed text-muted">{t("statsWorkbench.editor.subtitle")}</p>
            </div>
            <button type="button" className="sw-icon-button shrink-0" aria-label={t("statsWorkbench.edit.cancel")} onClick={close}>
              <XGlyph />
            </button>
          </header>

          <div className="sw-editor-body min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-6 md:overflow-hidden md:pb-0">
            {/* ---- 右栏（窄屏在上）：已选内容、模板、尺寸、预览、名称与时间 ---- */}
            <div className="flex min-h-0 flex-col gap-5 md:order-2 md:overflow-y-auto md:pb-4">
              <section aria-labelledby="sw-editor-selected" className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="sw-editor-selected" className="text-body font-medium text-ink">{t("statsWorkbench.editor.selected", { count: slots.length })}</h3>
                  <span className="text-helper text-muted">{t("statsWorkbench.editor.limits", { numbers: MAX_NUMBER_SLOTS, charts: MAX_CHART_SLOTS })}</span>
                </div>
                {slots.length === 0 ? (
                  <p className="rounded-field border border-dashed border-line px-4 py-3 text-helper-relaxed text-muted">{t("statsWorkbench.editor.emptyHint")}</p>
                ) : (
                  <ol className="flex flex-col gap-2" aria-label={t("statsWorkbench.editor.selectedList")}>
                    {slots.map((slot, index) => (
                      <SlotRow
                        key={slot.id}
                        slot={slot}
                        index={index}
                        total={slots.length}
                        replacing={replacing === slot.id}
                        disabled={readOnly}
                        onFamily={(family) => setFamily(slot.id, family)}
                        onMove={(delta) => move(index, delta)}
                        onReplace={() => (replacing === slot.id ? setReplacing(null) : startReplace(slot.id))}
                        onRemove={() => remove(slot.id)}
                      />
                    ))}
                  </ol>
                )}
              </section>

              {slots.length === 0 ? null : (
                <>
                  <section aria-labelledby="sw-editor-template" className="flex flex-col gap-2">
                    <h3 id="sw-editor-template" className="text-body font-medium text-ink">{t("statsWorkbench.editor.template")}</h3>
                    <div className="sw-template-grid" role="radiogroup" aria-labelledby="sw-editor-template">
                      {templateOrder.filter((id) => allTemplates || templateFit(CARD_TEMPLATES.find((item) => item.id === id)!, counts).status !== "excess").map((id) => {
                        const fit = templateFit(CARD_TEMPLATES.find((item) => item.id === id)!, counts);
                        const active = template === id;
                        const status = fit.status === "ok" ? (id === recommended ? t("statsWorkbench.editor.recommended") : t("statsWorkbench.editor.available")) : fit.status === "needs" ? needsText(fit.numbers, fit.charts, t) : t("statsWorkbench.editor.cannotHold");
                        return (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={readOnly || fit.status === "excess"}
                            className={`sw-template ${active ? "sw-template-on" : ""}`}
                            onClick={() => setChosenTemplate(id === recommended && fit.status === "ok" ? null : id)}
                          >
                            <TemplateSketch id={id} />
                            <span className="min-w-0">
                              <span className="block truncate text-helper font-medium text-ink">{t(`statsWorkbench.composite.templates.${id}.name`)}</span>
                              <span className={`block truncate text-helper ${fit.status === "ok" && id === recommended ? "text-brand-dark" : "text-muted"}`}>{status}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {hiddenTemplates > 0 ? (
                      <button type="button" className="sw-link self-start" aria-expanded={allTemplates} onClick={() => setAllTemplates((value) => !value)}>
                        {allTemplates ? t("statsWorkbench.editor.hideTemplates") : t("statsWorkbench.editor.showTemplates", { count: hiddenTemplates })}
                      </button>
                    ) : null}
                    <p className="text-helper-relaxed text-muted">{t(`statsWorkbench.composite.templates.${template}.desc`)}</p>
                  </section>

                  <section aria-labelledby="sw-editor-size" className="flex flex-col gap-2">
                    <h3 id="sw-editor-size" className="text-body font-medium text-ink">{t("statsWorkbench.editor.size")}</h3>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="sw-editor-size">
                      {(sizeChecks.length > 0 ? sizeChecks : []).map((check) => {
                        const active = size !== null && sameSize(size, check.size);
                        return (
                          <button
                            key={sizeKey(check.size)}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={readOnly || check.tooWide}
                            className={`sw-chip inline-flex items-center gap-1.5 ${active ? "sw-chip-on" : ""}`}
                            onClick={() => setChosenSize(check.size)}
                          >
                            <span className="tabular-nums">{sizeKey(check.size)}</span>
                            <span className="text-helper opacity-80">{check.tooWide ? t("statsWorkbench.editor.sizeTooWide") : check.fits ? t("statsWorkbench.editor.sizeFits") : t("statsWorkbench.editor.sizeTight", { count: check.hidden })}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-helper-relaxed text-muted">
                      {size === null
                        ? null
                        : sizeCheck === undefined || sizeCheck.fits
                          ? t("statsWorkbench.editor.sizeOk", { size: sizeKey(size) })
                          : t("statsWorkbench.editor.sizeWarn", { size: sizeKey(size), count: sizeCheck.hidden })}
                      {recommendedSize !== null && size !== null && !sameSize(recommendedSize, size) ? ` ${t("statsWorkbench.editor.sizeRecommended", { size: sizeKey(recommendedSize) })}` : ""}
                    </p>
                  </section>

                  <section aria-labelledby="sw-editor-preview" className="flex flex-col gap-2">
                    <h3 id="sw-editor-preview" className="text-body font-medium text-ink">{t("statsWorkbench.editor.preview")}</h3>
                    {previewCard === null || size === null ? null : <Preview card={previewCard} size={size} scope={scope} metrics={metrics} />}
                    {problem === "template" && recommended !== null ? <p className="text-helper text-muted">{t("statsWorkbench.editor.previewUsesRecommended", { template: t(`statsWorkbench.composite.templates.${recommended}.name`) })}</p> : null}
                  </section>

                  <section aria-labelledby="sw-editor-settings" className="flex flex-col gap-4">
                    <h3 id="sw-editor-settings" className="sr-only">{t("statsWorkbench.editor.settings")}</h3>
                    <label className="flex flex-col gap-1.5 text-helper text-muted">
                      {t("statsWorkbench.config.name")}
                      <input
                        value={name}
                        maxLength={CUSTOM_NAME_MAX}
                        disabled={readOnly}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={previewCard === null ? "" : cardTitle({ ...previewCard, title: { kind: "preset" } }, t)}
                        className="min-h-11 rounded-field border border-line bg-surface px-3.5 py-2 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
                      />
                      <span>{t("statsWorkbench.editor.nameHint")}</span>
                    </label>
                    <fieldset className="flex flex-col gap-2" disabled={readOnly}>
                      <legend className="pb-1.5 text-helper text-muted">{t("statsWorkbench.config.time")}</legend>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" aria-pressed={!pinned} className={`sw-chip ${!pinned ? "sw-chip-on" : ""}`} onClick={() => setPinned(false)}>{t("statsWorkbench.config.inherit")}</button>
                        <button type="button" aria-pressed={pinned} className={`sw-chip ${pinned ? "sw-chip-on" : ""}`} onClick={() => setPinned(true)}>{t("statsWorkbench.config.pinned")}</button>
                      </div>
                      {pinned ? <PinnedRange today={today} from={from} to={to} onFrom={setFrom} onTo={setTo} problem={rangeProblem} /> : <p className="text-helper-relaxed text-muted">{t("statsWorkbench.editor.sharedScope")}</p>}
                    </fieldset>
                  </section>
                </>
              )}
            </div>

            {/* ---- 左栏（窄屏在下）：指标目录 ---- */}
            <div ref={catalogRef} className="mt-6 flex min-h-0 flex-col gap-3 md:order-1 md:mt-0 md:overflow-y-auto md:pb-4">
              <Catalog
                section={section}
                onSection={setSection}
                query={query}
                onQuery={setQuery}
                slots={slots}
                combined={scope.combined}
                replacingName={replacing === null ? null : analysisTitle(slots.find((slot) => slot.id === replacing)?.analysisId ?? "", t)}
                onCancelReplace={() => setReplacing(null)}
                disabled={readOnly}
                onPick={pick}
              />
            </div>
          </div>

          <footer className="flex flex-col gap-2 border-t border-line px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:px-6">
            <p role="status" aria-live="polite" className={`min-h-5 text-helper ${submitted && problemText !== null ? "text-danger" : "text-muted"}`}>
              {submitted && problemText !== null ? problemText : notice ?? (problemText ?? t("statsWorkbench.editor.ready", { count: slots.length, template: t(`statsWorkbench.composite.templates.${template}.name`), size: size === null ? "" : sizeKey(size) }))}
            </p>
            <div className="flex gap-3">
              <button type="button" className="sw-pill flex-1" onClick={close}>{t("statsWorkbench.edit.cancel")}</button>
              <button type="submit" className="sw-pill sw-pill-primary flex-1" disabled={readOnly || slots.length === 0}>
                {card === undefined ? t("statsWorkbench.custom.create") : t("statsWorkbench.editor.save")}
              </button>
            </div>
          </footer>
        </form>
      )}
    </BottomSheet>
  );
}

function needsText(numbers: number, charts: number, t: Translate): string {
  const parts: string[] = [];
  if (numbers > 0) parts.push(t("statsWorkbench.editor.needNumbers", { count: numbers }));
  if (charts > 0) parts.push(t("statsWorkbench.editor.needCharts", { count: charts }));
  return parts.join(t("statsWorkbench.editor.and"));
}

function SlotRow({
  slot,
  index,
  total,
  replacing,
  disabled,
  onFamily,
  onMove,
  onReplace,
  onRemove,
}: {
  readonly slot: CompositionSlot;
  readonly index: number;
  readonly total: number;
  readonly replacing: boolean;
  readonly disabled: boolean;
  readonly onFamily: (family: ChartFamily) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onReplace: () => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const type = cardType(slot.analysisId);
  const title = analysisTitle(slot.analysisId, t);
  const families = type?.families ?? [slot.family];
  return (
    <li className={`sw-slot-row ${replacing ? "sw-slot-row-replacing" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="sw-order">{index + 1}</span>
        <ChartGlyph family={slot.family} className="shrink-0 text-brand-dark" width={18} height={18} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink">{title}</span>
          <span className="block truncate text-helper text-muted">{t(`statsWorkbench.editor.kind.${slotKindOf(slot.family)}`)}{replacing ? ` · ${t("statsWorkbench.editor.replacingTag")}` : ""}</span>
        </span>
        <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.editor.moveUp", { name: title })} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
          <ChevronUp />
        </button>
        <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.editor.moveDown", { name: title })} disabled={disabled || index === total - 1} onClick={() => onMove(1)}>
          <ChevronDown />
        </button>
        <button type="button" className={`sw-icon-button ${replacing ? "sw-icon-button-on" : ""}`} aria-pressed={replacing} aria-label={t("statsWorkbench.editor.replace", { name: title })} disabled={disabled} onClick={onReplace}>
          <SwapGlyph />
        </button>
        <button type="button" className="sw-icon-button" aria-label={t("statsWorkbench.editor.remove", { name: title })} disabled={disabled} onClick={onRemove}>
          <XGlyph />
        </button>
      </div>
      {families.length > 1 ? (
        <div className="sw-chip-row mt-2" role="radiogroup" aria-label={t("statsWorkbench.editor.displayFor", { name: title })}>
          {families.map((family) => (
            <button
              key={family}
              type="button"
              role="radio"
              aria-checked={slot.family === family}
              disabled={disabled}
              className={`sw-chip sw-chip-sm inline-flex shrink-0 items-center gap-1.5 ${slot.family === family ? "sw-chip-on" : ""}`}
              onClick={() => onFamily(family)}
            >
              <ChartGlyph family={family} width={16} height={16} />
              {t(`statsWorkbench.config.families.${family}`)}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-1 pl-8 text-helper text-muted">{t("statsWorkbench.editor.onlyForm", { form: t(`statsWorkbench.config.families.${slot.family}`) })}</p>
      )}
    </li>
  );
}

function Catalog({
  section,
  onSection,
  query,
  onQuery,
  slots,
  combined,
  replacingName,
  onCancelReplace,
  disabled,
  onPick,
}: {
  readonly section: DirectorySectionId;
  readonly onSection: (section: DirectorySectionId) => void;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly slots: readonly CompositionSlot[];
  readonly combined: boolean;
  readonly replacingName: string | null;
  readonly onCancelReplace: () => void;
  readonly disabled: boolean;
  readonly onPick: (type: CardType) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const sections = useMemo(() => directorySections(), []);
  const results = useMemo(() => searchDirectory(query, (key) => t(key as never)), [query, t]);
  const searching = query.trim() !== "";
  const active = sections.find((item) => item.id === section) ?? sections[0];
  const totalMetrics = useMemo(() => new Set(sections.flatMap((item) => item.subgroups.flatMap((group) => group.ids))).size, [sections]);
  const used = new Map<string, number>();
  for (const slot of slots) used.set(slot.analysisId, (used.get(slot.analysisId) ?? 0) + 1);
  return (
    <section aria-labelledby="sw-editor-catalog" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="sw-editor-catalog" className="text-body font-medium text-ink">{t("statsWorkbench.editor.catalog")}</h3>
        <span className="text-helper text-muted">{t("statsWorkbench.editor.catalogCount", { count: totalMetrics })}</span>
      </div>
      {replacingName === null ? null : (
        <p className="flex items-center gap-2 rounded-field bg-brand-soft px-3 py-2 text-helper text-ink">
          <SwapGlyph width={16} height={16} className="shrink-0 text-brand-dark" />
          <span className="min-w-0 flex-1">{t("statsWorkbench.editor.replacingBanner", { name: replacingName })}</span>
          <button type="button" className="sw-link shrink-0" onClick={onCancelReplace}>{t("statsWorkbench.edit.cancel")}</button>
        </p>
      )}
      <label className="relative block">
        <span className="sr-only">{t("statsWorkbench.editor.search")}</span>
        <SearchGlyph width={18} height={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("statsWorkbench.editor.search")}
          className="min-h-11 w-full rounded-field border border-line bg-surface py-2 pr-3 pl-9 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
        />
      </label>
      {searching ? null : (
        <div className="sw-chip-row" role="tablist" aria-label={t("statsWorkbench.editor.sections")}>
          {sections.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={active?.id === item.id} className={`sw-chip shrink-0 ${active?.id === item.id ? "sw-chip-on" : ""}`} onClick={() => onSection(item.id)}>
              {t(`statsWorkbench.directory.sections.${item.id}`)}
            </button>
          ))}
        </div>
      )}
      {searching ? (
        results.length === 0 ? (
          <p className="text-helper text-muted">{t("statsWorkbench.drawer.noMatches")}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("statsWorkbench.editor.searchResults", { count: results.length })}>
            {results.map((type) => (
              <CatalogItem key={type.id} type={type} used={used.get(type.id) ?? 0} combined={combined} replacing={replacingName !== null} disabled={disabled} sectionTag={primarySectionOf(type.id)} onPick={() => onPick(type)} />
            ))}
          </ul>
        )
      ) : active === undefined ? null : (
        <div className="flex flex-col gap-4" role="tabpanel">
          <p className="text-helper-relaxed text-muted">{t(`statsWorkbench.directory.sectionDesc.${active.id}`)}</p>
          {active.subgroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <h4 className="text-helper font-medium text-muted">{t(`statsWorkbench.directory.subgroups.${group.id}` as "statsWorkbench.directory.subgroups.totals")}</h4>
              <ul className="flex flex-col gap-2">
                {group.ids.map((id) => {
                  const type = cardType(id);
                  return type === null ? null : <CatalogItem key={id} type={type} used={used.get(id) ?? 0} combined={combined} replacing={replacingName !== null} disabled={disabled} sectionTag={null} onPick={() => onPick(type)} />;
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogItem({
  type,
  used,
  combined,
  replacing,
  disabled,
  sectionTag,
  onPick,
}: {
  readonly type: CardType;
  readonly used: number;
  readonly combined: boolean;
  readonly replacing: boolean;
  readonly disabled: boolean;
  readonly sectionTag: DirectorySectionId | null;
  readonly onPick: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const title = analysisTitle(type.id, t);
  const forms = type.families.map((family) => t(`statsWorkbench.config.families.${family}`)).join(t("statsWorkbench.editor.listSeparator"));
  const needsCombined = type.requiresCombined === true && !combined;
  const selectable = isSelectableAnalysis(type.id);
  return (
    <li className="sw-catalog-item">
      <ChartGlyph family={type.families[0] ?? "number"} className="mt-0.5 shrink-0 text-brand-dark" width={20} height={20} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-body text-ink">{title}</span>
          {used > 0 ? <span className="shrink-0 rounded-full bg-brand-soft px-1.5 text-helper text-brand-dark">{t("statsWorkbench.editor.usedCount", { count: used })}</span> : null}
        </span>
        <span className="block text-helper-relaxed text-muted">{t(`statsWorkbench.cards.${type.id as "AN-B01"}.desc`)}</span>
        <span className="block truncate text-helper text-muted">
          {sectionTag === null ? "" : `${t(`statsWorkbench.directory.sections.${sectionTag}`)} · `}
          {t("statsWorkbench.editor.forms", { forms })}
          {needsCombined ? ` · ${t("statsWorkbench.editor.needsCombined")}` : ""}
        </span>
      </span>
      <button
        type="button"
        className="sw-add-button mt-0.5"
        disabled={disabled || !selectable}
        aria-label={replacing ? t("statsWorkbench.editor.replaceWith", { name: title }) : t("statsWorkbench.drawer.add", { name: title })}
        onClick={onPick}
      >
        {replacing ? <SwapGlyph width={18} height={18} /> : <PlusGlyph width={18} height={18} />}
      </button>
    </li>
  );
}

/** 模板示意图：只表达「数字格 / 图表格」的相对位置，不画真实数据。 */
function TemplateSketch({ id }: { readonly id: TemplateId }): React.JSX.Element {
  const cells: Readonly<Record<TemplateId, readonly (readonly [number, number, number, number, "n" | "c"])[]>> = {
    single: [[0, 0, 4, 4, "c"]],
    T1: [[0, 0, 4, 2, "n"], [0, 2, 4, 2, "n"]],
    T2: [[0, 0, 2, 2, "n"], [2, 0, 2, 2, "n"], [0, 2, 2, 2, "n"], [2, 2, 2, 2, "n"]],
    T3: [[0, 0, 2, 1, "n"], [2, 0, 2, 1, "n"], [0, 1, 4, 3, "c"]],
    T4: [[0, 0, 1, 1, "n"], [1, 0, 1, 1, "n"], [2, 0, 1, 1, "n"], [3, 0, 1, 1, "n"], [0, 1, 4, 3, "c"]],
    T5: [[0, 0, 4, 2, "c"], [0, 2, 4, 2, "c"]],
    T6: [[0, 0, 1.5, 4, "n"], [1.5, 0, 2.5, 4, "c"]],
    T7: [[0, 0, 2, 1.33, "n"], [2, 0, 2, 1.33, "n"], [0, 1.33, 2, 1.33, "n"], [2, 1.33, 2, 1.33, "n"], [0, 2.67, 2, 1.33, "n"], [2, 2.67, 2, 1.33, "n"]],
    T8: [[0, 0, 2, 1, "n"], [2, 0, 2, 1, "n"], [0, 1, 2, 3, "c"], [2, 1, 2, 3, "c"]],
  };
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true" className="shrink-0">
      {cells[id].map(([x, y, w, h, kind], index) => (
        <rect key={index} x={x * 10 + 1} y={y * 10 + 1} width={w * 10 - 2} height={h * 10 - 2} rx="2" className={kind === "n" ? "sw-sketch-number" : "sw-sketch-chart"} />
      ))}
    </svg>
  );
}

function PinnedRange({ today, from, to, onFrom, onTo, problem }: {
  readonly today: string;
  readonly from: string;
  readonly to: string;
  readonly onFrom: (value: string) => void;
  readonly onTo: (value: string) => void;
  readonly problem: string | null;
}): React.JSX.Element {
  const { t } = useI18n();
  const lastMonth = previousMonth(today);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="sw-chip" onClick={() => { onFrom(startOfMonth(today)); onTo(endOfMonth(today)); }}>{t("statsWorkbench.time.thisMonth")}</button>
        <button type="button" className="sw-chip" onClick={() => { onFrom(`${lastMonth}-01`); onTo(endOfMonth(`${lastMonth}-01`)); }}>{t("statsWorkbench.time.lastMonth")}</button>
        <button type="button" className="sw-chip" onClick={() => { onFrom(`${today.slice(0, 4)}-01-01`); onTo(today); }}>{t("statsWorkbench.time.yearToDate")}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
          {t("statsWorkbench.time.from")}
          <input type="date" value={from} onChange={(event) => onFrom(event.target.value)} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-helper text-muted">
          {t("statsWorkbench.time.to")}
          <input type="date" value={to} onChange={(event) => onTo(event.target.value)} className="min-h-11 min-w-0 rounded-field border border-line bg-surface px-3 py-2 text-base text-ink" />
        </label>
      </div>
      {problem === null ? (
        <p className="text-helper text-muted">{t("statsWorkbench.config.pinnedHint")}</p>
      ) : (
        <p role="alert" className="text-helper text-danger">{t(`statsWorkbench.filter.problems.${problem as "invalid"}`)}</p>
      )}
    </div>
  );
}

/**
 * 实时预览：用**真正的卡片组件**按当前设备上的真实格子像素画出来（同一套排布函数），
 * 所以「预览里放得下」就等于「工作台里放得下」。预览不响应点击。
 */
function Preview({ card, size, scope, metrics }: { readonly card: AnalysisCardNode; readonly size: GridSize; readonly scope: WorkbenchScope; readonly metrics: GridMetrics | null }): React.JSX.Element {
  const { t } = useI18n();
  const columnWidth = metrics?.columnWidth ?? 160;
  const rowHeight = metrics?.rowHeight ?? 116;
  const gap = metrics?.gap ?? 12;
  const width = Math.round(columnWidth * size.colSpan + gap * (size.colSpan - 1));
  const height = Math.round(rowHeight * size.rowSpan + gap * (size.rowSpan - 1));
  return (
    <div className="sw-preview overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-field bg-canvas p-3" aria-label={t("statsWorkbench.editor.previewLabel", { size: sizeKey(size) })}>
      <div className="sw-preview-card pointer-events-none mx-auto" style={{ width, height }} aria-hidden="true">
        <CardTile card={card} scope={scope} onOpen={() => undefined} />
      </div>
    </div>
  );
}
