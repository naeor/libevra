import { useEffect } from "react";
import { t } from "../i18n/index.js";
import { usePane, usePaneDirty } from "../workspace/context.js";

/**
 * 保护刷新、页内链接以及浏览器后退；不保存草稿，不阻止已确认的离开。
 *
 * ⚠️ **S18：浏览器后退与地址栏只属于主工作区。** 资料页在辅助工作区（或被收起的工作区）里时，不往浏览器历史
 * 里压保护记录、不拦浏览器后退——那是主区的；只拦本工作区里的链接，并把草稿登记给外壳（跟随导航不会替换它、
 * 打开别的页面前先确认）。手机上只有主区，行为与以前相同。
 */
export function useDraftExit(dirty: boolean): void {
  usePaneDirty(dirty);
  const pane = usePane();
  const ownsHistory = pane.role === "primary";
  const instance = pane.instance;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    const marker = `profile-draft-${crypto.randomUUID()}`;
    let active = true;
    // 同 URL 的保护条目让后退先落回仍然挂载的编辑页，确认后才跨到上一页。
    if (ownsHistory) window.history.pushState({ ...window.history.state, profileDraftGuard: marker }, "", window.location.href);
    const pop = (): void => {
      if (!active || window.history.state?.profileDraftGuard === marker) return;
      if (window.confirm(t("account.profile.leaveConfirm"))) {
        active = false;
        window.removeEventListener("beforeunload", beforeUnload);
        window.history.back();
      } else window.history.forward();
    };
    const link = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      // 另一个工作区里的链接与这份草稿无关。
      const owner = event.target.closest("[data-instance]")?.getAttribute("data-instance");
      if (owner !== null && owner !== undefined && owner !== instance) return;
      if (!window.confirm(t("account.profile.leaveConfirm"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    if (ownsHistory) window.addEventListener("popstate", pop);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (ownsHistory) window.removeEventListener("popstate", pop);
      document.removeEventListener("click", link, true);
      if (ownsHistory && active && window.history.state?.profileDraftGuard === marker) window.history.back();
      active = false;
    };
  }, [dirty, ownsHistory, instance]);
}
