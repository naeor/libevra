import { glassMaterial } from "./material.js";

export interface B2GlassValues { ambient: number; content: number; chrome: number; blur: number }
export const B2_GLASS_PRESETS = {
  clear: { ambient: 95, content: 85, chrome: 50, blur: 50 },
  balanced: { ambient: 85, content: 75, chrome: 65, blur: 65 },
  soft: { ambient: 75, content: 65, chrome: 80, blur: 80 },
} as const satisfies Record<string, B2GlassValues>;
export type B2GlassPreset = keyof typeof B2_GLASS_PRESETS;
export type B2GlassMode = B2GlassPreset | "custom";
/** 顶底栏按所有者指定反向配比；内容玻璃与旧页的 blur 继续独立。 */
export const B2_CHROME_BLUR = { clear: 80, balanced: 65, soft: 50 } as const;
export interface B2GlassSelection { version: 1; mode: B2GlassMode; values: B2GlassValues }
export const B2_GLASS_FIELDS = ["ambient", "content", "chrome", "blur"] as const;
export const B2_GLASS_PRESET_NAMES = ["clear", "balanced", "soft"] as const;
export const B2_GLASS_DEFAULT = presetGlass("balanced");
export const B2_OLD_PAGE_RETREAT = false;
export const B2_GLASS_STORAGE_PREFIX = "libevra.s19-b2-glass:";
export const B2_GLASS_LEGACY_OWNER_KEY = "libevra.s19-b2-legacy-owner";
export function b2GlassStorageKey(account: string | null): string { return `${B2_GLASS_STORAGE_PREFIX}${account ?? "local"}`; }
export function presetGlass(mode: B2GlassPreset): B2GlassSelection { return { version: 1, mode, values: { ...B2_GLASS_PRESETS[mode] } }; }
export function normalizeB2Glass(values: B2GlassValues): B2GlassValues {
  return Object.fromEntries(B2_GLASS_FIELDS.map(key => [key, Number.isFinite(values[key])
    ? Math.round(Math.max(0, Math.min(100, values[key]))) : B2_GLASS_PRESETS.balanced[key]])) as unknown as B2GlassValues;
}
export function customGlass(values: B2GlassValues): B2GlassSelection { return { version: 1, mode: "custom", values: normalizeB2Glass(values) }; }
/** 预设始终引用统一定义；旧值/损坏数据不产生空字段，也不覆盖已保存的自定义。 */
export function parseB2Glass(raw: string | null | undefined, legacyBlur?: string | null): B2GlassSelection {
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<B2GlassSelection> : null;
    if (parsed?.version === 1 && parsed.mode && B2_GLASS_PRESET_NAMES.includes(parsed.mode as B2GlassPreset)) return presetGlass(parsed.mode as B2GlassPreset);
    if (parsed?.version === 1 && parsed.mode === "custom" && parsed.values
      && B2_GLASS_FIELDS.every(key => typeof parsed.values?.[key] === "number" && Number.isFinite(parsed.values[key]))) return customGlass(parsed.values);
  } catch { /* 未识别的本机值采用默认；不回写或删除旧数据。 */ }
  // 只有未保存新格式时才迁移过去明确保存的 B2 模糊选择。
  if (!raw && legacyBlur?.trim() && Number.isFinite(Number(legacyBlur))) return customGlass({ ...B2_GLASS_PRESETS.balanced, blur: Number(legacyBlur) });
  return presetGlass("balanced");
}
/** 与 Motion Lab 相同：透出 / 100，填充 = 1 - 通透度 / 100；blur 保留原独立映射。 */
export function b2GlassMaterial(input: B2GlassValues, mode: B2GlassMode = "custom") {
  const values = normalizeB2Glass(input);
  const chromeStrength = mode === "custom" ? values.blur : B2_CHROME_BLUR[mode];
  return { ...glassMaterial("b2", values.blur), chromeBlur: glassMaterial("b2", chromeStrength).surfaceBlur, carry: values.ambient / 100,
    contentFill: (100 - values.content) / 100, chromeFill: (100 - values.chrome) / 100, ambientVeil: `${100 - values.ambient}%` };
}
export function applyB2Glass(style: Pick<CSSStyleDeclaration, "setProperty"> | undefined, values: B2GlassValues, mode: B2GlassMode = "custom"): void {
  const mapped = b2GlassMaterial(values, mode);
  for (const [key, value] of Object.entries({
    "carry": mapped.carry, "content-fill": mapped.contentFill, "chrome-fill": mapped.chromeFill, "chrome-blur": `${mapped.chromeBlur}px`,
    "ambient-veil": mapped.ambientVeil, "surface-blur": `${mapped.surfaceBlur}px`, "environment-spread": mapped.environmentSpread,
  })) style?.setProperty(`--s19-b2-${key}`, String(value));
}
