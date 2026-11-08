import { startTransition, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TransactionKind } from "@libellum/shared";
import type { EntryPresentation } from "../components/EntrySortControls.js";
import { DRAG_DISTANCE, LATE_THRESHOLD, clamp01 } from "./transitionPhysics.js";
import { bindNativeHeaderScroll, scrollContentHeight } from "./nativeHeaderScroll.js";
import { runFrameValue } from "./frameClock.js";
import { CONTROL_MORPH, easingFunction } from "./motionTokens.js";

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

const searchEase = easingFunction(CONTROL_MORPH.easing);

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
  /** 关闭搜索后顶部从搜索态回到滚动位置的过程中，`--p` 仍由这里推进，行程区已按滚动恢复。 */
  const releasing = useRef(false);
  /** 当前的 --search-k（0 常态、1 搜索态）。快速开合时从这里接续，不先跳回端点。 */
  const searchK = useRef(initialSearch ? 1 : 0);
  const stopSearchMotion = useRef<() => void>(() => {});
  const repaint = useRef<() => void>(() => {});
  const cancelMotion = useRef<() => void>(() => {});
  /**
   * 搜索开合时顶部的收起 / 展开。1.19.43 起用帧锚定时钟：旧实现在点击时取 `performance.now()` 作起点，
   * 点击当下的整页重渲染与键盘弹出占掉的时间被算进了动画，第一帧就接近终点，看起来是“向上跳”。
   * 搜索态顶部比普通收起多出的 26px（放范围说明）也随同一时钟长出 / 收回，不再瞬间撑开。
   */
  const lockSearch = useCallback((locked: boolean, restoreTop?: number) => {
    const changed = searchLock.current !== locked;
    const root = rootRef.current, scroller = scrollRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (changed) { cancelMotion.current(); stopSearchMotion.current(); }
    // 与搜索胶囊的形变同一条曲线（Motion Token：控件形变），标题让位、顶部收起与胶囊展开同步。
    const ease = searchEase;
    const setK = (k: number): void => { searchK.current = k; root?.style.setProperty("--search-k", String(k)); };
    if (locked) {
      const origin = clamp01((scroller?.scrollTop ?? 0) / DRAG_DISTANCE);
      // 收回还没结束又打开：从屏幕上当前的姿态接续，而不是先按滚动位置跳回去。
      const interrupted = releasing.current;
      searchLock.current = true; releasing.current = false;
      if (changed) {
        const from = reduced ? 1 : interrupted ? searchProgress.current : origin, kFrom = reduced ? 1 : searchK.current;
        searchProgress.current = from;
        if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - DRAG_DISTANCE);
        root?.setAttribute("data-search-room", "");
        setK(kFrom);
        stopSearchMotion.current = runFrameValue(reduced ? 0 : CONTROL_MORPH.duration, t => {
          searchProgress.current = from + (1 - from) * ease(t);
          setK(kFrom + (1 - kFrom) * ease(t));
          repaint.current();
        }, () => { searchK.current = 1; root?.style.removeProperty("--search-k"); });
      }
      repaint.current();
      return;
    }
    searchLock.current = false;
    if (restoreTop !== undefined && scroller) {
      root?.style.setProperty("--detail-scroll-travel", `${clamp01(restoreTop / DRAG_DISTANCE) * DRAG_DISTANCE}px`);
      scroller.scrollTop = restoreTop;
    }
    if (!changed) { repaint.current(); return; }
    const from = searchProgress.current, target = clamp01((scroller?.scrollTop ?? 0) / DRAG_DISTANCE);
    releasing.current = true;
    const kFrom = searchK.current;
    setK(kFrom);
    stopSearchMotion.current = runFrameValue(reduced ? 0 : CONTROL_MORPH.duration, t => {
      searchProgress.current = from + (target - from) * ease(t);
      setK(kFrom * (1 - ease(t)));
      repaint.current();
    }, () => {
      releasing.current = false; searchK.current = 0;
      root?.removeAttribute("data-search-room"); root?.style.removeProperty("--search-k");
      repaint.current();
    });
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
      const scrolled = clamp01(scroller.scrollTop / DRAG_DISTANCE);
      const p = searchLock.current || releasing.current ? searchProgress.current : scrolled;
      const progress = p.toFixed(4), travel = `${searchLock.current ? 0 : scrolled * DRAG_DISTANCE}px`;
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
    // 菜单借用视口空间，但不能缩短列表的滚动行程，否则关闭菜单时浏览器会
    // 钳制 scrollTop，重新进入顶栏吸附区间，甚至触发 atList 的自动关闭菜单。
    const menuSpace = root.querySelector<HTMLElement>("[data-detail-menu-space]");
    const measure = () => {
      content.style.minHeight = `${scrollContentHeight(scroller) + (menuSpace?.getBoundingClientRect().height ?? 0) + DRAG_DISTANCE}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller); measure();
    scroller.scrollTop = initialSearch ? sessionFor(scope).scrollTop : Math.max(initial * DRAG_DISTANCE, sessionFor(scope).scrollTop);
    if (initialSearch) root.setAttribute("data-search-room", "");
    paint();
    return () => {
      stopSearchMotion.current();
      writeSession({ progress: clamp01(scroller.scrollTop / DRAG_DISTANCE), scrollTop: scroller.scrollTop }, scope);
      controller.destroy(); observer.disconnect(); content.style.minHeight = oldMinHeight; navigate.current = () => {};
    };
  }, []);
  return { rootRef, scrollRef, stripRef, atList, goTo, lockSearch };
}
