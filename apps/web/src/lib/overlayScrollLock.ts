const locks = new Map<HTMLElement, { count: number; overflow: string }>();

export function hasOverlayScrollLock(target: HTMLElement): boolean { return locks.has(target); }

export function lockOverlayScroll(target: HTMLElement): () => void {
  const lock = locks.get(target) ?? { count: 0, overflow: target.style.overflow };
  lock.count += 1;
  locks.set(target, lock);
  target.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count > 0) return;
    // 尚未迁移的父面板可能先恢复滚动；不要用打开时的 hidden 覆盖它的恢复结果。
    if (target.style.overflow === "hidden") target.style.overflow = lock.overflow;
    locks.delete(target);
  };
}
