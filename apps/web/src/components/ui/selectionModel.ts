/**
 * 选中指示与已选条件标签的纯逻辑（1.19.62，规格 S19 §3「选中指示」「条件标签」）：风格判断、会移动的选中块的关键帧、
 * 条件标签的出现 / 删除状态与删除后的焦点去向。组件在 `SelectionControls.tsx`，外观在 `selection-controls.css`。
 *
 * 四种风格是同一个“模型”——会移动的选中、网格选中、条件标签出现与消失——区别只在外观与动效性格：
 * B1 / B2 弹性玻璃（与底栏选中胶囊同一套参数）、A 选中项自己浮起（A2 档，纯 CSS）、C 实底干脆滑动。
 * Original、深色、Pad 与电脑版（没有 S19 作用域标记）回落基础外观。
 */
import { SELECTION_GLIDE, SELECTION_SLIDE, selectionGlideDuration, selectionSlideDuration } from "../../lib/motionTokens.js";
import { S19_SCOPE_SELECTOR } from "../../s19/scope.js";
import type { SelectionBox } from "./selectionMotion.js";

export type SelectionStyle = "a" | "b1" | "b2" | "c";
export type SelectionAxis = "x" | "y";
/** 选中块怎么移动：glide = B1 / B2 弹性玻璃；slide = C 干脆滑动；base = 基础外观里原来的滑动胶囊（共享分段控件、SlidingSelection）；none = 不移动。 */
export type SelectionMotion = "glide" | "slide" | "base" | "none";
/**
 * 基础外观（Original、深色、Pad、电脑版）里怎么表示选中：
 * - static：不显示选中块，选中项保持调用方自己的选中样式（筛选面板、外观页明暗三选一）；
 * - slide：显示一块原滑动胶囊，外观由调用方的样式给出（共享分段控件 `SegmentedControl`）；
 * - copy：显示一块原滑动胶囊，外观逐项从选中按钮的计算样式复制（1.19.67，`SlidingSelection` 的六个使用方：
 *   各自的选中样式写在自己的类名里，品牌实底、白胶囊、浅底都有）。
 * 两种滑动都用原来的 200ms 节奏（`selectionMotion.ts`）。S19 浅色手机外壳里三者一样，按风格画选中块或浮起。
 */
export type SelectionBase = "static" | "slide" | "copy";

/** 当前生效的 S19 风格；不在 S19 作用域、深色或 Original 时为 null（与组件动效 `componentMotion` 同一判断）。 */
export function selectionStyle(root: { readonly dataset: DOMStringMap }, inScope: boolean): SelectionStyle | null {
  if (!inScope || root.dataset.themeMode !== "light") return null;
  const style = root.dataset.visualStyle;
  return style === "a" || style === "b1" || style === "b2" || style === "c" ? style : null;
}

export function selectionStyleOf(element: Element): SelectionStyle | null {
  return selectionStyle(document.documentElement, element.closest(S19_SCOPE_SELECTOR) !== null);
}

/** A 不移动色块（选中项自己浮起，CSS 负责）；基础外观只有声明了原滑动胶囊（slide / copy）的调用方才移动。 */
export function selectionMotion(style: SelectionStyle | null, base: SelectionBase, reduced: boolean): SelectionMotion {
  if (reduced) return "none";
  if (style === "b1" || style === "b2") return "glide";
  if (style === "c") return "slide";
  if (style === "a") return "none";
  return base === "static" ? "none" : "base";
}

const pos = (box: SelectionBox, axis: SelectionAxis): number => (axis === "x" ? box.x : box.y);
const len = (box: SelectionBox, axis: SelectionAxis): number => (axis === "x" ? box.width : box.height);

function frame(box: SelectionBox, axis: SelectionAxis, p: number, l: number, easing?: string): Keyframe {
  return {
    transform: axis === "x" ? `translate3d(${p}px, ${box.y}px, 0)` : `translate3d(${box.x}px, ${p}px, 0)`,
    width: `${axis === "x" ? l : box.width}px`,
    height: `${axis === "y" ? l : box.height}px`,
    ...(easing === undefined ? {} : { easing }),
  };
}

/**
 * B1 / B2：与底栏选中胶囊同一套形变规则（Motion Token `SELECTION_GLIDE`）。沿 `axis` 的前缘先走、到点越过再回弹；
 * 另一个方向的位置与尺寸直接取目标值。`from` 可以是动画途中的位置（被打断时接着走）。
 */
export function glideFrames(from: SelectionBox, to: SelectionBox, axis: SelectionAxis): { frames: Keyframe[]; duration: number } {
  const { maxStretch, stretchPerPx, lead, overshoot, rebound, overStretch, offsets, easing } = SELECTION_GLIDE;
  const fromC = pos(from, axis) + len(from, axis) / 2, toC = pos(to, axis) + len(to, axis) / 2, d = toC - fromC;
  const dir = d >= 0 ? 1 : -1, dist = Math.abs(d), size = len(to, axis);
  const s = Math.min(size * maxStretch, dist * stretchPerPx), over = Math.min(overshoot.max, overshoot.base + dist * overshoot.perPx);
  const at = (offset: number, c: number, stretch: number, curve?: string): Keyframe => ({
    offset, ...frame(to, axis, dir > 0 ? c - size / 2 - stretch * (1 - lead) : c - size / 2 - stretch * lead, size + stretch, curve),
  });
  // 起点完全是来时的位置与尺寸（可能是动画途中），之后的帧在另一个方向上直接取目标值，终点精确贴合目标。
  const start: Keyframe = { offset: 0, transform: `translate3d(${from.x}px, ${from.y}px, 0)`, width: `${from.width}px`, height: `${from.height}px`, easing: easing.depart };
  return {
    duration: selectionGlideDuration(dist),
    frames: [
      start,
      at(offsets.stretch, fromC + d * 0.5, s, easing.stretch),
      at(offsets.over, toC + dir * over, s * overStretch, easing.over),
      at(offsets.rebound, toC - dir * over * rebound, 0, easing.rebound),
      at(1, toC, 0),
    ],
  };
}

/** C：整块实底干脆滑到新选项，不拉伸、不越界（Motion Token `SELECTION_SLIDE`）。 */
export function slideFrames(from: SelectionBox, to: SelectionBox, axis: SelectionAxis): { frames: Keyframe[]; duration: number } {
  const key = (box: SelectionBox): Keyframe => ({ transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: `${box.width}px`, height: `${box.height}px` });
  return { duration: selectionSlideDuration(Math.abs(pos(to, axis) - pos(from, axis))), frames: [{ ...key(from), easing: SELECTION_SLIDE.easing }, key(to)] };
}

/* ---------------- 已选条件标签 ---------------- */

export interface ConditionTagItem {
  /** 稳定的键（同一个条件前后两次渲染相同）。 */
  readonly key: string;
  /** 标签上显示的文字。 */
  readonly label: string;
  /** 删除按钮的可访问名称（例如“清除时间条件”）。 */
  readonly removeLabel: string;
  /** 悬停提示（文字被省略时看全文）。 */
  readonly title?: string;
}

/** in：刚出现（轻微放大淡入）；rest：静止；out：已被删除、正在缩小淡出，结束后移除。 */
export type ConditionTagState = "in" | "rest" | "out";
export interface ConditionTagEntry { readonly item: ConditionTagItem; readonly state: ConditionTagState }

/**
 * 新的条件列表与正在显示的标签对齐：已有的保持（文字可能更新）；新出现的标 in；不在新列表里的标 out，留在原来的位置
 * 直到退场结束；退场途中又被加回来的重新标 in。新列表的顺序优先，退场的标签插在它原来的前一个标签之后。
 */
export function reconcileTags(previous: readonly ConditionTagEntry[], next: readonly ConditionTagItem[]): ConditionTagEntry[] {
  const nextKeys = new Set(next.map(item => item.key));
  const before = new Map(previous.map(entry => [entry.item.key, entry]));
  const result: ConditionTagEntry[] = next.map(item => {
    const old = before.get(item.key);
    return { item, state: old === undefined || old.state === "out" ? "in" : old.state };
  });
  previous.forEach((entry, index) => {
    if (nextKeys.has(entry.item.key)) return;
    // 找到它原来前面最近的一个仍在列表里的标签，插在其后；没有就放在最前面。
    let anchor = -1;
    for (let i = index - 1; i >= 0; i--) {
      const at = result.findIndex(item => item.item.key === previous[i]!.item.key);
      if (at >= 0) { anchor = at; break; }
    }
    result.splice(anchor + 1, 0, { item: entry.item, state: "out" });
  });
  return result;
}

/** 删除一个标签后，键盘焦点交给它后面的标签，没有就交给前面的；都没有返回 null（交给标签组本身）。 */
export function focusAfterRemoval(entries: readonly ConditionTagEntry[], removed: string): string | null {
  const live = entries.filter(entry => entry.state !== "out" || entry.item.key === removed).map(entry => entry.item.key);
  const index = live.indexOf(removed);
  if (index < 0) return null;
  return live[index + 1] ?? live[index - 1] ?? null;
}
