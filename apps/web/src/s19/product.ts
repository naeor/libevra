/** 四风格正式材质入口：不加载实验把手、模拟数据或 Motion Lab。保留旧导出名减少接线改动。 */
import "./s19.css";
import { startVisualStyleRuntime } from "../lib/visualStyle.js";
import { startTabIndicator } from "./tabIndicator.js";
import { startTabMotion } from "./tabMotion.js";
import { startWallpaperEdges } from "./wallpaperEdges.js";

export function startB2Appearance(): void {
  startVisualStyleRuntime();
  startWallpaperEdges();
  startTabMotion();
  startTabIndicator();
}
