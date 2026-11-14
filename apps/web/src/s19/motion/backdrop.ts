import { NAVIGATION } from "../../lib/motionTokens.js";
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
export const defaults: MotionOptions = { scheme: "native", material: "b2", duration: NAVIGATION.b2.duration, retreat: true, blur: true, blurStrength: DEFAULT_GLASS_BLUR, handoff: true, inheritance: "source" };
/**
 * 历史关系的作用域：哪个工作区、哪个账号、哪本账。1.19.75（审查 T2）起正式协调器（pilot.tsx）**不再传风格 / 明暗 / 配色**：
 * “这一页是从哪一页进来的”是历史事实，换外观不改变它；原来作用域里带着风格，一换风格整条栈的来源都作废，返回不再有转场。
 * `style` 只留给实验页（experiments/motion-lab）在切换方案时重置。
 */
export interface VisualScope { workspace: string; account: string; ledger: string; style?: string }
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
  /**
   * REPLACE（1.19.75，审查 T3）：同一个历史位置换成了一条新记录（新 key）。REPLACE 不改变“下面是哪一页”，所以新记录
   * 接过被替换记录的来源，就像它当初也是从那一页进来的；原来以旧记录为来源的记录（前进栈里的页面）改指新记录。
   * 返回时仍要经过 `directionFor` 的显式边检查，来源本身不授权任何动画。
   */
  replace(from: BackdropContext, key: string, page: string, scope: VisualScope): BackdropContext {
    const known = this.entries.get(key);
    if (known) return known;
    const sameScope = JSON.stringify(from.scope) === JSON.stringify(scope);
    const source = sameScope && from.sourceKey !== null ? this.entries.get(from.sourceKey) : undefined;
    const result = this.ensure(key, page, scope, source, "source");
    // 来源的描述已被淘汰（超过上限）时仍保留关系本身。
    if (sameScope && result.sourceKey === null && from.sourceKey !== null) result.sourceKey = from.sourceKey;
    if (sameScope) for (const entry of this.entries.values()) if (entry !== result && entry.sourceKey === from.entryKey) entry.sourceKey = key;
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
