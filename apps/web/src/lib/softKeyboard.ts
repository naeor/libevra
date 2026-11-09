/**
 * 软键盘是否打开（S19 记账工作区，1.19.51）。
 *
 * 所有者决定：键盘打开时，底部操作区（保存栏、确认条）与常驻底栏不再跟着键盘抬起，而是像被键盘盖住一样
 * 隐藏；收起键盘后正常出现。Original、深色、四种风格一致——这是布局行为，不是材质。
 *
 * 判定 = 焦点在可输入文字的控件上 **且** 可视区确实被挡住（≥ {@link KEYBOARD_THRESHOLD}px）**且** 没有双指缩放。
 * - iOS Safari：键盘只缩小 visualViewport，布局视口不变 → 看“布局视口底边 − 可视区底边”。
 * - `interactive-widget=resizes-content`（index.html）下的 Android Chrome：布局视口本身变矮 → 再看
 *   “同一宽度下见过的最大高度 − 当前高度”。地址栏伸缩只有几十像素，低于阈值；旋转（宽度变化）重置基线。
 * - 外接键盘、iPad 浮动键盘不挡可视区 → 不判为打开，栏照常显示。
 *
 * 只写 `<html data-soft-keyboard="open|closing">` 与 `--lv-keyboard-inset`，隐藏本身由 CSS 完成
 * （`s19/motion/navigation.css`），不改布局、不锁焦点、不改输入字号。焦点在两个输入框之间切换时有
 * {@link FOCUS_SETTLE_MS} 去抖，不会闪出保存栏；失焦即关闭，所以 iOS 26 收起键盘后可视区偶发不复位
 * （WebKit 已知问题）也不会让栏一直藏着。
 */
export const KEYBOARD_THRESHOLD = 120;
export const FOCUS_SETTLE_MS = 150;
/** 收起后淡入所用的时间窗口；与 `--lv-reveal-ms` 的最大值（220ms）对齐并留余量。 */
export const REVEAL_WINDOW_MS = 260;
/** 键盘打开后，系统自己的滚动结束再检查焦点是否仍被挡住。 */
const REVEAL_FOCUS_DELAY_MS = 320;

const NON_TEXT_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);

/** 会唤起文字键盘的控件（日期 / 时间选择器在 iOS 上若占用可视区，同样按打开处理）。 */
export function isTextEntry(element: Element | null): boolean {
  if (element === null || typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !NON_TEXT_INPUTS.has(element.type);
  return false;
}

export interface KeyboardSample {
  readonly focused: boolean;
  /** 布局视口底边 − 可视区底边（iOS）。 */
  readonly covered: number;
  /** 同一宽度下见过的最大布局高度 − 当前布局高度（Android resizes-content）。 */
  readonly shrunk: number;
  readonly scale: number;
}

/** 纯判定，便于单测。 */
export function keyboardOpen(sample: KeyboardSample): boolean {
  if (!sample.focused || sample.scale > 1.01) return false;
  return sample.covered >= KEYBOARD_THRESHOLD || sample.shrunk >= KEYBOARD_THRESHOLD;
}

/** 被键盘挡住的高度（布局视口坐标）；没有键盘或缩放时为 0。 */
export function coveredHeight(layoutHeight: number, viewportTop: number, viewportHeight: number): number {
  return Math.max(0, Math.round(layoutHeight - (viewportTop + viewportHeight)));
}

type Listener = () => void;
const listeners = new Set<Listener>();
let open = false;

export function softKeyboardOpen(): boolean {
  return open;
}

export function subscribeSoftKeyboard(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let users = 0;
let stop: (() => void) | null = null;

/** 由手机外壳启动；多处调用共享一份运行时，最后一个调用者释放时清理。 */
export function startSoftKeyboard(): () => void {
  users += 1;
  if (users === 1) stop = run();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) { stop?.(); stop = null; }
  };
}

function run(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let reveal: ReturnType<typeof setTimeout> | null = null;
  let focusCheck: ReturnType<typeof setTimeout> | null = null;
  let baseline = { width: window.innerWidth, height: window.innerHeight };

  const write = (next: boolean, inset: number): void => {
    if (next) root.style.setProperty("--lv-keyboard-inset", `${inset}px`);
    if (next === open) return;
    open = next;
    if (reveal !== null) { clearTimeout(reveal); reveal = null; }
    if (next) {
      root.dataset.softKeyboard = "open";
      scheduleFocusCheck();
    } else {
      root.style.removeProperty("--lv-keyboard-inset");
      root.dataset.softKeyboard = "closing";
      reveal = setTimeout(() => { reveal = null; if (!open) delete root.dataset.softKeyboard; }, REVEAL_WINDOW_MS);
    }
    for (const listener of listeners) listener();
  };

  const update = (): void => {
    frame = 0;
    const height = window.innerHeight, width = window.innerWidth;
    if (width !== baseline.width) baseline = { width, height };
    else if (height > baseline.height) baseline = { width, height };
    const layout = root.clientHeight || height;
    const covered = viewport ? coveredHeight(layout, viewport.offsetTop, viewport.height) : 0;
    const sample: KeyboardSample = {
      focused: isTextEntry(document.activeElement),
      covered,
      shrunk: Math.max(0, baseline.height - height),
      scale: viewport?.scale ?? 1,
    };
    write(keyboardOpen(sample), covered);
  };
  const schedule = (): void => { if (frame === 0) frame = window.requestAnimationFrame(update); };
  const onFocusIn = (): void => {
    if (settle !== null) { clearTimeout(settle); settle = null; }
    schedule();
    if (open) scheduleFocusCheck();
  };
  // 失焦时 activeElement 还没换到下一个控件；等一小段再判定，切换输入框时不闪出保存栏。
  const onFocusOut = (): void => {
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => { settle = null; schedule(); }, FOCUS_SETTLE_MS);
  };

  /**
   * 键盘打开后焦点仍被挡住时，把最近的可滚动祖先滚一点，让输入区域露在键盘上方。
   * 先等系统自己的滚动结束；已经可见就什么都不做，比可视区还高的控件（多行文本）不强行对齐。
   */
  function scheduleFocusCheck(): void {
    if (focusCheck !== null) clearTimeout(focusCheck);
    focusCheck = setTimeout(() => {
      focusCheck = null;
      const element = document.activeElement;
      if (!open || !viewport || !(element instanceof HTMLElement) || !isTextEntry(element)) return;
      const rect = element.getBoundingClientRect();
      const visibleTop = viewport.offsetTop, visibleBottom = viewport.offsetTop + viewport.height - 12;
      const overflow = rect.bottom - visibleBottom;
      if (overflow <= 0 || rect.height > visibleBottom - visibleTop) return;
      const scroller = scrollParent(element);
      scroller.scrollBy({ top: overflow, behavior: "instant" as ScrollBehavior });
    }, REVEAL_FOCUS_DELAY_MS);
  }

  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  update();

  return () => {
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    if (frame !== 0) window.cancelAnimationFrame(frame);
    for (const timer of [settle, reveal, focusCheck]) if (timer !== null) clearTimeout(timer);
    open = false;
    delete root.dataset.softKeyboard;
    root.style.removeProperty("--lv-keyboard-inset");
  };
}

function scrollParent(element: HTMLElement): Element {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}
