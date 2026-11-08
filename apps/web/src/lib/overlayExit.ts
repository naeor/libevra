/** 与现有 sheet-out / backdrop-out 的 200ms 一致。只管理呈现，不读取业务状态。 */
export const OVERLAY_EXIT_MS = 200;

export function createOverlayExit(onPhase: (closing: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(action: () => void): void {
      // 同一帧的连续点击也只能完成一次；不能只靠 React 下一帧的 state 防重。
      if (timer !== undefined) return;
      onPhase(true);
      timer = setTimeout(() => {
        timer = undefined;
        action();
        // 调用方可能因正在处理而拒绝关闭，此时恢复可操作状态。
        onPhase(false);
      }, OVERLAY_EXIT_MS);
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
