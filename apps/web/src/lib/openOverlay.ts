/**
 * **“现在有没有弹窗打开”**：转场协调器（`s19/motion/pilot.tsx`）用它决定页面转场是否改为即时切换。
 *
 * 弹出面板模板的根节点都带 `data-overlay-root` 与 `data-overlay-state="open" | "closing"`（1.19.58）。
 * 原来只查 `dialog[open], [role=dialog][aria-modal=true]`，有两个漏洞：
 *
 * - 确认框是 `role="alertdialog"`，不在判断范围内；
 * - 正在收起的面板仍被算作打开：从面板里发起导航（例如账本管理里点“账本设置”）时，面板先播放 200ms
 *   退场再导航，导航那一刻面板还在 DOM 里，转场就被当成“有弹窗”而丢掉（审查中优先级问题）。
 *
 * 现在：模板根节点按开 / 关状态判断，没有模板标记的旧弹层（原生 `<dialog>`、电脑版对话框）继续按原来的属性判断，
 * 并补上 alertdialog；位于正在关闭的弹层里面的节点一律不算。
 */
export const OPEN_OVERLAY_SELECTOR = [
  '[data-overlay-root][data-overlay-state="open"]',
  "dialog[open]",
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
].join(", ");

const CLOSING = '[data-overlay-state="closing"]';

/** 只依赖 querySelectorAll / closest，便于在没有 DOM 的测试里用假节点验证。 */
export interface OverlayQueryRoot {
  querySelectorAll(selector: string): Iterable<{ closest(selector: string): unknown }>;
}

export function hasOpenOverlay(root: OverlayQueryRoot | null = typeof document === "undefined" ? null : document): boolean {
  if (root === null) return false;
  for (const node of root.querySelectorAll(OPEN_OVERLAY_SELECTOR)) {
    if (node.closest(CLOSING) === null && node.closest('[inert], [hidden]') === null) return true;
  }
  return false;
}
