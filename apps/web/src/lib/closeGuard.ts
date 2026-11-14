/**
 * **关闭前询问**（弹出面板模板，1.19.58；分类见 docs/specs/design/S19-审查后续待办与弹出面板模板-20261114.md §2）。
 *
 * 所有者的规则：轻量、常用的弹窗直接关闭；重要、操作多、误关损失大又不常用的弹窗**确有改动时**先问一句
 * 是否放弃修改，没有改动时直接关闭。点背景、下拉、右上角 ×、Esc 与系统返回一视同仁——都走同一个判断。
 *
 * - 正在保存（`busy`）时任何关闭请求都不响应，避免保存到一半面板没了、结果不知道成没成功；
 * - 保存成功后的关闭（`force`）不再询问：那时的“改动”已经保存了。
 */
import { useCallback, useEffect, useRef } from "react";

import { usePane } from "../workspace/context.js";
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
export function usePageBackGuard(active: boolean, onBack: () => void): (fallback: () => void) => void {
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

  return useCallback((fallback: () => void) => {
    const entry = current.current;
    const state = typeof window === "undefined" ? null : (window.history.state as { overlayGuard?: string; idx?: unknown } | null);
    if (entry === null || state?.overlayGuard !== entry.marker) { fallback(); return; }
    entry.released = true;
    window.removeEventListener("popstate", entry.pop);
    current.current = null;
    // 保护记录复制了这一页的历史位置（idx）：大于 0 说明前面还有本应用的记录，退两条回到上一页；否则（深链）交给原来的返回。
    if (typeof state.idx === "number" && state.idx > 0) window.history.go(-2);
    else fallback();
  }, []);
}

