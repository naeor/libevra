/**
 * **提示条的显示宿主**（1.19.66）：每个外壳一个——手机 / Pad 在 `WorkspaceShell` 的 `.lv-shell` 里（S19 材质规则才能命中），
 * 电脑版在 `DesktopShell` 的 `.lv-desktop` 里。它订阅应用级控制器（`ToastProvider`），负责：
 *
 * - **位置**（方案 §3.1）：手机在底栏、“+”、底部操作栏与软键盘之上 8px（量出来，不猜）；分析工作台编辑态
 *   声明了顶部锚点时放在编辑条下方；电脑版在底部操作栏之上 16px；Pad 宽屏这一阶段固定在外壳底部居中。
 * - **账本胶囊让位**（1.19.72，见 `bottomSlot.ts`）：手机提示在底部时，底栏上方的当前账本胶囊先缩回、提示再升起；
 *   提示退场后胶囊再弹回。胶囊因此不是障碍物；它还在原位时，提示的入场推迟到它基本让开。
 * - **让开**（方案 §3.2，所有者决定第 17 条）：任何模态弹层打开（`lib/openOverlay.ts`）或“+”记一笔菜单展开
 *   （`[data-toast-yield]`）时，当前提示退场并暂停计时，关闭后再出现。
 * - **无障碍**（方案 §2.5）：两个播报区挂载即存在、之后只改文字；可见本体在 `aria-label="通知"` 的区域里，
 *   不兼任播报区；出现时不抢焦点；焦点在提示里时 Esc 关闭；提示因操作 / × / 替换消失时焦点回到进入前的元素；
 *   悬停（能悬停的设备）与焦点在提示里时暂停；键盘焦点落到被提示盖住的元素时把它滚到提示外面（WCAG 2.4.11）。
 */
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useI18n } from "../../i18n/index.js";
import { hasOpenOverlay } from "../../lib/openOverlay.js";
import { bottomOffset, centeredSpan, topOffset, type Box } from "../../lib/toast/placement.js";
import type { ToastAnnouncement, ToastView } from "../../lib/toast/types.js";
import { TOAST_WAIT_FOR_GIVE_WAY_MS, ToastBottomSlotContext } from "./bottomSlot.js";
import { ToastCard } from "./Toast.js";
import { useToastController } from "./ToastProvider.js";

export type ToastHostKind = "phone" | "wide" | "desktop";

/** 让开的标记：“+”记一笔菜单展开时由 BottomNav 写上。 */
export const TOAST_YIELD_SELECTOR = "[data-toast-yield]";
/** 底部障碍物：底部操作栏与显式标记的元素（底栏、抬高的“+”）。账本胶囊给提示让位，不是障碍物（1.19.72）。 */
export const TOAST_OBSTACLE_SELECTOR = "[data-lv-bottom-bar], [data-toast-avoid]";
/** 顶部锚点：页面声明“这一阶段提示放在我下面”（分析工作台编辑态的编辑条）。 */
export const TOAST_TOP_ANCHOR_SELECTOR = '[data-toast-anchor="top"]';

const OBSERVED_ATTRIBUTES = [
  "hidden",
  "class",
  "inert",
  "open",
  "aria-modal",
  "aria-hidden",
  "data-overlay-state",
  "data-toast-yield",
  "data-toast-avoid",
  "data-toast-anchor",
  "data-toast-give-way",
  "data-lv-bottom-bar",
];

export function shouldYield(root: Document = document): boolean {
  return hasOpenOverlay(root) || root.querySelector(TOAST_YIELD_SELECTOR) !== null;
}

function shownBox(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // 软键盘打开时底栏与操作栏是 visibility: hidden（s19/motion/navigation.css）：矩形还在，但不算障碍物。
  if (getComputedStyle(element).visibility === "hidden") return null;
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

interface Item {
  readonly key: string;
  readonly view: ToastView<ReactNode>;
}

interface Display {
  readonly current: Item | null;
  readonly leaving: readonly Item[];
}

const EMPTY_DISPLAY: Display = { current: null, leaving: [] };

/** 由快照推出要渲染什么：换了槽位或消失时旧的一条进入退场；合并只换内容、不换 key。纯函数。 */
export function reconcileDisplay(display: Display, shown: ToastView<ReactNode> | null): Display {
  const key = shown === null ? null : `${String(shown.slot)}:${String(shown.appearance)}`;
  const current = display.current;
  if (current === null && key === null) return display;
  if (current !== null && key === current.key) return current.view === shown ? display : { current: { key, view: shown! }, leaving: display.leaving };
  const leaving = current === null ? display.leaving : [...display.leaving, current].slice(-2);
  return { current: key === null ? null : { key, view: shown! }, leaving };
}

/** 键盘焦点（`:focus-visible`）；不支持这个伪类的环境当作不是。 */
function isFocusVisible(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  try {
    return target.matches(":focus-visible");
  } catch {
    return false;
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export function ToastViewport({ kind }: { readonly kind: ToastHostKind }): React.JSX.Element {
  const controller = useToastController();
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const host = useRef<HTMLDivElement | null>(null);
  const region = useRef<HTMLElement | null>(null);
  const probe = useRef<HTMLSpanElement | null>(null);
  const bottomSlot = useContext(ToastBottomSlotContext);
  const active = snapshot.current !== null;

  // ---- 让开判断登记给控制器：新提示进来时先问一次，弹层打开时不会先播报再让开 ----
  useEffect(() => {
    controller.setYieldProbe(() => shouldYield());
    return () => {
      controller.setYieldProbe(null);
    };
  }, [controller]);

  // ---- 位置 ----
  const place = useCallback((): "top" | "bottom" | null => {
    const element = host.current;
    if (element === null || kind === "wide") return null;
    const viewportHeight = window.innerHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    if (kind === "phone") {
      const anchor = [...document.querySelectorAll(TOAST_TOP_ANCHOR_SELECTOR)].map(shownBox).find((box) => box !== null) ?? null;
      if (anchor !== null) {
        element.dataset.placement = "top";
        element.style.setProperty("--lv-toast-offset", `${String(topOffset({ anchorBottom: anchor.bottom, safeTop: 0, gap: 8 }))}px`);
        return "top";
      }
    }
    element.dataset.placement = "bottom";
    const safeBottom = probe.current === null ? 0 : Math.max(0, viewportHeight - probe.current.getBoundingClientRect().top);
    const obstacles: Box[] = [];
    for (const node of document.querySelectorAll(TOAST_OBSTACLE_SELECTOR)) {
      if (element.contains(node)) continue;
      const box = shownBox(node);
      if (box !== null) obstacles.push(box);
    }
    const viewport = window.visualViewport;
    const keyboardCover =
      kind === "phone" && document.documentElement.dataset.softKeyboard === "open" && viewport !== null
        ? Math.max(0, viewportHeight - (viewport.offsetTop + viewport.height))
        : 0;
    const regionBox = region.current?.getBoundingClientRect();
    const span = regionBox !== undefined && regionBox.width > 0 ? { left: regionBox.left, right: regionBox.right } : centeredSpan(viewportWidth);
    const offset = bottomOffset({
      viewportHeight,
      safeBottom,
      span,
      obstacles,
      keyboardCover,
      gap: kind === "desktop" ? 16 : 8,
      edge: kind === "desktop" ? 24 : 16,
    });
    element.style.setProperty("--lv-toast-offset", `${String(offset)}px`);
    return "bottom";
  }, [kind]);

  // 有当前提示时（包括正在让开）才观察：没有提示时不付测量的代价。
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      controller.setPause("yield", shouldYield());
      const placement = place();
      // 底部提示位被占用：手机、放在底部、没有模态弹层（弹层打开时提示藏在遮罩后，胶囊回原位，见 bottomSlot.ts）。
      bottomSlot?.set(kind === "phone" && placement === "bottom" && !hasOpenOverlay());
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
    mutations.observe(document.documentElement, { attributes: true, attributeFilter: ["data-soft-keyboard"] });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    // 吸底的操作栏在内容很短时跟着滚动；捕获阶段才能听到任何滚动容器。
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    return () => {
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      if (frame !== 0) cancelAnimationFrame(frame);
      controller.setPause("yield", false);
      bottomSlot?.set(false);
    };
  }, [active, bottomSlot, controller, kind, place]);

  // ---- 渲染哪几条（当前一条 + 正在退场的） ----
  const shown = snapshot.visible ? snapshot.current : null;
  const [display, setDisplay] = useState<Display>(EMPTY_DISPLAY);
  const next = reconcileDisplay(display, shown);
  if (next !== display) setDisplay(next);
  const removeLeaving = useCallback((key: string) => {
    setDisplay((value) => (value.leaving.some((item) => item.key === key) ? { ...value, leaving: value.leaving.filter((item) => item.key !== key) } : value));
  }, []);
  // 动画被跳过（后台标签页、动画被关）时也要清掉退场中的一条。
  useEffect(() => {
    if (display.leaving.length === 0) return;
    const keys = display.leaving.map((item) => item.key);
    const timer = setTimeout(() => {
      for (const key of keys) removeLeaving(key);
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [display.leaving, removeLeaving]);

  const currentKey = display.current?.key ?? null;

  // ---- 账本胶囊让位（1.19.72）：从“没有提示”到出现一条、而胶囊还在原位时，入场推迟到胶囊基本缩回 ----
  // 换一条（替换、合并）时胶囊已经让开，不等；写在宿主的变量上，入场动画（含 S19 的材质层与内容）都读它。
  // 必须在上面的测量之后：放在底部还是顶部锚点要先量出来。
  const enteredFrom = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = host.current;
    const from = enteredFrom.current;
    enteredFrom.current = currentKey;
    if (element === null || currentKey === null || from === currentKey) return;
    const wait =
      from === null &&
      kind === "phone" &&
      element.dataset.placement === "bottom" &&
      !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) &&
      document.querySelector('[data-toast-give-way="shown"]') !== null;
    element.style.setProperty("--lv-toast-enter-delay", wait ? `${String(TOAST_WAIT_FOR_GIVE_WAY_MS)}ms` : "0ms");
  }, [currentKey, kind]);

  // ---- 焦点：进入提示前在哪里，提示消失后回到哪里 ----
  const returnTo = useRef<HTMLElement | null>(null);
  const focusInside = useRef(false);
  const keyboardFocus = useRef(false);
  const previousKey = useRef<string | null>(currentKey);
  useLayoutEffect(() => {
    if (previousKey.current === currentKey) return;
    previousKey.current = currentKey;
    if (!focusInside.current) return;
    focusInside.current = false;
    controller.setPause("focus", false);
    const target = returnTo.current;
    returnTo.current = null;
    if (target !== null && target.isConnected && !target.closest("[inert]")) {
      target.focus({ preventScroll: true });
      return;
    }
    // 原来的元素已经不在了：键盘用户回到当前页标题（与转场协调器聚焦 h1[tabindex="-1"] 的做法一致）；
    // 鼠标点的 × 不搬动焦点。
    if (keyboardFocus.current) document.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus({ preventScroll: true });
  }, [controller, currentKey]);

  // ---- 悬停暂停：只在能悬停的设备（触屏点一下会粘住 :hover） ----
  const canHover = useRef(false);
  useEffect(() => {
    canHover.current = typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
  }, []);

  // ---- 焦点不被遮挡（WCAG 2.4.11）：键盘焦点落到被提示盖住的元素时，把它滚到提示外面 ----
  useEffect(() => {
    if (display.current === null) return;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      const card = region.current;
      if (!(target instanceof HTMLElement) || card === null || card.contains(target)) return;
      if (!isFocusVisible(target)) return;
      const toast = card.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      if (box.bottom <= toast.top || box.top >= toast.bottom || box.right <= toast.left || box.left >= toast.right) return;
      const top = host.current?.dataset.placement === "top";
      scrollParent(target)?.scrollBy({ top: top ? box.top - toast.bottom - 8 : box.bottom - toast.top + 8 });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [display.current]);

  // ---- 播报 ----
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const announcement = snapshot.announcement;
  useEffect(() => {
    if (announcement === null) return;
    const text = composeAnnouncement(announcement, t);
    // 先清空、下一帧再写：同样的文字也能再读一次；播报区本身一直在 DOM 里（缺陷 8）。
    if (announcement.politeness === "alert") setAssertive("");
    else setPolite("");
    const frame = requestAnimationFrame(() => {
      if (announcement.politeness === "alert") setAssertive(text);
      else setPolite(text);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [announcement, t]);
  useEffect(() => {
    if (active) return;
    setPolite("");
    setAssertive("");
  }, [active]);

  const closeLabel = t("common.toast.close");
  const hasItems = display.current !== null || display.leaving.length > 0;

  return (
    <>
      {/* 量底部安全区：放在宿主外面（宿主有 transform，fixed 子元素会以它为参照）。 */}
      <span ref={probe} className="lv-toast-probe" aria-hidden="true" />
      <div ref={host} className="lv-toast-host" data-toast-host={kind} data-placement="bottom">
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
        <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
          {assertive}
        </div>
        {hasItems ? (
          <section
            ref={region}
            className="lv-toast-region"
            aria-label={t("common.toast.region")}
            onPointerEnter={(event) => {
              if (canHover.current && event.pointerType !== "touch") controller.setPause("hover", true);
            }}
            onPointerLeave={() => {
              controller.setPause("hover", false);
            }}
            onFocus={(event) => {
              if (!focusInside.current) {
                const from = event.relatedTarget;
                returnTo.current = from instanceof HTMLElement && !event.currentTarget.contains(from) ? from : null;
              }
              keyboardFocus.current = isFocusVisible(event.target);
              focusInside.current = true;
              controller.setPause("focus", true);
            }}
            onBlur={(event) => {
              const to = event.relatedTarget;
              if (to instanceof Node && event.currentTarget.contains(to)) return;
              if (to === null) return; // 元素被移除 / 变成 inert：交给上面的焦点归还
              focusInside.current = false;
              controller.setPause("focus", false);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || display.current === null) return;
              event.stopPropagation();
              controller.close(display.current.view.id);
            }}
          >
            {display.leaving.map((item) => (
              <ToastCard key={item.key} view={item.view} phase="exit" closeLabel={closeLabel} onExited={() => removeLeaving(item.key)} />
            ))}
            {display.current === null ? null : (
              <ToastCard
                key={display.current.key}
                view={display.current.view}
                phase="enter"
                closeLabel={closeLabel}
                onAction={() => {
                  controller.runAction(display.current!.view.id);
                }}
                onClose={() => {
                  controller.close(display.current!.view.id);
                }}
              />
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

/** 读屏文字：警告 / 错误加前缀，正文＋第二行，带操作时说明“可撤销”一类。 */
export function composeAnnouncement(announcement: ToastAnnouncement, t: Translate): string {
  const prefix =
    announcement.tone === "warning" ? t("common.toast.warningPrefix") : announcement.tone === "error" ? t("common.toast.errorPrefix") : "";
  const parts = [`${prefix}${announcement.text}`];
  if (announcement.detail !== undefined && announcement.detail !== "") parts.push(announcement.detail);
  if (announcement.actionLabel !== undefined) parts.push(t("common.toast.actionHint", { action: announcement.actionLabel }));
  return parts.join(" ");
}
