import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from "react";
import "./component-motion.css";

export type ComponentMotionKind = "press" | "select" | "reveal" | "dismiss" | "feedback" | "loading";
export function componentMotion(element: HTMLElement, kind: ComponentMotionKind) {
  const css = getComputedStyle(element);
  const enabled = !!element.closest('.lv-shell[data-shell="contents"]') && document.documentElement.dataset.themeMode === "light" && !!document.documentElement.dataset.visualStyle;
  return { duration: !enabled || matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : (parseFloat(css.getPropertyValue(`--lv-${kind}-ms`)) || 0),
    easing: css.getPropertyValue("--lv-motion-ease").trim() || "ease-out", y: parseFloat(css.getPropertyValue("--lv-reveal-y")) || 0 };
}

/** 只看可见性边沿；不依赖路由。初次挂载、保持 visible、普通重渲染都不入场。 */
export function MotionPresence({ visible, children, ...props }: HTMLAttributes<HTMLDivElement> & { visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null), previous = useRef(visible), animation = useRef<Animation | null>(null);
  const initialHidden = useRef(!visible);
  const latest = useRef(visible); latest.current = visible;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || previous.current === visible) return;
    previous.current = visible;
    const wasHidden = node.hidden, css = getComputedStyle(node);
    const from = { opacity: wasHidden ? "0" : css.opacity, transform: wasHidden ? "" : css.transform };
    animation.current?.cancel(); node.hidden = false;
    const motion = componentMotion(node, visible ? "reveal" : "dismiss");
    if (!motion.duration || !node.animate) { node.hidden = !visible; return; }
    const move = `translateY(${motion.y}px)`;
    const run = node.animate([{ opacity: from.opacity, transform: from.transform || move }, { opacity: visible ? 1 : 0, transform: visible ? "none" : move }], { duration: motion.duration, easing: motion.easing, fill: "both" });
    animation.current = run;
    run.onfinish = () => { if (animation.current !== run) return; node.hidden = !latest.current; run.cancel(); animation.current = null; };
  }, [visible]);
  useLayoutEffect(() => {
    const node = ref.current, media = matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => { animation.current?.cancel(); animation.current = null; if (node) node.hidden = !latest.current; };
    const reduced = () => { if (media.matches) settle(); };
    const background = () => { if (document.hidden) settle(); };
    media.addEventListener("change", reduced); document.addEventListener("visibilitychange", background);
    return () => { settle(); media.removeEventListener("change", reduced); document.removeEventListener("visibilitychange", background); };
  }, []);
  // hidden 由该节点的呈现器管理，React 不在退出动画开始前抢先隐藏。
  return <div {...props} ref={ref} hidden={initialHidden.current} inert={!visible} aria-hidden={!visible || undefined}>{children}</div>;
}

/** 成功反馈由完成事件递增 signal，不能把每次渲染/挂载当成成功。 */
export function useComponentFeedback(ref: RefObject<HTMLElement | null>, signal: number) {
  const previous = useRef(signal), animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (signal === previous.current) return;
    previous.current = signal; animation.current?.cancel();
    const node = ref.current; if (!node) return;
    const motion = componentMotion(node, "feedback");
    if (motion.duration && node.animate) animation.current = node.animate([{ opacity: .65 }, { opacity: 1 }], { duration: motion.duration, easing: motion.easing });
  }, [signal, ref]);
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => { if (media.matches || document.hidden) { animation.current?.cancel(); animation.current = null; } };
    media.addEventListener("change", settle); document.addEventListener("visibilitychange", settle);
    return () => { animation.current?.cancel(); media.removeEventListener("change", settle); document.removeEventListener("visibilitychange", settle); };
  }, []);
}
