import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createOverlayExit, OVERLAY_EXIT_MS } from "./overlayExit.js";
import { hasOverlayScrollLock, lockOverlayScroll } from "./overlayScrollLock.js";
import "../s19/overlays.css";

/** 关闭按钮、遮罩、取消共用出口；外部导航卸载时取消回调，不留下延迟操作。 */
export function useOverlayExit(onClose: () => void, open = true) {
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const exit = useMemo(() => createOverlayExit(setClosing), []);
  useEffect(() => {
    setClosing(false);
    return () => exit.cancel();
  }, [exit, open]);
  const requestClose = useCallback(() => exit.schedule(() => closeRef.current()), [exit]);
  const afterExit = useCallback((action: () => void) => exit.schedule(action), [exit]);
  return { closing, requestClose, afterExit };
}

/** 受控对话框：业务回调仍同步执行，仅在 open=false 后保留外壳播放退出。 */
export function useOverlayPresence(open: boolean) {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), OVERLAY_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { visible: open || present, closing: !open && present };
}

/** 按引用计数恢复滚动，多层选择器按任意顺序关闭都不会遗留 hidden。 */
export function useOverlayScrollLock(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const targets = new Set<HTMLElement>();
    let node = ref.current?.parentElement ?? null;
    while (node && node !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) || hasOverlayScrollLock(node)) targets.add(node);
      if (node.hasAttribute("data-instance")) break;
      node = node.parentElement;
    }
    // 宽屏只锁所属工作区，不冻结旁边仍可使用的工作区。
    if (!ref.current?.closest('[data-shell="wide"]')) targets.add(document.body);
    const releases = [...targets].map(lockOverlayScroll);
    return () => { releases.forEach(release => release()); };
  }, [active, ref]);
}
