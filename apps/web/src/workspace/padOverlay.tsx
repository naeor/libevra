import { createContext, useContext, useLayoutEffect, useMemo } from "react";

export const PadOverlayHost = createContext<HTMLElement | null>(null);
const managed = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** 只有最顶层可操作。保留原本已被工作区或权限流程锁定的元素。 */
function sync(host: HTMLElement): void {
  const old = managed.get(host) ?? new Set<HTMLElement>();
  const layers = Array.from(host.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
    .sort((a, b) => Number(a.dataset.priority) - Number(b.dataset.priority));
  const top = layers.at(-1);
  const lock = new Set<HTMLElement>();
  if (top && host.parentElement) {
    for (const node of [...host.parentElement.children, ...layers]) {
      if (node instanceof HTMLElement && node !== host && node !== top && (!node.inert || old.has(node))) lock.add(node);
    }
  }
  for (const node of old) if (!lock.has(node)) node.inert = false;
  for (const node of lock) node.inert = true;
  managed.set(host, lock);
}
export function usePadModalLayer(active: boolean, priority = 1): HTMLElement | null {
  const host = useContext(PadOverlayHost);
  const layer = useMemo(() => host && active ? document.createElement("div") : null, [host, active]);
  useLayoutEffect(() => {
    if (!host || !layer || !active) return;
    layer.dataset.padModalLayer = "";
    layer.dataset.priority = String(priority);
    host.append(layer);
    sync(host);
    const observer = new MutationObserver(() => sync(host));
    if (host.parentElement) observer.observe(host.parentElement, { childList: true });
    return () => { observer.disconnect(); layer.remove(); sync(host); };
  }, [host, layer, active, priority]);
  return host && active ? layer : null;
}
