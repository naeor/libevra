import { startTransition, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TransactionKind } from "@libellum/shared";
import type { EntryPresentation } from "../components/EntrySortControls.js";
import { DRAG_DISTANCE, LATE_THRESHOLD, clamp01 } from "./transitionPhysics.js";
import { bindNativeHeaderScroll } from "./nativeHeaderScroll.js";

interface Session { progress: number; month: string | null; kind: TransactionKind | "all" | null; scrollTop: number; syncRequested?: boolean; presentation?: EntryPresentation; syncReturnPath?: string; search?: string; searchOpen?: boolean; searchOrigin?: number }
/**
 * ⚠️ **S18：每个工作区实例一份**（`w1` / `w2`）。大屏上主区与辅助区可以同时打开明细，各自的月份、收支
 * 切换与滚动位置互不覆盖；手机上只有 `w1`，与以前的单份会话完全相同。
 */
const sessions = new Map<string, Session>();
function sessionFor(scope: string): Session {
  let session = sessions.get(scope);
  if (session === undefined) {
    session = { progress: 0, month: null, kind: null, scrollTop: 0 };
    sessions.set(scope, session);
  }
  return session;
}
export function readSession(scope = "w1"): Readonly<Session> { return { ...sessionFor(scope) }; }
export function writeSession(patch: Partial<Session>, scope = "w1"): void { Object.assign(sessionFor(scope), patch); }

/** 原生滚动始终拥有整次触摸；只在滚动结束后复用原有弹簧吸附。
 * --p 仍驱动原来的明细动画，补偿区抵消过渡区的滚动距离，财务摘要不被额外卷走。
 */
export function useDetailTransition(initial: number, scope = "w1", initialSearch = false) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [atList, setAtList] = useState(initialSearch || initial >= 1);
  const searchLock = useRef(initialSearch);
  const searchProgress = useRef(initialSearch ? 1 : initial);
  const searchFrame = useRef(0);
  const repaint = useRef<() => void>(() => {});
  const cancelMotion = useRef<() => void>(() => {});
  const lockSearch = useCallback((locked: boolean, restoreTop?: number) => {
    const changed = searchLock.current !== locked;
    if (changed) { cancelMotion.current(); cancelAnimationFrame(searchFrame.current); }
    const origin = clamp01((scrollRef.current?.scrollTop ?? 0) / DRAG_DISTANCE);
    searchLock.current = locked;
    if (!locked && restoreTop !== undefined && scrollRef.current) {
      rootRef.current?.style.setProperty("--detail-scroll-travel", `${clamp01(restoreTop / DRAG_DISTANCE) * DRAG_DISTANCE}px`);
      scrollRef.current.scrollTop = restoreTop;
    }
    if (changed && locked) {
      searchProgress.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : origin;
      if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, scrollRef.current.scrollTop - DRAG_DISTANCE);
      const started = performance.now();
      const advance = (now: number) => {
        const t = Math.min(1, (now - started) / 200);
        searchProgress.current = origin + (1 - origin) * (1 - (1 - t) ** 2);
        repaint.current();
        if (t < 1) searchFrame.current = requestAnimationFrame(advance);
      };
      if (searchProgress.current < 1) searchFrame.current = requestAnimationFrame(advance);
    }
    repaint.current();
  }, []);
  const navigate = useRef<(p: number) => void>(() => {});
  const goTo = useCallback((p: number) => navigate.current(p), []);

  useLayoutEffect(() => {
    const root = rootRef.current, scroller = scrollRef.current;
    if (!root || !scroller) return;
    let settled = initial >= 1;
    let paintedProgress = "", paintedTravel = "";
    const paint = () => {
      const p = searchLock.current ? searchProgress.current : clamp01(scroller.scrollTop / DRAG_DISTANCE);
      const progress = p.toFixed(4), travel = `${searchLock.current ? 0 : p * DRAG_DISTANCE}px`;
      // 列表端继续惯性滚动时不重复刷新整棵摘要/账目树的继承样式。
      if (progress !== paintedProgress) { root.style.setProperty("--p", progress); paintedProgress = progress; }
      if (travel !== paintedTravel) { root.style.setProperty("--detail-scroll-travel", travel); paintedTravel = travel; }
      const late = p >= LATE_THRESHOLD;
      stripRef.current?.classList.toggle("flex-nowrap", late);
      stripRef.current?.classList.toggle("flex-wrap", !late);
      const next = p >= 1;
      /**
       * S18 第二轮：到达 / 离开列表端时整页要重新渲染（双工作区时是一整页较重的树）。放进过渡更新，
       * 不在滚动事件里同步占住主线程——那会推迟后续 scroll 事件，正是惯性期间误判「已停止」的诱因之一。
       */
      if (next !== settled) { settled = next; startTransition(() => { setAtList(next); }); }
    };
    repaint.current = paint;
    const controller = bindNativeHeaderScroll(scroller, () => searchLock.current ? 0 : DRAG_DISTANCE, paint);
    cancelMotion.current = controller.cancel;
    navigate.current = controller.goTo;
    const content = scroller.firstElementChild as HTMLElement;
    const oldMinHeight = content.style.minHeight;
    const measure = () => { content.style.minHeight = `${scroller.clientHeight + DRAG_DISTANCE}px`; };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller); measure();
    scroller.scrollTop = initialSearch ? sessionFor(scope).scrollTop : Math.max(initial * DRAG_DISTANCE, sessionFor(scope).scrollTop);
    paint();
    return () => {
      cancelAnimationFrame(searchFrame.current);
      writeSession({ progress: clamp01(scroller.scrollTop / DRAG_DISTANCE), scrollTop: scroller.scrollTop }, scope);
      controller.destroy(); observer.disconnect(); content.style.minHeight = oldMinHeight; navigate.current = () => {};
    };
  }, []);
  return { rootRef, scrollRef, stripRef, atList, goTo, lockSearch };
}
