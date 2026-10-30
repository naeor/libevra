/**
 * **一个工作区实例自己的路由上下文。**
 *
 * 页面仍然只用 React Router 的 `useNavigate` / `useLocation` / `useSearchParams` / `<Link>`，
 * 不知道自己在哪个工作区——这些钩子读的就是本实例的 `PaneHistory`。两个工作区共用同一套路由表和
 * 页面组件、同一个查询缓存与登录状态；**不是两个应用实例，也没有两个互相竞争地址栏的全局 Router**：
 * 地址栏只由主区实例写入（见 `paneHistory.ts`）。
 *
 * ⚠️ `UNSAFE_LocationContext` 置空是 React Router 允许的嵌套方式：外壳本身有一个绑定主区历史的 Router
 * （同意书门禁、侧栏链接用它），工作区内部的 Router 需要先「离开」那个上下文。
 */
import { startTransition, useLayoutEffect, useState } from "react";
import { NavigationType, Router, UNSAFE_LocationContext } from "react-router";

import type { PaneHistory, PaneSnapshot } from "./paneHistory.js";

export function PaneRouter({
  history,
  nested = false,
  children,
}: {
  readonly history: PaneHistory;
  /** 位于外壳的 Router 之内时为 `true`。 */
  readonly nested?: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<PaneSnapshot>(history.snapshot);

  useLayoutEffect(() => {
    // 订阅之前的变化（同一渲染周期里外壳已经导航过）也要接上。
    setSnapshot(history.snapshot);
    return history.subscribe((next) => {
      startTransition(() => {
        setSnapshot(next);
      });
    });
  }, [history]);

  const navigationType =
    snapshot.action === "PUSH" ? NavigationType.Push : snapshot.action === "REPLACE" ? NavigationType.Replace : NavigationType.Pop;
  const router = (
    <Router location={snapshot.location} navigationType={navigationType} navigator={history}>
      {children}
    </Router>
  );

  if (!nested) return router;
  return <UNSAFE_LocationContext.Provider value={null as never}>{router}</UNSAFE_LocationContext.Provider>;
}
