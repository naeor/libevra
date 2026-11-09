import { useSyncExternalStore } from "react";
import { parseVisualStyle, type VisualStyle } from "./visualStyle.js";

/**
 * 当前生效的视觉风格（读 `<html data-visual-style>`，风格切换时重新渲染）。
 *
 * 只给少数需要**换结构**而不只是换材质的地方使用（1.19.51 手动记账顶区：A / B1 / B2 改用明细同款选择栏）。
 * 纯材质差异仍然写在 CSS 里。服务端 / 静态渲染与测试环境返回 Original，即原有结构。
 */
export function useRootVisualStyle(): VisualStyle {
  return useSyncExternalStore(subscribe, snapshot, () => "original");
}

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-visual-style"] });
  return () => observer.disconnect();
}

function snapshot(): VisualStyle {
  return typeof document === "undefined" ? "original" : parseVisualStyle(document.documentElement.dataset.visualStyle ?? null);
}
