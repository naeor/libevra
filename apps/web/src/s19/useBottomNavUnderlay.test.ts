import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ nav: null as unknown, cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({ useRef: () => ({ current: hook.nav }), useLayoutEffect: (fn: () => () => void) => { hook.cleanup = fn(); } }));
import { useBottomNavUnderlay } from "./useBottomNavUnderlay.js";

let resize: () => void;
let structure: () => void;
let caption: { getBoundingClientRect(): { height: number } } | null;
let menu: { getBoundingClientRect(): { height: number } };
let nav: { isConnected: boolean; closest(): unknown; querySelector(): unknown; getBoundingClientRect(): { height: number } };
let scroller: { isConnected: boolean; dataset: Record<string, string>; style: { setProperty(key: string, value: string): void; removeProperty(key: string): void } };
let css: Map<string, string>;
let pageCss: Map<string, string>;
beforeEach(() => {
  css = new Map(); pageCss = new Map(); caption = null;
  menu = { getBoundingClientRect: () => ({ height: 84 }) };
  scroller = { isConnected: true, dataset: {}, style: { setProperty: (k, v) => { css.set(k, v); }, removeProperty: k => { css.delete(k); } } };
  const page = { querySelector: (selector: string) => selector.includes("overflow-y-auto") ? scroller : caption,
    style: { setProperty: (k: string, v: string) => { pageCss.set(k, v); }, removeProperty: (k: string) => { pageCss.delete(k); } } };
  nav = { isConnected: true, closest: () => page, querySelector: () => menu, getBoundingClientRect: () => ({ height: 84 }) };
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("MutationObserver", class { constructor(cb: () => void) { structure = cb; } observe() {} disconnect() {} });
  hook.nav = nav;
  useBottomNavUnderlay();
});
afterEach(async () => { hook.cleanup?.(); await Promise.resolve(); vi.unstubAllGlobals(); });

it("StrictMode 清理再订阅不临时撤掉滚动视口的重叠空间", async () => {
  hook.cleanup?.();
  await Promise.resolve();
  expect(scroller.dataset.b2ScrollUnderlay).toBe("");
  expect(css.get("--s19-b2-dock-overlap")).toBe("84px");
  expect(pageCss.get("--s19-entry-space")).toBe("92px");
  useBottomNavUnderlay();
  expect(css.get("--s19-b2-dock-overlap")).toBe("84px");
});

it("底栏被独立移除时清理重叠空间，供工作台编辑布局继续使用", async () => {
  hook.cleanup?.(); nav.isConnected = false;
  await Promise.resolve();
  expect(scroller.dataset.b2ScrollUnderlay).toBeUndefined();
  expect(css.size).toBe(0);
  expect(pageCss.size).toBe(0);
});

it("异步出现和消失的账本说明与真实底栏高度一起测量", () => {
  caption = { getBoundingClientRect: () => ({ height: 32 }) };
  structure(); expect(css.get("--s19-b2-dock-overlap")).toBe("116px");
  nav.getBoundingClientRect = () => ({ height: 64 });
  resize(); expect(css.get("--s19-b2-dock-overlap")).toBe("96px");
  caption = null; structure(); expect(css.get("--s19-b2-dock-overlap")).toBe("64px");
});

it("菜单占位跟随真实高度，扣除仍在布局中的说明；安全区不重复计入", () => {
  expect(pageCss.get("--s19-entry-space")).toBe("92px");
  caption = { getBoundingClientRect: () => ({ height: 32 }) };
  structure(); expect(pageCss.get("--s19-entry-space")).toBe("60px");
  menu.getBoundingClientRect = () => ({ height: 100 });
  resize(); expect(pageCss.get("--s19-entry-space")).toBe("76px");
  nav.getBoundingClientRect = () => ({ height: 118 });
  resize(); expect(pageCss.get("--s19-entry-space")).toBe("76px");
  caption = null; structure(); expect(pageCss.get("--s19-entry-space")).toBe("108px");
});
