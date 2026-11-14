import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from "react";
import { SELECTION_DURATION, selectionFrames, type SelectionBox } from "./selectionMotion.js";
import {
  focusAfterRemoval, glideFrames, reconcileTags, selectionMotion, selectionStyleOf, slideFrames,
  type ConditionTagEntry, type ConditionTagItem, type ConditionTagState, type SelectionAxis,
} from "./selectionModel.js";
import "./selection-controls.css";

export type { ConditionTagItem, ConditionTagState, SelectionAxis } from "./selectionModel.js";

/**
 * **选中指示与已选条件标签（1.19.62，规格 S19 §3「选中指示」「条件标签」）。**
 *
 * 四种风格同一个模型，区别只在外观与动效性格（外观在 `selection-controls.css`，参数在 Motion Token）：
 * - `MovingSelection` 会移动的选中（竖向导航、横向分段）：B1 / B2 一块不染色的模拟玻璃按底栏胶囊的弹性规则滑到新选项；
 *   A 没有色块，选中项自己按 A2 档浮起；C 浅绿实底整块干脆滑动。选中文字都变品牌绿。
 * - `SelectionGrid` 网格选中（月份格）：B1 / B2 玻璃在旧格淡出、新格淡入；A 选中格浮起；C 交叉淡化。
 * - `ConditionTags` 已选条件标签（可删除的对象）：出现时轻微放大淡入，删除时缩小淡出；删除命中区约 44px 高。
 *
 * 选项按钮、角色与 aria（tablist / tab / aria-selected、group / aria-pressed）、点击与键盘行为全部由调用方保留；
 * 这里只加一块 `aria-hidden` 的选中块和 data 属性。Original、深色、Pad 与电脑版回落基础外观；减少动态效果时直接切换。
 */

const SELECTED = ':scope > button:is([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"])';

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 选中按钮相对容器内边距框（含滚动）的位置与尺寸。A 浮起时按钮带 transform，改用不受变换影响的布局尺寸。 */
function boxOf(button: HTMLElement, root: HTMLElement): SelectionBox {
  const transform = getComputedStyle(button).transform;
  if (transform !== "" && transform !== "none") return { x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight };
  const r = button.getBoundingClientRect(), p = root.getBoundingClientRect();
  return { x: r.left - p.left + root.scrollLeft - root.clientLeft, y: r.top - p.top + root.scrollTop - root.clientTop, width: r.width, height: r.height };
}

/** 选中块此刻在屏幕上的位置（动画途中被打断时从这里接着走）。 */
function visualBox(block: HTMLElement, root: HTMLElement): SelectionBox {
  const r = block.getBoundingClientRect(), p = root.getBoundingClientRect();
  return { x: r.left - p.left + root.scrollLeft - root.clientLeft, y: r.top - p.top + root.scrollTop - root.clientTop, width: r.width, height: r.height };
}

const moved = (a: SelectionBox, b: SelectionBox): boolean => (Object.keys(a) as (keyof SelectionBox)[]).some(key => Math.abs(a[key] - b[key]) > 0.25);

/**
 * 会移动的选中。子元素是调用方自己的 `<button>`（直接子元素），以 `aria-selected` / `aria-pressed` / `aria-checked` 标出选中项；
 * 其余属性（role、aria-label、onKeyDown……）原样落在容器上。`base="slide"` 只给原来就有滑动胶囊的共享分段控件：
 * 基础外观里保留那块胶囊和它的 200ms 滑动（`selectionMotion.ts`）。
 */
export function MovingSelection({ axis, base = "static", hostRef, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  axis: SelectionAxis;
  base?: "static" | "slide";
  hostRef?: RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const rootRef = hostRef ?? localRef;
  const blockRef = useRef<HTMLSpanElement>(null);
  const running = useRef<Animation | null>(null);
  const previous = useRef<{ button: HTMLElement; box: SelectionBox } | null>(null);
  const syncRef = useRef<(animate: boolean) => void>(() => undefined);

  syncRef.current = (animate) => {
    const root = rootRef.current, block = blockRef.current;
    if (!root || !block) return;
    const selected = root.querySelector<HTMLElement>(SELECTED);
    if (!selected || selected.matches(":disabled") || root.getClientRects().length === 0 || selected.getClientRects().length === 0) {
      running.current?.cancel(); running.current = null; previous.current = null;
      delete root.dataset.selectReady;
      return;
    }
    const to = boxOf(selected, root), old = previous.current;
    // 被新的选择打断：从选中块此刻的位置接着走，不排队。
    const from = running.current?.playState === "running" ? visualBox(block, root) : old?.box ?? to;
    block.style.borderRadius = getComputedStyle(selected).borderRadius;
    root.dataset.selectReady = "true";
    if (old && old.button === selected && !moved(old.box, to)) return;
    running.current?.cancel(); running.current = null;
    Object.assign(block.style, { transform: `translate3d(${to.x}px, ${to.y}px, 0)`, width: `${to.width}px`, height: `${to.height}px` });
    previous.current = { button: selected, box: to };
    if (!animate || !old || old.button === selected || typeof block.animate !== "function") return;
    const motion = selectionMotion(selectionStyleOf(root), base, reducedMotion());
    if (motion === "none") return;
    const plan = motion === "glide" ? glideFrames(from, to, axis) : motion === "slide" ? slideFrames(from, to, axis)
      : { frames: selectionFrames(from, to), duration: SELECTION_DURATION };
    const run = block.animate(plan.frames, { duration: plan.duration });
    running.current = run;
    run.onfinish = () => { if (running.current === run) running.current = null; };
  };

  useLayoutEffect(() => { syncRef.current(true); });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // 窗口、字体、风格或主题变化后选项位置会变：重新对齐，不播放动画。
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => syncRef.current(false));
    resize?.observe(root);
    root.querySelectorAll(":scope > button").forEach(button => resize?.observe(button));
    const theme = new MutationObserver(() => syncRef.current(false));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-visual-style", "data-theme-mode", "data-theme-palette"] });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { running.current?.cancel(); running.current = null; syncRef.current(false); };
    media.addEventListener("change", stop);
    return () => {
      resize?.disconnect(); theme.disconnect(); media.removeEventListener("change", stop);
      running.current?.cancel(); running.current = null; previous.current = null; delete root.dataset.selectReady;
    };
  }, [rootRef]);

  return <div {...props} ref={rootRef} data-select-moving="" data-axis={axis} data-select-base={base === "slide" ? "slide" : undefined}>
    {children}
    <span ref={blockRef} data-select-block="" aria-hidden="true" />
  </div>;
}

/** 网格选中（月份格等）：子元素是调用方自己的 `<button aria-pressed>`；外观与动画全部由 CSS 按风格给出，可以同时选中多格。 */
export function SelectionGrid(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-select-grid="" />;
}

/**
 * 单个已选条件标签：整个标签就是删除按钮（与原来一样点哪里都删除），可访问名称是 `removeLabel`；
 * 视觉高度不变，命中区由伪元素上下扩到约 44px。退场中的标签 `inert`，不可聚焦、不进辅助技术树。
 */
export function ConditionTag({ item, state = "rest", buttonRef, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title" | "aria-label" | "type"> & {
  item: ConditionTagItem;
  state?: ConditionTagState;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}) {
  const out = state === "out";
  return <button {...props} ref={buttonRef} type="button" data-cond-tag="" data-state={state} title={item.title} aria-label={item.removeLabel}
    inert={out || undefined} aria-hidden={out || undefined} tabIndex={out ? -1 : props.tabIndex}>
    <span data-cond-tag-label="">{item.label}</span><span data-cond-tag-x="" aria-hidden="true">×</span>
  </button>;
}

const sameItems = (a: readonly ConditionTagItem[], b: readonly ConditionTagItem[]): boolean =>
  a.length === b.length && a.every((item, i) => item.key === b[i]!.key && item.label === b[i]!.label && item.removeLabel === b[i]!.removeLabel && item.title === b[i]!.title);

/**
 * 已选条件标签组。`items` 是当前生效的条件（每次渲染可以是新数组）；点标签调用 `onRemove(key)`，由调用方改自己的条件，
 * 条件消失后标签在原位置缩小淡出再移除。初次挂载不播放出现动画。用键盘删除时焦点交给后一个（没有就前一个）标签，
 * 都没有时交给标签组本身。`empty` 在没有任何标签（含正在退场的）时显示。
 */
export function ConditionTags({ items, onRemove, empty, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  items: readonly ConditionTagItem[];
  onRemove: (key: string) => void;
  empty?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const timers = useRef(new Map<string, number>());
  const pendingFocus = useRef<string | null | undefined>(undefined);
  const [entries, setEntries] = useState<ConditionTagEntry[]>(() => items.map(item => ({ item, state: "rest" })));
  const [seen, setSeen] = useState(items);
  if (seen !== items && !sameItems(seen, items)) {
    // 条件变化时在渲染中直接对齐（React 的“由属性派生状态”写法），退场的标签不会少画一帧。
    setSeen(items);
    setEntries(reconcileTags(entries, items));
  }

  const drop = (key: string): void => {
    const timer = timers.current.get(key);
    if (timer !== undefined) { window.clearTimeout(timer); timers.current.delete(key); }
    setEntries(old => old.filter(entry => !(entry.item.key === key && entry.state === "out")));
  };
  const settle = (key: string): void => setEntries(old => old.map(entry => entry.item.key === key && entry.state === "in" ? { ...entry, state: "rest" } : entry));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || entries.every(entry => entry.state === "rest")) return;
    if (selectionStyleOf(root) === null || reducedMotion()) {
      // 基础外观与减少动态效果：没有出现 / 删除动画，直接到位（在绘制之前）。
      setEntries(old => old.filter(entry => entry.state !== "out").map(entry => entry.state === "in" ? { ...entry, state: "rest" } : entry));
      return;
    }
    // 动画结束事件的兜底（页面隐藏、元素被裁掉时可能收不到）。
    for (const entry of entries) {
      if (entry.state !== "out" || timers.current.has(entry.item.key)) continue;
      const element = buttons.current.get(entry.item.key);
      const ms = element ? parseFloat(getComputedStyle(element).animationDuration) * 1000 : 0;
      timers.current.set(entry.item.key, window.setTimeout(() => drop(entry.item.key), (Number.isFinite(ms) ? ms : 0) + 120));
    }
  }, [entries]);
  useLayoutEffect(() => {
    if (pendingFocus.current === undefined) return;
    const target = pendingFocus.current;
    pendingFocus.current = undefined;
    (target === null ? rootRef.current : buttons.current.get(target) ?? rootRef.current)?.focus();
  });
  useLayoutEffect(() => () => { timers.current.forEach(timer => window.clearTimeout(timer)); timers.current.clear(); }, []);

  const remove = (key: string, event: MouseEvent<HTMLButtonElement>): void => {
    if (document.activeElement === event.currentTarget) pendingFocus.current = focusAfterRemoval(entries, key);
    onRemove(key);
  };

  return <div role="group" tabIndex={-1} {...props} ref={rootRef} data-cond-tags="">
    {entries.length === 0 ? empty : entries.map(({ item, state }) => <ConditionTag key={item.key} item={item} state={state}
      buttonRef={element => { if (element) buttons.current.set(item.key, element); else buttons.current.delete(item.key); }}
      {...(state === "out" ? {} : { onClick: (event: MouseEvent<HTMLButtonElement>) => remove(item.key, event) })}
      onAnimationEnd={event => {
        if (event.target !== event.currentTarget) return;
        if (state === "out") drop(item.key); else if (state === "in") settle(item.key);
      }} />)}
  </div>;
}
