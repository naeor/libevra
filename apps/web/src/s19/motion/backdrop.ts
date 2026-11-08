import type { PaneSnapshot } from "../../workspace/paneHistory.js";
import { DEFAULT_GLASS_BLUR } from "../material.js";

export type Scheme = "live" | "native" | "ambient" | "hybrid";
export type Material = "a" | "b1" | "b2" | "c";
export type Inheritance = "source" | "shared" | "off";
export type Direction = "push" | "pop" | "none";
export interface MotionOptions {
  scheme: Scheme;
  material: Material;
  duration: 180 | 200 | 220;
  retreat: boolean;
  blur: boolean;
  blurStrength: number;
  handoff: boolean;
  inheritance: Inheritance;
}
export const defaults: MotionOptions = { scheme: "native", material: "b2", duration: 200, retreat: true, blur: true, blurStrength: DEFAULT_GLASS_BLUR, handoff: true, inheritance: "source" };
export interface VisualScope { workspace: string; account: string; ledger: string; style: string }
export interface Ambient { hue: number; accent: number; x: number; y: number }
/** 描述可恢复；不声称这些字段是一张浏览器像素快照。 */
export interface BackdropContext {
  entryKey: string;
  sourceKey: string | null;
  page: string;
  scope: VisualScope;
  ambient: Ambient;
  sourceType: "source-description" | "shared" | "default";
  sourceScene: Scene | null;
  scroll: number;
}
/** 有界、非递归的实验页面配方。深层背景合并为环境描述，不保存活跃页面树。 */
export interface Scene { page: string; scroll: number; ambient: Ambient }

export function pageAmbient(page: string): Ambient {
  let seed = 0;
  for (const char of page) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const hue = (seed * 137) % 360;
  return { hue, accent: (hue + 65) % 360, x: 14 + seed % 64, y: 10 + seed % 32 };
}
export function ambientCss(a: Ambient, spread = 1): string {
  return `radial-gradient(ellipse at ${a.x}% ${a.y}%, hsl(${a.hue} 57% 83% / .82), transparent ${65 * spread}%), radial-gradient(ellipse at ${100 - a.x}% 86%, hsl(${a.accent} 63% 84% / .7), transparent ${65 * spread}%), var(--color-canvas)`;
}

/** 只消费真实历史的 key/关系，没有 navigate，也不拥有第二套业务栈。 */
export class BackdropStore {
  private scopeId = "";
  private readonly entries = new Map<string, BackdropContext>();
  readonly limit = 64;
  resets = 0;
  evictions = 0;
  setScope(scope: VisualScope): boolean {
    const key = JSON.stringify(scope);
    if (key === this.scopeId) return false;
    this.clear();
    this.scopeId = key;
    return true;
  }
  get(key: string): BackdropContext | undefined { return this.entries.get(key); }
  get size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.resets++; }
  prune(validKeys: readonly string[]): void {
    const valid = new Set(validKeys);
    for (const key of this.entries.keys()) if (!valid.has(key)) this.entries.delete(key);
  }
  ensure(key: string, page: string, scope: VisualScope, from: BackdropContext | undefined, inherit: Inheritance): BackdropContext {
    this.setScope(scope);
    const known = this.entries.get(key);
    if (known) return known;
    const source = inherit === "source" && from && JSON.stringify(from.scope) === JSON.stringify(scope) ? from : undefined;
    const base = source ? pageAmbient(source.page) : pageAmbient(inherit === "shared" ? "shared" : page);
    // 色彩与位置保持稳定；层级不会增加 blur，也不会建立递归 DOM/描述链。
    const ambient = source ? { ...base, accent: source.ambient.hue } : base;
    const result: BackdropContext = {
      entryKey: key, page, scope: { ...scope }, sourceKey: from && JSON.stringify(from.scope) === JSON.stringify(scope) ? from.entryKey : null,
      ambient, sourceType: source ? "source-description" : inherit === "shared" ? "shared" : "default",
      sourceScene: source ? { page: source.page, scroll: source.scroll, ambient: { ...source.ambient } } : null,
      scroll: 0,
    };
    this.entries.set(key, result);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
    return result;
  }
}

/** 显式边 + 真实 entry 来源；URL 字符串层级与单独的 PUSH/POP 都不足以授权动画。 */
export function directionFor(
  from: BackdropContext, to: BackdropContext, action: PaneSnapshot["action"],
  edges: readonly (readonly [string, string])[], allowPop: boolean,
): Direction {
  if (from.entryKey === to.entryKey || JSON.stringify(from.scope) !== JSON.stringify(to.scope)) return "none";
  if (action === "PUSH" && to.sourceKey === from.entryKey && edges.some(([a, b]) => a === from.page && b === to.page)) return "push";
  if (action === "POP" && allowPop && from.sourceKey === to.entryKey && edges.some(([a, b]) => a === to.page && b === from.page)) return "pop";
  return "none";
}
