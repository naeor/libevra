import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from "react";
import { SELECTION_DURATION, selectionFrames, type SelectionBox } from "./selectionMotion.js";
import "./sliding-selection.css";

/** 只移动选中项的材质，原按钮、aria、点击和键盘行为由调用者保留。 */
export function SlidingSelection({ children, hostRef, ...props }: HTMLAttributes<HTMLDivElement> & { hostRef?: RefObject<HTMLDivElement | null> }) {
  const localRef = useRef<HTMLDivElement>(null);
  const rootRef = hostRef ?? localRef;
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const running = useRef<Animation | null>(null);
  const previous = useRef<{ button: HTMLElement; box: SelectionBox } | null>(null);
  const syncRef = useRef<(animate: boolean) => void>(() => undefined);

  syncRef.current = (animate) => {
    const root = rootRef.current, indicator = indicatorRef.current;
    if (!root || !indicator) return;
    const selected = root.querySelector<HTMLElement>(':scope > button:is([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"])');
    if (!selected || selected.matches(":disabled") || root.clientWidth === 0 || selected.getClientRects().length === 0) {
      running.current?.cancel(); running.current = null; previous.current = null;
      delete root.dataset.selectionReady;
      return;
    }
    const relativeBox = (element: HTMLElement): SelectionBox => {
      const r = element.getBoundingClientRect(), parent = root.getBoundingClientRect();
      return { x: r.left - parent.left + root.scrollLeft - root.clientLeft, y: r.top - parent.top + root.scrollTop - root.clientTop, width: r.width, height: r.height };
    };
    const to = relativeBox(selected), old = previous.current;
    const from = old ? relativeBox(indicator) : to;
    // 同步测量原选中外观；不会经过绘制帧，也不复制文字或交互节点。
    delete root.dataset.selectionReady;
    const paint = getComputedStyle(selected);
    Object.assign(indicator.style, {
      background: paint.background, boxShadow: paint.boxShadow, borderRadius: paint.borderRadius,
      border: paint.border, opacity: paint.opacity,
    });
    root.dataset.selectionReady = "true";
    const changed = !old || Object.keys(to).some(key => Math.abs(to[key as keyof SelectionBox] - old.box[key as keyof SelectionBox]) > .25);
    if (!changed && old?.button === selected) return;
    running.current?.cancel(); running.current = null;
    Object.assign(indicator.style, { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, width: `${to.width}px`, height: `${to.height}px` });
    previous.current = { button: selected, box: to };
    if (animate && old && old.button !== selected && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && typeof indicator.animate === "function") {
      const motion = indicator.animate(selectionFrames(from, to), { duration: SELECTION_DURATION });
      running.current = motion;
      motion.onfinish = () => { if (running.current === motion) running.current = null; };
    }
  };
  useLayoutEffect(() => { syncRef.current(true); });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => syncRef.current(false));
    resize?.observe(root);
    root.querySelectorAll(":scope > button").forEach(button => resize?.observe(button));
    const theme = new MutationObserver(() => syncRef.current(false));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-visual-style", "data-theme-mode", "data-theme-palette"] });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopMotion = () => { running.current?.cancel(); running.current = null; syncRef.current(false); };
    reduced.addEventListener("change", stopMotion);
    return () => { resize?.disconnect(); theme.disconnect(); reduced.removeEventListener("change", stopMotion); running.current?.cancel(); running.current = null; previous.current = null; delete root.dataset.selectionReady; };
  }, [rootRef]);

  return <div {...props} ref={rootRef} data-sliding-selection="">
    {Children.map(children, child => isValidElement(child) && child.type === "button"
      ? cloneElement(child as ReactElement<{ children: ReactNode }>, {}, <span data-selection-label="">{(child.props as { children: ReactNode }).children}</span>)
      : child)}
    <span ref={indicatorRef} data-selection-indicator="" aria-hidden="true" />
  </div>;
}
