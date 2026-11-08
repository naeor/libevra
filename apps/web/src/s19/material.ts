/** S19 材质映射：环境扩散、表面模糊、旧页模糊各自有尺度，不共用像素半径。 */
import type { CSSProperties } from "react";

/** Material Lab、正式组件、Gallery 共用；曲面折射不进入正式依赖。 */
export const MATERIAL_DEFAULTS = {
  magnification: { frosted: 1.03, clear: 1.05, lens: 1.05 },
  edge: .45, reflection: .6, angle: 225,
} as const;
export type MaterialFinish = "auto" | "satin" | "glazed" | "frosted" | "clear" | "lens";
export type MaterialRole = "primary" | "secondary" | "danger" | "danger-quiet" | "ghost" | "tool" | "capsule" | "display" | "interactive" | "field";
/** 用途决定默认外观；高级项只覆盖局部材质，不控制业务、导航或 B2 全局预设。 */
export interface MaterialAppearance {
  finish?: MaterialFinish;
  optics?: "stable" | "enhanced";
  shape?: "default" | "pill" | "circle";
  elevation?: "default" | "flat" | "raised";
}
export function materialAttributes(role: MaterialRole, appearance: MaterialAppearance = {}) {
  // 强调/危险/输入控件的清晰度优先；不允许以透明变体覆盖用途颜色。
  const decorative = ["display", "interactive", "tool", "capsule", "secondary"].includes(role);
  return {
    "data-material-role": role,
    "data-material-finish": decorative ? (appearance.finish ?? "auto") : "auto",
    "data-material-optics": decorative ? (appearance.optics ?? "stable") : "stable",
    "data-material-shape": appearance.shape ?? "default",
    "data-material-elevation": appearance.elevation ?? "default",
  };
}

/** 无可控纹理的 DOM 一律不放大；名称和目标倍率不等于已经实现了背景采样。 */
export function materialCapability(finish: MaterialFinish) {
  return { runtime: "css" as const, magnification: 1,
    target: finish === "frosted" || finish === "clear" || finish === "lens" ? MATERIAL_DEFAULTS.magnification[finish] : 1,
    reason: "dom-background" as const };
}

export interface MaterialTuning { edge?: number; reflection?: number; radius?: number }
/** Gallery 局部作用域使用。操作透明度继续由既有 B2 角色控制。 */
export function materialTuningStyle(values: MaterialTuning = {}): CSSProperties {
  const bounded = (v: number | undefined, fallback: number, min = 0, max = 1) => Number.isFinite(v) ? Math.max(min, Math.min(max, v!)) : fallback;
  return {
    "--lv-material-edge": bounded(values.edge, MATERIAL_DEFAULTS.edge),
    "--lv-material-reflection": bounded(values.reflection, MATERIAL_DEFAULTS.reflection),
    ...(values.radius === undefined ? {} : { "--lv-material-radius": `${bounded(values.radius, 20, 8, 32)}px` }),
  } as CSSProperties;
}
export const DEFAULT_GLASS_BLUR = 65;
export const GLASS_BLUR_STORAGE_KEY = "libevra.s19-glass-blur";

export function normalizeGlassBlur(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : DEFAULT_GLASS_BLUR;
}
export function parseGlassBlur(raw: string | null | undefined): number {
  return raw == null || raw.trim() === "" ? DEFAULT_GLASS_BLUR : normalizeGlassBlur(Number(raw));
}
export function glassMaterial(material: "b1" | "b2", strength = DEFAULT_GLASS_BLUR) {
  const scale = normalizeGlassBlur(strength) / 100;
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    // 环境原本没有 filter: blur；只收窄渐变扩散，保留连续柔和的边缘。
    environmentSpread: round(.5 + .5 * scale),
    surfaceBlur: round((material === "b1" ? 16 : 14) * scale),
    outgoingBlur: round(14 * scale),
    outgoingSoftBlur: round(3 * scale),
    // 内部材质值，不随滑块提高白色覆盖，以免“模糊”变成“变白”。
    milk: .9,
  };
}
export function motionBlur(material: string, strength: number, enabled: boolean) {
  if (!enabled) return { outgoingBlur: 0, outgoingSoftBlur: 0 };
  if (material === "b1" || material === "b2") return glassMaterial(material, strength);
  // A / C / Original 的原有滤镜不受玻璃偏好影响。
  return { outgoingBlur: 14, outgoingSoftBlur: 3 };
}
/** 只输出 B1/B2 命名空间的令牌；其他风格没有消费者。 */
export function applyGlassBlur(style: Pick<CSSStyleDeclaration, "setProperty"> | undefined, strength: number): void {
  for (const material of ["b1", "b2"] as const) {
    const values = glassMaterial(material, strength);
    style?.setProperty(`--s19-${material}-surface-blur`, `${values.surfaceBlur}px`);
    style?.setProperty(`--s19-${material}-environment-spread`, String(values.environmentSpread));
    style?.setProperty(`--s19-${material}-milk`, String(values.milk));
  }
}
