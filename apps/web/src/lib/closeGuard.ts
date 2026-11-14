/**
 * **关闭前询问**（弹出面板模板，1.19.58；分类见 docs/specs/design/S19-审查后续待办与弹出面板模板-20261114.md §2）。
 *
 * 所有者的规则：轻量、常用的弹窗直接关闭；重要、操作多、误关损失大又不常用的弹窗**确有改动时**先问一句
 * 是否放弃修改，没有改动时直接关闭。点背景、下拉、右上角 ×、Esc 与系统返回一视同仁——都走同一个判断。
 *
 * - 正在保存（`busy`）时任何关闭请求都不响应，避免保存到一半面板没了、结果不知道成没成功；
 * - 保存成功后的关闭（`force`）不再询问：那时的“改动”已经保存了。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useMarkBack, usePane } from "../workspace/context.js";
import { uuidV7 } from "./uuid.js";

export type CloseDecision = "ignore" | "ask" | "close";

export function decideClose({ busy, dirty, force = false }: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly force?: boolean;
}): CloseDecision {
  if (busy && !force) return "ignore";
  if (dirty && !force) return "ask";
  return "close";
}

/**
 * **系统返回也先询问**：有改动的面板打开期间，在浏览器历史里压一条同地址的保护记录（与资料编辑的草稿守卫
 * 同一做法）。按返回只会退掉这条保护记录、页面不动；这里马上补回保护记录并调用 `onBack`（由面板弹出询问）。
 * 面板关闭或改动被撤销时，如果保护记录仍在最上面就把它退掉，历史栈恢复原样。
 *
 * ⚠️ 只在拥有地址栏的主工作区生效：大屏的辅助工作区不写浏览器历史，也不拦浏览器返回（与 `useDraftExit` 一致）。
 * ⚠️ 没有改动的面板不压记录：系统返回保持原来的行为（返回上一页，面板随页面关闭）。
 */
/** 整页离开时为 true：保护记录交给离开的那次导航处理，卸载时不再自己退掉（见 `leavePage`）。 */
let leaving = false;

const guardOnTop = (): boolean =>
  typeof window !== "undefined" && typeof (window.history.state as { overlayGuard?: unknown } | null)?.overlayGuard === "string";

/**
 * **从有改动的面板里整页离开**（例如批量添加里的「去账本设置」，原来就是 `window.location.assign`）。
 *
 * 面板关闭时会退掉自己压的保护记录（`history.back()`，异步）；如果同一时刻又开始整页导航，两者会互相打断。
 * 所以整页离开改由这里处理：最上面是保护记录时用 `location.replace` 把它换成目标页——浏览器历史与原来
 * 「没有保护记录时 assign」完全一样（上一页仍是原页面）；没有保护记录时照常 `assign`。
 */
export function leavePage(url: string): void {
  leaving = true;
  if (guardOnTop()) window.location.replace(url);
  else window.location.assign(url);
}

export function useBackGuard(active: boolean, onBack: () => void): void {
  const owns = usePane().role === "primary";
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active || !owns || typeof window === "undefined") return;
    const marker = `overlay-guard-${uuidV7()}`;
    const guard = (): void => {
      window.history.pushState({ ...(window.history.state as object | null), overlayGuard: marker }, "", window.location.href);
    };
    const isGuard = (): boolean => (window.history.state as { overlayGuard?: string } | null)?.overlayGuard === marker;
    guard();
    const pop = (): void => {
      if (isGuard()) return;
      guard();
      callback.current();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (!leaving && isGuard()) window.history.back();
    };
  }, [active, owns]);
}

/**
 * **整页的“系统返回也先询问”**（1.19.81，所有者 2026-11-15：“我们的返回跟系统返回应该是一致的——它要拦我们的返回，当然也要拦系统的返回”）。
 *
 * 与 `useBackGuard` 同一做法：页面有未保存输入（`active`）期间压一条同地址的保护记录；系统返回只退掉它、页面不动，
 * 马上补回并调用 `onBack`（页面弹出与顶栏返回同一个询问）。另外返回 `leave(fallback)`，给确认“放弃并返回”之后用：
 *
 * - 先撤掉监听，保证这次离开不会被自己再拦一次；
 * - 保护记录在最上面、这一页前面还有本应用的历史时，一次退两条（保护记录 + 这一页）回到上一页——协调器按返回播放转场；
 *   （直接 `navigate(-1)` 只会退掉保护记录、停在原页）
 * - 保护记录不在（没有未保存输入）或这一页是会话第一条（深链）时，交给 `fallback`（页面原来的返回）。
 *
 * ⚠️ 只在拥有地址栏的主工作区生效（与 `useBackGuard` 一致）。
 */
export function usePageBackGuard(active: boolean, onBack: () => void): (fallback: () => void, released?: (guarded: boolean) => void) => void {
  const owns = usePane().role === "primary";
  const callback = useRef(onBack);
  useEffect(() => {
    callback.current = onBack;
  }, [onBack]);
  const current = useRef<{ marker: string; pop: () => void; released: boolean } | null>(null);

  useEffect(() => {
    if (!active || !owns || typeof window === "undefined") return;
    const marker = `page-guard-${uuidV7()}`;
    const guard = (): void => {
      window.history.pushState({ ...(window.history.state as object | null), overlayGuard: marker }, "", window.location.href);
    };
    const isGuard = (): boolean => (window.history.state as { overlayGuard?: string } | null)?.overlayGuard === marker;
    guard();
    const pop = (): void => {
      if (isGuard()) return;
      guard();
      callback.current();
    };
    const entry = { marker, pop, released: false };
    current.current = entry;
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (current.current === entry) current.current = null;
      if (!entry.released && !leaving && isGuard()) window.history.back();
    };
  }, [active, owns]);

  /**
   * 确认离开。默认是“返回”：退掉保护记录与这一页。给了 `released` 时只撤掉保护（不导航），由调用方去别处——
   * `guarded` 为 true 表示保护记录还在最上面，调用方应当用 replace 换掉它（浏览器历史与没有询问时一致）。
   */
  return useCallback((fallback: () => void, released?: (guarded: boolean) => void) => {
    const entry = current.current;
    const state = typeof window === "undefined" ? null : (window.history.state as { overlayGuard?: string; idx?: unknown } | null);
    if (entry === null || state?.overlayGuard !== entry.marker) { if (released) released(false); else fallback(); return; }
    entry.released = true;
    window.removeEventListener("popstate", entry.pop);
    current.current = null;
    if (released) { released(true); return; }
    // 保护记录复制了这一页的历史位置（idx）：大于 0 说明前面还有本应用的记录，退两条回到上一页；否则（深链）交给原来的返回。
    if (typeof state.idx === "number" && state.idx > 0) window.history.go(-2);
    else fallback();
  }, []);
}

/**
 * **整页“离开前询问”**（1.19.82，所有者 2026-11-15：“所有的记账方式退出时都要问放弃；但如果记账页面没做任何改动的话，
 * 退出就不用问放弃”；“尽可能让所有的东西都用我们自己风格的对话框”）。
 *
 * 顶栏返回与系统返回走同一个判断：有改动（`dirty`）时先弹应用自己的确认框（`ConfirmDialog`），没有改动直接离开。
 * - `requestLeave`：给顶栏返回（`InnerPage` / `WorkspaceTopBar` 的 `onBack`）；
 * - `confirmLeave`：确认框的「放弃并返回」；`dialog` 可直接展开给 `ConfirmDialog`（open / onConfirm / onCancel）；
 * - `askLeave(path)`：页面里去别处的入口（例如页内链接）需要先问时调用；确认后前往 `path`。
 * - `proceed(path)`：流程里的下一步（文本记账 → 核对页、识别完 → 概览……）不是离开，不问；有保护记录时先退掉它再前往。
 *   去别处（`askLeave` 确认、`proceed`）都先退掉保护记录、等工作区历史回到这一页，再 push 新页面：浏览器历史与没有询问时
 *   完全一样，从新页面返回回到这一页（用 replace 换掉保护记录会让工作区历史不认识回来的那条记录，返回栈被重置）。
 * - `discardHere(action)`：页面自己问过“放弃修改？”、确认后**留在本页**（收起编辑、换一项编辑）时用：先退掉保护记录，
 *   再执行 `action`——`action` 里如果 replace 了地址（例如退出编辑态），不会把保护记录改写成一条普通记录、留下重复的一页。
 * - 系统返回只在拥有地址栏的主工作区拦截（`usePageBackGuard`）；确认放弃后一次退掉保护记录与这一页，
 *   协调器照常播放返回转场。离开前再告诉工作区外壳“这是返回”（`markBack`，有时限，取消询问不会留下）。
 * - `links: true`：有改动时，点本应用里去别处的链接（常驻底栏、页内链接）也先问，确认后再前往。只认本工作区里的链接
 *   （另一个工作区里的链接与这页无关）；新窗口、下载、外站链接与按着修饰键的点击不拦。流程内部的下一步如果是链接，不要开它。
 */
export function useLeaveConfirm(dirty: boolean, leave: () => void, options: { readonly links?: boolean } = {}): {
  readonly requestLeave: () => void;
  readonly confirmLeave: () => void;
  readonly askLeave: (path: string) => void;
  readonly proceed: (path: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => void;
  readonly discardHere: (action: () => void) => void;
  readonly dialog: { readonly open: boolean; readonly onConfirm: () => void; readonly onCancel: () => void };
} {
  const [asking, setAsking] = useState(false);
  const target = useRef<string | null>(null);
  const markBack = useMarkBack();
  const navigate = useNavigate();
  const leaveGuarded = usePageBackGuard(dirty, () => { target.current = null; setAsking(true); });
  /** 撤掉保护记录后执行 `action`：保护记录在最上面时先退回这一页（工作区历史认得它，不播转场），再执行。 */
  const discardHere = useCallback((action: () => void): void => {
    leaveGuarded(action, (guarded) => {
      if (!guarded || typeof window === "undefined") { action(); return; }
      window.addEventListener("popstate", () => { action(); }, { once: true });
      window.history.back();
    });
  }, [leaveGuarded]);
  const latest = useRef({ dirty, leave });
  useEffect(() => { latest.current = { dirty, leave }; }, [dirty, leave]);
  const leaveNow = useCallback(() => { markBack(); leaveGuarded(latest.current.leave); }, [leaveGuarded, markBack]);
  const requestLeave = useCallback(() => {
    if (latest.current.dirty) { target.current = null; setAsking(true); } else leaveNow();
  }, [leaveNow]);
  const askLeave = useCallback((path: string) => {
    if (!latest.current.dirty) { void navigate(path); return; }
    target.current = path; setAsking(true);
  }, [navigate]);
  const confirmLeave = useCallback(() => {
    setAsking(false);
    const to = target.current; target.current = null;
    if (to === null) { leaveNow(); return; }
    // 去别处（不是返回）：先退掉保护记录再前往，浏览器历史与没有询问时一致。
    discardHere(() => { void navigate(to); });
  }, [discardHere, leaveNow, navigate]);
  const cancel = useCallback(() => { target.current = null; setAsking(false); }, []);
  const proceed = useCallback((path: string, options?: { readonly replace?: boolean; readonly state?: unknown }) => {
    discardHere(() => { void navigate(path, options); });
  }, [discardHere, navigate]);
  const instance = usePane().instance;
  const links = options.links === true;
  useEffect(() => {
    if (!dirty || !links || typeof document === "undefined") return;
    const click = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target !== "" && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const owner = anchor.closest("[data-instance]")?.getAttribute("data-instance");
      if (owner !== null && owner !== undefined && owner !== instance) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const path = `${url.pathname}${url.search}${url.hash}`;
      if (path === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      event.stopPropagation();
      askLeave(path);
    };
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("click", click, true); };
  }, [dirty, links, instance, askLeave]);
  return { requestLeave, confirmLeave, askLeave, proceed, discardHere, dialog: { open: asking, onConfirm: confirmLeave, onCancel: cancel } };
}
