/**
 * **弹出面板的状态记忆**（1.19.82，所有者 2026-11-15：“应该是记住面板当时的状态……尽可能的记录滚动页面当前的位置”）。
 *
 * 从弹出面板里打开别的页面（例如账本通知里的「账目 →」、附件预览里的账目链接）时，面板先收起再前往；以前返回只回到
 * 面板所在的页面，面板是关着的。现在打开前把面板当时的样子（看的是哪一项、列表滚到哪里）记在**面板所在的那条历史记录**上，
 * 返回（POP）到这条记录时重新打开面板、接着看；之后从别处重新进入这一页（新的历史记录）不会自己弹出面板。
 *
 * - 只在内存里，一次性：取出即删除；最多记 32 条，最旧的先丢。
 * - “不连续使用”（应用离开屏幕超过 30 分钟，lib/continuity.ts）后全部清掉。
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";

import { pageTransitionActive } from "../components/ui/ComponentMotion.js";
import { onContinuityReset } from "./continuity.js";

const LIMIT = 32;
const memory = new Map<string, unknown>();
const slot = (entryKey: string, panel: string): string => `${entryKey}\u0000${panel}`;

onContinuityReset(() => { memory.clear(); });

/** 在面板所在的历史记录（`entryKey` = 那一页的 `location.key`）上记下面板状态。 */
export function rememberPanel(entryKey: string, panel: string, state: unknown): void {
  const id = slot(entryKey, panel);
  memory.delete(id);
  memory.set(id, state);
  while (memory.size > LIMIT) memory.delete(memory.keys().next().value!);
}

export function peekPanel<T>(entryKey: string, panel: string): T | null {
  return (memory.get(slot(entryKey, panel)) as T | undefined) ?? null;
}

export function forgetPanel(entryKey: string, panel: string): void {
  memory.delete(slot(entryKey, panel));
}

/**
 * 返回到这一页时，取回面板离开前的状态（只在 POP 时；取回后即删除）。没有就是 null。
 * 读在初始化里、删在 effect 里：开发模式的 StrictMode 会把初始化调用两次，读写分开才不会第二次读到空。
 */
export function useReturnedPanel<T>(panel: string): T | null {
  const location = useLocation();
  const type = useNavigationType();
  const [returned] = useState<T | null>(() => (type === "POP" ? peekPanel<T>(location.key, panel) : null));
  useEffect(() => { if (returned !== null) forgetPanel(location.key, panel); }, [returned, location.key, panel]);
  return returned;
}

/** 等页面转场结束再执行（返回时页面先到位、面板再升起，不和返回转场叠在一起）；最多等 1.5 秒。返回取消函数。 */
export function afterPageTransition(run: () => void): () => void {
  if (typeof requestAnimationFrame === "undefined") { run(); return () => undefined; }
  const start = performance.now();
  let frame = 0;
  const tick = (): void => {
    if (!pageTransitionActive() || performance.now() - start > 1500) { run(); return; }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(frame); };
}

/** 返回到面板所在的页面时，等页面转场结束后用记下的状态重新打开面板（`reopen`）。 */
export function useReopenPanel<T>(panel: string, reopen: (state: T) => void): void {
  const returned = useReturnedPanel<T>(panel);
  const latest = useRef(reopen);
  useEffect(() => { latest.current = reopen; }, [reopen]);
  useEffect(() => {
    if (returned === null) return;
    return afterPageTransition(() => { latest.current(returned); });
  }, [returned]);
}
