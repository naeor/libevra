import { useLayoutEffect, useRef } from "react";

/** 测量现有底栏、账本说明及记账菜单；布局由 S19 手机样式选择性启用。
 * 用 layout effect 在原生快照捕获前完成，避免返回时先拍旧尺寸再调整。
 */
export function useBottomNavUnderlay() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    const page = nav?.closest<HTMLElement>(".h-dvh");
    const scroller = page?.querySelector<HTMLElement>(":scope > .overflow-y-auto");
    if (!nav || !page || !scroller || typeof ResizeObserver === "undefined") return;
    const menu = nav.querySelector<HTMLElement>(".lv-entry-menu");
    let caption: HTMLElement | null = null;
    const measure = () => {
      const next = page.querySelector<HTMLElement>(".current-book-caption");
      if (next !== caption) {
        if (caption) observer.unobserve(caption);
        caption = next;
        if (caption) observer.observe(caption);
      }
      const captionHeight = caption?.getBoundingClientRect().height ?? 0;
      const height = nav.getBoundingClientRect().height + captionHeight;
      scroller.style.setProperty("--s19-b2-dock-overlap", `${height}px`);
      // 菜单已用 bottom-full 锚在底栏（含安全区）上方，无需重复加底栏高度。
      // 明细的隐藏说明仍占位，其他 Tab 会移除说明；只补足菜单与 8px 衔接空间。
      if (menu) page.style.setProperty("--s19-entry-space", `${Math.max(0, menu.getBoundingClientRect().height + 8 - captionHeight)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    if (menu) observer.observe(menu);
    // 账本说明可以在异步加载后出现；只观察结构，不观察自己写的 style。
    const structure = new MutationObserver(measure);
    structure.observe(page, { childList: true, subtree: true });
    scroller.dataset.b2ScrollUnderlay = "";
    measure();
    return () => {
      observer.disconnect(); structure.disconnect();
      // StrictMode 重订阅时 DOM 仍挂载，不能临时缩小滚动视口。
      // 只有底栏被独立移除（如进入工作台编辑），才在同一帧内撤掉重叠区。
      queueMicrotask(() => {
        if (nav.isConnected || !scroller.isConnected) return;
        delete scroller.dataset.b2ScrollUnderlay;
        scroller.style.removeProperty("--s19-b2-dock-overlap");
        page.style.removeProperty("--s19-entry-space");
      });
    };
  }, []);
  return ref;
}
