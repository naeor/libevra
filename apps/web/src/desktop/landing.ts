/**
 * 电脑版的落地页：**这个浏览器标签第一次打开应用**或**刚登录进来**时，根路径先到总览；
 * 其它时候根路径就是明细——在应用里回到 `/`、在明细页刷新、在明细页切换账本（整页重新载入）都留在明细。
 *
 * 「这个标签打开过」记在 `sessionStorage`：刷新与整页载入保留，新标签页或重新打开浏览器时清空。
 */
const TAB_KEY = "libevra.desktop.tab:v1";

export function shouldLandOnDashboard(input: {
  /** 上一个地址；这次挂载后的第一次渲染为 `null`。 */
  readonly previous: string | null;
  readonly previousStandalone: boolean;
  readonly pathname: string;
  readonly search: string;
  readonly tabVisited: boolean;
}): boolean {
  if (input.pathname !== "/" || input.search !== "") return false;
  if (input.previous === null) return !input.tabVisited;
  return input.previousStandalone;
}

export function readTabVisited(): boolean {
  try {
    return window.sessionStorage.getItem(TAB_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTabVisited(): void {
  try {
    window.sessionStorage.setItem(TAB_KEY, "1");
  } catch {
    // 存不下只是刷新时回到总览。
  }
}
