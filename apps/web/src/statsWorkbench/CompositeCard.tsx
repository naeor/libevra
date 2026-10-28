/**
 * 组合卡片的内容区（1.17.10）：按卡片内容模板与**卡片自身的真实宽高**排布槽位。
 *
 * - 读取共享：同一张卡片里用同一段日期的槽位只读一次、只折算一次（`useCardScope`），槽位各自只做结果计算；
 *   计算结果本身又按「账目快照 + 条件」缓存（compute.ts），同一指标在不同卡片里拿到同一个结果对象。
 * - 渲染复用：每个槽位交给既有的 `SlotBody`（与单项卡片同一套 A/B/C 计算与图表），只额外告诉它
 *   「你在一个多大的格子里、是数字还是图表」；不另写计算、不另写图表。
 * - 放不下：排布函数先保证可读下限，放不下的槽位不画，在角落写「另有 N 项」，点开详情页能看到全部内容；
 *   不靠缩小字号硬塞。
 */
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useI18n } from "../i18n/index.js";
import { cardRange, COMPARISON_IDS, displayCard, needsOwnRange, SlotBody, SlotPresentationContext, slotTitle, useCardScope } from "./cards.js";
import { SourceEntries } from "./SourceEntries.js";
import { cardType } from "./catalog.js";
import { layoutComposition, readComposition, slotCard, slotSpecs, type CompositionSlot, type SlotPlacement } from "./composition.js";
import type { WorkbenchScope } from "./scope.js";
import { densityFor } from "./ui.js";

/** 槽位名称一行的高度（px），与 `.sw-slot-label` 一致。 */
const LABEL_HEIGHT = 18;
/** 「另有 N 项」一行的高度（text-helper 行高 + 间隙）。 */
const MORE_LINE = 18;

export interface CompositeSlotView {
  readonly slot: CompositionSlot;
  /** 已解析展示别名的虚拟卡片（交给 `SlotBody`）。 */
  readonly card: AnalysisCardNode;
  readonly scope: WorkbenchScope;
  readonly label: string;
}

/**
 * 组合卡片各槽位的作用域：**最多两组读取**——跟随卡片时间（顶部筛选或卡片固定区间）的一组、
 * 分析自带「近 12 个月」窗口的一组。两组各自至多读一次原件、折算一次；两期比较只在需要时读上一周期。
 */
export function useCompositeSlots(card: AnalysisCardNode, scope: WorkbenchScope): readonly CompositeSlotView[] {
  const { t } = useI18n();
  const read = readComposition(card);
  // 槽位按实际日期分成三组（共享时间 / 近 12 个月 / 全年），每组只读一次、只折算一次。
  const entries = read.slots.map((slot) => {
    const virtual = displayCard(slotCard(card, slot));
    return { slot, card: virtual, window: cardType(virtual.analysis.analysisId)?.ownWindow ?? null };
  });
  const main = entries.filter((entry) => entry.window === null);
  const windowed = entries.filter((entry) => entry.window === "12m");
  const yearly = entries.filter((entry) => entry.window === "year");
  const mainRange = cardRange(main[0]?.card ?? slotCard(card, read.slots[0]!), scope);
  const windowRange = windowed[0] === undefined ? mainRange : cardRange(windowed[0].card, scope);
  const yearRange = yearly[0] === undefined ? mainRange : cardRange(yearly[0].card, scope);
  const mainScope = useCardScope(mainRange, scope, {
    active: main.some((entry) => needsOwnRange(entry.card, scope)),
    comparison: main.some((entry) => COMPARISON_IDS.has(entry.card.analysis.analysisId)),
  });
  const windowScope = useCardScope(windowRange, scope, { active: windowed.some((entry) => needsOwnRange(entry.card, scope)), comparison: false });
  const yearScope = useCardScope(yearRange, scope, { active: yearly.some((entry) => needsOwnRange(entry.card, scope)), comparison: false });
  return entries.map((entry) => ({
    slot: entry.slot,
    card: entry.card,
    scope: entry.window === "12m" ? windowScope : entry.window === "year" ? yearScope : mainScope,
    label: entry.window === "12m"
      ? `${slotTitle(entry.slot.analysisId, entry.slot.family, t)} · ${t("statsWorkbench.card.ownWindow12m")}`
      : entry.window === "year"
        ? `${slotTitle(entry.slot.analysisId, entry.slot.family, t)} · ${t("statsWorkbench.card.ownWindowYear", { year: yearRange.from.slice(0, 4) })}`
        : slotTitle(entry.slot.analysisId, entry.slot.family, t),
  }));
}

export function CompositeBody({
  card,
  scope,
  width,
  height,
}: {
  readonly card: AnalysisCardNode;
  readonly scope: WorkbenchScope;
  readonly width: number;
  readonly height: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const read = readComposition(card);
  const views = useCompositeSlots(card, scope);
  const specs = slotSpecs(read.slots);
  const full = layoutComposition(read.template, specs, width, height);
  // 放不下全部内容时，底部留一行写「另有 N 项」，并按扣掉这一行后的高度重新排布，提示不压在数字上。
  // 若留出这一行会让能显示的项变少（例如窄屏 1×1 只放得下一个数字），就不留行，改成右下角的「+N」角标。
  const reserved = full.hidden.length === 0 ? full : layoutComposition(read.template, specs, width, Math.max(0, height - MORE_LINE));
  const useBadge = full.hidden.length > 0 && reserved.placements.length < full.placements.length;
  const layout = useBadge ? full : reserved;
  const byId = new Map(views.map((view) => [view.slot.id, view] as const));
  const moreText = t("statsWorkbench.composite.more", { count: layout.hidden.length });
  return (
    <div className="sw-composite relative h-full w-full" data-template={read.template}>
      {layout.placements.map((placement) => {
        const view = byId.get(placement.slotId);
        return view === undefined ? null : <SlotCell key={placement.slotId} placement={placement} view={view} />;
      })}
      {layout.hidden.length === 0 ? null : useBadge ? (
        <span role="img" aria-label={moreText} title={moreText} className="sw-composite-more absolute top-0 right-0 text-helper font-medium text-muted">
          +{layout.hidden.length}
        </span>
      ) : (
        <p className="sw-composite-more absolute right-0 bottom-0 left-0 truncate text-right text-helper text-muted">{moreText}</p>
      )}
    </div>
  );
}

function SlotCell({ placement, view }: { readonly placement: SlotPlacement; readonly view: CompositeSlotView }): React.JSX.Element {
  const style: React.CSSProperties = { left: placement.x, top: placement.y, width: placement.width, height: placement.height };
  const body = (bodyHeight: number) => (
    <SlotPresentationContext.Provider value={{ mode: placement.mode }}>
      <SlotBody card={view.card} scope={view.scope} density={densityFor(placement.width, bodyHeight)} height={bodyHeight} width={placement.width} />
    </SlotPresentationContext.Provider>
  );
  if (placement.mode === "inline") {
    return (
      // 数值优先：数值按自身宽度完整显示，名称在剩余空间里截断（完整名称在 title 与读屏文字里）。
      <div className="sw-slot absolute flex min-w-0 items-center gap-2" style={style} data-slot-mode="inline">
        <span className="sw-slot-label min-w-[2.25rem] flex-1 truncate" title={view.label}>{view.label}</span>
        <span className="max-w-full min-w-0 shrink-0 text-right">{body(placement.height)}</span>
      </div>
    );
  }
  if (placement.mode === "stacked") {
    return (
      <div className="sw-slot absolute flex min-w-0 flex-col justify-between" style={style} data-slot-mode="stacked">
        <span className="sw-slot-label truncate" title={view.label}>{view.label}</span>
        <span className="min-w-0">{body(placement.height - LABEL_HEIGHT)}</span>
      </div>
    );
  }
  const bodyHeight = Math.max(0, placement.height - LABEL_HEIGHT);
  return (
    <div className="sw-slot absolute flex min-w-0 flex-col" style={style} data-slot-mode={placement.mode}>
      <span className="sw-slot-label truncate" title={view.label}>{view.label}</span>
      <div className="min-h-0 flex-1 overflow-hidden">{body(bodyHeight)}</div>
    </div>
  );
}

/** 详情页：每个槽位一节，完整密度；读取同样由整张卡片共享。 */
export function CompositeDetail({ card, scope }: { readonly card: AnalysisCardNode; readonly scope: WorkbenchScope }): React.JSX.Element {
  const views = useCompositeSlots(card, scope);
  return (
    <div className="flex flex-col gap-4">
      {views.map((view) => (
        <section key={view.slot.id} className="min-h-0 rounded-card border border-line bg-surface p-4" aria-label={view.label}>
          <h2 className="pb-2 text-card-title text-ink">{view.label}</h2>
          <SlotBody card={view.card} scope={view.scope} density="expanded" detail />
          <SourceEntries card={view.card} scope={view.scope} />
        </section>
      ))}
    </div>
  );
}
