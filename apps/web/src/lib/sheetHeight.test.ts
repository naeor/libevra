import { describe, expect, it } from "vitest";

import {
  SHEET_RESIZE_FALLBACK,
  attachSheetHeightTransition,
  parseResizeDuration,
  planSheetResize,
  type SheetResizeEnv,
  type SheetResizePanel,
} from "./sheetHeight.js";

/**
 * 按内容档面板的高度过渡（1.19.63「内容优先」）：内容变化引起的高度变化过渡过去，外框（可视区 / 工作区 / 键盘）变化、
 * 减少动态效果、正在收起时直接取新高度。测试没有 DOM：面板、尺寸观察与动画都用替身。
 */
describe("planSheetResize", () => {
  const motion = { reducedMotion: false, closing: false };

  it("第一次测量只记基准，面板升起时不额外播放", () => {
    expect(planSheetResize(null, { height: 300, frame: "a" }, motion)).toBe("baseline");
  });

  it("同一外框下内容变高或变矮：过渡", () => {
    expect(planSheetResize({ height: 200, frame: "a" }, { height: 520, frame: "a" }, motion)).toBe("animate");
    expect(planSheetResize({ height: 520, frame: "a" }, { height: 240, frame: "a" }, motion)).toBe("animate");
  });

  it("外框变了（键盘、旋转、工作区宽度）：直接取新高度", () => {
    expect(planSheetResize({ height: 500, frame: "390|780px" }, { height: 300, frame: "390|480px" }, motion)).toBe("snap");
  });

  it("减少动态效果、正在收起、亚像素变化：直接取新高度", () => {
    expect(planSheetResize({ height: 200, frame: "a" }, { height: 500, frame: "a" }, { reducedMotion: true, closing: false })).toBe("snap");
    expect(planSheetResize({ height: 200, frame: "a" }, { height: 500, frame: "a" }, { reducedMotion: false, closing: true })).toBe("snap");
    expect(planSheetResize({ height: 200, frame: "a" }, { height: 201.5, frame: "a" }, motion)).toBe("snap");
  });
});

describe("parseResizeDuration", () => {
  it("读令牌里的毫秒或秒；读不到用与面板升起相同的 260ms", () => {
    expect(parseResizeDuration(" 260ms")).toBe(260);
    expect(parseResizeDuration("0.3s")).toBe(300);
    expect(parseResizeDuration("")).toBe(SHEET_RESIZE_FALLBACK.durationMs);
    expect(parseResizeDuration("auto")).toBe(SHEET_RESIZE_FALLBACK.durationMs);
  });
});

/** 一块可以改高度、记录动画的面板替身。 */
function harness(options: { readonly reducedMotion?: boolean } = {}) {
  let onResize: (() => void) | null = null;
  let maxHeight = "780px";
  const animations: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancelled: boolean }[] = [];
  const panel: SheetResizePanel & { offsetHeight: number } = {
    offsetHeight: 240,
    dataset: {},
    animate(keyframes, animationOptions) {
      let finish = (): void => undefined;
      const finished = new Promise<unknown>((resolve) => {
        finish = () => {
          resolve(undefined);
        };
      });
      const record = { keyframes, options: animationOptions, finish: () => { finish(); }, cancelled: false };
      animations.push(record);
      return { finished, cancel: () => { record.cancelled = true; } };
    },
  };
  const env: SheetResizeEnv = {
    observe: (_panel, callback) => {
      onResize = callback;
      return () => {
        onResize = null;
      };
    },
    maxHeightOf: () => maxHeight,
    tokenOf: (_panel, name) => (name === "--lv-sheet-resize-ms" ? "260ms" : "cubic-bezier(0.32, 0.72, 0, 1)"),
    reducedMotion: () => options.reducedMotion ?? false,
  };
  const root = { clientWidth: 390 };
  const resize = (height: number): void => {
    panel.offsetHeight = height;
    onResize?.();
  };
  return {
    panel,
    root,
    env,
    animations,
    resize,
    setMaxHeight: (value: string) => {
      maxHeight = value;
    },
    observing: () => onResize !== null,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe("attachSheetHeightTransition", () => {
  it("加载中 → 有数据：从旧高度过渡到新高度，时长与曲线取令牌；过渡期间内容区不出滚动条", async () => {
    const h = harness();
    const stop = attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(240); // 观察开始时的第一次回调：基准
    expect(h.animations).toHaveLength(0);
    h.resize(560);
    expect(h.animations).toHaveLength(1);
    expect(h.animations[0]?.keyframes).toEqual([{ height: "240px" }, { height: "560px" }]);
    expect(h.animations[0]?.options).toEqual({ duration: 260, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
    expect(h.panel.dataset.sheetResizing).toBe("true");
    // 过渡自己的帧不会再起一段过渡。
    h.resize(400);
    expect(h.animations).toHaveLength(1);
    h.panel.offsetHeight = 560;
    h.animations[0]?.finish();
    await flush();
    expect(h.panel.dataset.sheetResizing).toBeUndefined();
    expect(h.animations).toHaveLength(1);
    stop();
  });

  it("过渡途中内容又变了：结束后从停下的高度接着过渡到现在的高度", async () => {
    const h = harness();
    attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(240);
    h.resize(560);
    h.panel.offsetHeight = 320; // 过渡期间变成空状态
    h.animations[0]?.finish();
    await flush();
    expect(h.animations).toHaveLength(2);
    expect(h.animations[1]?.keyframes).toEqual([{ height: "560px" }, { height: "320px" }]);
  });

  it("软键盘打开（最大高度变了）：直接取新高度，不和键盘动画抢", () => {
    const h = harness();
    attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(600);
    h.setMaxHeight("420px");
    h.resize(420);
    expect(h.animations).toHaveLength(0);
    // 新外框下的下一次内容变化照常过渡。
    h.resize(300);
    expect(h.animations).toHaveLength(1);
  });

  it("工作区宽度变了：直接取新高度", () => {
    const h = harness();
    attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(300);
    h.root.clientWidth = 600;
    h.resize(260);
    expect(h.animations).toHaveLength(0);
  });

  it("减少动态效果：不过渡", () => {
    const h = harness({ reducedMotion: true });
    attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(240);
    h.resize(560);
    expect(h.animations).toHaveLength(0);
    expect(h.panel.dataset.sheetResizing).toBeUndefined();
  });

  it("正在收起的面板：不过渡", () => {
    const h = harness();
    attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(240);
    h.panel.dataset.overlayState = "closing";
    h.resize(560);
    expect(h.animations).toHaveLength(0);
  });

  it("卸载：停止观察、取消进行中的过渡、去掉标记", () => {
    const h = harness();
    const stop = attachSheetHeightTransition(h.panel, h.root, h.env);
    h.resize(240);
    h.resize(560);
    stop();
    expect(h.observing()).toBe(false);
    expect(h.animations[0]?.cancelled).toBe(true);
    expect(h.panel.dataset.sheetResizing).toBeUndefined();
  });
});
