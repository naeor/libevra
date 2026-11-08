/** B2 正式材质入口：不加载实验把手、模拟数据或 Motion Lab。其他候选仍由 lab.ts 开启。 */
import "./s19.css";
import { startVisualStyleRuntime } from "../lib/visualStyle.js";
import { startTabIndicator } from "./tabIndicator.js";
import { startTabMotion } from "./tabMotion.js";

export function startB2Appearance(): void {
  startVisualStyleRuntime();
  startTabMotion();
  startTabIndicator();
}
