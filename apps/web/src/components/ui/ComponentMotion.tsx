import { useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import { S19_SCOPE_SELECTOR, s19Style } from "../../s19/scope.js";
import "./component-motion.css";

export type ComponentMotionKind = "press" | "select" | "reveal" | "dismiss" | "feedback" | "loading";
export function componentMotion(element: HTMLElement, kind: ComponentMotionKind) {
  const css = getComputedStyle(element);
  const enabled = !!element.closest(S19_SCOPE_SELECTOR) && s19Style(document.documentElement.dataset.visualStyle) !== null;
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

/**
 * 页面转场正在播放（A / B1 / C 的舞台在场，或 B2 的 View Transition 标记了方向）。
 * 这时新页面里“一挂载就在”的内容属于页面本身，不另做入场——页面转场已经负责了它的出现。
 */
export function pageTransitionActive(): boolean {
  return typeof document !== "undefined" && (document.querySelector(".s19-abc-stage, .s19-abc-plane") !== null || document.documentElement.dataset.motionDirection !== undefined);
}

const reduced = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * **展开块**（1.19.76，S19 §5 Reveal / Dismiss 的文档流版本）：在页面里展开 / 收起的一块内容（记一笔的“分类”“快捷金额”
 * “更多选项”、行内下拉、行内编辑……）。打开时高度从 0 展开到内容高度、内容淡入并从上方轻移到位，下面的内容随高度平滑让位；
 * 收起时反向，结束后 `hidden`（不可聚焦、读屏跳过）。中途反向从当前高度接着走，不跳。
 *
 * - 只在 S19 浅色手机外壳里有动画（时长读 `--lv-reveal-ms` / `--lv-dismiss-ms`）；Original、深色、Pad、电脑版与减少动态效果直接显隐。
 * - 初次挂载不入场：`open` 一开始就是 true 时直接显示。
 * - `lazy`（默认）：第一次打开前不挂载内容；打开过之后一直挂载，收起时内容状态不丢。
 * - `keep={false}`：收起动画走完后卸载内容（下次打开从头开始，与原来“收起即卸载”的行为一致，例如分类选择器回到第一层）。
 * - 外层是一个块：放在带 `gap` 的 flex / grid 里时，收起状态是 `hidden`，不占间距；展开开始的一瞬间间距会出现（与内容一起被高度动画带出）。
 */
export function Reveal({ open, lazy = true, keep = true, children, style, ...props }: HTMLAttributes<HTMLDivElement> & { readonly open: boolean; readonly lazy?: boolean; readonly keep?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open || !lazy);
  if (open && !mounted) setMounted(true);
  const initialHidden = useRef(!open);
  const previous = useRef(open);
  const latest = useRef(open); latest.current = open;
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || previous.current === open) return;
    previous.current = open;
    const from = node.hidden ? 0 : node.getBoundingClientRect().height;
    const fromOpacity = node.hidden ? "0" : getComputedStyle(node).opacity;
    animation.current?.cancel(); animation.current = null;
    node.hidden = false;
    const motion = componentMotion(node, open ? "reveal" : "dismiss");
    if (!motion.duration || !node.animate) { node.hidden = !open; if (!open && !keep) setMounted(false); return; }
    const full = node.getBoundingClientRect().height;
    const lift = `translateY(${String(-Math.min(motion.y, 6))}px)`;
    const run = node.animate(
      open
        ? [{ height: `${String(from)}px`, opacity: fromOpacity, transform: from === 0 ? lift : "none", overflow: "hidden" }, { height: `${String(full)}px`, opacity: "1", transform: "none", overflow: "hidden" }]
        : [{ height: `${String(from)}px`, opacity: fromOpacity, transform: "none", overflow: "hidden" }, { height: "0px", opacity: "0", transform: lift, overflow: "hidden" }],
      { duration: motion.duration, easing: motion.easing },
    );
    animation.current = run;
    run.onfinish = () => { if (animation.current !== run) return; animation.current = null; node.hidden = !latest.current; if (!latest.current && !keep) setMounted(false); };
  }, [open, keep]);
  useLayoutEffect(() => {
    const node = ref.current;
    const settle = (): void => { animation.current?.cancel(); animation.current = null; if (node) node.hidden = !latest.current; };
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    const onReduced = (): void => { if (media?.matches) settle(); };
    const onHidden = (): void => { if (document.hidden) settle(); };
    media?.addEventListener("change", onReduced); document.addEventListener("visibilitychange", onHidden);
    return () => { animation.current?.cancel(); media?.removeEventListener("change", onReduced); document.removeEventListener("visibilitychange", onHidden); };
  }, []);
  // hidden 由呈现器管理（收起动画走完才隐藏），React 只给初值。
  return <div {...props} ref={ref} style={style} data-reveal="" hidden={initialHidden.current} inert={!open || undefined}>{mounted ? children : null}</div>;
}

/**
 * **内容切换**（1.19.76）：同一块位置换成另一份内容时（明细切换全部 / 支出 / 收入、筛选面板左侧换维度、页内多步流程换一步、
 * 查看 ↔ 编辑），新内容淡入并从下方轻移到位，不再一帧硬切。不重新挂载内容（不丢状态、不重置滚动与懒加载）；
 * `key` 第一次的值不播放（初次挂载不入场），之后每次变化播放一次。时长读 `--lv-reveal-ms`。
 */
export function useSwapReveal(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const previous = useRef(key), animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    animation.current?.cancel(); animation.current = null;
    const node = ref.current;
    if (!node?.animate) return;
    const motion = componentMotion(node, "reveal");
    if (!motion.duration) return;
    animation.current = node.animate([{ opacity: 0, transform: `translateY(${String(motion.y)}px)` }, { opacity: 1, transform: "none" }], { duration: motion.duration, easing: motion.easing });
  }, [key, ref]);
  useLayoutEffect(() => () => { animation.current?.cancel(); }, []);
}

/**
 * **挂载即出现**（1.19.76）：条件挂载、之后才出现的小块（行内提示 `Alert` / `InlineMessage`、状态行）展开到位：
 * 高度从 0 展开（下面的内容平滑让位）、同时淡入。初次随页面一起出现的（页面转场正在播放时挂载的）不做，页面转场已经负责。
 * 只做出现；消失仍是直接卸载（不为退场把节点多留一段，避免读屏与焦点问题）。`role="alert"` 等播报不受影响（节点立即挂载）。
 */
export function useMountReveal(ref: RefObject<HTMLElement | null>, options: { readonly height?: boolean } = {}): void {
  const height = options.height ?? true;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node?.animate || reduced() || pageTransitionActive()) return;
    const motion = componentMotion(node, "reveal");
    if (!motion.duration) return;
    const full = node.getBoundingClientRect().height;
    const frames: Keyframe[] = height
      ? [{ height: "0px", opacity: 0, overflow: "hidden" }, { height: `${String(full)}px`, opacity: 1, overflow: "hidden" }]
      : [{ opacity: 0, transform: `translateY(${String(motion.y)}px)` }, { opacity: 1, transform: "none" }];
    const run = node.animate(frames, { duration: motion.duration, easing: motion.easing });
    return () => { run.cancel(); };
  }, [ref, height]);
}

/**
 * **列表增删**（1.19.76）：列表的项变化时（管理页添加 / 归档 / 删除、附件增删、留言追加……），
 * 新出现的项展开到位（高度从 0 + 淡入），留下的项从原位置平滑移到新位置（FLIP：只动 transform）——
 * 删除一项时下面的项平滑补上，而不是一帧跳上去。被删的项本身直接卸载（不为退场把节点多留一段，避免读屏与焦点问题）。
 *
 * - `ref` 指向列表容器，作用于它的直接子元素（React 按 key 复用节点，同一个节点就是同一项）；
 * - `signal` 变化时才比较（一般传项的 id 串或数组）；第一次渲染不播放（初次挂载不入场），容器节点换了也按第一次处理，页面转场进行中也不播放；
 * - 只在 S19 浅色手机外壳里播放（时长读 `--lv-reveal-ms`），其他外观与减少动态效果直接变化。
 */
export function useListMotion(ref: RefObject<HTMLElement | null>, signal: unknown): void {
  const positions = useRef(new Map<Element, number>());
  const first = useRef(true);
  const previous = useRef(signal);
  const owner = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    // 容器本身换了（例如按分组 key 重新挂载）：当作第一次渲染，不把整组当成新项。
    if (container !== owner.current) { owner.current = container; first.current = true; }
    const children = Array.from(container.children) as HTMLElement[];
    const changed = !Object.is(previous.current, signal);
    previous.current = signal;
    const before = positions.current;
    const next = new Map<Element, number>();
    for (const child of children) next.set(child, child.getBoundingClientRect().top);
    positions.current = next;
    if (first.current) { first.current = false; return; }
    if (!changed || !container.animate || reduced() || pageTransitionActive()) return;
    const motion = componentMotion(container, "reveal");
    if (!motion.duration) return;
    // 新项的高度动画会把它下面的项“自然地”往下推（布局负责），所以位移补偿要扣掉上方新项的高度，只补删除与重排造成的跳动。
    let grownAbove = 0;
    for (const child of children) {
      const old = before.get(child);
      const now = next.get(child)!;
      if (old === undefined) {
        const height = child.getBoundingClientRect().height;
        grownAbove += height;
        child.animate([{ height: "0px", opacity: 0, overflow: "hidden" }, { height: `${String(height)}px`, opacity: 1, overflow: "hidden" }], { duration: motion.duration, easing: motion.easing });
        continue;
      }
      const offset = old - (now - grownAbove);
      if (Math.abs(offset) > 0.5) child.animate([{ transform: `translateY(${String(offset)}px)` }, { transform: "none" }], { duration: motion.duration, easing: motion.easing });
    }
  });
}

