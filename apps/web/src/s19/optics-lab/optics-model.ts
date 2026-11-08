import { MATERIAL_DEFAULTS } from "../material.js";
export const OPTICS_LAB_VERSION = "0.3.1";
export type GlassKind = "frosted" | "clear" | "lens";
export type RenderMode = "baseline" | "css" | "magnify" | "webgl";
export type BackgroundPattern = "scene" | "line" | "circle" | "text" | "grid";
export type Magnification = 1 | 1.03 | 1.05 | 1.1;
export const DEFAULT_MAGNIFICATION: Record<GlassKind, Magnification> = MATERIAL_DEFAULTS.magnification;
export const DEFAULT_PORCELAIN_REFLECTION = MATERIAL_DEFAULTS.reflection;
export const usesTexture = (mode: RenderMode) => mode === "webgl" || mode === "magnify";
export type SceneMotion = "static" | "glass" | "background";
export type RenderQuality = "full" | "half";
export type GlassShape = "round" | "rect";
export interface OpticalSettings { ior: number; roughness: number; curvature: number; strength: number; angle: number }
export const DEFAULT_OPTICS: OpticalSettings = { ior: 1.5, roughness: .55, curvature: .7, strength: MATERIAL_DEFAULTS.edge, angle: MATERIAL_DEFAULTS.angle };
/** CSS 像素空间的示意几何；背景是假定的平面，并非标定后的真实场景深度。 */
export const GEOMETRY = { thickness: 4, bevel: 24, gap: 12, capRatio: .24, derivativeStep: .1 } as const;
export interface GlassGeometry { x: number; y: number; halfWidth: number; halfHeight: number; radius: number; reference: boolean; panel: number }
export interface StageConfig {
  mode: RenderMode; material: GlassKind; count: 1 | 2 | 4; quality: RenderQuality;
  shape: GlassShape; compare: boolean; optics: OpticalSettings; position: number; fixedFootprint?: boolean;
  magnification?: Magnification; pattern?: BackgroundPattern;
}
export const DEFAULT_STAGE: StageConfig = { mode: "magnify", material: "clear", count: 1, quality: "full", shape: "round", compare: true, optics: DEFAULT_OPTICS, position: .5, pattern: "scene" };
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
// C² 连续：倒角接入平面处的曲率也归零，避免旧 cubic smoothstep 的内圈接缝。
const smooth = (v: number) => { const t = clamp(v); return t * t * t * (t * (t * 6 - 15) + 10); };
export function roundedDistance(x: number, y: number, hw: number, hh: number, radius: number): number {
  const qx = Math.abs(x) - hw + radius, qy = Math.abs(y) - hh + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
export function surfaceHeight(x: number, y: number, geometry: GlassGeometry, kind: GlassKind, curvature: number): number {
  const d = roundedDistance(x, y, geometry.halfWidth, geometry.halfHeight, geometry.radius);
  const edge = smooth(-d / Math.min(GEOMETRY.bevel, Math.min(geometry.halfWidth, geometry.halfHeight) * .55));
  const cap = Math.max(0, 1 - (x / geometry.halfWidth) ** 2 - (y / geometry.halfHeight) ** 2);
  return GEOMETRY.thickness * edge + (kind === "lens" ? Math.min(geometry.halfWidth, geometry.halfHeight) * GEOMETRY.capRatio * curvature * cap ** 3 * edge : 0);
}
/** 以镜片中心裁切；只混合采样坐标，绝不叠加两份图像。轮廓处值及斜率回到原背景。 */
export function magnifiedOffset(x: number, y: number, geometry: GlassGeometry, zoom: Magnification): [number, number] {
  const d = roundedDistance(x, y, geometry.halfWidth, geometry.halfHeight, geometry.radius);
  const weight = smooth(-d / (Math.min(geometry.halfWidth, geometry.halfHeight) * .45));
  const scale = (1 / zoom - 1) * weight;
  return [x * scale, y * scale];
}
type Vec3 = [number, number, number];
function refract(incident: Vec3, normal: Vec3, eta: number): Vec3 | null {
  const dot = incident.reduce((n, x, i) => n + x * normal[i]!, 0), k = 1 - eta * eta * (1 - dot * dot);
  if (k < 0) return null;
  return incident.map((x, i) => eta * x - (eta * dot + Math.sqrt(k)) * normal[i]!) as Vec3;
}
/** 与 Shader 同一高度场 / Snell 两界面近似，用于检验恒等、对称和边界连续性。 */
export function refractedOffset(x: number, y: number, geometry: GlassGeometry, kind: GlassKind, settings: OpticalSettings): [number, number] {
  const distance = roundedDistance(x, y, geometry.halfWidth, geometry.halfHeight, geometry.radius);
  if (distance >= 0) return [0, 0];
  // 靠近轮廓缩小差分步长，避免跨过截断的高度场产生虚假的边界斜率。
  const e = Math.min(GEOMETRY.derivativeStep, Math.max(.005, -distance * .5));
  const height = (px: number, py: number) => surfaceHeight(px, py, geometry, kind, settings.curvature);
  const dx = (height(x + e, y) - height(x - e, y)) / (2 * e), dy = (height(x, y + e) - height(x, y - e)) / (2 * e);
  const length = Math.hypot(dx, dy, 1), normal: Vec3 = [-dx / length, -dy / length, 1 / length];
  const ior = 1 + (settings.ior - 1) * settings.strength;
  const inside = refract([0, 0, -1], normal, 1 / ior);
  if (!inside) return [0, 0];
  const outside = refract(inside, [0, 0, 1], ior);
  if (!outside) return [0, 0];
  const travel = height(x, y) / Math.max(.1, -inside[2]);
  return [inside[0] * travel + outside[0] * GEOMETRY.gap / Math.max(.1, -outside[2]), inside[1] * travel + outside[1] * GEOMETRY.gap / Math.max(.1, -outside[2])];
}
export function glassLayout(width: number, height: number, config: StageConfig, motion: SceneMotion, elapsed: number): GlassGeometry[] {
  const count = config.compare ? 2 : config.count, columns = config.compare || count > 1 ? 2 : 1, rows = count === 4 ? 2 : 1;
  const cellWidth = width / columns, cellHeight = height / rows;
  // 性能矩阵固定每片尺寸与运动幅度，让数量变化可以独立比较。
  const sizingWidth = config.fixedFootprint ? width / 2 : cellWidth, sizingHeight = config.fixedFootprint ? height / 2 : cellHeight;
  const r = Math.min(sizingWidth * .34, sizingHeight * .32, 76);
  const hw = config.shape === "rect" ? Math.min(sizingWidth * .37, 91) : r;
  const hh = config.shape === "rect" ? Math.min(sizingHeight * .28, 54) : r;
  return Array.from({ length: count }, (_, i) => {
    const roomX = Math.max(0, sizingWidth / 2 - hw - 4), roomY = Math.max(0, sizingHeight / 2 - hh - 4);
    const phase = elapsed / 1400 + (config.compare ? 0 : i * .7);
    const mx = motion === "glass" ? Math.sin(phase) * roomX * .85 : (config.position - .5) * 2 * roomX;
    const my = motion === "glass" ? Math.cos(phase * .83) * roomY * .65 : 0;
    return { x: (i % columns + .5) * cellWidth + mx, y: (Math.floor(i / columns) + .5) * cellHeight + my,
      halfWidth: hw, halfHeight: hh, radius: config.shape === "round" ? r : Math.min(24, hh), reference: config.compare && i === 0, panel: config.compare ? i : 0 };
  });
}
export function renderSize(width: number, height: number, dpr: number, quality: RenderQuality, maxDimension = 4096) {
  const requestedScale = dpr * (quality === "half" ? .5 : 1);
  const scale = Math.min(requestedScale, Math.sqrt(2_000_000 / Math.max(1, width * height)), maxDimension / Math.max(1, width, height));
  const w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
  return { width: w, height: h, requestedScale, actualScale: w / Math.max(1, width), capped: scale < requestedScale - .001, pixels: w * h };
}
