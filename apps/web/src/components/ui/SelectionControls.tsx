import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type MouseEvent, type ReactNode, type RefObject } from "react";
import { SELECTION_DURATION, selectionFrames, type SelectionBox } from "./selectionMotion.js";
import {
  focusAfterRemoval, glideFrames, reconcileTags, selectionMotion, selectionStyleOf, slideFrames,
  type ConditionTagEntry, type ConditionTagItem, type ConditionTagState, type SelectionAxis, type SelectionBase,
} from "./selectionModel.js";
import "./selection-controls.css";

export type { ConditionTagItem, ConditionTagState, SelectionAxis, SelectionBase } from "./selectionModel.js";

/**
 * **选中指示与已选条件标签（1.19.62，规格 S19 §3「选中指示」「条件标签」）。**
 *
 * 四种风格同一个模型，区别只在外观与动效性格（外观在 `selection-controls.css`，参数在 Motion Token）：
 * - `MovingSelection` 会移动的选中（竖向导航、横向分段）：B1 / B2 一块不染色的模拟玻璃按底栏胶囊的弹性规则滑到新选项；
 *   A 没有色块，选中项自己按 A2 档浮起；C 浅绿实底整块干脆滑动。选中文字都变品牌绿。
 * - `SelectionGrid` 网格选中（月份格）：B1 / B2 玻璃在旧格淡出、新格淡入；A 选中格浮起；C 交叉淡化。
 * - `SelectionItem` 独立的选中项（多选列表的行、单个选项，1.19.65）：与网格选中同一规则，每一项各自淡入淡出 / 浮起。
 * - `ConditionTags` 已选条件标签（可删除的对象）：出现时轻微放大淡入，删除时缩小淡出；删除命中区约 44px 高。
 *
 * 选项按钮、角色与 aria（tablist / tab / aria-selected、group / aria-pressed）、点击与键盘行为全部由调用方保留；
 * 这里只加一块 `aria-hidden` 的选中块和 data 属性。怎么选：同一时间只有一项被选中、选项排成一行或一列 → `MovingSelection`；
 * 可以同时选中几项（多选列表）、换行排列的小组、或单独的一个选项 → `SelectionGrid` / `SelectionItem`；开关按钮（开 / 关，1.19.67）→
 * `ToggleButton`，开启状态与独立选中项同一外观。Original、深色、Pad 与电脑版回落基础外观；减少动态效果时直接切换。
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
 * 其余属性（role、aria-label、onKeyDown……）原样落在容器上。`base` 只决定基础外观（Original、深色、Pad、电脑版）：
 * 默认 `static` 不显示选中块；`slide` 给原来就有滑动胶囊的共享分段控件（胶囊外观由调用方的样式给出）；
 * `copy`（1.19.67）给 `SlidingSelection`：胶囊外观逐项复制选中按钮原来的计算样式。两种滑动都保留原 200ms 节奏（`selectionMotion.ts`）。
 * S19 浅色手机外壳里三者一样，按风格画选中块或浮起。
 * 容器本身是一条分段轨道（A0 底槽）时写 `data-select-track=""`（1.19.73）：A 风格下选中项用轨道内 A2，原地不位移；
 * 不写的（竖向导航、没有底槽的分段、平铺 / 胶囊组）保留完整 A2 浮起——旧选中项沉回平面，新选中项浮起。
 */
export function MovingSelection({ axis, base = "static", hostRef, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  axis: SelectionAxis;
  base?: SelectionBase;
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
    if (base === "copy" && selectionStyleOf(root) === null) {
      // 基础外观：选中块逐项复制选中按钮原来的外观。先撤下就绪标记读出原样（同步完成，不经过绘制帧，不复制文字或交互节点）；
      // 按钮在这种模式下只过渡颜色与滤镜（selection-controls.css），撤下再挂回不会触发底色过渡。
      delete root.dataset.selectReady;
      const paint = getComputedStyle(selected);
      Object.assign(block.style, { background: paint.background, boxShadow: paint.boxShadow, borderRadius: paint.borderRadius, border: paint.border, opacity: paint.opacity });
    } else {
      // S19：外观全部由 CSS 按风格给出；从基础外观切过来时清掉复制的内联外观，只保留跟随选中项的圆角。
      if (base === "copy") Object.assign(block.style, { background: "", boxShadow: "", border: "", opacity: "" });
      block.style.borderRadius = getComputedStyle(selected).borderRadius;
    }
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

  return <div {...props} ref={rootRef} data-select-moving="" data-axis={axis} data-select-base={base === "static" ? undefined : base}>
    {children}
    <span ref={blockRef} data-select-block="" aria-hidden="true" />
  </div>;
}

/**
 * 网格选中（月份格、会折行的互斥小组等）：子元素是调用方自己的 `<button aria-pressed>`；外观与动画全部由 CSS 按风格给出，可以同时选中多格。
 * 1.19.73：A 风格下会折行的互斥小组用轨道内 A2（原地不位移）；日历式的格子（月份格）写 `data-select-cells`、头像写 `data-select-plain`，
 * 仍用完整 A2 浮起（上移、放大）。
 */
export function SelectionGrid(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-select-grid="" />;
}

/**
 * 独立的选中项（1.19.65）：多选列表的行（每行各自选中，可以同时选中几行，例如筛选面板的“不限 / CNY · 人民币 ✓”），
 * 以及不在同一组里滑动的单个选项（“全部时间”“只看自己”）。按网格选中的规则表现：B1 / B2 玻璃在这一项上淡入淡出，
 * A 这一项自己按 A2 档浮起（放大取 `--s19-a-lift-scale`，不用月份格的放大），C 浅绿实底淡入淡出；选中文字变品牌绿。
 * 不要求放在某个容器的直接子元素位置（列表行里常有展开按钮等兄弟元素）。渲染的就是调用方的 `<button type="button">`，
 * 以 `aria-pressed` / `aria-selected` / `aria-checked` 标出选中；只加 `data-select-item` 钩子，基础外观由调用方的样式给出。
 */
export function SelectionItem(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return <button type="button" {...props} data-select-item="" />;
}

/**
 * 开关按钮（1.19.67，规格 S19 §3「怎么选」的“开关按钮”一行）：只有开 / 关两种状态、表示一种模式是否打开
 * （筛选标题行“多选”、分析卡片编辑器的“替换”），再点一次就关。保持开关语义——就是调用方的
 * `<button type="button" aria-pressed>`，不改成 `Switch`（`role="switch"` 要轨道，标题行放不下），也不改成 `CapsuleButton`
 * （会改变 Original 的尺寸与描边）。开启时在 S19 浅色手机外壳里按选中模型表现：B1 / B2 透明模拟玻璃淡入、A 按 A2 档浮起、
 * C 浅绿实底，文字变品牌绿；关闭时回到调用方的普通按钮。材质只画在 `::before`（调用方常用 `::after` 扩大命中区）。
 * Original、深色、Pad、电脑版用调用方自己的开启样式。只多一个 `data-select-toggle` 钩子。
 */
export function ToggleButton({ pressed, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & { pressed: boolean }) {
  return <button type="button" {...props} aria-pressed={pressed} data-select-toggle="" />;
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
