// i18n-ignore-file 文件内中文仅用于开发/显式测试构建的诊断把手；正式 B2 不显示它。
import { startTransition, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useAuthOptional } from "../../auth/AuthProvider.js";
import { currentBookId, subscribeCurrentBook } from "../../lib/currentBook.js";
import { visualStyleRuntime } from "../../lib/visualStyle.js";
import { RESTORE_HEADER_SCROLL } from "../../lib/useCollapsingHeader.js";
import { usePane } from "../../workspace/context.js";
import type { PaneHistory, PaneSnapshot } from "../../workspace/paneHistory.js";
import { BackdropStore, defaults, directionFor, type BackdropContext, type VisualScope } from "./backdrop.js";
import { MotionEngine } from "./engine.js";
import { B2_GLASS_DEFAULT, B2_OLD_PAGE_RETREAT, b2GlassMaterial } from "../b2Glass.js";
import { describeLayout, layoutBackground, type AmbientLayout } from "./ambientLayout.js";
import { aVariant, captureATabFrame, createABCPresentation, subscribeAVariant } from "./abcBridge.js";
import "./motion.css";
import "./pilot.css";

export interface PilotAdapter {
  accept(next: PaneSnapshot, commit: () => void): void;
  committed(key: string): void;
}
const edges = [["/me", "/settings"], ["/settings", "/settings/appearance/language"], ["/settings", "/settings/appearance/theme"]] as const;
const pages = new Set<string>(edges.flat());
let enabled = (import.meta.env.DEV || (typeof __S19_STYLE_LAB__ !== "undefined" && __S19_STYLE_LAB__)) && typeof location !== "undefined" && new URLSearchParams(location.search).get("motion") === "1";
interface ScrollPoint { documentY: number; inner: number[] }

/** 只挂在内层 PaneRouter。仍只有一棵真实 React 页面树，DOM 提交由 flushSync 回执。 */
export default function MotionPilot({ history, adapter }: {
  history: PaneHistory; adapter: RefObject<PilotAdapter | null>;
}): null {
  const pane = usePane();
  const auth = useAuthOptional();
  const book = useSyncExternalStore(subscribeCurrentBook, currentBookId, currentBookId);
  const account = auth?.user?.id ?? "guest";
  const phone = pane.shell === "phone" && pane.role === "primary" && pane.visible && pane.split === "none";
  const preference = visualStyleRuntime();
  const style = useSyncExternalStore(preference?.subscribe ?? (() => () => undefined), () => preference?.getSnapshot() ?? "original", () => "original");
  useLayoutEffect(() => {
    const abc = createABCPresentation && ["a", "b1", "c"].includes(style);
    if ((!enabled && style !== "b2" && !abc) || !phone || !history.attached) return;
    const controller = createPilot(history, account, book ?? "local");
    adapter.current = controller;
    return () => { adapter.current = null; controller.dispose(); };
  }, [history, adapter, account, book, phone, style]);
  return null;
}

function createPilot(history: PaneHistory, account: string, ledger: string): PilotAdapter & { dispose(): void } {
  const html = document.documentElement;
  const store = new BackdropStore();
  const scrolls = new Map<string, ScrollPoint>();
  const layouts = new Map<string, AmbientLayout>();
  let current: BackdropContext | undefined;
  let appBack: { from: string; to: string; at: number } | null = null;
  let lastEntryClick: { key: string; href: string; at: number } | null = null;
  let pendingBack: string | null = null;
  let pendingRestore: { key: string; focus: boolean } | null = null;
  let captureOrigin: { x: number; y: number } | null = null;
  let committedKey = history.location.key;
  let clickedControl: Element | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const badge = document.createElement("div"); badge.id = "motion-pilot-badge";
  const status = document.createElement("output");
  const close = document.createElement("button"); close.type = "button"; close.textContent = "关闭";
  close.setAttribute("aria-label", "关闭 Motion 试点");
  badge.append(status, close); if (enabled) document.body.append(badge);
  const engine = new MotionEngine(() => {
    status.textContent = `Motion 试点 · ${engine.active ? "转场中" : "就绪"} · 快照 ${engine.snapshots}`;
    badge.dataset.entryKey = current?.entryKey ?? "";
    badge.dataset.sourceKey = current?.sourceKey ?? "";
    badge.dataset.fallbacks = String(engine.fallbacks);
  });
  const abc = createABCPresentation?.() ?? null;
  const acceptsStyle = (): boolean => enabled || html.dataset.visualStyle === "b2" || (!!abc && ["a", "b1", "c"].includes(html.dataset.visualStyle ?? ""));
  status.textContent = "Motion 试点 · 我的 → 设置 → 语言";
  const scope = (): VisualScope => ({ workspace: history.id, account, ledger, style: `${html.dataset.visualStyle ?? "original"}:${html.dataset.themeMode}:${html.dataset.themePalette}` });
  const paneRoot = (): HTMLElement | null => document.querySelector(`.lv-pane[data-instance="${history.id}"] .lv-pane-scroll`);
  const scrollers = (): HTMLElement[] => Array.from(paneRoot()?.querySelectorAll<HTMLElement>(".overflow-y-auto") ?? []);
  const saveScroll = (key: string): void => { scrolls.set(key, { documentY: window.scrollY, inner: scrollers().map(el => el.scrollTop) }); };
  const restoreScroll = (key: string): void => {
    const saved = scrolls.get(key);
    window.scrollTo({ top: saved?.documentY ?? 0, behavior: "instant" });
    scrollers().forEach((el, i) => {
      const top = saved?.inner[i] ?? 0;
      el.scrollTop = top;
      if (html.dataset.visualStyle === "b2" || abc) el.dispatchEvent(new CustomEvent(RESTORE_HEADER_SCROLL, { detail: top }));
    });
  };
  const captureBounds = (): DOMRect | undefined => {
    const page = paneRoot()?.firstElementChild;
    if (!(page instanceof HTMLElement)) return;
    page.dataset.b2MotionPage = "";
    return page.getBoundingClientRect();
  };
  const background = (context: BackdropContext): string => {
    if (html.dataset.visualStyle !== "b2") return `radial-gradient(ellipse at ${context.ambient.x}% ${context.ambient.y}%, color-mix(in srgb, var(--color-brand) 18%, transparent), transparent 68%), var(--s19-bg, var(--color-canvas))`;
    const values = visualStyleRuntime()?.getB2Snapshot().values ?? B2_GLASS_DEFAULT.values;
    const geometry = layoutBackground(layouts.get(context.entryKey), values.ambient, b2GlassMaterial(values).outgoingBlur, B2_OLD_PAGE_RETREAT, getComputedStyle(document.body).color);
    return [geometry, `radial-gradient(ellipse at ${context.ambient.x}% ${context.ambient.y}%, color-mix(in srgb, var(--color-brand) calc(18% * var(--s19-b2-carry, .85)), transparent), transparent 68%)`, "var(--s19-bg, var(--color-canvas))"].filter(Boolean).join(", ");
  };
  const paint = (): void => {
    const style = html.dataset.visualStyle;
    if (!current || !pages.has(current.page) || !["b1", "b2"].includes(style ?? "") || html.dataset.themeMode === "dark" || (abc && style !== "b2")) {
      delete html.dataset.motionBackdrop; html.style.removeProperty("--motion-pilot-bg"); return;
    }
    // 与 Lab 同一无文字轮廓映射，只有被授权的手机设置路径使用；不读取账目文字或截图像素。
    html.dataset.motionBackdrop = "true";
    html.style.setProperty("--motion-pilot-bg", background(current));
  };
  const reset = (): void => {
    engine.cancel(); abc?.cancel(); store.setScope(scope()); scrolls.clear(); layouts.clear();
    current = store.ensure(history.location.key, history.location.pathname, scope(), undefined, "source"); paint();
  };
  current = store.ensure(history.location.key, history.location.pathname, scope(), undefined, "source"); paint();
  const observe = new MutationObserver(reset);
  observe.observe(html, { attributes: true, attributeFilter: ["data-visual-style", "data-theme-mode", "data-theme-palette"] });
  const unsubscribeGlass = visualStyleRuntime()?.subscribe(() => { engine.cancel(); abc?.cancel(); paint(); });
  const unsubscribeVariant = subscribeAVariant(() => abc?.cancel());
  const cancel = (): void => { engine.cancel(); abc?.cancel(); };
  const input = (event: Event): void => {
    engine.cancel();
    // 导航控件先把当前姿态交给下一次 run；滚动、空白点按、输入立即释放呈现副本。
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("a,button") || (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))) abc?.cancel();
  };
  const click = (event: MouseEvent): void => {
    const generation = abc?.generation;
    queueMicrotask(() => { if (abc?.generation === generation) abc?.cancel(); });
    if (!acceptsStyle() || !event.isTrusted || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !paneRoot()?.contains(target)) return;
    const control = target.closest("a,button");
    // 捕获尚未提交时，同一旧控件的重复激活不再入栈；新页面的下一操作立即可用。
    if (control && control === clickedControl && committedKey !== history.location.key) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    clickedControl = control;
    const now = performance.now();
    if (target.closest("[data-back-control]")) {
      if (pendingBack === history.location.key) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const previous = history.previousLocation;
      if (previous && pages.has(previous.pathname) && pages.has(history.location.pathname)) {
        appBack = { from: history.location.key, to: previous.key, at: now };
        pendingBack = history.location.key;
        pendingTimer = setTimeout(() => { pendingBack = null; appBack = null; }, 300);
      }
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (anchor && edges.some(([a, b]) => a === history.location.pathname && b === anchor.pathname)) {
      if (lastEntryClick?.key === history.location.key && lastEntryClick.href === anchor.href && now - lastEntryClick.at < 300) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      lastEntryClick = { key: history.location.key, href: anchor.href, at: now };
    }
  };
  const visibility = (): void => {
    if (!document.hidden) return;
    cancel();
    // 只释放临时呈现；轻量历史描述与滚动仍用于恢复，切作用域时另行清理。
    if (html.dataset.visualStyle === "b2" || abc) return;
    scrolls.clear(); store.clear(); current = undefined; paint();
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  document.addEventListener("pointerdown", input, true);
  document.addEventListener("keydown", input, true);
  document.addEventListener("click", click, true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", cancel);
  window.addEventListener("pagehide", cancel);
  window.visualViewport?.addEventListener("resize", cancel);
  reduced.addEventListener("change", cancel);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return; disposed = true;
    engine.dispose(); abc?.dispose(); store.clear(); scrolls.clear(); layouts.clear(); observe.disconnect(); unsubscribeGlass?.(); unsubscribeVariant(); badge.remove();
    if (pendingTimer) clearTimeout(pendingTimer);
    delete html.dataset.motionBackdrop; html.style.removeProperty("--motion-pilot-bg");
    for (const name of ["--motion-b2-old-x", "--motion-b2-old-y"]) html.style.removeProperty(name);
    for (const page of document.querySelectorAll<HTMLElement>("[data-b2-motion-page]")) delete page.dataset.b2MotionPage;
    document.removeEventListener("pointerdown", input, true); document.removeEventListener("keydown", input, true);
    document.removeEventListener("click", click, true); document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("resize", cancel); window.removeEventListener("pagehide", cancel); window.visualViewport?.removeEventListener("resize", cancel); reduced.removeEventListener("change", cancel);
  };
  close.addEventListener("click", () => { enabled = false; dispose(); });
  return {
    dispose,
    accept(next, commit) {
      if (disposed || !acceptsStyle()) { startTransition(commit); return; }
      if (html.dataset.visualStyle === "a") captureATabFrame?.();
      engine.cancel();
      const from = current;
      if (from && pages.has(from.page)) saveScroll(from.entryKey);
      if (store.setScope(scope())) { current = undefined; scrolls.clear(); layouts.clear(); }
      const legalEdge = from && next.action === "PUSH" && edges.some(([a, b]) => a === from.page && b === next.location.pathname);
      const known = store.get(next.location.key);
      current = store.ensure(next.location.key, next.location.pathname, scope(), legalEdge ? from : undefined, "source");
      const source = paneRoot();
      if (!known && legalEdge && source && html.dataset.visualStyle === "b2") {
        layouts.set(current.entryKey, describeLayout(source, { bounds: new DOMRect(0, 0, innerWidth, innerHeight),
          selectors: ".book-card, .rounded-card.bg-surface, .lv-settings-body.bg-surface, .sw-statbar, details.rounded-field.bg-surface, .detail-overview-main, .detail-overview-mini" }));
      }
      const keys = history.serialize().entries.map(entry => entry.key);
      store.prune(keys);
      for (const key of scrolls.keys()) if (!keys.includes(key) || !store.get(key)) scrolls.delete(key);
      for (const key of layouts.keys()) if (!store.get(key)) layouts.delete(key);
      const allowPop = !!appBack && appBack.from === from?.entryKey && appBack.to === next.location.key && performance.now() - appBack.at < 1000;
      appBack = null; pendingBack = null; if (pendingTimer) clearTimeout(pendingTimer);
      let direction = from ? directionFor(from, current, next.action, edges, allowPop) : "none";
      const focus = document.activeElement;
      const blocked = document.querySelector("dialog[open], [role=dialog][aria-modal=true]") !== null
        || focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || (focus instanceof HTMLElement && focus.isContentEditable)
        || document.querySelector('.lv-shell[data-shell="contents"]') === null;
      const query = new URLSearchParams(next.location.search);
      const testQueryOnly = [...query].every(([key, value]) =>
        (key === "motion" && value === "1") || (key === "s19" && ["a", "b1", "b2", "c", "original"].includes(value))
        || (key === "shell" && ["workspace", "auto"].includes(value)));
      if (blocked || !testQueryOnly || next.location.hash) direction = "none";
      if (!enabled && html.dataset.themeMode !== "light") direction = "none";
      // 不属于白名单的导航立即交回原路径，不为无关页面捕获或改变滚动。
      if (!pages.has(next.location.pathname) || (from && !pages.has(from.page))) direction = "none";
      const target = current;
      pendingRestore = pages.has(next.location.pathname) ? { key: next.location.key, focus: direction !== "none" } : null;
      const apply = (): void => {
        // 动画捕获回调在 React 生命周期外同步提交；即时跳转保留原来的调度。
        if (direction === "none") startTransition(commit);
        else flushSync(commit);
        badge.dataset.entryKey = target.entryKey; badge.dataset.sourceKey = target.sourceKey ?? "";
      };
      const preference = visualStyleRuntime();
      const style = preference?.getSnapshot();
      const material = style === "b1" || style === "b2" || style === "a" ? style : "c";
      if (abc && material !== "b2") {
        if (direction === "none" || !from) { abc.cancel(); apply(); return; }
        abc.run({ fromKey: from.entryKey, toKey: target.entryKey, direction, style: material, variant: aVariant(), commit: apply,
          page: () => { const page = paneRoot()?.firstElementChild; return page instanceof HTMLElement ? page : null; } });
        return;
      }
      abc?.cancel();
      if (material === "b2") {
        captureOrigin = captureBounds() ?? null;
        html.style.setProperty("--motion-b2-old-x", "0px");
        html.style.setProperty("--motion-b2-old-y", "0px");
      }
      engine.run({ ...defaults, scheme: material === "b2" && html.dataset.themeMode === "light" ? "hybrid" : defaults.scheme, material,
        retreat: material === "b2" ? B2_OLD_PAGE_RETREAT : defaults.retreat,
        blurStrength: material === "b2" ? preference?.getB2Snapshot().values.blur ?? B2_GLASS_DEFAULT.values.blur : preference?.getBlurSnapshot() ?? defaults.blurStrength }, direction, apply, undefined, {
        ambient: background(target),
        fallbackSurface: () => {
          const surface = paneRoot()?.firstElementChild;
          return surface instanceof HTMLElement && getComputedStyle(surface).display !== "contents" ? surface : null;
        },
      });
    },
    committed(key) {
      if (disposed || key !== current?.entryKey) return;
      committedKey = key;
      // 记录只拦截旧页尚未提交时的重入；返回到同一 entry 后属于一次新的激活。
      if (lastEntryClick?.key !== key) lastEntryClick = null;
      paint();
      if (pendingRestore?.key !== key) return;
      restoreScroll(key);
      if (html.dataset.visualStyle === "b2" && captureOrigin) {
        // 快照组已由浏览器定位到实际页面；只补旧图相对于目标原点的差值。
        // 新图保持原位，不能再叠加一份文档滚动偏移。
        const targetOrigin = captureBounds();
        html.style.setProperty("--motion-b2-old-x", `${targetOrigin ? captureOrigin.x - targetOrigin.x : 0}px`);
        html.style.setProperty("--motion-b2-old-y", `${targetOrigin ? captureOrigin.y - targetOrigin.y : 0}px`);
        captureOrigin = null;
      }
      if (pendingRestore.focus) {
        const title = paneRoot()?.querySelector<HTMLElement>("h1");
        if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
      }
      pendingRestore = null;
    },
  };
}
