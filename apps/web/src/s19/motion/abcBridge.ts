import type { ABCStyle, AVariant } from "../../../../../experiments/abc-motion/controller.js";

/** 开发入口注册呈现器；正式 B2 包不引入实验动画、模拟页面或第二套导航。 */
export interface ABCPresentation {
  readonly active: boolean;
  readonly generation: number;
  run(options: { fromKey: string; toKey: string; page: () => HTMLElement | null; commit: () => void; style: ABCStyle; variant: AVariant | null; direction: "push" | "pop" }): void;
  cancel(): void;
  dispose(): void;
}
export let createABCPresentation: (() => ABCPresentation) | null = null;
export let captureATabFrame: (() => void) | null = null;
export function registerABCPresentation(factory: () => ABCPresentation, captureTab: () => void): void {
  createABCPresentation = factory; captureATabFrame = captureTab;
}

/** A 尚未定默认；只保留本次实验会话的明确选择，不改正式偏好格式。 */
export const A_VARIANTS: readonly AVariant[] = ["pulse", "depth", "directional", "directional-entry", "pure-cover"];
let variant: AVariant | null = null;
const listeners = new Set<() => void>();
export const aVariant = (): AVariant | null => variant;
export function chooseAVariant(next: AVariant | null): void {
  if (variant === next) return;
  variant = next; for (const listener of listeners) listener();
}
export function subscribeAVariant(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
