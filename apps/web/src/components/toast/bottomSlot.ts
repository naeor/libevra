/**
 * **手机底部提示位的让位**（1.19.72，所有者 2026-11-14 要求）：底部提示条出现时，底栏上方的当前账本胶囊（“我的本地账本”）
 * 先缩回底栏后面，提示再从下方升起；提示消失后，胶囊再弹回原位。只是短暂让位，不是隐藏账本入口。
 *
 * - **谁写**：手机外壳的 `ToastViewport`。当前有一条提示、放在底部（不是分析工作台编辑态的顶部锚点）、
 *   而且没有模态弹层打开时，底部提示位算“被占用”。弹层打开时提示本来就让开（藏在遮罩后面），这时不占用：
 *   胶囊回到原位，弹层的打开按钮（例如胶囊自己的账本切换面板）关闭后焦点才能回到它身上。
 *   “+”记一笔菜单展开时提示也让开，但菜单本来就盖住胶囊的位置（胶囊隐藏），所以仍算占用，菜单收起时不会先弹出胶囊再缩回。
 * - **谁读**：`PersistentBookCapsule`。动画沿用它原有的两段：离开页面时“向下缩到底栏上缘之后”、出现时“从下方弹起、略过冲”。
 * - **先后**：胶囊让开约八成时提示开始升起（`TOAST_WAIT_FOR_GIVE_WAY_MS`）；提示退场约八成时胶囊开始弹回（胶囊自己按当前风格的
 *   提示退场时长计算）。宿主只在胶囊此刻还在原位（`data-toast-give-way="shown"`）时才等，已经让开时提示直接出现。
 *
 * 胶囊让开期间不再是提示的障碍物（它不带 `data-toast-avoid`），提示放在抬高的“+”之上 8px。
 */
import { createContext, useContext, useSyncExternalStore } from "react";

export interface ToastBottomSlot {
  /** 底部提示位此刻是否被占用。 */
  get(): boolean;
  set(occupied: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createToastBottomSlot(): ToastBottomSlot {
  let occupied = false;
  const listeners = new Set<() => void>();
  return {
    get: () => occupied,
    set(next) {
      if (next === occupied) return;
      occupied = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const ToastBottomSlotContext = createContext<ToastBottomSlot | null>(null);

/** 给提示让位的元素（当前账本胶囊的宿主）。值：`shown` 在原位；`leaving` 正在缩回；`away` 已让开或在等提示退场后弹回。 */
export const TOAST_GIVE_WAY_SELECTOR = "[data-toast-give-way]";
export type ToastGiveWayState = "shown" | "leaving" | "away";

/** 胶囊缩回用 200ms（PersistentBookCapsule 的 EXIT_MS），走到约八成、大部分已经藏到底栏后面时提示开始升起。 */
export const TOAST_WAIT_FOR_GIVE_WAY_MS = 160;

/** 胶囊等提示退场的比例：提示退场时长（`--lv-dismiss-ms`，按风格 120–180ms）的约八成。 */
export const GIVE_WAY_RETURN_RATIO = 0.8;

const noopSubscribe = (): (() => void) => () => undefined;
const never = (): boolean => false;

/** 底部提示位是否被占用；没有 ToastProvider（测试、样板页的局部渲染）时一直是 false。 */
export function useToastBottomOccupied(): boolean {
  const slot = useContext(ToastBottomSlotContext);
  return useSyncExternalStore(slot?.subscribe ?? noopSubscribe, slot?.get ?? never, never);
}
