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

/**
 * **S19 浅色**：任何 S19 风格（A / B1 / B2 / C）且浅色主题。只给需要按“S19 浅色手机端”换**结构**的地方用（1.19.78 记账工作区：
 * 隐藏底栏、换成工作区顶栏）；Original 与深色保持原结构。服务端 / 测试环境返回 false。
 */
export function useS19Light(): boolean {
  return useSyncExternalStore(subscribeBoth, s19LightSnapshot, () => false);
}

function subscribeBoth(onChange: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-visual-style", "data-theme-mode"] });
  return () => observer.disconnect();
}

function s19LightSnapshot(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  return parseVisualStyle(root.dataset.visualStyle ?? null) !== "original" && root.dataset.themeMode === "light";
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
