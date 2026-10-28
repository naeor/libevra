import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuthOptional } from "../auth/AuthProvider.js";
import { WORKBENCH_CHANGED } from "./configEvents.js";
import { WorkspaceSync, type SyncSnapshot } from "./sync.js";

const Context = createContext<WorkspaceSync | null>(null);
const local: SyncSnapshot = { status: "local" };
const subscribeNone = () => () => {};
export function WorkbenchSyncBridge({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const auth = useAuthOptional();
  const id = auth?.user?.id ?? null;
  const engine = useMemo(() => {
    if (!id) return null;
    try { return new WorkspaceSync(`user:${id}`, localStorage); } catch { return null; }
  }, [id]);
  useEffect(() => {
    if (!engine) return;
    engine.activate();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => { if (document.visibilityState !== "hidden" && navigator.onLine) void engine.run(); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== engine.scope) return;
      engine.changed(); clearTimeout(timer); timer = setTimeout(run, 350);
    };
    const storage = (event: StorageEvent) => {
      if (event.key?.endsWith(engine.scope)) { engine.changed(); run(); }
    };
    window.addEventListener(WORKBENCH_CHANGED, changed);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("storage", storage);
    const poll = setInterval(run, 60_000);
    run();
    return () => {
      engine.dispose(); clearTimeout(timer); clearInterval(poll);
      window.removeEventListener(WORKBENCH_CHANGED, changed);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("storage", storage);
    };
  }, [engine]);
  return <Context.Provider value={engine}>{children}</Context.Provider>;
}
export function useWorkspaceSync() {
  const engine = useContext(Context);
  const snapshot = useSyncExternalStore(engine?.subscribe ?? subscribeNone, engine?.getSnapshot ?? (() => local), () => local);
  return { engine, snapshot };
}
