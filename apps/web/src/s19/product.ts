/**
 * 四风格正式材质入口：不加载实验把手、模拟数据或 Motion Lab。保留旧导出名减少接线改动。
 * 1.19.49：A / B1 / C 成为正式风格后，它们的页面转场运行时（ABC presentation、A 底栏）也必须随正式构建启动；
 * 原来只有开发 / 测试构建的 lab.ts 启动它，正式构建里 A / B1 / C 没有任何 S19 转场。
 */
import "./s19.css";
import { startVisualStyleRuntime } from "../lib/visualStyle.js";
import { startTabIndicator } from "./tabIndicator.js";
import { startTabMotion } from "./tabMotion.js";
import { startWallpaperEdges } from "./wallpaperEdges.js";
import { startABCRuntime } from "./motion/abcRuntime.js";

export function startB2Appearance(): void {
  startVisualStyleRuntime();
  startWallpaperEdges();
  startTabMotion();
  startTabIndicator();
  startABCRuntime();
}
