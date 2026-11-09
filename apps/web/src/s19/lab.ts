/**
 * S19 风格实验的入口：只在 `STYLE_LAB_ENABLED` 为真时由 `main.tsx` 动态加载。
 *
 * 1. 载入四套风格的样式表（都限定在 `:root[data-visual-style]` + 手机外壳之下，Original 时一条也不命中）；
 * 2. 启动风格开关（读取上次的选择或 `?s19=` 参数，写 `<html data-visual-style>`）；
 * 3. 右侧的小切换把手（单独的 React 根，不进入应用的组件树，不影响应用状态）**默认不显示**（1.19.49）：
 *    正式的风格切换在“设置 → 外观 → 视觉风格”。调试时在地址后加 `?s19lab=1` 打开（本标签页内保持，
 *    之后的页面切换与刷新都在），`?s19lab=0` 关闭。
 * 4. 启动 B1 / B2 底栏的选中玻璃胶囊与两套动效（tabIndicator.ts / tabMotion.ts）。
 *
 * 首次渲染之前等这里完成，所以带着已选风格刷新页面时不会先闪一下 Original。
 */
import "./s19.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { startVisualStyleRuntime } from "../lib/visualStyle.js";
import { StyleLabDock } from "./StyleLabDock.js";
import { wantsStyleLabDock } from "./labDock.js";
import { startTabIndicator } from "./tabIndicator.js";
import { startTabMotion } from "./tabMotion.js";
import { startABCRuntime } from "./motion/abcRuntime.js";

export function startStyleLab(): void {
  const controller = startVisualStyleRuntime();
  startTabMotion();
  startTabIndicator();
  startABCRuntime();
  let storage: Storage | null = null;
  try { storage = sessionStorage; } catch { storage = null; }
  if (!wantsStyleLabDock(location.search, storage)) return;
  if (document.getElementById("s19-style-lab")) return;
  const host = document.createElement("div");
  host.id = "s19-style-lab";
  document.body.appendChild(host);
  createRoot(host).render(createElement(StyleLabDock, { controller }));
}
