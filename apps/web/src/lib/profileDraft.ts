import { useEffect } from "react";

/** 保护刷新、页内链接以及浏览器后退；不保存草稿，不阻止已确认的离开。 */
export function useDraftExit(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    const marker = `profile-draft-${crypto.randomUUID()}`;
    let active = true;
    // 同 URL 的保护条目让后退先落回仍然挂载的编辑页，确认后才跨到上一页。
    window.history.pushState({ ...window.history.state, profileDraftGuard: marker }, "", window.location.href);
    const pop = (): void => {
      if (!active || window.history.state?.profileDraftGuard === marker) return;
      if (window.confirm("放弃未保存的修改并离开？")) {
        active = false;
        window.removeEventListener("beforeunload", beforeUnload);
        window.history.back();
      } else window.history.forward();
    };
    const link = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      if (!window.confirm("放弃未保存的修改并离开？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop);
      document.removeEventListener("click", link, true);
      if (active && window.history.state?.profileDraftGuard === marker) window.history.back();
      active = false;
    };
  }, [dirty]);
}
