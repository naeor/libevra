/**
 * **按内容档面板的高度过渡**（弹出面板模板，1.19.63「内容优先」）。
 *
 * 1.19.63 起 T1 列表、T2 表单、T4 信息说明都按内容取高度、最高到大档（所有者 2026-11-14：“大部分弹窗都能够展示出它完整的
 * 内容”）。原来半屏上限把大部分高度变化压在 52% 以内；放开之后，加载中 → 有数据、空状态 → 有数据、校验提示出现、
 * 图片载入这类内容变化可能让面板一下子长高或变矮。这里让这种变化用与面板升起同一条曲线、同样的时长过渡过去
 * （令牌 `--lv-sheet-resize-ms` / `--lv-sheet-resize-ease`，在 `components/panel-template.css`），不在原地跳一下。
 *
 * - **只过渡内容引起的变化**：可视区、工作区尺寸或软键盘高度变了（上限跟着变）就直接取新高度，不和系统键盘动画抢；
 *   第一次测量只记下基准，面板升起时不额外播放。
 * - **固定高度的档位不用**（固定半屏、高半屏、大档的高度不随内容变）；正在收起的面板不播放。
 * - **减少动态效果时不过渡**，直接取新高度。
 * - 过渡期间面板带 `data-sheet-resizing`，内容区暂时不出滚动条（样式在 `panel-template.css`）；结束后照常滚动。
 * - 用 Web Animations 从旧高度过渡到新高度、不留填充：结束后面板回到 CSS 决定的高度（按内容、最高到大档）。
 */
import { useEffect, type RefObject } from "react";

/** 小于它的变化（亚像素、字体微调）直接采用，不播放。 */
export const SHEET_RESIZE_MIN_DELTA_PX = 2;
/** 读不到令牌时的后备值：与面板升起 `libellum-sheet-in` 相同（index.css）。 */
export const SHEET_RESIZE_FALLBACK = { durationMs: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" } as const;

/** 一次测量：面板高度，以及决定上限的“外框”（工作区宽度与面板的最大高度，后者已包含可视区与键盘）。 */
export interface SheetMeasure {
  readonly height: number;
  readonly frame: string;
}

export type SheetResizePlan = "baseline" | "snap" | "animate";

/** 这次高度变化怎么处理。纯函数，便于测试。 */
export function planSheetResize(
  previous: SheetMeasure | null,
  next: SheetMeasure,
  options: { readonly reducedMotion: boolean; readonly closing: boolean },
): SheetResizePlan {
  if (previous === null) return "baseline";
  if (options.closing || options.reducedMotion) return "snap";
  if (previous.frame !== next.frame) return "snap";
  if (Math.abs(next.height - previous.height) < SHEET_RESIZE_MIN_DELTA_PX) return "snap";
  return "animate";
}

/** 令牌里的时长（"260ms" / "0.26s"）；读不到或不合法时用后备值。 */
export function parseResizeDuration(value: string): number {
  const text = value.trim();
  const number = Number.parseFloat(text);
  if (!Number.isFinite(number) || number < 0) return SHEET_RESIZE_FALLBACK.durationMs;
  return text.endsWith("ms") ? number : text.endsWith("s") ? number * 1000 : number;
}

/** 过渡需要的最小面板接口（真实环境是 HTMLElement；测试里用替身）。 */
export interface SheetResizePanel {
  readonly offsetHeight: number;
  readonly dataset: Record<string, string | undefined>;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): { readonly finished: Promise<unknown>; cancel(): void };
}

/** 环境：观察尺寸变化、读样式、减少动态效果。真实环境见 `browserSheetResizeEnv`。 */
export interface SheetResizeEnv {
  readonly observe: (panel: SheetResizePanel, onResize: () => void) => () => void;
  /** 面板算出的最大高度（已包含可视区、安全区与软键盘）。 */
  readonly maxHeightOf: (panel: SheetResizePanel) => string;
  readonly tokenOf: (panel: SheetResizePanel, name: string) => string;
  readonly reducedMotion: () => boolean;
}

/**
 * 给按内容档的面板接上高度过渡，返回清理函数。外框 = 遮罩根节点（所在可视区或工作区）的宽度 + 面板的最大高度，
 * 外框变了就不过渡。
 */
export function attachSheetHeightTransition(
  panel: SheetResizePanel,
  root: { readonly clientWidth: number } | null,
  env: SheetResizeEnv,
): () => void {
  const measure = (): SheetMeasure => ({
    height: panel.offsetHeight,
    frame: `${String(root?.clientWidth ?? 0)}|${env.maxHeightOf(panel)}`,
  });
  let last: SheetMeasure | null = null;
  let running: { readonly finished: Promise<unknown>; cancel(): void } | null = null;

  const settle = (): void => {
    const next = measure();
    const plan = planSheetResize(last, next, { reducedMotion: env.reducedMotion(), closing: panel.dataset.overlayState === "closing" });
    if (plan === "animate" && last !== null) {
      const easing = env.tokenOf(panel, "--lv-sheet-resize-ease").trim();
      const animation = panel.animate([{ height: `${String(last.height)}px` }, { height: `${String(next.height)}px` }], {
        duration: parseResizeDuration(env.tokenOf(panel, "--lv-sheet-resize-ms")),
        easing: easing === "" ? SHEET_RESIZE_FALLBACK.easing : easing,
      });
      running = animation;
      panel.dataset.sheetResizing = "true";
      const done = (): void => {
        if (running !== animation) return;
        running = null;
        delete panel.dataset.sheetResizing;
        // 过渡期间内容又变了（观察到的只是过渡帧）：从刚停下的高度接着过渡到现在的高度。
        settle();
      };
      void animation.finished.then(done, done);
    }
    last = next;
  };

  const stop = env.observe(panel, () => {
    // 过渡自己的每一帧也会触发观察，跳过；结束时 `done` 会再量一次。
    if (running === null) settle();
  });
  return () => {
    stop();
    const animation = running;
    running = null;
    animation?.cancel();
    delete panel.dataset.sheetResizing;
  };
}

function browserSheetResizeEnv(): SheetResizeEnv | null {
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return null;
  return {
    observe: (panel, onResize) => {
      const observer = new ResizeObserver(onResize);
      observer.observe(panel as unknown as Element);
      return () => {
        observer.disconnect();
      };
    },
    maxHeightOf: (panel) => getComputedStyle(panel as unknown as Element).maxHeight,
    tokenOf: (panel, name) => getComputedStyle(panel as unknown as Element).getPropertyValue(name),
    reducedMotion: () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/**
 * `BottomSheet` 用：按内容档时接上高度过渡。没有 `ResizeObserver` 或 `Element.animate` 的环境（服务端渲染、
 * 老浏览器）什么也不做，面板照常按内容取高度。
 */
export function useSheetHeightTransition(panelRef: RefObject<HTMLElement | null>, rootRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const panel = panelRef.current;
    const env = browserSheetResizeEnv();
    if (!enabled || panel === null || env === null || typeof panel.animate !== "function") return;
    return attachSheetHeightTransition(panel, rootRef.current, env);
  }, [panelRef, rootRef, enabled]);
}
