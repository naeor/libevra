/**
 * 转场期间让出主线程（1.19.45）。
 *
 * 页面转场（主 Tab 交换、对象展开、记账工作区、账本空间海浪……）进行时，新页面里可以晚一点出现的重活
 * ——分析卡片的图表、按测量尺寸重算的内容——先不渲染，等转场结束再在后台（React transition）补上。
 * 转场优先拿到每一帧；手机较慢时，图表在转场结束后零点几秒内出现，而不是在滑动途中掉帧。
 *
 * - 帧锚定时钟（`frameClock.ts`）与账本空间海浪在开始时 `beginMotion()`，结束或取消时调用返回的函数。
 * - 需要让路的代码用 {@link whenMotionIdle} 推迟，或用 {@link isMotionIdle} 判断。
 * - 安全阀：任何一次标记最多维持 `MAX_BUSY_MS`，即使呈现器异常没有收尾，推迟的工作也会照常执行。
 */
const MAX_BUSY_MS = 2500;
let busy = 0;
let waiting: (() => void)[] = [];

function flush(): void {
  const run = waiting;
  waiting = [];
  for (const task of run) task();
}

/** 标记一次转场开始；返回的函数结束标记（可重复调用，只生效一次）。 */
export function beginMotion(): () => void {
  busy++;
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    clearTimeout(guard);
    busy = Math.max(0, busy - 1);
    if (busy === 0) flush();
  };
  const guard = setTimeout(end, MAX_BUSY_MS);
  return end;
}

export function isMotionIdle(): boolean { return busy === 0; }

/** 没有转场时立即执行；否则排到最后一个转场结束之后。 */
export function whenMotionIdle(task: () => void): void {
  if (busy === 0) task(); else waiting.push(task);
}
