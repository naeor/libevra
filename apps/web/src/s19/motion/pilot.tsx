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
import { hasDefaultMotion, isDefaultMotionEdge, isTabSwitch, navigationLevel } from "./navigation.js";
import { EnterModePresentation, enterModeOptions } from "./enterMode.js";
import { ObjectExpandPresentation, objectSource, type ObjectSource } from "./objectExpand.js";
import { TabExchangePresentation, tabIndex } from "./tabExchange.js";
import { onClockReport } from "../../lib/frameClock.js";

export interface PilotAdapter {
  accept(next: PaneSnapshot, commit: () => void): void;
  committed(key: string): void;
}
const pages = { has: hasDefaultMotion };
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
  // 主 Tab 的最后滚动位置按 Tab 记，点击底栏重新入栈（新 key）回来时也能接上。
  const tabScrolls = new Map<string, ScrollPoint>();
  const layouts = new Map<string, AmbientLayout>();
  let current: BackdropContext | undefined;
  let appBack: { from: string; to: string; at: number } | null = null;
  let lastEntryClick: { key: string; href: string; at: number } | null = null;
  let pendingBack: string | null = null;
  let pendingRestore: { key: string; focus: boolean; tab?: string | undefined } | null = null;
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
  const objects = new ObjectExpandPresentation();
  const tabs = new TabExchangePresentation();
  const modes = new EnterModePresentation();
  const modeOptions = enterModeOptions(window.location.search);
  const modeEntries = new Map<string, string>();
  const objectEntries = new Map<string, { source: ObjectSource; sourceKey: string }>();
  let clickedObject: { source: ObjectSource; key: string; at: number } | null = null;
  const page = (): HTMLElement | null => {
    const node = paneRoot()?.firstElementChild;
    return node instanceof HTMLElement ? node : null;
  };
  const acceptsStyle = (): boolean => enabled || html.dataset.visualStyle === "b2" || (!!abc && ["a", "b1", "c"].includes(html.dataset.visualStyle ?? ""));
  status.textContent = "Motion 试点 · 我的 → 设置 → 语言";
  const scope = (): VisualScope => ({ workspace: history.id, account, ledger, style: `${html.dataset.visualStyle ?? "original"}:${html.dataset.themeMode}:${html.dataset.themePalette}` });
  const paneRoot = (): HTMLElement | null => document.querySelector(`.lv-pane[data-instance="${history.id}"] .lv-pane-scroll`);
  const scrollers = (): HTMLElement[] => Array.from(paneRoot()?.querySelectorAll<HTMLElement>(".overflow-y-auto") ?? []);
  const saveScroll = (key: string, page: string): void => {
    const point = { documentY: window.scrollY, inner: scrollers().map(el => el.scrollTop) };
    scrolls.set(key, point);
    if (navigationLevel(page) === "tabRoot") tabScrolls.set(page, point);
    while (scrolls.size > 64) scrolls.delete(scrolls.keys().next().value!);
  };
  let restoreFrame = 0;
  const restoreScroll = (key: string, tab?: string): void => {
    const saved = scrolls.get(key) ?? (tab ? tabScrolls.get(tab) : undefined);
    cancelAnimationFrame(restoreFrame);
    const apply = (): boolean => {
      window.scrollTo({ top: saved?.documentY ?? 0, behavior: "instant" });
      let clamped = false;
      scrollers().forEach((el, i) => {
        const top = saved?.inner[i] ?? 0;
        el.scrollTop = top;
        if (el.scrollTop < top - 1) clamped = true;
        if (html.dataset.visualStyle === "b2" || abc) el.dispatchEvent(new CustomEvent(RESTORE_HEADER_SCROLL, { detail: top }));
      });
      return clamped;
    };
    // 本地缓存一般同步渲染；列表晚一两帧才撑高时短暂重试，超过约 100ms 不再与用户滚动争夺。
    let tries = 6;
    const retry = (): void => { if (apply() && --tries > 0) restoreFrame = requestAnimationFrame(retry); };
    if (apply() && saved) restoreFrame = requestAnimationFrame(retry);
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
  // 1.19.42：不再把逐页环境写进 body::before。统一壁纸是全站唯一环境，B2 环境描述只在转场期间交给引擎。
  const reset = (): void => {
    engine.cancel(); abc?.cancel(); objects.cancel(); modes.cancel(); tabs.cancel(); objectEntries.clear(); modeEntries.clear(); store.setScope(scope()); scrolls.clear(); tabScrolls.clear(); layouts.clear();
    current = store.ensure(history.location.key, history.location.pathname, scope(), undefined, "source");
  };
  current = store.ensure(history.location.key, history.location.pathname, scope(), undefined, "source");
  const observe = new MutationObserver(reset);
  observe.observe(html, { attributes: true, attributeFilter: ["data-visual-style", "data-theme-mode", "data-theme-palette"] });
  const unsubscribeGlass = visualStyleRuntime()?.subscribe(() => { engine.cancel(); abc?.cancel(); });
  const unsubscribeVariant = subscribeAVariant(() => abc?.cancel());
  const cancel = (): void => { engine.cancel(); abc?.cancel(); objects.cancel(); modes.cancel(); tabs.cancel(); };
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
    const object = target.closest<HTMLElement>("[data-object-source]");
    clickedObject = object ? { source: objectSource(object), key: history.location.key, at: performance.now() } : null;
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
    if (anchor && isDefaultMotionEdge(history.location.pathname, anchor.pathname)) {
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
    scrolls.clear(); tabScrolls.clear(); store.clear(); current = undefined;
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let viewport = { width: innerWidth, height: innerHeight, visualHeight: window.visualViewport?.height };
  const viewportChanged = (): void => {
    const next = { width: innerWidth, height: innerHeight, visualHeight: window.visualViewport?.height };
    // 普通详情出现文档滚动条只改变 visualViewport.width，不是用户旋转/缩放或键盘。
    // iPhone Safari 在 push / pop 时会改动工具栏（前进按钮出现或消失、底栏收起），视口高度变几十像素；
    // 1.19.42 遇到任何高度变化都会把正在播放的转场直接收束到终点，看起来就是“闪一下到详情”。
    // 现在只在宽度变化（旋转）或高度大幅变化（键盘）时收束。
    const height = (a?: number, b?: number): number => Math.abs((a ?? 0) - (b ?? 0));
    if (next.width !== viewport.width || height(next.height, viewport.height) > 150 || height(next.visualHeight, viewport.visualHeight) > 150) cancel();
    viewport = next;
  };
  /**
   * 浏览器自己已经做了返回动画（iOS 边缘滑动返回会先把上一页的快照拉出来）。这时协调器只提交页面，
   * 不再叠一段收回或覆盖转场。优先读 `PopStateEvent.hasUAVisualTransition`；不支持的旧 Safari 用
   * “从屏幕边缘开始的横向拖动”作为同一信号。
   */
  let edgeSwipeAt = -Infinity;
  let edgeStart: { x: number; y: number } | null = null;
  const touchStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    edgeStart = touch && (touch.clientX <= 16 || touch.clientX >= innerWidth - 16) ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const touchMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (edgeStart && touch && Math.abs(touch.clientX - edgeStart.x) > 24 && Math.abs(touch.clientX - edgeStart.x) > Math.abs(touch.clientY - edgeStart.y)) edgeSwipeAt = performance.now();
  };
  // 系统接管边缘返回手势时，页面常常只收到 touchstart，随后是 touchcancel（没有 touchmove）。
  const touchCancel = (): void => { if (edgeStart) edgeSwipeAt = performance.now(); edgeStart = null; };
  const browserAnimatedPop = (action: string): boolean => {
    if (action !== "POP") return false;
    const event = (window as unknown as { event?: Event }).event;
    if (event?.type === "popstate" && (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) return true;
    return performance.now() - edgeSwipeAt < 1500;
  };
  // 开发诊断：`?motion=1` 徽章显示上一次转场的真实帧数与时间分布，供 iPhone 上直接核对。
  const unsubscribeClock = onClockReport(report => {
    if (!enabled) return;
    badge.dataset.lastMotion = report.name;
    status.textContent = `${report.name} · ${report.frames}帧 / ${report.wallMs}ms（设定 ${report.duration}） · 首帧 ${report.firstFrameMs}ms · 最长间隔 ${report.maxGapMs}ms${report.stalled ? " · rAF 停止，已直接收尾" : report.completed ? "" : " · 中断"}`;
  });
  document.addEventListener("pointerdown", input, true);
  document.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  document.addEventListener("touchmove", touchMove, { capture: true, passive: true });
  document.addEventListener("touchcancel", touchCancel, { capture: true, passive: true });
  document.addEventListener("keydown", input, true);
  document.addEventListener("click", click, true);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("resize", viewportChanged);
  window.addEventListener("pagehide", cancel);
  window.visualViewport?.addEventListener("resize", viewportChanged);
  reduced.addEventListener("change", cancel);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return; disposed = true;
    engine.dispose(); abc?.dispose(); objects.cancel(); modes.cancel(); tabs.dispose(); objectEntries.clear(); modeEntries.clear(); store.clear(); scrolls.clear(); tabScrolls.clear(); layouts.clear(); observe.disconnect(); unsubscribeGlass?.(); unsubscribeVariant(); badge.remove();
    if (pendingTimer) clearTimeout(pendingTimer);
    for (const name of ["--motion-b2-old-x", "--motion-b2-old-y"]) html.style.removeProperty(name);
    for (const page of document.querySelectorAll<HTMLElement>("[data-b2-motion-page]")) delete page.dataset.b2MotionPage;
    document.removeEventListener("pointerdown", input, true); document.removeEventListener("keydown", input, true);
    document.removeEventListener("touchstart", touchStart, true); document.removeEventListener("touchmove", touchMove, true); document.removeEventListener("touchcancel", touchCancel, true); unsubscribeClock();
    document.removeEventListener("click", click, true); document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("resize", viewportChanged); window.removeEventListener("pagehide", cancel); window.visualViewport?.removeEventListener("resize", viewportChanged); reduced.removeEventListener("change", cancel);
  };
  close.addEventListener("click", () => { enabled = false; dispose(); });
  return {
    dispose,
    accept(next, commit) {
      if (disposed || !acceptsStyle()) { tabs.cancel(); startTransition(commit); return; }
      if (html.dataset.visualStyle === "a") captureATabFrame?.();
      engine.cancel();
      const from = current;
      // 排队中的 Tab 交换尚未提交时，屏幕上仍是上一页；只记录真正显示着的那一页。
      if (from && committedKey === from.entryKey) saveScroll(from.entryKey, from.page);
      if (store.setScope(scope())) { current = undefined; scrolls.clear(); layouts.clear(); }
      const legalEdge = from && next.action === "PUSH" && isDefaultMotionEdge(from.page, next.location.pathname);
      const known = store.get(next.location.key);
      current = store.ensure(next.location.key, next.location.pathname, scope(), legalEdge ? from : undefined, "source");
      const source = paneRoot();
      if (browserAnimatedPop(next.action)) {
        // 浏览器已经呈现过返回：只交付页面与滚动，不再播放任何呈现层动画。
        abc?.cancel(); objects.cancel(false); modes.cancel(); tabs.cancel(); clickedObject = null; edgeSwipeAt = -Infinity;
        pendingRestore = { key: next.location.key, focus: false, tab: navigationLevel(next.location.pathname) === "tabRoot" ? next.location.pathname : undefined };
        flushSync(commit);
        return;
      }
      const focused = document.activeElement;
      const typing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || (focused instanceof HTMLElement && focused.isContentEditable);
      // switchTab：四个主 Tab 之间整页横向交换（Tab Switch Lab），不是 navigate / objectExpand / enterMode。
      if (from && next.action !== "REPLACE" && isTabSwitch(from.page, next.location.pathname) && !next.location.hash) {
        abc?.cancel(); objects.cancel(); modes.cancel(); clickedObject = null;
        const instant = typing || document.querySelector("dialog[open], [role=dialog][aria-modal=true]") !== null
          || (!enabled && html.dataset.themeMode !== "light");
        pendingRestore = { key: next.location.key, focus: false, tab: next.location.pathname };
        if (instant) { tabs.cancel(); startTransition(commit); return; }
        tabs.request({ from: tabIndex(from.page), to: tabIndex(next.location.pathname), page, commit: () => flushSync(commit) });
        return;
      }
      tabs.cancel();
      const objectPush = next.action === "PUSH" && clickedObject && clickedObject.key === from?.entryKey && performance.now() - clickedObject.at < 1000
        && clickedObject.source.id === next.location.pathname ? clickedObject : null;
      const objectPop = next.action === "POP" && from ? objectEntries.get(from.entryKey) : undefined;
      if (objectPush) objectEntries.set(next.location.key, { source: objectPush.source, sourceKey: objectPush.key });
      while (objectEntries.size > 32) objectEntries.delete(objectEntries.keys().next().value!);
      clickedObject = null;
      if (objectPush || objectPop?.sourceKey === next.location.key) {
        abc?.cancel();
        pendingRestore = { key: next.location.key, focus: true };
        objects.run({ source: objectPush?.source ?? objectPop!.source, page,
          style: html.dataset.visualStyle ?? "c", reverse: !objectPush,
          commit: () => flushSync(commit) });
        return;
      }
      objects.cancel();
      const modePush = next.action === "PUSH" && from && navigationLevel(next.location.pathname) === "enterMode" && from.page !== next.location.pathname;
      const modePop = next.action === "POP" && from && modeEntries.get(from.entryKey) === next.location.key;
      if (modePush || modePop) {
        if (modePush) modeEntries.set(next.location.key, from!.entryKey);
        while (modeEntries.size > 32) modeEntries.delete(modeEntries.keys().next().value!);
        abc?.cancel(); pendingRestore = { key: next.location.key, focus: true };
        modes.run(page, () => flushSync(commit), html.dataset.visualStyle ?? "c", modeOptions, !!modePop);
        return;
      }
      modes.cancel();
      if (!known && legalEdge && source && html.dataset.visualStyle === "b2") {
        layouts.set(current.entryKey, describeLayout(source, { bounds: new DOMRect(0, 0, innerWidth, innerHeight),
          selectors: ".book-card, .rounded-card.bg-surface, .lv-settings-body.bg-surface, .sw-statbar, details.rounded-field.bg-surface, .detail-overview-main, .detail-overview-mini" }));
      }
      const keys = history.serialize().entries.map(entry => entry.key);
      for (const key of objectEntries.keys()) if (!keys.includes(key)) objectEntries.delete(key);
      for (const key of modeEntries.keys()) if (!keys.includes(key)) modeEntries.delete(key);
      store.prune(keys);
      for (const key of scrolls.keys()) if (!keys.includes(key)) scrolls.delete(key);
      for (const key of layouts.keys()) if (!store.get(key)) layouts.delete(key);
      const allowPop = next.action === "POP" && from?.sourceKey === next.location.key
        || !!appBack && appBack.from === from?.entryKey && appBack.to === next.location.key && performance.now() - appBack.at < 1000;
      appBack = null; pendingBack = null; if (pendingTimer) clearTimeout(pendingTimer);
      // PUSH 只授权刚发生的那条边；POP 回放同一条边的反向（1.19.41 只按 from→to 判定，返回边全部丢失）。
      const edges: [string, string][] = !from ? []
        : next.action === "POP" ? (isDefaultMotionEdge(current.page, from.page) ? [[current.page, from.page]] : [])
        : isDefaultMotionEdge(from.page, current.page) ? [[from.page, current.page]] : [];
      let direction = from ? directionFor(from, current, next.action, edges, allowPop) : "none";
      const focus = document.activeElement;
      const blocked = document.querySelector("dialog[open], [role=dialog][aria-modal=true]") !== null
        || focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || (focus instanceof HTMLElement && focus.isContentEditable)
        || document.querySelector('.lv-shell[data-shell="contents"]') === null;
      // 查询参数属于页面状态（筛选、来源），不再阻止默认转场；锚点跳转仍是页内定位。
      if (blocked || next.location.hash) direction = "none";
      if (!enabled && html.dataset.themeMode !== "light") direction = "none";
      // 自带动效的页面（账本空间海浪等）立即交回原路径，不为它们捕获或改变滚动。
      if (!pages.has(next.location.pathname) || (from && !pages.has(from.page))) direction = "none";
      const target = current;
      // 同一页面换筛选（REPLACE / 同路径）保持当前滚动；换页面或返回才恢复该条历史的位置。
      const moved = !from || from.page !== next.location.pathname || next.action === "POP";
      pendingRestore = pages.has(next.location.pathname) && moved ? { key: next.location.key, focus: direction !== "none" } : null;
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
        abc.run({ fromKey: from.entryKey, toKey: target.entryKey, direction, style: material, variant: aVariant() ?? "pure-cover", commit: apply,
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
      if (pendingRestore?.key !== key) return;
      restoreScroll(key, pendingRestore.tab);
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
