export type ABCStyle = "a" | "b1" | "c";
export type AVariant = "pulse" | "depth" | "directional" | "directional-entry" | "pure-cover";
export interface MotionHandle {
  finished: Promise<{ status: string; reason: string | null }>;
  seek(progress: number): void;
  cancel(): void;
}
export class ABCMotion {
  constructor(stage: HTMLElement);
  active: { animations: Animation[] } | null;
  generation: number;
  run(options: { from: HTMLElement; to: HTMLElement; style: ABCStyle; variant?: AVariant; direction: "push" | "pop"; duration?: number; onProgress?: (progress: number) => void }): MotionHandle;
  cancel(reason?: string): void;
  dispose(): void;
}
