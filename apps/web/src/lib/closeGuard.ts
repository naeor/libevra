/**
 * **关闭前询问**（弹出面板模板，1.19.58；分类见 docs/specs/design/S19-审查后续待办与弹出面板模板-20261114.md §2）。
 *
 * 所有者的规则：轻量、常用的弹窗直接关闭；重要、操作多、误关损失大又不常用的弹窗**确有改动时**先问一句
 * 是否放弃修改，没有改动时直接关闭。点背景、下拉、右上角 ×、Esc 与系统返回一视同仁——都走同一个判断。
 *
 * - 正在保存（`busy`）时任何关闭请求都不响应，避免保存到一半面板没了、结果不知道成没成功；
 * - 保存成功后的关闭（`force`）不再询问：那时的“改动”已经保存了。
 */
import { useEffect, useRef } from "react";

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
      if (isGuard()) window.history.back();
    };
  }, [active, owns]);
}
