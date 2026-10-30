/**
 * **「在指定工作区打开」：任何可导航入口共用的长按 / 拖动 / 右键菜单**（S18 第二轮）。
 *
 * 一个入口只要声明「它通往哪一页、叫什么」，就能：
 * - 触屏长按约 0.4 秒浮起，拖到主工作区或辅助工作区松手，在那里打开；
 * - 鼠标按住拖动越过几像素即进入拖动；
 * - 右键 / 长按后原地松手 / 键盘菜单键：弹出「在主工作区打开 · 在辅助工作区打开」。
 *
 * ⚠️ **只给「去往某一页」的入口用。** 删除、保存、开关、菜单、输入框这类就地执行的操作不调用它，
 * 所以它们的点击、长按与原来完全一样。手机界面（没有大屏外壳）时整个机制不启用，入口的行为一个字不变。
 *
 * ⚠️ **与滚动的分工**：长按之前手指一动，就是一次滚动——立即放弃，不阻止浏览器滚动；只有浮起之后才
 * 拦截 `touchmove`。同时关闭 iOS 的长按菜单、文字选择与原生链接拖拽，不让它们与这里的长按抢同一个手势。
 *
 * ⚠️ **非被动的 `touchmove` 监听必须在手指按下之前就挂在入口上**（第三轮，iPad 实测拖动成功率低的原因）。
 * iOS Safari 在一次触摸开始时就决定这次触摸要不要等页面处理 `touchmove`：浮起之后才临时挂上的监听，
 * 对这一次触摸已经来不及——`preventDefault()` 被忽略，浏览器开始滚动并发出 `pointercancel`，浮起的
 * 入口闪一下就复原（视频里的「频闪、拖不动」）。所以监听随入口一起挂上，平时什么都不做（不阻止滚动），
 * 只在浮起 / 拖动中才 `preventDefault()`。
 *
 * ⚠️ **1.17.24（所有者 iPad 录屏：浮起后一移动就「闪一下、复原」，偶尔能成功）还做了两件事。**
 * 1. 拖动开始时不再改动手指按着的那一行所在的滚动区与工作区（不加 `filter` / `transform` / `opacity`，
 *    模糊改由上层遮罩的 `backdrop-filter` 完成，见 workspace.css）。iPad 上改变滚动区或它祖先的合成方式，
 *    系统会把进行中的触摸当作被打断。
 * 2. 浮起之后即使收到 `pointercancel` / `lostpointercapture`，只要手指还按着，就改由触摸事件继续这次拖动；
 *    真正的结束以 `touchend` / `touchcancel` 为准。触屏也不再显式 `setPointerCapture`（触摸指针本来就随手指）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { useI18n } from "../i18n/index.js";
import { useViewBookId } from "../lib/workspaceLedger.js";
import { useWorkspaceView, usePane } from "./context.js";
import { navDrag, type DragPayload } from "./navDrag.js";

export const LONG_PRESS_MS = 380;
export const DRAG_SLOP = 8;

/**
 * 属于某一本账的页面：拖到另一个工作区后仍应显示**来源那本账**里的内容（一笔明细、一张分析卡片、
 * 这本账的成员与编辑记录）。主导航目的地与账户级页面不算——它们在目标工作区按那里自己的账本显示。
 */
export function isLedgerScopedPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? path;
  return pathname.startsWith("/transactions/") || pathname.startsWith("/stats/cards/") || pathname.startsWith("/ledger/");
}

/**
 * 适合「在另一个工作区打开」的页面。拍照 / 语音 / 粘贴 / 导入这些**带着进行中流程**的入口、登录与公开
 * 页面不参与：它们要么依赖当前页面交给它的文件与状态，要么根本不属于工作区。
 */
export function isOpenablePath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? path;
  if (!pathname.startsWith("/")) return false;
  const blocked = ["/scan", "/record", "/paste", "/voice", "/ocr", "/import", "/import-ledger", "/join", "/login", "/register", "/recover", "/recover-archive", "/guest"];
  return !blocked.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export interface OpenDragOptions {
  readonly path: string;
  readonly title: string;
  readonly disabled?: boolean;
  /** 侧栏里的入口不属于任何工作区。 */
  readonly fromRail?: boolean;
  readonly ledger?: string | null;
  /** 账本行保留自己的完整菜单。 */
  readonly onMenu?: (point: { readonly x: number; readonly y: number }) => void;
  readonly onDropComplete?: () => void;
}

export function openDragPayload(options: OpenDragOptions, instance: "w1" | "w2", viewBook: string | null): DragPayload {
  return {
    path: options.path,
    title: options.title,
    ledger: options.ledger !== undefined ? options.ledger : options.fromRail === true || !isLedgerScopedPath(options.path) ? null : viewBook,
    source: options.fromRail === true ? null : instance,
  };
}

export interface OpenDragBinding {
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => void;
  /** 挂上常驻的非被动 `touchmove` 监听（见文件头）。 */
  readonly ref: (element: HTMLElement | null) => void;
  readonly "data-lv-open-drag": string;
  readonly "data-lifted"?: "true";
}

interface Gesture {
  readonly id: number;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  long: boolean;
  dragging: boolean;
  /**
   * 1.17.24：浮起之后浏览器发来了 `pointercancel` / `lostpointercapture`，但手指还按着。
   * iPad Safari 会在这种时候把指针事件掐断、触摸事件却照常送达；此后改由触摸事件（`touchmove` /
   * `touchend` / `touchcancel`）继续这次拖动，真正的结束以触摸事件为准。
   */
  pointerGone: boolean;
}

export function useOpenDrag(options: OpenDragOptions): {
  readonly bind: OpenDragBinding | null;
  readonly lifted: boolean;
  readonly menu: React.ReactNode;
} {
  const { t } = useI18n();
  const pane = usePane();
  const view = useWorkspaceView();
  const viewBook = useViewBookId();
  const wide = view !== null && view.shell === "wide";
  const enabled = wide && options.disabled !== true && options.title !== "" && isOpenablePath(options.path);
  const [lifted, setLifted] = useState(false);
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const payload = useCallback((): DragPayload => {
    const current = latest.current;
    return openDragPayload(current, pane.instance, viewBook);
  }, [pane.instance, viewBook]);

  const showMenu = useCallback((point: { readonly x: number; readonly y: number }) => {
    if (latest.current.onMenu !== undefined) latest.current.onMenu(point);
    else setMenu(point);
  }, []);

  const reset = useCallback(() => {
    const current = gesture.current;
    if (current !== null && current.timer !== null) clearTimeout(current.timer);
    gesture.current = null;
    setLifted(false);
  }, []);

  /**
   * 一次移动：拖动中就更新落点；浮起（或鼠标按住）后越过门槛就开始拖动；长按之前就移动了是一次滚动。
   * 指针事件与（指针被掐断之后的）触摸事件共用这一段。返回 `"started"` 时调用方负责截住这次事件。
   */
  const step = useRef<(current: Gesture, x: number, y: number, mouseDown: boolean) => "moved" | "started" | "scroll" | "none">(() => "none");
  step.current = (current, x, y, mouseDown) => {
    if (current.dragging) {
      navDrag.move(x, y);
      return "moved";
    }
    if (Math.hypot(x - current.x, y - current.y) <= DRAG_SLOP) return "none";
    const canDrag = current.long || (current.type === "mouse" && mouseDown);
    if (!canDrag) {
      // 长按之前就移动了：这是一次滚动，不是拖动。
      if (current.type !== "mouse") reset();
      return "scroll";
    }
    current.dragging = true;
    if (current.timer !== null) clearTimeout(current.timer);
    setLifted(true);
    navDrag.start(payload(), x, y);
    return "started";
  };

  /** 松手：拖动中就在落点打开；浮起后原地松手弹出「在哪个工作区打开」的菜单。 */
  const finish = useRef<(current: Gesture, x: number, y: number) => void>(() => undefined);
  finish.current = (current, x, y) => {
    if (current.dragging) {
      suppressClick.current = true;
      if (navDrag.end(true)) latest.current.onDropComplete?.();
    } else if (current.long) {
      suppressClick.current = true;
      showMenu({ x, y });
    }
    reset();
  };

  /** 取消：拖动中原样复原，不打开任何东西；之后补发的点击不当作「轻点打开」。 */
  const abort = useRef<(current: Gesture) => void>(() => undefined);
  abort.current = (current) => {
    if (current.dragging) navDrag.end(false);
    if (current.dragging || current.long) suppressClick.current = true;
    reset();
  };

  /**
   * 常驻在入口上的触摸监听（见文件头：必须在手指按下之前就挂好，`touchmove` 必须非被动）。
   * - `touchmove`：浮起 / 拖动中阻止页面滚动；指针被掐断之后（`pointerGone`）由它继续推进拖动。
   * - `touchend`：指针被掐断之后由它完成松手。
   * - `touchcancel`：系统真的取消了这次触摸——无论指针是否还在，都按取消处理。
   */
  const onTouchMove = useCallback((event: TouchEvent) => {
    const current = gesture.current;
    if (current === null || current.type === "mouse") return;
    if (current.long || current.dragging) event.preventDefault();
    if (!current.pointerGone) return;
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    // 第二根手指，或这次移动已经不可取消（浏览器已经在滚动 / 缩放）：交还给浏览器，拖动取消。
    if (touch === undefined || !event.cancelable) {
      abort.current(current);
      return;
    }
    step.current(current, touch.clientX, touch.clientY, false);
  }, []);
  const onTouchEnd = useCallback((event: TouchEvent) => {
    const current = gesture.current;
    if (current === null || current.type === "mouse" || !current.pointerGone) return;
    const touch = event.changedTouches[0];
    finish.current(current, touch?.clientX ?? current.x, touch?.clientY ?? current.y);
  }, []);
  const onTouchCancel = useCallback(() => {
    const current = gesture.current;
    if (current === null || current.type === "mouse") return;
    if (current.long || current.dragging || current.pointerGone) abort.current(current);
  }, []);

  const element = useRef<HTMLElement | null>(null);
  const attach = useCallback(
    (next: HTMLElement | null) => {
      if (element.current === next) return;
      element.current?.removeEventListener("touchmove", onTouchMove);
      element.current?.removeEventListener("touchend", onTouchEnd);
      element.current?.removeEventListener("touchcancel", onTouchCancel);
      element.current = next;
      next?.addEventListener("touchmove", onTouchMove, { passive: false });
      next?.addEventListener("touchend", onTouchEnd);
      next?.addEventListener("touchcancel", onTouchCancel);
    },
    [onTouchMove, onTouchEnd, onTouchCancel],
  );

  /**
   * 浮起之后指针被掐断：触屏改由触摸事件继续（见 `Gesture.pointerGone`）；鼠标没有这条后路，按取消处理。
   * 浮起之前被掐断：那是一次滚动或系统手势，放弃这次长按。
   */
  const pointerLost = (pointerId: number): void => {
    const current = gesture.current;
    if (current === null || current.id !== pointerId) return;
    if (current.type !== "mouse" && (current.long || current.dragging)) {
      current.pointerGone = true;
      return;
    }
    abort.current(current);
  };

  // 入口在拖动中被卸载（列表刷新、换页）：结束拖动，不让预览与模糊留在屏幕上。
  useEffect(
    () => () => {
      if (gesture.current?.dragging === true) navDrag.end(false);
      reset();
    },
    [reset],
  );

  // 浮起 / 拖动中：Esc、窗口失焦、尺寸变化（含旋转）都取消，回到原状，不留浮起的入口或目标预览。
  useEffect(() => {
    if (!lifted) return;
    const cancel = (): void => {
      const current = gesture.current;
      // 取消之后松手，浏览器仍会补发一次点击：不能把它当成「轻点打开」。
      if (current !== null) abort.current(current);
      else reset();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") cancel();
    };
    /**
     * 1.17.24：只有窗口尺寸**真的变了**才取消。iPad Safari 在触摸过程中偶尔会发出尺寸没有变化的
     * `resize`（工具栏、视口重新计算），不能把这种事件当成旋转把正在进行的拖动取消掉。
     */
    const size = { w: window.innerWidth, h: window.innerHeight };
    const onResize = (): void => {
      if (Math.abs(window.innerWidth - size.w) > 1 || Math.abs(window.innerHeight - size.h) > 1) cancel();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", cancel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", cancel);
    };
  }, [lifted, reset]);

  const bind: OpenDragBinding | null = enabled
    ? {
        "data-lv-open-drag": "",
        ref: attach,
        ...(lifted ? { "data-lifted": "true" as const } : {}),
        onPointerDown: (event) => {
          // 新的一次按下：上一次手势留下的「吞掉点击」作废（那次松手可能根本没有产生点击）。
          suppressClick.current = false;
          if (event.button !== 0 || !event.isPrimary || !navDrag.enabled) return;
          const touchLike = event.pointerType !== "mouse";
          const start: Gesture = {
            id: event.pointerId,
            type: event.pointerType,
            x: event.clientX,
            y: event.clientY,
            element: event.currentTarget,
            timer: null,
            long: false,
            dragging: false,
            pointerGone: false,
          };
          if (touchLike) {
            start.timer = setTimeout(() => {
              if (gesture.current !== start) return;
              start.long = true;
              setLifted(true);
            }, LONG_PRESS_MS);
          }
          gesture.current = start;
        },
        onPointerMove: (event) => {
          const current = gesture.current;
          if (current === null || current.id !== event.pointerId || current.pointerGone) return;
          // 浮起之后这次触摸归这里：不让外层的横滑（分析卡片轮播）或其它手势再接手。
          if (current.long || current.dragging) event.stopPropagation();
          const result = step.current(current, event.clientX, event.clientY, (event.buttons & 1) === 1);
          if (result !== "started") return;
          // 越过门槛的这一次移动起就归拖动：外层的横滑（分析卡片轮播）不能在同一帧抢走指针。
          event.stopPropagation();
          // 鼠标拖出元素之外也要继续收到移动；触屏的指针本来就随手指，不另外捕获（iPad 上多一次捕获
          // 只会多一个被系统收回的机会）。
          if (current.type === "mouse") {
            try {
              current.element.setPointerCapture(event.pointerId);
            } catch {
              // 指针已结束：拖动仍靠移动事件继续。
            }
          }
        },
        onPointerUp: (event) => {
          const current = gesture.current;
          if (current === null || current.id !== event.pointerId || current.pointerGone) return;
          if (current.long || current.dragging) event.stopPropagation();
          finish.current(current, event.clientX, event.clientY);
        },
        onPointerCancel: (event) => {
          pointerLost(event.pointerId);
        },
        onContextMenu: (event) => {
          event.preventDefault();
          if (gesture.current?.dragging === true) return;
          reset();
          suppressClick.current = false;
          showMenu({ x: event.clientX, y: event.clientY });
        },
        onClickCapture: (event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        },
        onKeyDown: (event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const box = event.currentTarget.getBoundingClientRect();
            showMenu({ x: box.left + Math.min(box.width - 8, 48), y: box.top + box.height / 2 });
          }
        },
        // 链接与图片的原生拖拽（iPad 长按拖出链接）与这里的拖动抢同一个手势。
        onDragStart: (event) => {
          event.preventDefault();
        },
        // 指针被别处抢走（外层手势捕获、系统手势）：鼠标拖动当作取消；触屏改由触摸事件继续（见 `pointerLost`）。
        onLostPointerCapture: (event) => {
          const current = gesture.current;
          if (current === null || current.id !== event.pointerId || !current.dragging) return;
          pointerLost(event.pointerId);
        },
      }
    : null;

  const menuNode =
    menu === null ? null : (
      <FloatingMenu
        x={menu.x}
        y={menu.y}
        label={t("workspace.rail.itemMenu", { label: options.title })}
        onClose={() => {
          setMenu(null);
        }}
        items={[
          {
            label: t("workspace.drop.inPrimary"),
            run: () => {
              navDrag.open("primary", payload());
            },
          },
          {
            label: view?.splitVisible === true ? t("workspace.drop.inSecondary") : t("workspace.drop.createSecondary"),
            disabled: view?.canSplit !== true,
            run: () => {
              navDrag.open(view?.splitVisible === true ? "secondary" : "create", payload());
            },
          },
        ]}
      />
    );

  return { bind, lifted, menu: menuNode };
}

/**
 * 可拖到另一个工作区打开的链接：其余行为与 `<Link>` 完全相同（轻点照常导航）。手机界面、或这一页不适合
 * 跨工作区打开时，就是一个普通的 `<Link>`。
 */
export function DraggableLink({
  to,
  title,
  disabled = false,
  className,
  children,
}: {
  readonly to: string;
  /** 拖动预览与菜单上的名字。 */
  readonly title: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const drag = useOpenDrag({ path: to, title, disabled });
  return (
    <>
      <Link to={to} className={drag.bind === null ? className : `${className ?? ""} lv-draggable`} draggable={false} {...drag.bind}>
        {children}
      </Link>
      {drag.menu}
    </>
  );
}

/** 节点里的纯文字（用作拖动预览的名字）；拿不到就是空串，入口不参与拖动。 */
export function plainText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return "";
}

// ---------------------------------------------------------------------------
// 小菜单
// ---------------------------------------------------------------------------

export interface MenuItem {
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * 固定定位的小菜单，挂在 `document.body` 上：工作区盒子有布局约束（固定定位以工作区为准），菜单必须按
 * 整个窗口的坐标摆放，也不能被工作区或侧栏的滚动区域裁切。Esc / 点外面关闭，方向键在菜单项间移动。
 */
export function FloatingMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x + 8, top: y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const box = element.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(x + 8, window.innerWidth - box.width - 12)),
      top: Math.max(12, Math.min(y - box.height / 2, window.innerHeight - box.height - 12)),
    });
    element.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const options = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
        const index = options.indexOf(document.activeElement as HTMLElement);
        const next = options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length];
        next?.focus();
        event.preventDefault();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (ref.current?.contains(event.target as Node) === true) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  return createPortal(
    <div ref={ref} className="lv-popover lv-menu" role="menu" aria-label={label} style={{ position: "fixed", left: position.left, top: position.top }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="lv-popover-item"
          disabled={item.disabled}
          onClick={() => {
            closeRef.current();
            item.run();
          }}
        >
          <span className="min-w-0 truncate">{item.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
