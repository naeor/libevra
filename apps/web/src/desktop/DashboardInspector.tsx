/**
 * 检查器（1.19.103，候选清单 D5）：侧栏里放了「检查器」模块时，点总览上的分析卡片不再跳走，而是在侧栏里显示
 * 它的完整内容与来源账目（与分析页详情同一套组件），旁边有「在分析页打开」。卡片设置里选了别的点击去处的卡片照旧。
 */
import { createContext, useContext } from "react";

import { useI18n } from "../i18n/index.js";
import { CardBody, cardSubtitle, cardTitle } from "../statsWorkbench/cards.js";
import { CompositeDetail } from "../statsWorkbench/CompositeCard.js";
import { isMultiSlot } from "../statsWorkbench/composition.js";
import { withCardSource } from "../statsWorkbench/nativeCards.js";
import { useScope } from "../statsWorkbench/scope.js";
import { SourceEntries } from "../statsWorkbench/SourceEntries.js";
import { useDashboardCardScope } from "./dashboardScopes.js";
import { findDashboardCard, templateObjectId } from "./dashboardStore.js";
import { useDashboardView } from "./dashboardView.js";

export interface DashboardInspect {
  readonly inspected: string | null;
  readonly inspect: (cardId: string | null) => void;
  /** 跳到分析页（不经过检查器）。 */
  readonly openFull: (cardId: string) => void;
}

export const DashboardInspectContext = createContext<DashboardInspect | null>(null);

export function InspectorModule(): React.JSX.Element {
  const { t } = useI18n();
  const inspect = useContext(DashboardInspectContext);
  const view = useDashboardView();
  const fallback = useScope();
  const inspected = inspect?.inspected ?? null;
  const templateId = inspected === null ? null : templateObjectId(inspected);
  const found = templateId === null || view.owner === null ? undefined : findDashboardCard(view.owner, templateId);
  // 「每本账一组」页里的卡片：数据来自那一组的账本（id 里 @ 后面）。
  const card = found === undefined || inspected === null || inspected === templateId ? found : withCardSource(found, inspected.slice((templateId ?? "").length + 1));
  const scope = useDashboardCardScope(card, fallback);
  if (inspect === null || card === undefined || inspected === null) {
    return <p className="text-helper-relaxed text-muted">{t("desktop.dashboard.inspector.empty")}</p>;
  }
  const subtitle = cardSubtitle(card, scope, t);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-ink">{cardTitle(card, t)}</span>
          {subtitle === "" ? null : <span className="block text-helper text-muted">{subtitle}</span>}
        </span>
        <button type="button" className="lv-desk-link shrink-0" onClick={() => inspect.inspect(null)}>{t("desktop.dashboard.inspector.close")}</button>
      </div>
      <div className="lv-inspector-body" data-amount="">
        {isMultiSlot(card) ? <CompositeDetail card={card} scope={scope} /> : (
          <>
            <CardBody card={card} scope={scope} density="expanded" detail width={340} />
            <SourceEntries card={card} scope={scope} />
          </>
        )}
      </div>
      <button type="button" className="lv-desk-btn self-start" onClick={() => inspect.openFull(inspected)}>{t("desktop.dashboard.inspector.openFull")}</button>
    </div>
  );
}
