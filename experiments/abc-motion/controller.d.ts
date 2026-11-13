export type ABCStyle = "a" | "b1" | "c";
export type AVariant = "pulse" | "depth" | "directional" | "directional-entry" | "pure-cover";
export interface MotionHandle {
  finished: Promise<{ status: string; reason: string | null }>;
  seek(progress: number): void;
  cancel(): void;
}
export interface MotionSize { width: number; height: number }
export interface ABCMotionOptions {
  /** 被动画节点从转场开始时的尺寸变到当前尺寸，是否应当打断（Libevra 传入共享的转场打断规则）；不传则不因尺寸打断。 */
  interrupts?: (before: MotionSize, after: MotionSize) => boolean;
}
export class ABCMotion {
  constructor(stage: HTMLElement, options?: ABCMotionOptions);
  active: { animations: Animation[] } | null;
  generation: number;
  run(options: { from: HTMLElement; to: HTMLElement; style: ABCStyle; variant?: AVariant; direction: "push" | "pop"; duration?: number; onProgress?: (progress: number) => void }): MotionHandle;
  cancel(reason?: string): void;
  dispose(): void;
}
