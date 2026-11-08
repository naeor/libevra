import { useContext } from "react";
import { UNSAFE_NavigationContext, useLocation, useNavigate } from "react-router";
import { useMarkBack, usePane } from "../workspace/context.js";
import { PaneHistory, entryPath, type PaneEntry } from "../workspace/paneHistory.js";
import { recordBackPress } from "./backFallback.js";

type Source = Pick<PaneEntry, "pathname" | "search" | "hash" | "key"> & { browserIndex?: number };
const allowed = (path: string): boolean => path === "/" || /^\/(ledger(?:\/history)?|stats(?:\/cards\/[^/]+)?|books\/[^/]+)$/.test(path);

/** 只由已知阅读入口创建，不复制来源页的 state。 */
export function entryReturnState(source: Source): { entryOrigin: Source } {
  const browser = typeof window === "undefined" ? null : window.history.state as { idx?: number; key?: string } | null;
  const browserIndex = (browser?.key ?? "default") === source.key && Number.isInteger(browser?.idx) ? browser?.idx : undefined;
  return { entryOrigin: { pathname: source.pathname, search: source.search, hash: source.hash, key: source.key, ...(browserIndex === undefined ? {} : { browserIndex }) } };
}

export function entryBackTarget(state: unknown, previous: Source | undefined, previousBrowserIndex?: number): { pop: boolean; fallback: string } {
  const raw = state && typeof state === "object" ? (state as { entryOrigin?: unknown }).entryOrigin : null;
  if (!raw || typeof raw !== "object") return { pop: false, fallback: "/" };
  const origin = raw as Source;
  if (typeof origin.pathname !== "string" || !allowed(origin.pathname) || typeof origin.search !== "string" || (origin.search !== "" && !origin.search.startsWith("?")) || typeof origin.hash !== "string" || (origin.hash !== "" && !origin.hash.startsWith("#")) || typeof origin.key !== "string") return { pop: false, fallback: "/" };
  const path = entryPath(origin);
  const restoredBrowserOrigin = previous === undefined && previousBrowserIndex !== undefined && previousBrowserIndex >= 0 && Number.isInteger(origin.browserIndex) && origin.browserIndex === previousBrowserIndex;
  return { pop: (previous?.key === origin.key && entryPath(previous) === path) || restoredBrowserOrigin, fallback: path };
}

export function useEntryReturn(): () => void {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const navigate = useNavigate();
  const markBack = useMarkBack();
  const pane = usePane();
  return () => {
    markBack();
    if (recordBackPress()) { void navigate("/", { replace: true }); return; }
    const history = navigator instanceof PaneHistory ? navigator : null;
    const target = entryBackTarget(location.state, history?.previousLocation, history?.previousBrowserIndex);
    // 跟随详情来自主区时，辅助区返回自己的原页面，不复制主区的来源页。
    if (target.pop || (pane.role === "secondary" && history?.canGoBack)) void navigate(-1);
    else void navigate(target.fallback, { replace: true, state: null });
  };
}
