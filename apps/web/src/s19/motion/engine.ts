import type { Direction, MotionOptions } from "./backdrop.js";
import { motionBlur } from "../material.js";
import { prepareHybrid } from "./hybrid.js";

export interface MotionSample {
  scheme: string; direction: Direction; firstRafMs: number | null; elapsedMs: number;
  frames: number[]; interrupted: boolean; fallback: string | null;
  commitMs: number | null; captureReadyMs: number | null; inputReadyMs: number | null;
  handoffFrames: number[]; fallbackMode: "ambient" | "instant" | null;
  handoff: boolean;
  inspection: boolean;
}
export interface MotionEnvironment { ambient: string; fallbackSurface?: () => HTMLElement | null }
type Transition = { ready: Promise<void>; finished: Promise<void>; skipTransition(): void };
type NativeDocument = { startViewTransition?: (update: () => void) => Transition };
export const SNAPSHOT_BUDGET_BYTES = 32 * 1024 * 1024;

/** 单一活动 token。回调只提交视图或清理自身；从不执行导航。 */
export class MotionEngine {
  private generation = 0;
  private finish: ((interrupted: boolean) => void) | null = null;
  active = false;
  snapshots = 0;
  interruptions = 0;
  fallbacks = 0;
  samples: MotionSample[] = [];
  phase: "idle" | "capture" | "transition" | "handoff" | "ambient" = "idle";
  /** 只供 Lab 逐帧视觉审查；真实试点从不设置，审查样本不进入性能汇总。 */
  inspectionProgress: number | null = null;
  private inspectionAnimations: Animation[] = [];
  private inspectionDuration = 200;
  seekInspection(progress: number): void {
    this.inspectionProgress = Math.min(1, Math.max(0, progress));
    for (const animation of this.inspectionAnimations) animation.currentTime = this.inspectionDuration * this.inspectionProgress;
  }
  resumeInspection(): void {
    this.inspectionProgress = null;
    for (const animation of this.inspectionAnimations) animation.play();
    this.inspectionAnimations = [];
  }
  constructor(private readonly changed: () => void = () => undefined) {}

  cancel(): void { this.finish?.(true); this.generation++; }
  run(options: MotionOptions, direction: Direction, commit: () => void, planes?: {
    old: HTMLElement; next: HTMLElement; settle: () => void;
  }, environment?: MotionEnvironment): void {
    this.cancel();
    const token = ++this.generation;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (direction === "none" || reduced || document.hidden) {
      commit(); planes?.settle(); this.changed(); return;
    }
    const started = performance.now();
    const sample: MotionSample = { scheme: options.scheme, direction, firstRafMs: null, elapsedMs: 0, frames: [], interrupted: false, fallback: null,
      commitMs: null, captureReadyMs: null, inputReadyMs: null, handoffFrames: [], fallbackMode: null,
      handoff: options.scheme === "hybrid" && options.material === "b2" && options.handoff, inspection: this.inspectionProgress !== null };
    let applied = false;
    let finished = false;
    let native: Transition | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    let previous = started;
    let nativeAbandoned = false;
    let cleanupHybrid: (() => void) | null = null;
    const animations: Animation[] = [];
    const apply = (): void => {
      if (token !== this.generation || applied) return;
      applied = true;
      commit();
      sample.commitMs = performance.now() - started;
    };
    const done = (interrupted: boolean): void => {
      if (finished) return;
      finished = true;
      // 取消准备中的捕获也必须立即交付已接受的真实页面。
      apply();
      if (interrupted) { native?.skipTransition(); this.interruptions++; }
      for (const animation of animations) animation.cancel();
      if (deadline) clearTimeout(deadline);
      if (watchdog) clearTimeout(watchdog);
      cancelAnimationFrame(raf);
      cleanupHybrid?.(); cleanupHybrid = null;
      this.inspectionAnimations = [];
      planes?.settle();
      sample.interrupted = interrupted;
      sample.elapsedMs = performance.now() - started;
      this.samples.push(sample);
      if (this.samples.length > 300) this.samples.shift();
      if (token === this.generation) {
        this.active = false; this.snapshots = 0; this.finish = null;
        this.phase = "idle";
        delete document.documentElement.dataset.motionDirection;
        this.changed();
      }
    };
    this.finish = done;
    this.active = true;
    this.phase = options.scheme === "native" || options.scheme === "hybrid" ? "capture" : "transition";
    const frame = (now: number): void => {
      if (finished) return;
      if (applied && sample.firstRafMs === null) sample.firstRafMs = now - started;
      const interval = now - previous;
      sample.frames.push(interval); previous = now;
      if (sample.handoff && !nativeAbandoned && sample.captureReadyMs !== null) {
        const progress = (now - started - sample.captureReadyMs) / options.duration;
        if (progress >= .4 && progress <= .95) {
          sample.handoffFrames.push(interval);
          if (this.phase !== "handoff") { this.phase = "handoff"; this.changed(); }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const root = document.documentElement;
    root.dataset.motionDirection = direction;
    root.style.setProperty("--motion-duration", `${options.duration}ms`);
    root.style.setProperty("--motion-retreat", options.retreat ? "-15%" : "0%");
    const { outgoingBlur, outgoingSoftBlur } = motionBlur(options.material, options.blurStrength, options.blur);
    root.style.setProperty("--motion-blur", `${outgoingBlur}px`);
    root.style.setProperty("--motion-soft-blur", `${outgoingSoftBlur}px`);
    root.style.setProperty("--motion-soft-contrast", options.blur ? ".85" : "1");
    root.style.setProperty("--motion-contrast", options.blur ? ".56" : "1");
    cleanupHybrid = prepareHybrid(root, options, environment?.ambient ?? "var(--color-canvas)");
    const fail = (reason: string): void => {
      if (finished || nativeAbandoned) return;
      nativeAbandoned = true;
      sample.fallback = reason; this.fallbacks++;
      native?.skipTransition();
      this.snapshots = 0;
      if (deadline) clearTimeout(deadline);
      if (watchdog) clearTimeout(watchdog);
      cleanupHybrid?.(); cleanupHybrid = null;
      if (options.scheme === "hybrid") {
        // 原生捕获失败后只淡入已经提交的目标与 Ambient；不复活旧 DOM，不重启一次捕获。
        apply(); sample.inputReadyMs = performance.now() - started;
        const surface = planes?.next ?? environment?.fallbackSurface?.();
        if (!document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches && surface?.animate) {
          try {
            this.phase = "ambient"; sample.fallbackMode = "ambient";
            const animation = surface.animate([{ opacity: .72 }, { opacity: 1 }], { duration: Math.min(160, options.duration), easing: "ease-out", fill: "both" });
            animations.push(animation);
            watchdog = setTimeout(() => done(false), options.duration + 100);
            void animation.finished.then(() => done(false)).catch(() => done(false));
            this.changed(); return;
          } catch { /* 没有可用动画能力就立即显示真实目标。 */ }
        }
      }
      sample.fallbackMode = "instant";
      done(false);
    };
    watchdog = setTimeout(() => fail("completion-timeout"), options.duration + 500);
    if (options.scheme === "native" || options.scheme === "hybrid") {
      const doc = document as unknown as NativeDocument;
      if (!doc.startViewTransition) { fail("unsupported"); return; }
      if (typeof window !== "undefined") {
        const width = planes?.old.parentElement?.clientWidth ?? window.innerWidth;
        const height = planes?.old.parentElement?.clientHeight ?? window.innerHeight;
        // 浏览器没有真实纹理容量 API；用两张 RGBA 的下限做保守准入，绝不声称是实际内存。
        if (width * height * (window.devicePixelRatio || 1) ** 2 * 4 * 2 > SNAPSHOT_BUDGET_BYTES) { fail("snapshot-budget"); return; }
      }
      try {
        native = doc.startViewTransition(apply);
        this.snapshots = 2; // 一组 old/new，表示申请数量，不是浏览器实际内存读数。
        deadline = setTimeout(() => fail("capture-timeout"), 120);
        void native.ready.then(() => {
          if (finished || nativeAbandoned || token !== this.generation) return;
          if (deadline) clearTimeout(deadline);
          sample.captureReadyMs = performance.now() - started;
          sample.inputReadyMs = sample.captureReadyMs;
          if (this.inspectionProgress !== null) {
            this.inspectionDuration = options.duration;
            this.inspectionAnimations = document.getAnimations().filter(animation => {
              const name = (animation as CSSAnimation).animationName ?? "";
              return /^(hybrid-|motion-|-ua-view-transition-)/.test(name);
            });
            for (const animation of this.inspectionAnimations) animation.pause();
            this.seekInspection(this.inspectionProgress);
            if (watchdog) clearTimeout(watchdog);
            watchdog = setTimeout(() => done(true), 20_000);
          }
          this.phase = "transition"; this.changed();
        }).catch(() => fail("capture-failed"));
        void native.finished.then(() => { if (!nativeAbandoned) done(false); }).catch(() => fail("native-failed"));
      } catch { fail("native-threw"); }
    } else if (planes) {
      apply();
      sample.inputReadyMs = performance.now() - started;
      const blur = options.blur ? `blur(${outgoingBlur}px) contrast(.56) saturate(.8)` : "none";
      const retreat = options.retreat ? "-15%" : "0%";
      const timing: KeyframeAnimationOptions = { duration: options.duration, easing: "cubic-bezier(.2,.75,.25,1)", fill: "both" };
      try {
        animations.push(planes.old.animate(direction === "push" ? [
          { transform: "translateX(0)", filter: "none", opacity: 1 },
          { filter: options.blur ? `blur(${outgoingSoftBlur}px) contrast(.85)` : "none", offset: .15 },
          { transform: `translateX(${retreat})`, filter: blur, opacity: options.scheme === "ambient" ? 0 : 1 },
        ] : [{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], timing));
        animations.push(planes.next.animate(direction === "push" ? [
          { transform: "translateX(100%)" }, { transform: "translateX(100%)", offset: .1 }, { transform: "translateX(0)" },
        ] : [{ transform: `translateX(${retreat})`, filter: blur }, { transform: "translateX(0)", filter: "none" }], timing));
        void Promise.all(animations.map(a => a.finished)).then(() => done(false)).catch(() => { /* cancel 的 done 已完成清理 */ });
      } catch { fail("waapi-failed"); }
    } else { fail("no-surface"); }
    this.changed();
  }
  dispose(): void { this.cancel(); this.samples = []; }
}

export function percentile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] ?? null;
}
