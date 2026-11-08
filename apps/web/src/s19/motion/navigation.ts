/** 页面层级与动效语义分别判断；对象展开还必须有有效来源几何。 */
export type NavigationLevel = "tabRoot" | "enterMode" | "subpage";
const tabs = new Set(["/", "/stats", "/ledger", "/me"]);
const modes = new Set(["/paste", "/record", "/add", "/scan", "/import"]);
export function navigationLevel(pathname: string): NavigationLevel {
  return tabs.has(pathname) ? "tabRoot" : modes.has(pathname) ? "enterMode" : "subpage";
}

export function isSettingsMotionPage(pathname: string): boolean {
  return ["/me", "/settings", "/settings/appearance/language", "/settings/appearance/theme", "/profile", "/downloads", "/update"].includes(pathname)
    || /^\/books\/[^/]+$/.test(pathname);
}

/** 只补现有「我的」入口；不把任意同前缀 URL 视作父子关系。 */
export function isSettingsMotionEdge(from: string, to: string): boolean {
  return from === "/me" && (["/settings", "/profile", "/downloads", "/update"].includes(to) || /^\/books\/[^/]+$/.test(to))
    || from === "/settings" && ["/settings/appearance/language", "/settings/appearance/theme"].includes(to);
}
