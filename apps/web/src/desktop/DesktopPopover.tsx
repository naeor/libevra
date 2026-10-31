/**
 * 从导航栏向右弹出的小面板（账本选择、记账方式、账户菜单）。
 *
 * 点击打开、点击外面或 Esc 关闭，关闭后焦点回到触发按钮；打开时焦点进入面板。位置用 `fixed` 计算并夹在
 * 视口内，所以不会被导航栏或内容区裁切。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "right-start" | "right-end" | "bottom-end" | "bottom-start";

export function popoverPosition(
  anchor: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  placement: PopoverPlacement,
  gap = 10,
): { readonly left: number; readonly top: number } {
  const margin = 8;
  if (placement === "bottom-end" || placement === "bottom-start") {
    const wantedLeft = placement === "bottom-end" ? anchor.right - size.width : anchor.left;
    const belowTop = anchor.bottom + 6;
    const top = belowTop + size.height + margin <= viewport.height ? belowTop : Math.max(margin, anchor.top - size.height - 6);
    return { left: Math.max(margin, Math.min(wantedLeft, viewport.width - size.width - margin)), top };
  }
  const left = Math.min(anchor.right + gap, viewport.width - size.width - margin);
  const preferredTop = placement === "right-start" ? anchor.top : anchor.bottom - size.height;
  const top = Math.max(margin, Math.min(preferredTop, viewport.height - size.height - margin));
  return { left: Math.max(margin, left), top };
}

export function DesktopPopover({
  anchor,
  label,
  placement = "right-start",
  width = 288,
  onClose,
  role = "dialog",
  children,
}: {
  readonly anchor: React.RefObject<HTMLElement | null>;
  readonly label: string;
  readonly placement?: PopoverPlacement;
  readonly width?: number;
  readonly onClose: () => void;
  readonly role?: "dialog" | "menu";
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ readonly left: number; readonly top: number } | null>(null);

  useLayoutEffect(() => {
    const place = (): void => {
      const box = anchor.current?.getBoundingClientRect();
      const panel = ref.current;
      if (box === undefined || panel === null) return;
      setPosition(popoverPosition(box, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, placement));
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current !== null) observer.observe(ref.current);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, placement]);

  useEffect(() => {
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus], input, button:not([disabled]), a[href]");
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
      anchor.current?.focus({ preventScroll: true });
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (ref.current?.contains(target) === true || anchor.current?.contains(target) === true) return;
      // 弹出层上又开了对话框（新建账本、退出确认）时，点对话框不算点外面。
      if (((target as Element).closest?.('[aria-modal="true"]') ?? null) !== null) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className="lv-desk-popover"
      style={{ width, left: position?.left ?? -9999, top: position?.top ?? 0, visibility: position === null ? "hidden" : undefined }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** 列表里用 ↑↓ / Home / End 在可用的按钮或链接之间移动焦点。 */
export function moveFocusInList(event: React.KeyboardEvent<HTMLElement>, selector = "button:not([disabled]), a[href]"): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus({ preventScroll: true });
}
