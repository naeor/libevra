import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NavigationType, Router, UNSAFE_LocationContext } from "react-router";

import { SheetCloseButton } from "../components/BottomSheet.js";
import { useI18n } from "../i18n/index.js";
import { entryReturnState } from "../lib/entryReturn.js";
import { hasVisibleDialogOrMenu, useDialogFocus } from "../lib/dialogFocus.js";
import { useOverlayScrollLock } from "../lib/useOverlayPresentation.js";
import { WorkspaceActionsContext } from "./context.js";
import { entryFromPath, PaneHistory } from "./paneHistory.js";
import { TemporaryContents, TemporaryHostContext, type TemporaryHost, type TemporaryTask } from "./temporary.js";
import { cssDurationMs } from "../lib/motionTokens.js";

/** 真实路由及权限包装在自己的内存栈里运行。回到来源即完成附属阅读，宿主没有新增历史。 */
export function TemporaryDetail({ task, host, registerDirty, children, split }: {
  task: TemporaryTask; host: TemporaryHost; registerDirty: (value: boolean) => void; children: React.ReactNode; split: boolean;
}) {
  const { t } = useI18n();
  const actions = useContext(WorkspaceActionsContext);
  const scoped = useMemo(() => actions && ({ ...actions, markBack: () => undefined,
    setDirty: (_id: unknown, dirty: boolean) => registerDirty(dirty) }), [actions, registerDirty]);
  const [history] = useState(() => new PaneHistory("temporary", [task.origin, entryFromPath(task.detailPath!, "detail", entryReturnState(task.origin))]));
  const snap = useSyncExternalStore(history.subscribe, () => history.snapshot);
  const panel = useRef<HTMLDivElement>(null);
  const focus = useDialogFocus(panel, !split);
  useOverlayScrollLock(panel, !split);
  const close = useRef(task.close);
  close.current = task.close;
  useLayoutEffect(() => {
    if (snap.location.key === task.origin.key || snap.location.pathname === task.origin.pathname) host.tasks.release(task.id);
  }, [host.tasks, task, snap.location]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (split ? hasVisibleDialogOrMenu() : !focus.owns(event)) return;
      event.preventDefault(); close.current();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [split, focus]);
  const scroll = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    el.scrollTop = offsets.current.get(snap.location.key) ?? 0;
    const duration = cssDurationMs(getComputedStyle(el).getPropertyValue("--lv-temporary-motion-ms"));
    const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches && duration > 0
      ? el.animate([{ opacity: .82 }, { opacity: 1 }], { duration }) : null;
    return () => { offsets.current.set(snap.location.key, el.scrollTop); motion?.cancel(); };
  }, [snap.location.key]);
  return <div className="lv-temporary-detail" data-floating={!split || undefined} role={split ? "region" : "dialog"}
    aria-label={t("entry.detail.title")} aria-modal={split ? undefined : true} tabIndex={-1} ref={panel}>
    <SheetCloseButton label={t("nav.sheet.close", { title: t("entry.detail.title") })} onClick={() => task.close()} />
    <div className="lv-temporary-detail-page" ref={scroll}>
      <TemporaryContents host={host}><TemporaryHostContext.Provider value={null}>
        <WorkspaceActionsContext.Provider value={scoped}>
          <UNSAFE_LocationContext.Provider value={null as never}>
            <Router navigator={history} location={snap.location} navigationType={snap.action as NavigationType}>{children}</Router>
          </UNSAFE_LocationContext.Provider>
        </WorkspaceActionsContext.Provider>
      </TemporaryHostContext.Provider></TemporaryContents>
    </div>
  </div>;
}
