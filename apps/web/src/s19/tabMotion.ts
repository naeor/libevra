/**
 * S19：正式版使用 V1，开发与实验构建可以比较两种底栏胶囊动效。
 *
 * - V1 Behind the Plus：跨过中央“＋”时连续移动，从“＋”后方穿过。
 * - V2 Disappear & Reappear：跨过“＋”时在原位置收起消失，在目标位置重新出现。
 *
 * 两套共用同一个胶囊（位置、形状、材质、选中图标与文字都相同），只切换动画。
 * 实验选择存在本机；测试链接可带 `?s19tab=v1|v2`。
 */
import { STYLE_LAB_ENABLED } from "../lib/visualStyle.js";

export type TabMotion = "v1" | "v2";
export const TAB_MOTIONS: readonly TabMotion[] = ["v1", "v2"];
export const TAB_MOTION_STORAGE_KEY = "libevra.s19-tab-motion";
export const TAB_MOTION_LABELS: Readonly<Record<TabMotion, string>> = {
  v1: "V1 — Behind the Plus",
  v2: "V2 — Disappear & Reappear",
};

function parse(raw: string | null | undefined): TabMotion {
  return raw === "v2" ? "v2" : "v1";
}

function readStored(): TabMotion {
  if (!STYLE_LAB_ENABLED) return "v1";
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("s19tab");
    if (fromUrl === "v1" || fromUrl === "v2") {
      try { window.localStorage.setItem(TAB_MOTION_STORAGE_KEY, fromUrl); } catch { /* 只在本次会话里生效 */ }
      return fromUrl;
    }
  } catch { /* 忽略 */ }
  try { return parse(window.localStorage.getItem(TAB_MOTION_STORAGE_KEY)); } catch { return "v1"; }
}

let current: TabMotion | null = null;
const listeners = new Set<() => void>();

export function tabMotion(): TabMotion {
  current ??= readStored();
  return current;
}

export function chooseTabMotion(next: TabMotion): void {
  current = next;
  try { window.localStorage.setItem(TAB_MOTION_STORAGE_KEY, next); } catch { /* 只在本次会话里生效 */ }
  document.documentElement.dataset.s19TabMotion = next;
  for (const listener of listeners) listener();
}

export function subscribeTabMotion(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let started = false;
export function startTabMotion(): void {
  if (started) return; started = true;
  document.documentElement.dataset.s19TabMotion = tabMotion();
  if (!STYLE_LAB_ENABLED) return;
  window.addEventListener("storage", (event) => {
    if (event.key !== TAB_MOTION_STORAGE_KEY) return;
    current = parse(event.newValue);
    document.documentElement.dataset.s19TabMotion = current;
    for (const listener of listeners) listener();
  });
}
