/**
 * **Libevra 电脑版外壳。**
 *
 * 与平板的多工作区外壳（`WorkspaceShell`）并列、互不依赖：一个浏览器路由（地址栏、后退前进与刷新照常），
 * 左侧固定窄导航，右侧是主展示区；页面需要时再在主展示区右边打开情境辅助栏（`DesktopSplit`）。
 * 共用同一份查询缓存、登录状态、离线队列与撤销条——这些都挂在外壳之外。
 */
import { useEffect, useMemo, useRef } from "react";
import { BrowserRouter, useLocation } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { useGuestIdentity } from "../lib/guest/session.js";
import { PaneContext, PaneSizeContext, PaneSizeStore, type PaneInfo } from "../workspace/context.js";
import { isStandalonePath } from "../workspace/follow.js";
import "../workspace/workspace.css";
import { DesktopNav } from "./DesktopNav.js";
import { DesktopActiveProvider, DesktopSurfaceProvider } from "./surface.js";
import "./desktop.css";

/** 页面读到的工作区信息：电脑版只有一个「主区」，没有底部导航。 */
const DESKTOP_PANE: PaneInfo = { instance: "w1", role: "primary", shell: "wide", nav: "rail", split: "none", visible: true };

export function DesktopShell({
  renderRoutes,
  wrapChrome,
}: {
  readonly renderRoutes: () => React.ReactNode;
  readonly wrapChrome: (children: React.ReactNode) => React.ReactNode;
}): React.JSX.Element {
  return (
    <BrowserRouter>
      <PaneContext.Provider value={DESKTOP_PANE}>
        <DesktopActiveProvider>{wrapChrome(<DesktopFrame>{renderRoutes()}</DesktopFrame>)}</DesktopActiveProvider>
      </PaneContext.Provider>
    </BrowserRouter>
  );
}

function DesktopFrame({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation();
  const { user, status } = useAuth();
  const guest = useGuestIdentity();
  const hasSession = status === "ready" && (user !== null || guest !== null);
  const chrome = hasSession && !isStandalonePath(pathname);
  const size = useMemo(() => new PaneSizeStore(), []);
  const content = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.shell = "desktop";
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, []);

  useEffect(() => {
    const element = content.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) size.set(box.width, box.height);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [chrome, size]);

  if (!chrome) return <>{children}</>;

  return (
    <div className="lv-desktop">
      <DesktopNav />
      <div ref={content} className="lv-desktop-content">
        <PaneSizeContext.Provider value={size}>
          <DesktopSurfaceProvider surface="main">{children}</DesktopSurfaceProvider>
        </PaneSizeContext.Provider>
      </div>
    </div>
  );
}
