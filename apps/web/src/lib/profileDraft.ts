import { useEffect } from "react";
import { usePaneDirty } from "../workspace/context.js";

/**
 * 资料编辑的草稿保护：登记给工作区外壳（`usePaneDirty`），并在刷新 / 关闭标签页时请浏览器确认。
 *
 * 1.19.82 起返回与链接的询问改用应用自己的对话框（所有者 2026-11-15：“尽可能让所有的东西都用我们自己风格的对话框”）：
 * 系统返回、本工作区里的链接由页面的 `useLeaveConfirm`（lib/closeGuard.ts）拦截，与顶栏返回同一个判断、同一个对话框。
 * 原来这里用浏览器原生的 `window.confirm`，而且页面自己的对话框确认后还会被它再问一次。
 *
 * ⚠️ **刷新 / 关闭标签页仍是浏览器自带的提示**：`beforeunload` 只能请浏览器弹它自己的确认，网页不能换成自己的对话框，
 * 文案也由浏览器决定。
 *
 * ⚠️ **S18：浏览器后退与地址栏只属于主工作区**（`useLeaveConfirm` 里的 `usePageBackGuard` 自己判断）；辅助工作区只拦本工作区里的链接。
 */
export function useDraftExit(dirty: boolean): void {
  usePaneDirty(dirty);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty]);
}
