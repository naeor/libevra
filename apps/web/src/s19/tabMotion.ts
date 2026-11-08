/**
 * S19：底栏选中玻璃胶囊的两套动效（只在开发 / 测试构建里存在，随 lab.ts 加载）。
 *
 * - V1 Behind the Plus：跨过中央“＋”时连续移动，从“＋”后方穿过。
 * - V2 Disappear & Reappear：跨过“＋”时在原位置收起消失，在目标位置重新出现。
 *
 * 两套共用同一个胶囊（位置、形状、材质、选中图标与文字都相同），只切换动画。
 * 选择存在本机（`libevra.` 前缀，“清除本机全部数据”会一并清掉）；测试链接可带 `?s19tab=v1|v2`。
 */
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
  window.addEventListener("storage", (event) => {
    if (event.key !== TAB_MOTION_STORAGE_KEY) return;
    current = parse(event.newValue);
    document.documentElement.dataset.s19TabMotion = current;
    for (const listener of listeners) listener();
  });
}
