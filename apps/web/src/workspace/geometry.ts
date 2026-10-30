/**
 * **S18 多工作区的几何（纯函数）。**
 *
 * 只回答「在这块可用区域里，侧栏 / 主区 / 辅助区 / 分界线各占哪里」。页面内部的排版不在这里决定——
 * 页面按**自己所在工作区的实际尺寸**响应（容器查询与 `usePaneSize`），而不是按整个窗口。
 *
 * ⚠️ 这里的像素是 CSS px 的**初始设计参数**（所有者 2026-10-30 规格：侧栏完整约 200–260、紧凑约
 * 52–72；双区 55:45；正常调整 30%–70%），可以随真机体验再调，但不按设备型号分支。
 */
import type { RailPreference } from "./model.js";

export type ShellMode = "phone" | "wide";
export type Orientation = "landscape" | "portrait";
export type CollapseSide = "primary" | "secondary" | null;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 完整侧栏宽度。 */
export const RAIL_FULL = 232;
/** 紧凑侧栏宽度（图标 + 触控目标）。 */
export const RAIL_COMPACT = 68;
/** 两个工作区之间的分界区（含拖动把手）。 */
export const GUTTER = 12;
/** 双区时工作区与外缘之间的留白（工作区呈圆角窗口）。单区时为 0，内容贴满。 */
export const SPLIT_MARGIN = 6;
/** 一个工作区仍可操作的最小宽 / 高（不足时双区让位为单区，辅助区保留可恢复）。 */
export const MIN_PANE_WIDTH = 320;
export const MIN_PANE_HEIGHT = 240;

/** 进入大屏外壳的窗口下限：小于它保持现有手机界面（底部导航）。 */
export const WIDE_MIN_WIDTH = 700;
export const WIDE_MIN_HEIGHT = 520;

export const NORMAL_MIN = 0.3;
export const NORMAL_MAX = 0.7;
/** 越过正常范围多少才进入「松手收起」预览；反向回到正常范围即取消（迟滞，避免临界点闪动）。 */
export const COLLAPSE_ARM = 0.035;

export function shellModeFor(width: number, height: number): ShellMode {
  return width >= WIDE_MIN_WIDTH && height >= WIDE_MIN_HEIGHT ? "wide" : "phone";
}

export function orientationFor(width: number, height: number): Orientation {
  return width >= height ? "landscape" : "portrait";
}

export function railWidthFor(preference: RailPreference, split: boolean): number {
  if (preference === "expanded") return RAIL_FULL;
  if (preference === "collapsed") return RAIL_COMPACT;
  return split ? RAIL_COMPACT : RAIL_FULL;
}

/** 双区在这块区域里是否放得下两个可操作的工作区。 */
export function splitFits(area: { readonly w: number; readonly h: number }, orientation: Orientation): boolean {
  if (orientation === "landscape") return splitAvailable(area, orientation) >= MIN_PANE_WIDTH * 2;
  return splitAvailable(area, orientation) >= MIN_PANE_HEIGHT * 2 && area.w - SPLIT_MARGIN * 2 >= MIN_PANE_WIDTH;
}

/** 双区时主区占比的可用范围：30%–70%，并且两侧都不小于最小可操作尺寸。 */
export function ratioLimits(available: number, orientation: Orientation): { readonly min: number; readonly max: number } {
  const minPx = orientation === "landscape" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  if (available <= 0) return { min: NORMAL_MIN, max: NORMAL_MAX };
  const byPixels = minPx / available;
  const min = Math.min(0.5, Math.max(NORMAL_MIN, byPixels));
  const max = Math.max(0.5, Math.min(NORMAL_MAX, 1 - byPixels));
  return { min, max };
}

/**
 * 分界线方向上的可用长度（扣除外缘留白与分界区）。
 *
 * 第二轮：辅助区右侧的常驻功能区已移除（导航改为辅助区内部右下角的按钮），辅助区一直延伸到外缘留白。
 */
export function splitAvailable(area: { readonly w: number; readonly h: number }, orientation: Orientation): number {
  return orientation === "landscape" ? area.w - SPLIT_MARGIN * 2 - GUTTER : area.h - SPLIT_MARGIN * 2 - GUTTER;
}

export interface PaneLayout {
  readonly primary: Rect;
  readonly secondary: Rect | null;
  readonly divider: Rect | null;
}

export function layoutPanes(
  area: { readonly w: number; readonly h: number },
  orientation: Orientation,
  split: boolean,
  ratio: number,
): PaneLayout {
  const w = Math.max(0, area.w);
  const h = Math.max(0, area.h);
  if (!split) return { primary: { x: 0, y: 0, w, h }, secondary: null, divider: null };

  const available = splitAvailable({ w, h }, orientation);
  const limits = ratioLimits(available, orientation);
  const share = Math.min(limits.max, Math.max(limits.min, ratio));
  const first = Math.round(available * share);
  const m = SPLIT_MARGIN;

  if (orientation === "landscape") {
    return {
      primary: { x: m, y: m, w: first, h: h - m * 2 },
      divider: { x: m + first, y: 0, w: GUTTER, h },
      secondary: { x: m + first + GUTTER, y: m, w: available - first, h: h - m * 2 },
    };
  }
  const top = m + first + GUTTER;
  return {
    primary: { x: m, y: m, w: w - m * 2, h: first },
    divider: { x: 0, y: m + first, w, h: GUTTER },
    secondary: { x: m, y: top, w: w - m * 2, h: h - m - top },
  };
}

/**
 * 拖动时：指针位置换算出的「原始比例」→ 显示比例与是否进入收起预览。
 *
 * - 正常范围内，分界线完全跟手；
 * - 越过 30% / 70%（或最小尺寸）之后带阻尼地继续跟随，越过 `COLLAPSE_ARM` 进入收起预览；
 * - 已在收起预览中时，只有回到正常范围之内才取消（迟滞）。
 */
export function dragState(
  raw: number,
  limits: { readonly min: number; readonly max: number },
  previous: CollapseSide,
): { readonly display: number; readonly collapse: CollapseSide } {
  let collapse: CollapseSide = previous;
  if (previous === "primary" && raw > limits.min) collapse = null;
  if (previous === "secondary" && raw < limits.max) collapse = null;
  if (collapse === null) {
    if (raw < limits.min - COLLAPSE_ARM) collapse = "primary";
    else if (raw > limits.max + COLLAPSE_ARM) collapse = "secondary";
  }

  let display = raw;
  if (raw < limits.min) display = limits.min - (limits.min - raw) * 0.55;
  if (raw > limits.max) display = limits.max + (raw - limits.max) * 0.55;
  display = Math.min(0.94, Math.max(0.06, display));
  return { display, collapse };
}

/** 键盘调整分界线：每次 5%，Home / End 到两端。 */
export function keyboardRatio(current: number, key: string, limits: { readonly min: number; readonly max: number }): number | null {
  const step = 0.05;
  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(limits.min, current - step);
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(limits.max, current + step);
    case "Home":
      return limits.min;
    case "End":
      return limits.max;
    default:
      return null;
  }
}
