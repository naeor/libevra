/**
 * 「固定到总览」（1.19.100，电脑版）：分析卡片详情里把这张卡片复制一份放到总览末尾，数据固定来自现在看的这本账。
 * 只在电脑版外壳里出现；手机与平板不显示。
 */
import { useState } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n/index.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { useBooks, useCurrentBookId } from "../lib/queries.js";
import { pinCardToDashboard, readDashboardSettings, scopeBooks } from "./dashboardStore.js";
import { useDesktopActive } from "./surface.js";

export function PinToDashboard({ card, bookId }: { readonly card: AnalysisCardNode; readonly bookId: string | null }): React.JSX.Element | null {
  const { t } = useI18n();
  const desktop = useDesktopActive();
  const { user } = useAuth();
  const guest = useGuestIdentity();
  const books = useBooks();
  const currentBookId = useCurrentBookId();
  const [status, setStatus] = useState<"idle" | "done" | "failed">("idle");
  const owner = user !== null ? `user:${user.id}` : guest !== null ? `guest:${guest.id}` : null;
  if (!desktop || owner === null || books.data === undefined) return null;
  const all = books.data.books.filter((book) => guest === null || book.id === currentBookId).map((book) => book.id);
  const scoped = scopeBooks(readDashboardSettings(owner), all);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="lv-desk-btn"
        disabled={status === "done"}
        onClick={() => setStatus(pinCardToDashboard(owner, card, bookId, scoped, all) ? "done" : "failed")}
      >
        {status === "done" ? t("desktop.dashboard.pin.done") : t("desktop.dashboard.pin.action")}
      </button>
      {status === "failed" ? <span role="status" className="text-helper text-danger">{t("desktop.dashboard.pin.failed")}</span> : null}
      {status === "done" ? <span role="status" className="text-helper text-muted">{t("desktop.dashboard.pin.hint")}</span> : null}
    </div>
  );
}
