import type { MotionOptions } from "./backdrop.js";
import { normalizeGlassBlur } from "../material.js";

/** 只配置原生快照叠层；不创建 DOM、历史或长期图像资源。 */
export function prepareHybrid(root: HTMLElement, options: MotionOptions, ambient: string): (() => void) | null {
  if (options.scheme !== "hybrid" || options.material !== "b2" || !options.handoff) return null;
  root.dataset.motionHybrid = "true";
  root.style.setProperty("--motion-hybrid-ambient", ambient);
  // 低模糊时弱化旧文字，绝不偷偷抬高用户选择的模糊半径。
  const contrast = .42 + .14 * Math.min(normalizeGlassBlur(options.blurStrength) / 65, 1);
  root.style.setProperty("--motion-hybrid-contrast", contrast.toFixed(3));
  return () => {
    delete root.dataset.motionHybrid;
    root.style.removeProperty("--motion-hybrid-ambient");
    root.style.removeProperty("--motion-hybrid-contrast");
  };
}
