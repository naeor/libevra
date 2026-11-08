import type { MotionHandle } from "./controller.js";
export class DepthGlide {
  constructor(nav: HTMLElement, options?: { selected?: string; onSelect?: (key: string) => void });
  nav: HTMLElement;
  track: HTMLElement;
  buttons: HTMLElement[];
  indicator: HTMLElement;
  body: HTMLElement;
  face: HTMLElement;
  selected: string;
  click: EventListener;
  key: EventListener;
  width: number;
  active: { animations: Animation[]; handle: MotionHandle } | null;
  targets: Map<string, number>;
  mark(): void;
  select(key: string, options?: { animate?: boolean }): MotionHandle | undefined;
  snap(): void;
  measure(): void;
  dispose(): void;
}
