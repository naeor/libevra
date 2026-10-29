import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { TransactionKind } from "@libellum/shared";
import { DRAG_DISTANCE, LATE_THRESHOLD, clamp01 } from "./transitionPhysics.js";
import { bindNativeHeaderScroll } from "./nativeHeaderScroll.js";

interface Session { progress: number; month: string | null; kind: TransactionKind | null; scrollTop: number }
const session: Session = { progress: 0, month: null, kind: null, scrollTop: 0 };
export function readSession(): Readonly<Session> { return session; }
export function writeSession(patch: Partial<Session>): void { Object.assign(session, patch); }

/** 原生滚动始终拥有整次触摸；只在滚动结束后复用原有弹簧吸附。
 * --p 仍驱动原来的明细动画，补偿区抵消过渡区的滚动距离，财务摘要不被额外卷走。
 */
export function useDetailTransition(initial: number) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [atList, setAtList] = useState(initial >= 1);
  const navigate = useRef<(p: number) => void>(() => {});
  const goTo = useCallback((p: number) => navigate.current(p), []);

  useLayoutEffect(() => {
    const root = rootRef.current, scroller = scrollRef.current;
    if (!root || !scroller) return;
    let settled = initial >= 1;
    const paint = () => {
      const p = clamp01(scroller.scrollTop / DRAG_DISTANCE);
      root.style.setProperty("--p", p.toFixed(4));
      root.style.setProperty("--detail-scroll-travel", `${p * DRAG_DISTANCE}px`);
      const late = p >= LATE_THRESHOLD;
      stripRef.current?.classList.toggle("flex-nowrap", late);
      stripRef.current?.classList.toggle("flex-wrap", !late);
      const next = p >= 1;
      if (next !== settled) { settled = next; setAtList(next); }
    };
    const controller = bindNativeHeaderScroll(scroller, () => DRAG_DISTANCE, paint);
    navigate.current = controller.goTo;
    const content = scroller.firstElementChild as HTMLElement;
    const oldMinHeight = content.style.minHeight;
    const measure = () => { content.style.minHeight = `${scroller.clientHeight + DRAG_DISTANCE}px`; };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller); measure();
    scroller.scrollTop = Math.max(initial * DRAG_DISTANCE, session.scrollTop);
    paint();
    return () => {
      writeSession({ progress: clamp01(scroller.scrollTop / DRAG_DISTANCE), scrollTop: scroller.scrollTop });
      controller.destroy(); observer.disconnect(); content.style.minHeight = oldMinHeight; navigate.current = () => {};
    };
  }, []);
  return { rootRef, scrollRef, stripRef, atList, goTo };
}
