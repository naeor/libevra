/**
 * **共享页面框架的桌面呈现**（`TabPage`、`InnerPage`、`TabPageHeader`、`StickyActionBar` 在电脑版外壳里
 * 改用这里）。页面的业务内容不变，只换外框：
 *
 * - 没有手机的返回栏、绿色大标题、底部导航与安全区留白；
 * - 顶部是稳定的桌面工具栏（滚动时不收缩）；
 * - 内容宽度按桌面规则：说明与表单保持舒适行宽，列表与图表利用更宽的空间。
 */
import { useCallback } from "react";

import type { InnerPageProps, TabPageProps } from "../components/Layouts.js";
import { GuestModeBadge } from "../components/GuestModeBadge.js";
import { ChevronIcon } from "../components/Icons.js";
import { OfflineStatus } from "../components/OfflineStatus.js";
import { SyncBanner } from "../components/SyncBanner.js";
import { useI18n } from "../i18n/index.js";
import { useGoBack } from "../lib/connectivity.js";
import { XIcon } from "../workspace/icons.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { useDesktopSurface, type DesktopSurface } from "./surface.js";

const DESK_MAX = {
  reading: "max-w-[46rem]",
  content: "max-w-[68rem]",
  full: "max-w-none",
} as const;

function useSurface(): DesktopSurface {
  return useDesktopSurface() ?? { surface: "main", bar: "toolbar" };
}

export function DesktopTabPage({ children, className = "", scrollRef, rootRef, rootClassName = "", bottom, wideWidth = "content" }: TabPageProps): React.JSX.Element {
  return (
    <div ref={rootRef} {...(bottom === undefined ? {} : { "data-workbench-frame": "" })} className={`lv-desk-tabpage relative flex h-full min-h-0 flex-col overflow-hidden ${rootClassName}`}>
      <SyncBanner />
      <OfflineStatus />
      <div ref={scrollRef} className="lv-desk-scroll flex-1 overflow-y-auto overscroll-contain">
        <div className={`mx-auto flex w-full ${DESK_MAX[wideWidth]} flex-col ${bottom === undefined ? "pb-10" : "pb-24"} ${className}`}>{children}</div>
      </div>
      {bottom === undefined ? null : <div className="pointer-events-none absolute inset-x-4 bottom-4 z-30 [&>*]:pointer-events-auto">{bottom}</div>}
    </div>
  );
}

export function DesktopInnerPage({ title, subtitle, backTo = "/", backMode = "history", onBack, actions, children, wideWidth = "reading" }: InnerPageProps): React.JSX.Element {
  const { t } = useI18n();
  const surface = useSurface();
  const goBack = useGoBack(backTo, backMode);
  const back = useCallback(() => {
    (surface.onBack ?? onBack ?? goBack)();
  }, [surface.onBack, onBack, goBack]);

  if (surface.surface === "panel") {
    return (
      <div className="lv-desk-panel-page flex min-h-full flex-col">
        <div className="lv-desk-panel-bar">
          {surface.onBack === undefined ? null : (
            <button type="button" className="lv-desk-icon-btn -ml-1.5" onClick={surface.onBack} aria-label={t("desktop.page.back")}>
              <ChevronIcon direction="left" className="size-4" />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-section-title text-ink">{title}</h2>
          {actions === undefined || actions === null ? null : <div className="flex shrink-0 items-center gap-1">{actions}</div>}
          {surface.onClose === undefined ? null : (
            <button type="button" className="lv-desk-icon-btn -mr-1.5" onClick={surface.onClose} aria-label={t("desktop.panel.close")}>
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        <div className="lv-desk-panel-body">
          {subtitle ? <p className="text-helper-relaxed text-muted">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="lv-desk-page flex min-h-full flex-col">
      <OfflineStatus />
      {surface.bar === "toolbar" ? (
        <div className="lv-desk-sticky">
          <SyncBanner />
          <DesktopToolbar title={<span className="inline-flex items-center gap-2">{title}<GuestModeBadge /></span>} onBack={back} actions={actions} />
        </div>
      ) : (
        <SyncBanner />
      )}
      <main className={`lv-desk-main mx-auto flex w-full ${DESK_MAX[wideWidth]} flex-1 flex-col gap-6`}>
        {surface.bar === "heading" ? (
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-page-title text-ink">
                {title}
                <GuestModeBadge />
              </h1>
              {subtitle ? <p className="mt-1 text-body-relaxed text-muted">{subtitle}</p> : null}
            </div>
            {actions === undefined || actions === null ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
        ) : null}
        {surface.bar === "none" && actions !== undefined && actions !== null ? <div className="flex justify-end gap-2">{actions}</div> : null}
        {surface.bar !== "heading" && subtitle ? <p className="text-body-relaxed text-muted">{subtitle}</p> : null}
        {children}
      </main>
    </div>
  );
}

/** `TabPageHeader` 的桌面呈现：没有绿色背景、不随滚动收缩。 */
export function DesktopTabHeader({ title, subtitle, action }: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  const surface = useSurface();
  if (surface.bar === "none") {
    return action === undefined || action === null ? <></> : <div className="lv-desk-tabheader-actions flex justify-end gap-2 px-8 pt-4">{action}</div>;
  }
  return (
    <div className="lv-desk-tabheader">
      <DesktopToolbar
        title={<span className="inline-flex items-center gap-2">{title}<GuestModeBadge /></span>}
        meta={subtitle}
        actions={action === undefined || action === null ? undefined : <div className="lv-desk-tabheader-actions flex items-center gap-2">{action}</div>}
      />
    </div>
  );
}

/** `StickyActionBar` 的桌面呈现：贴在内容底边，左右与内容对齐，没有安全区留白。 */
export function DesktopActionBar({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div data-lv-bottom-bar="" className="lv-desk-actionbar">{children}</div>;
}
