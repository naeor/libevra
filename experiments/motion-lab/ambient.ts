/** Lab 只传示例选择器；正式模块不依赖 experiments。 */
import { describeLayout, layoutBackground as background, type AmbientLayout } from "../../apps/web/src/s19/motion/ambientLayout.js";
export { MAX_AMBIENT_SHAPES, type AmbientLayout, type AmbientShape } from "../../apps/web/src/s19/motion/ambientLayout.js";
export function describePlane(plane: HTMLElement): AmbientLayout {
  return describeLayout(plane, { selectors: ".ml-card, .ml-avatar, .ml-bars i, .ml-plus", cardSelector: ".ml-card", scrollSelector: ".ml-scroll" });
}
export function layoutBackground(layout: AmbientLayout | undefined, visibility: number, blur: number, retreat: boolean): string | null {
  return background(layout, visibility, blur, retreat, "rgb(61 91 76)");
}
