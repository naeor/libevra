/**
 * **跟随模式的路由规则（纯函数）。**
 *
 * 跟随模式只接管**适合跨工作区打开的页面层级导航**：在主区的列表里点开一项，详情出现在辅助区，
 * 主区保留列表。它不拦截所有点击——滚动、筛选（`replace`）、展开菜单、文字输入、切换主导航目的地
 * 都不会改变辅助区；这里只认「列表 → 下级详情」这几种 push。
 */

const TRANSACTION = /^\/transactions\/[^/]+$/;
const STATS_CARD = /^\/stats\/cards\/[^/]+$/;
const BOOK = /^\/books\/[^/]+$/;
const ANNOUNCEMENT = /^\/update\/announcements\/[^/]+$/;

/** 只有显式单区才自动展开；空间不足而暂隐的双区、双区独立模式均保持原意图。 */
export function followTargetFor(
  view: { readonly canSplit: boolean; readonly splitVisible: boolean; readonly secondaryOpen: boolean; readonly mode: "follow" | "independent" },
  from: string,
  to: string,
): "open-secondary" | "secondary" | null {
  if (!view.canSplit || !followsToSecondary(from, to)) return null;
  if (view.splitVisible) return view.mode === "follow" ? "secondary" : null;
  return view.secondaryOpen ? null : "open-secondary";
}

/** 主区从 `from` push 到 `to` 时，跟随模式下是否改在辅助区打开。 */
export function followsToSecondary(from: string, to: string): boolean {
  if (from === to) return false;
  if (TRANSACTION.test(to)) return !TRANSACTION.test(from);
  if (STATS_CARD.test(to)) return from === "/stats";
  if (BOOK.test(to)) return from === "/start" || from === "/ledger";
  if (ANNOUNCEMENT.test(to)) return from === "/update/announcements";
  return false;
}

/** 辅助区当前显示的是否是一页「跟随打开的详情」（下一次跟随替换它，而不是越叠越深）。 */
export function isFollowDetail(pathname: string): boolean {
  return TRANSACTION.test(pathname) || STATS_CARD.test(pathname) || BOOK.test(pathname) || ANNOUNCEMENT.test(pathname);
}

/** 主导航目的地（侧栏高亮、辅助区导航、拖入辅助区都用同一份）。 */
export type Destination = "entries" | "insights" | "ledger" | "me";

export function destinationOf(pathname: string): Destination | null {
  if (pathname === "/" || pathname.startsWith("/transactions/")) return "entries";
  if (pathname === "/stats" || pathname.startsWith("/stats/")) return "insights";
  if (
    pathname === "/ledger" ||
    pathname.startsWith("/ledger/") ||
    pathname === "/start" ||
    pathname.startsWith("/start/") ||
    pathname.startsWith("/books")
  ) {
    return "ledger";
  }
  if (
    pathname === "/me" ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/update") ||
    pathname.startsWith("/downloads") ||
    pathname === "/about" ||
    pathname.startsWith("/admin")
  ) {
    return "me";
  }
  return null;
}

/** 不显示工作区外壳（侧栏 / 辅助区）的页面：登录、注册、找回、公开法律文本与分享链接。 */
export function isStandalonePath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/recover" ||
    pathname === "/recover-archive" ||
    pathname === "/guest" ||
    pathname.startsWith("/join/") ||
    (pathname.startsWith("/legal/") && pathname !== "/legal/privacy" && pathname !== "/legal/terms")
  );
}
