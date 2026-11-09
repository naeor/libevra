import { createContext, useContext, useLayoutEffect, useRef } from "react";

/**
 * 手机常驻底栏上方的当前账本胶囊（1.19.50）。
 *
 * 胶囊与底部 Tab 栏绑在一起，由工作区（PaneShell）挂在常驻底栏里；页面只登记“我需要显示哪本账”。
 * 这样主 Tab 横向交换时胶囊不随页面滑动，目标页需不需要它只决定它弹出、留着还是缩回底栏后面；
 * 胶囊也不再占一整行，页面内容一直延伸到底栏上缘，在胶囊两侧照常可见。
 */
export interface BookCapsuleStore {
  /** owner 是登记者自己的标识；name 为 null 表示撤销登记。 */
  set(owner: object, name: string | null): void;
  get(): string | null;
  subscribe(listener: () => void): () => void;
}

export function createBookCapsuleStore(): BookCapsuleStore {
  const owners = new Map<object, string>();
  const listeners = new Set<() => void>();
  let value: string | null = null;
  const recompute = (): void => {
    let last: string | null = null;
    for (const name of owners.values()) last = name;
    if (last === value) return;
    value = last;
    for (const listener of listeners) listener();
  };
  return {
    set(owner, name) { if (name === null) owners.delete(owner); else owners.set(owner, name); recompute(); },
    get: () => value,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const BookCapsuleContext = createContext<BookCapsuleStore | null>(null);

/**
 * 页面登记需要显示的账本名（null：这一页不需要）。在 layout effect 里登记，与页面提交同一帧：
 * 旧页撤销、新页登记都在同一次提交里完成，胶囊只看最终结果，同一本账时不动。
 */
export function useRegisterBookCapsule(name: string | null): boolean {
  const store = useContext(BookCapsuleContext);
  const owner = useRef<object>({}).current;
  useLayoutEffect(() => { store?.set(owner, name); }, [store, owner, name]);
  useLayoutEffect(() => () => { store?.set(owner, null); }, [store, owner]);
  return store !== null;
}
