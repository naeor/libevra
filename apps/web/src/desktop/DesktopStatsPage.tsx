/**
 * **电脑版分析页**：沿用现有分析工作台（统计、图表、卡片配置、布局模板、响应式排列、自定义卡片、
 * 列数专属布局与筛选都不变），只换外框——稳定的桌面工具栏代替绿色大标题，点开的卡片显示在右侧辅助栏，
 * 工作台本身保留在左边，可以继续点别的卡片对照。辅助栏默认收起，给图表留出空间。
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { findDashboardCard } from "./dashboardStore.js";
import { StatsCardDetailPage } from "../pages/StatsCardDetailPage.js";
import { StatsPage } from "../pages/StatsPage.js";
import { DesktopSplit } from "./DesktopSplit.js";
import { dashboardAnalysisCard } from "./dashboardNavigation.js";

export const STATS_CARD_PARAM = "card";

export function DesktopStatsPage(): React.JSX.Element {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const card = params.get(STATS_CARD_PARAM);
  const { user } = useAuth();
  const guest = useGuestIdentity();
  const owner = user !== null ? `user:${user.id}` : guest !== null ? `guest:${guest.id}` : null;
  // 1.19.100：总览上的分析卡片（`dashboardCard`）在这里的右侧辅助栏显示；不写进分析工作台。
  const pinnedId = params.get("dashboardCard");
  const dashboardCard = dashboardAnalysisCard(params.get("dashboardChart")) ?? (pinnedId === null || owner === null ? undefined : findDashboardCard(owner, pinnedId));

  const open = useCallback(
    (cardId: string) => {
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set(STATS_CARD_PARAM, cardId);
        next.delete("dashboardChart");
        next.delete("dashboardCard");
        return next;
      });
    },
    [setParams],
  );
  const close = useCallback(() => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete(STATS_CARD_PARAM);
      next.delete("dashboardChart");
      next.delete("dashboardCard");
      return next;
    });
  }, [setParams]);

  return (
    <DesktopSplit panel={dashboardCard !== undefined ? <StatsCardDetailPage key={dashboardCard.objectId} cardOverride={dashboardCard} /> : card === null ? null : <StatsCardDetailPage key={card} objectId={card} />} panelLabel={t("desktop.stats.panel")} onClosePanel={close}>
      <StatsPage onOpenCard={open} />
    </DesktopSplit>
  );
}
