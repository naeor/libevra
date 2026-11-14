/**
 * **滚动位置记忆（不经过 S19 协调器的外观）**（1.19.82，所有者 2026-11-15：“尽可能的记录滚动页面当前的位置……
 * 用户不连续使用时，就可以重置每个页面的滚动位”）。
 *
 * S19 手机外观由协调器（s19/motion/pilot.tsx）记住并恢复滚动位置；Original、电脑与 Pad 的工作区原来没有——返回一页总是
 * 回到顶部。这里给它们同样的规则：
 * - 离开一页时记下它的滚动位置（按这条历史记录）；**返回**（POP）到这条记录时恢复；
 * - 主 Tab 另按 Tab 记一份：从别处点底栏回到某个 Tab（新的历史记录）也接上那个 Tab 上次的位置；
 * - 打开新页面（PUSH）照常从页面自己的初始位置开始；
 * - 换账号重新开始；应用离开屏幕超过 30 分钟（lib/continuity.ts）重新开始；重新载入页面本来就从头开始（只在内存里）。
 *
 * 滚动容器与协调器读同一组：工作区自己的滚动层（宽屏的盒子模式）、文档滚动、以及页面里的 `.overflow-y-auto`（按出现顺序）。
 * 列表晚一两帧才撑高时短暂重试（约 100ms），之后不再与用户的滚动争夺。
 */
import { onContinuityReset } from "../lib/continuity.js";
import { navigationLevel } from "../s19/motion/navigation.js";

interface ScrollPoint { readonly pane: number; readonly documentY: number; readonly inner: readonly number[] }

const LIMIT = 64;

export interface ScrollMemory {
  save(key: string, pathname: string): void;
  restore(key: string, pathname: string, action: "PUSH" | "REPLACE" | "POP"): void;
  setAccount(account: string): void;
  dispose(): void;
}

export function createScrollMemory(paneId: string): ScrollMemory {
  const entries = new Map<string, ScrollPoint>();
  const tabs = new Map<string, ScrollPoint>();
  let account: string | null = null;
  let frame = 0;
  const clear = (): void => { entries.clear(); tabs.clear(); };
  const off = onContinuityReset(clear);
  const root = (): HTMLElement | null => document.querySelector<HTMLElement>(`.lv-pane[data-instance="${paneId}"] > .lv-pane-scroll`);
  const inner = (): HTMLElement[] => Array.from(root()?.querySelectorAll<HTMLElement>(".overflow-y-auto") ?? []);
  return {
    save(key, pathname) {
      const pane = root();
      if (pane === null) return;
      const point: ScrollPoint = { pane: pane.scrollTop, documentY: window.scrollY, inner: inner().map((element) => element.scrollTop) };
      entries.delete(key);
      entries.set(key, point);
      if (navigationLevel(pathname) === "tabRoot") tabs.set(pathname, point);
      while (entries.size > LIMIT) entries.delete(entries.keys().next().value!);
    },
    restore(key, pathname, action) {
      cancelAnimationFrame(frame);
      const saved = action === "POP" ? entries.get(key) : action === "PUSH" && navigationLevel(pathname) === "tabRoot" ? tabs.get(pathname) : undefined;
      if (saved === undefined) return;
      const apply = (): boolean => {
        let clamped = false;
        const pane = root();
        if (pane !== null) { pane.scrollTop = saved.pane; if (pane.scrollTop < saved.pane - 1) clamped = true; }
        if (saved.documentY > 0) window.scrollTo({ top: saved.documentY, behavior: "instant" });
        inner().forEach((element, index) => {
          const top = saved.inner[index] ?? 0;
          if (top === 0 && element.scrollTop === 0) return;
          element.scrollTop = top;
          if (element.scrollTop < top - 1) clamped = true;
        });
        return clamped;
      };
      let tries = 6;
      const retry = (): void => { if (apply() && --tries > 0) frame = requestAnimationFrame(retry); };
      if (apply()) frame = requestAnimationFrame(retry);
    },
    setAccount(next) {
      if (account !== null && account !== next) clear();
      account = next;
    },
    dispose() { cancelAnimationFrame(frame); off(); },
  };
}
