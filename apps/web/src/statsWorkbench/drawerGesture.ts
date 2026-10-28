/**
 * 编辑态底部工具栏（卡片抽屉）的拖动手势：**跟手、松手吸附到收起 / 展开两端之一。**
 *
 * ⚠️ **不另造一套手势框架**：落点判断、速度与进度的算法直接复用账本页两态切换的
 * `transitionPhysics.ts`（`progressFromDrag` / `flickFromDrag` / `decideTarget`）——同一套
 * 「快速一甩看方向、慢慢拖看过没过一半」的规则，所有者已经在账本页上调过手感。
 *
 * ⚠️ **只有抽屉顶部（把手 + 标题栏）认领手势**：列表区照常上下滚动，滚到顶再往下拉也不会把抽屉
 * 收起（之前的方案按方向猜意图，误伤滚动）；卡片的拖放从网格或抽屉里的卡片开始，不经过这里，
 * 两套手势互不相交。
 *
 * ⚠️ **拖动过程中不触发 React 渲染**：进度直接写到元素的 CSS 变量 `--sw-drawer-p`（0 收起 · 1 展开），
 * 高度、标题交叉淡入与箭头旋转都由 CSS 按它计算；松手时才提交状态，交给 CSS 过渡吸附。抽屉里有几十个
 * 卡片项，逐帧重渲染在手机上会掉帧。
 */
import { useRef } from "react";

import { decideTarget, flickFromDrag, progressFromDrag } from "../lib/transitionPhysics.js";

/** 手指移动超过这么多像素才算拖动；更短的按下-抬起仍是点击（点标题 / 箭头 / 标签照常生效）。 */
export const DRAG_SLOP = 6;

/** 拖动距离的下限：极矮的窗口里也不至于一碰就到头。 */
export const MIN_TRAVEL = 120;

export type DrawerEnd = "collapsed" | "expanded";

/** 松手时吸附到哪一端（纯函数，供测试）：快速一甩看方向，否则看是否过半。 */
export function releaseTarget(startProgress: number, dy: number, elapsedMs: number, travel: number): { readonly progress: number; readonly end: DrawerEnd } {
  const progress = progressFromDrag(startProgress, dy, travel);
  const flick = flickFromDrag(dy, elapsedMs, travel);
  return { progress, end: decideTarget(progress, flick) === 1 ? "expanded" : "collapsed" };
}

/** 展开与收起两端之间的像素距离：按元素当前的实际高度与另一端的目标高度测量，不写死。 */
export function travelFor(element: HTMLElement, grab: HTMLElement, expanded: boolean): number {
  const style = getComputedStyle(element);
  const padding = Number.parseFloat(style.paddingBottom) || 0;
  const collapsedPx = grab.offsetHeight + padding;
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const viewport = typeof window === "undefined" ? 800 : window.innerHeight;
  const expandedPx = expanded ? element.offsetHeight : Math.min(viewport * 0.48, 27 * rem);
  return Math.max(MIN_TRAVEL, expandedPx - collapsedPx);
}

interface Grab {
  readonly pointerId: number;
  readonly y: number;
  readonly time: number;
  readonly start: number;
  readonly travel: number;
  dragging: boolean;
  dy: number;
}

/**
 * 抽屉手势。`sectionRef` 是整块抽屉（写 CSS 变量的元素），`grabProps` 展开到顶部把手 + 标题栏上。
 * 拖动后紧接着的 click 会被吞掉，避免「拖完松手」又被当成一次点标题。
 */
export function useDrawerGesture(options: {
  readonly expanded: boolean;
  readonly onEnd: (end: DrawerEnd) => void;
}): {
  readonly sectionRef: React.RefObject<HTMLElement | null>;
  readonly grabProps: {
    readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    readonly onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  };
} {
  const sectionRef = useRef<HTMLElement | null>(null);
  const grab = useRef<Grab | null>(null);
  const swallowClick = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const setProgress = (value: number | null) => {
    const element = sectionRef.current;
    if (element === null) return;
    if (value === null) {
      element.style.removeProperty("--sw-drawer-p");
      delete element.dataset.dragging;
    } else {
      element.style.setProperty("--sw-drawer-p", value.toFixed(4));
      element.dataset.dragging = "true";
    }
  };

  const finish = (commit: boolean) => {
    const current = grab.current;
    grab.current = null;
    if (current === null || !current.dragging) return;
    swallowClick.current = true;
    // 先撤掉内联进度、再提交状态：CSS 过渡从手指松开处的高度吸附到目标端。
    setProgress(null);
    if (!commit) return;
    const { end } = releaseTarget(current.start, current.dy, performance.now() - current.time, current.travel);
    latest.current.onEnd(end);
  };

  return {
    sectionRef,
    grabProps: {
      onPointerDown(event) {
        // 只认主键 / 单指；从标题栏里的按钮开始也可以拖（标签、箭头、预设都在这一行）。
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const element = sectionRef.current;
        if (element === null) return;
        swallowClick.current = false;
        const expanded = latest.current.expanded;
        grab.current = {
          pointerId: event.pointerId,
          y: event.clientY,
          time: performance.now(),
          start: expanded ? 1 : 0,
          travel: travelFor(element, event.currentTarget, expanded),
          dragging: false,
          dy: 0,
        };
      },
      onPointerMove(event) {
        const current = grab.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const dy = event.clientY - current.y;
        current.dy = dy;
        if (!current.dragging) {
          if (Math.abs(dy) < DRAG_SLOP) return;
          current.dragging = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // 个别浏览器在合成事件里不允许捕获；不捕获也能继续收到同一元素上的移动。
          }
        }
        event.preventDefault();
        setProgress(progressFromDrag(current.start, dy, current.travel));
      },
      onPointerUp(event) {
        if (grab.current?.pointerId !== event.pointerId) return;
        finish(true);
      },
      onPointerCancel(event) {
        if (grab.current?.pointerId !== event.pointerId) return;
        // 系统打断（来电、手势被浏览器接管）：回到原来的一端，不做半截状态。
        finish(false);
      },
      onClickCapture(event) {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}
