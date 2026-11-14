import { NAVIGATION, TAB_SWITCH } from "../../lib/motionTokens.js";
import { hasOpenOverlay } from "../../lib/openOverlay.js";
import type { PaneSnapshot } from "../../workspace/paneHistory.js";
import { isReturnToTab, isTabSwitch } from "./navigation.js";

/** Pad 只呈现提交后的真实页面，保持另一区、临时区及滚动容器静止；不采集全屏图像。 */
export function animatePadNavigation(instance: string, from: PaneSnapshot, to: PaneSnapshot): Animation[] {
  if (from.location.pathname === to.location.pathname || document.hidden ||
      document.documentElement.dataset.themeMode !== "light" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
  const style = document.documentElement.dataset.visualStyle;
  if (style !== "a" && style !== "b1" && style !== "b2" && style !== "c") return [];
  const root = document.querySelector<HTMLElement>(`.lv-pane[data-mode="box"][data-instance="${instance}"] > .lv-pane-scroll`);
  if (!root || root.closest("[inert]") || hasOpenOverlay(root) || document.querySelector("[data-pad-modal-layer]")) return [];
  const back = (to.action === "POP" && from.index >= to.index) || isReturnToTab(from.location.pathname, to.location.pathname);
  const tab = isTabSwitch(from.location.pathname, to.location.pathname);
  const config = tab ? TAB_SWITCH : NAVIGATION[style === "a" ? "b1" : style];
  const distance = Math.min(tab ? 42 : 30, root.clientWidth * .055) * (back ? -1 : 1);
  const frames = [
    { opacity: .76, transform: `translateX(${distance}px)` },
    { opacity: 1, transform: "translateX(0)" },
  ];
  return Array.from(root.children).filter((page): page is HTMLElement =>
    page instanceof HTMLElement && page.getClientRects().length > 0 && !page.matches("[data-overlay-root], [data-persistent-nav]"))
    .map(page => page.animate(frames, { duration: config.duration, easing: config.easing }));
}
