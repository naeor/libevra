/**
 * **弹层的焦点管理**（S18，审查 U04）：打开时焦点进入弹层，Tab 不会跑到背景里，关闭后回到打开它的那个
 * 控件；多层弹层叠在一起时，只有最上面那一层响应 Esc 与 Tab。
 *
 * ⚠️ **按工作区分层。** 大屏上两个工作区可以各开一个弹层：每个弹层属于它所在的工作区（最近的
 * `[data-instance]`），「最上面一层」只在同一个工作区里比较，焦点在另一个工作区时这一层不抢 Tab / Esc。
 *
 * ⚠️ **打开时聚焦的是弹层本身，而不是第一个输入框**：在手机与平板上把焦点直接放进输入框会立刻弹出
 * 软键盘，遮住面板的一半。读屏软件会读出弹层的名称（`aria-label`），键盘用户按 Tab 进入第一个控件。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Layer {
  readonly id: symbol;
  readonly scope: string;
}

const stack: Layer[] = [];

function scopeOf(node: Element | null): string {
  return node?.closest("[data-instance]")?.getAttribute("data-instance") ?? "global";
}

export function focusableWithin(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}

export interface DialogLayer {
  /** 这一层是不是它所在工作区里最上面的弹层。 */
  readonly isTop: () => boolean;
  /**
   * 这一次按键该不该由这一层处理：没有被上层处理过（`defaultPrevented`）、是本工作区最上面一层、
   * 焦点不在另一个工作区里。处理时调用方应 `preventDefault()`，下面的层就不会再响应同一次 Esc。
   */
  readonly owns: (event: KeyboardEvent) => boolean;
}

/**
 * @param ref 弹层的对话框元素（需要 `tabIndex={-1}`，以便能接收焦点）
 * @param active 是否处于打开状态
 */
export function useDialogFocus(ref: React.RefObject<HTMLElement | null>, active = true): DialogLayer {
  const id = useRef<symbol>(Symbol("dialog"));
  const scope = useRef("global");

  const isTop = useCallback(() => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const layer = stack[index] as Layer;
      if (layer.scope === scope.current) return layer.id === id.current;
    }
    return false;
  }, []);

  const owns = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isTop()) return false;
      const focused = document.activeElement;
      if (focused === null || focused === document.body) return true;
      const focusScope = scopeOf(focused);
      return focusScope === "global" || scope.current === "global" || focusScope === scope.current;
    },
    [isTop],
  );

  useEffect(() => {
    if (!active) return;
    const self = id.current;
    const node = ref.current;
    scope.current = scopeOf(node);
    const layer: Layer = { id: self, scope: scope.current };
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(layer);
    if (node !== null && !node.contains(document.activeElement)) node.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || !owns(event)) return;
      const container = ref.current;
      if (container === null) return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const current = document.activeElement;
      if (!container.contains(current) || current === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const index = stack.indexOf(layer);
      if (index >= 0) stack.splice(index, 1);
      if (previous !== null && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, owns, ref]);

  return useMemo(() => ({ isTop, owns }), [isTop, owns]);
}
