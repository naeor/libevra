/**
 * **统一提示条的应用级队列与调用接口**（1.19.66，方案 §2.1）。
 *
 * `ToastProvider` 挂在 `App.tsx` 原 `UndoProvider` 的位置（登录状态之内、路由与外壳之外）：删除一笔后返回列表，
 * 撤销提示仍在。它只管状态与计时，不渲染；显示由每个外壳里的 `ToastViewport` 负责（手机 / Pad 在 `.lv-shell` 内，
 * 电脑版在 `.lv-desktop` 内）。
 *
 * 调用一律走 `useToast()`：
 *
 * ```tsx
 * const toast = useToast();
 * toast.show({ tone: "success", text: t("…saved") });
 * toast.show({ tone: "info", text, action: { label: t("common.action.undo"), run: undo, alternative: "编辑条的撤销按钮" }, scope: "page" });
 * toast.show({ tone: "error", text: t("…saveFailed"), key: "stats-save", scope: "page" }); // 常驻，有 ×
 * ```
 *
 * `scope: "page"` 的提示随调用它的组件卸载而撤下（不触发操作）；默认 `app`，跨页面保留。
 * 不要在页面里再写固定定位的 `role="status"` 提示条——守卫测试会拦下（`toast.guard.test.ts`）。
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PaneContext } from "../../workspace/context.js";
import { ToastController } from "../../lib/toast/controller.js";
import type { ToastOptions } from "../../lib/toast/types.js";
import { createToastBottomSlot, ToastBottomSlotContext } from "./bottomSlot.js";

/** 前置图是 React 节点（例如头像）。 */
export type ToastLeading = ReactNode;
export type AppToastOptions = ToastOptions<ToastLeading>;
export type AppToastController = ToastController<ToastLeading>;

const ToastContext = createContext<AppToastController | null>(null);

export function ToastProvider({ children, controller }: { readonly children: ReactNode; readonly controller?: AppToastController }): React.JSX.Element {
  const [own] = useState<AppToastController>(() => controller ?? new ToastController<ToastLeading>());
  // 1.19.72：手机底部提示位的占用状态（宿主写、当前账本胶囊读，见 bottomSlot.ts）。
  const [bottomSlot] = useState(createToastBottomSlot);

  // 页面切到后台时暂停计时（方案 §2.4）：回来时至少还剩一段，不会“切回来正好错过”。
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = (): void => {
      own.setPause("hidden", document.visibilityState === "hidden");
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
    };
  }, [own]);

  // 开发 / 测试构建：控制台与截图脚本可以直接发一条提示（`window.__lvToast.show({ … })`），不用真的制造失败。
  // 正式构建里 import.meta.env.DEV 为 false，整段被去掉。
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    const host = window as unknown as { __lvToast?: AppToastController };
    host.__lvToast = own;
    return () => {
      if (host.__lvToast === own) delete host.__lvToast;
    };
  }, [own]);

  return (
    <ToastContext.Provider value={own}>
      <ToastBottomSlotContext.Provider value={bottomSlot}>{children}</ToastBottomSlotContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToastController(): AppToastController {
  const controller = useContext(ToastContext);
  if (controller === null) throw new Error("useToast must be used inside <ToastProvider>");
  return controller;
}

export interface ToastApi {
  /** 显示一条提示，返回 id。 */
  show(options: AppToastOptions): number;
  /** 撤下（不触发操作）。id 已经结束时什么也不做。 */
  dismiss(id: number): void;
}

/**
 * 发提示的唯一入口。返回的对象在组件生命周期内不变，可以放进依赖数组。
 * 组件卸载时，它发出的 `scope: "page"` 提示一并撤下。
 */
export function useToast(): ToastApi {
  const controller = useToastController();
  const pane = useContext(PaneContext);
  const instance = pane.shell === "wide" ? pane.instance : undefined;
  const owner = useRef<symbol | null>(null);
  if (owner.current === null) owner.current = Symbol("toast-owner");

  useEffect(() => {
    const mine = owner.current!;
    return () => {
      controller.dismissOwner(mine);
    };
  }, [controller]);

  return useMemo<ToastApi>(
    () => ({
      show: (options) => controller.show({ ...options, pane: instance }, owner.current),
      dismiss: (id) => {
        controller.dismiss(id);
      },
    }),
    [controller, instance],
  );
}
