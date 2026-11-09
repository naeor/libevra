/** 四风格正式外观与本机偏好。旧版 original 继续读取和保留，但不在正式选择器列出。
 * 默认入口 DEFAULT_VISUAL_STYLE 暂不改为 a；实验 URL / 把手仍由 STYLE_LAB_ENABLED 控制。
 * 样式只变材质，主题色、明暗、账号、账本及页面状态独立。
 */

import { applyGlassBlur, DEFAULT_GLASS_BLUR, GLASS_BLUR_STORAGE_KEY, normalizeGlassBlur, parseGlassBlur } from "../s19/material.js";
import { applyB2Glass, B2_GLASS_LEGACY_OWNER_KEY, B2_GLASS_STORAGE_PREFIX, b2GlassStorageKey, customGlass, parseB2Glass, presetGlass, type B2GlassPreset, type B2GlassSelection, type B2GlassValues } from "../s19/b2Glass.js";
import { DEFAULT_WALLPAPER, WALLPAPER_STORAGE_KEY, parseWallpaper, type Wallpaper } from "../s19/wallpaper.js";

export const VISUAL_STYLES = ["original", "a", "b1", "b2", "c"] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

/** `libevra.` 前缀：属于本应用，“清除本机全部数据”会一并清掉（见 deviceStorageKeys.ts）。 */
export const VISUAL_STYLE_STORAGE_KEY = "libevra.s19-visual-style";

/** 测试链接可以直接带上 `?s19=b1` 打开某一套（会记住，之后不必再带）。 */
export const VISUAL_STYLE_QUERY_PARAM = "s19";

export const STYLE_LAB_ENABLED: boolean =
  import.meta.env.DEV === true || (typeof __S19_STYLE_LAB__ !== "undefined" && __S19_STYLE_LAB__);

export function isVisualStyle(value: unknown): value is VisualStyle {
  return typeof value === "string" && (VISUAL_STYLES as readonly string[]).includes(value);
}

export const DEFAULT_VISUAL_STYLE: VisualStyle = "original";

export function parseVisualStyle(raw: string | null | undefined): VisualStyle {
  const value = raw?.trim().toLowerCase();
  return isVisualStyle(value) ? value : DEFAULT_VISUAL_STYLE;
}

export interface VisualStyleRoot {
  readonly dataset: { visualStyle?: string; wallpaper?: string };
  readonly style?: Pick<CSSStyleDeclaration, "setProperty">;
}

export interface VisualStyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Original 不写属性：没有属性时，任何 S19 规则都不会命中，页面与现在完全一致。 */
export function applyVisualStyle(root: VisualStyleRoot, style: VisualStyle): void {
  if (style === "original") delete root.dataset.visualStyle;
  else root.dataset.visualStyle = style;
}

function readStored(storage: VisualStyleStorage | null): VisualStyle {
  if (storage === null) return DEFAULT_VISUAL_STYLE;
  try {
    return parseVisualStyle(storage.getItem(VISUAL_STYLE_STORAGE_KEY));
  } catch {
    return DEFAULT_VISUAL_STYLE;
  }
}

function persist(storage: VisualStyleStorage | null, style: VisualStyle): void {
  if (storage === null) return;
  try {
    if (style === "original") storage.removeItem(VISUAL_STYLE_STORAGE_KEY);
    else storage.setItem(VISUAL_STYLE_STORAGE_KEY, style);
  } catch {
    /* 隐私模式或配额已满：只在本次会话里生效。 */
  }
}

export interface VisualStyleController {
  getSnapshot(): VisualStyle;
  getWallpaperSnapshot(): Wallpaper;
  chooseWallpaper(wallpaper: Wallpaper): void;
  restoreWallpaper(raw: string | null): void;
  getB2Snapshot(): B2GlassSelection;
  getB2Account(): string | null;
  setB2Account(account: string | null): void;
  chooseB2Preset(preset: B2GlassPreset): void;
  /** 仅供已通过 /admin/self 的高级编辑动作调用；账号必须仍与当前会话一致。 */
  chooseB2Custom(account: string, values: B2GlassValues): boolean;
  restoreB2(raw: string | null, key?: string | null): void;
  getBlurSnapshot(): number;
  chooseBlur(value: number): void;
  resetBlur(): void;
  restoreBlur(raw: string | null): void;
  subscribe(listener: () => void): () => void;
  choose(style: VisualStyle): void;
  /** 另一个标签页改了选择（`storage` 事件）时跟随；不再写回存储。 */
  restore(raw: string | null): void;
}

export function createVisualStyleController(
  root: VisualStyleRoot,
  storage: VisualStyleStorage | null,
  initial?: string | null,
  _allowExperiments = true,
): VisualStyleController {
  const listeners = new Set<() => void>();
  let wallpaper = DEFAULT_WALLPAPER;
  try { wallpaper = parseWallpaper(storage?.getItem(WALLPAPER_STORAGE_KEY)); } catch { /* 旧用户与不可用存储均使用柔和极光。 */ }
  root.dataset.wallpaper = wallpaper;
  const setWallpaper = (next: Wallpaper, save: boolean): void => {
    if (wallpaper === next) return;
    wallpaper = next;
    root.dataset.wallpaper = next;
    if (save) { try { storage?.setItem(WALLPAPER_STORAGE_KEY, next); } catch { /* 仍在本次会话立即生效。 */ } }
    for (const listener of listeners) listener();
  };
  let current: VisualStyle = readStored(storage);
  let blur = DEFAULT_GLASS_BLUR;
  try { blur = parseGlassBlur(storage?.getItem(GLASS_BLUR_STORAGE_KEY)); } catch { /* 会话内默认值 */ }
  const permitted = (value: VisualStyle): VisualStyle => value;
  current = permitted(current);
  let account: string | null = null;
  let legacyBlur: string | null = null;
  let legacyOwner: string | null = null;
  try {
    if (current === "b2") legacyBlur = storage?.getItem(GLASS_BLUR_STORAGE_KEY) ?? null;
    legacyOwner = storage?.getItem(B2_GLASS_LEGACY_OWNER_KEY) ?? null;
  } catch { /* 无存储时没有旧格式可迁移。 */ }
  const sessionSelections = new Map<string, B2GlassSelection>();
  const readB2 = (): B2GlassSelection => {
    const key = b2GlassStorageKey(account);
    try { legacyOwner = storage?.getItem(B2_GLASS_LEGACY_OWNER_KEY) ?? legacyOwner; } catch { /* 沿用会话内归属。 */ }
    // 旧格式没有账号字段，升级时归给首次恢复的账号；此后新账号默认均衡。
    if (account && legacyBlur?.trim() && Number.isFinite(Number(legacyBlur)) && !legacyOwner) {
      legacyOwner = account;
      sessionSelections.delete(b2GlassStorageKey(null));
      try { storage?.setItem(B2_GLASS_LEGACY_OWNER_KEY, account); } catch { /* 仍在当前会话隔离。 */ }
    }
    const cached = sessionSelections.get(key);
    if (cached) return cached;
    try { return parseB2Glass(storage?.getItem(key), legacyOwner === account ? legacyBlur : null); }
    catch { return presetGlass("balanced"); }
  };
  let b2 = readB2();
  const persistB2 = (): void => {
    try { storage?.setItem(b2GlassStorageKey(account), JSON.stringify(b2)); } catch { /* 只保留本次会话。 */ }
  };
  const setB2 = (next: B2GlassSelection, save: boolean): void => {
    b2 = next;
    sessionSelections.set(b2GlassStorageKey(account), b2);
    applyB2Glass(root.style, b2.values, b2.mode);
    if (save) persistB2();
    for (const listener of listeners) listener();
  };
  applyGlassBlur(root.style, blur);
  applyB2Glass(root.style, b2.values, b2.mode);
  const setBlur = (next: number, save: boolean): void => {
    const changed = blur !== next;
    blur = next;
    applyGlassBlur(root.style, blur);
    applyB2Glass(root.style, b2.values, b2.mode);
    if (save) {
      try {
        if (blur === DEFAULT_GLASS_BLUR) storage?.removeItem(GLASS_BLUR_STORAGE_KEY);
        else storage?.setItem(GLASS_BLUR_STORAGE_KEY, String(blur));
      } catch { /* 隐私模式或配额满时仍可实时预览。 */ }
    }
    if (changed) for (const listener of listeners) listener();
  };
  if (initial !== undefined && initial !== null && initial !== "") {
    current = permitted(parseVisualStyle(initial));
    persist(storage, current);
  }
  applyVisualStyle(root, current);
  const set = (next: VisualStyle, save: boolean): void => {
    if (next === current) return;
    current = next;
    applyVisualStyle(root, next);
    if (save) persist(storage, next);
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => current,
    getWallpaperSnapshot: () => wallpaper,
    chooseWallpaper: (next) => setWallpaper(parseWallpaper(next), true),
    restoreWallpaper: (raw) => setWallpaper(parseWallpaper(raw), false),
    getB2Snapshot: () => b2,
    getB2Account: () => account,
    setB2Account: (next) => {
      if (account === next) return;
      sessionSelections.set(b2GlassStorageKey(account), b2);
      account = next; setB2(readB2(), false);
    },
    chooseB2Preset: (preset) => setB2(presetGlass(preset), true),
    chooseB2Custom: (owner, values) => {
      if (owner !== account) return false;
      setB2(customGlass(values), true); return true;
    },
    restoreB2: (raw, key = b2GlassStorageKey(account)) => {
      if (key === null) { sessionSelections.clear(); legacyBlur = null; legacyOwner = null; }
      else if (key !== b2GlassStorageKey(account)) { sessionSelections.delete(key); return; }
      setB2(parseB2Glass(raw), false);
    },
    getBlurSnapshot: () => blur,
    chooseBlur: (value) => setBlur(normalizeGlassBlur(value), true),
    resetBlur: () => setBlur(DEFAULT_GLASS_BLUR, true),
    restoreBlur: (raw) => setBlur(parseGlassBlur(raw), false),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    choose: (style) => {
      const next = permitted(style);
      // 主动从 B1 等风格进入 B2 时固定现有选择，避免下次启动把 B1 共用旧键的强度误认作旧 B2 数据。
      // 已存旧 B2 的首次恢复仍走 readB2 的原兼容路径；不新建第二套存储格式。
      if (next === "b2" && current !== "b2") persistB2();
      set(next, true);
    },
    restore: (raw) => set(permitted(parseVisualStyle(raw)), false),
  };
}

let browserController: VisualStyleController | null = null;

/**
 * 浏览器里的唯一实例，由正式外观入口或开发实验入口启动；
 * 重复调用返回同一个实例。
 */
export function startVisualStyleRuntime(): VisualStyleController {
  if (browserController) return browserController;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* 不可用时只在本次会话里生效。 */ }
  let fromUrl: string | null = null;
  try { if (STYLE_LAB_ENABLED) fromUrl = new URLSearchParams(window.location.search).get(VISUAL_STYLE_QUERY_PARAM); } catch { /* 忽略 */ }
  const controller = createVisualStyleController(document.documentElement, storage, fromUrl, STYLE_LAB_ENABLED);
  window.addEventListener("storage", (event) => {
    if (event.key === WALLPAPER_STORAGE_KEY || event.key === null) controller.restoreWallpaper(event.newValue);
    if (event.key === VISUAL_STYLE_STORAGE_KEY || event.key === null) controller.restore(event.newValue);
    if (event.key === GLASS_BLUR_STORAGE_KEY || event.key === null) controller.restoreBlur(event.newValue);
    if (event.key?.startsWith(B2_GLASS_STORAGE_PREFIX) || event.key === null) controller.restoreB2(event.newValue, event.key);
  });
  browserController = controller;
  return controller;
}

/** 已经启动时返回实例，否则返回 `null`。 */
export function visualStyleRuntime(): VisualStyleController | null {
  return browserController;
}

export const VISUAL_STYLE_LABELS: Readonly<Record<VisualStyle, { readonly name: string; readonly note: string }>> = {
  original: { name: "Original", note: "当前正式外观（默认）" }, // i18n-ignore 仅开发/测试环境的实验开关
  a: { name: "A · Soft Spatial", note: "柔和空间 · 独立卡片 · 票据式明细" }, // i18n-ignore 仅开发/测试环境的实验开关
  b1: { name: "B1 · Ambient Frost", note: "环境磨砂 · 奶油玻璃栏 · 瓷片卡片" }, // i18n-ignore 仅开发/测试环境的实验开关
  b2: { name: "B2 · Layered Glass", note: "分层透光玻璃 · 玻璃卡片" }, // i18n-ignore 仅开发/测试环境的实验开关
  c: { name: "C · Classic Refined", note: "经典精修 · 主题色顶区 + 纸面正文" }, // i18n-ignore 仅开发/测试环境的实验开关
};
