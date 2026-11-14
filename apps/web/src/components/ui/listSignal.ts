import { useLayoutEffect, useRef } from "react";

/**
 * 给 `useListMotion` 的 signal：项 id 串，但“整批换成另一批”（没有任何一项留下，例如支出 / 收入切换）时保持原值，
 * 这种整体换内容由 `useSwapReveal` 负责，不再让每一项各自展开。
 */
export function useListSignal(ids: readonly string[]): string {
  const joined = ids.join("|");
  // 已提交的状态放在 ref 里、在布局副作用里更新：渲染本身保持纯（开发模式会把渲染调用两次）。
  const committed = useRef<{ signal: string; known: ReadonlySet<string> }>({ signal: joined, known: new Set(ids) });
  const wholesale = ids.length > 0 && committed.current.known.size > 0 && !ids.some((id) => committed.current.known.has(id));
  const signal = wholesale ? committed.current.signal : joined;
  useLayoutEffect(() => {
    committed.current = { signal, known: new Set(ids) };
  });
  return signal;
}

/** 最近一次非空的列表：整块收起的动画期间继续显示原来的内容，而不是闪成空列表 / 「0 项」。 */
export function useLastNonEmpty<T>(items: readonly T[]): readonly T[] {
  const last = useRef(items);
  if (items.length > 0) last.current = items;
  return items.length > 0 ? items : last.current;
}
