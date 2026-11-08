/**
 * **帧锚定动画时钟（S19 1.19.43）。**
 *
 * iPhone Safari 把 transform / opacity 的 WAAPI 动画交给合成器，开始时间取自动画创建时的时间线；
 * 如果紧接着的一帧很重（React 刚提交整页、整页副本或几十块玻璃首次绘制），这一帧画出来时动画时钟早已
 * 走了一两百毫秒——第一帧就落在中后段，看起来像“先跳到终态再补一点动画”。Chromium 的合成器会在首帧
 * 真正显示时才定起点，所以桌面逐帧测试看不出来。
 *
 * 这里不再让浏览器自己计时：动画创建后立即暂停，由 rAF 写 `currentTime`。
 * - 第一帧固定是 t = 0：起始姿态（与点击前完全相同的画面）先被真正画出来；
 * - 之后每帧最多推进 `maxStep`（约 30fps 的一帧）。长任务或首次绘制只会让动画停一下，不会跳过前段；
 * - 正常 60 / 120Hz 下与实时一致，总时长不变。
 *
 * 只负责时间，不创建 DOM、不提交路由；调用方在 `onProgress` 里做中途交接（例如 Object Expand 在 45% 时提交详情）。
 */
export interface ClockReport {
  readonly name: string;
  /** 从创建到第一帧绘制前回调的间隔（点击后的准备与首帧成本）。 */
  readonly firstFrameMs: number;
  /** 动画期间实际绘制的帧数。 */
  readonly frames: number;
  /** 从第一帧到结束的墙钟时间。 */
  readonly wallMs: number;
  /** 最长的一帧间隔；大于 maxStep 时说明那一帧被放慢而不是跳过。 */
  readonly maxGapMs: number;
  readonly duration: number;
  readonly completed: boolean;
}

const listeners = new Set<(report: ClockReport) => void>();
/** 开发诊断（`?motion=1` 徽章）订阅每次动画的真实帧数与时间分布。 */
export function onClockReport(listener: (report: ClockReport) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export interface FrameClock {
  readonly progress: number;
  /** 在运行中加入新动画（例如中途提交后才出现的详情页）；按当前时间对齐。 */
  add(animation: Animation): void;
  /** 动画已到终值时移出时钟并取消（例如淡入完成后不再让元素保持透明度动画，避免玻璃失去背景）。 */
  remove(animation: Animation): void;
  /** 立即停止；不调用 onDone。 */
  cancel(): void;
}

export function runFrameClock(animations: Animation[], duration: number, options: {
  readonly name: string;
  readonly onProgress?: (progress: number) => void;
  readonly onDone?: () => void;
  readonly maxStep?: number;
}): FrameClock {
  const maxStep = options.maxStep ?? 34;
  const list = [...animations];
  for (const animation of list) { animation.pause(); animation.currentTime = 0; }
  const created = performance.now();
  let time = 0, last: number | null = null, frames = 0, first = 0, firstAt = 0, maxGap = 0, raf = 0, ended = false;
  const report = (completed: boolean): void => {
    const value: ClockReport = { name: options.name, firstFrameMs: Math.round(first), frames, wallMs: Math.round(performance.now() - (firstAt || created)), maxGapMs: Math.round(maxGap), duration, completed };
    for (const listener of listeners) listener(value);
  };
  const tick = (now: number): void => {
    if (ended) return;
    if (last === null) { first = now - created; firstAt = now; }
    else {
      const gap = now - last; maxGap = Math.max(maxGap, gap);
      time = Math.min(duration, time + Math.min(gap, maxStep));
    }
    last = now; frames++;
    for (const animation of list) animation.currentTime = time;
    options.onProgress?.(duration ? time / duration : 1);
    if (time >= duration) { ended = true; report(true); options.onDone?.(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    get progress() { return duration ? time / duration : 1; },
    add(animation) { animation.pause(); animation.currentTime = time; list.push(animation); },
    remove(animation) { const index = list.indexOf(animation); if (index >= 0) list.splice(index, 1); animation.cancel(); },
    cancel() { if (ended) return; ended = true; cancelAnimationFrame(raf); report(false); },
  };
}

/** 不需要 WAAPI 的数值动画（例如明细顶部 `--p`）使用同一时钟语义。 */
export function runFrameValue(duration: number, onValue: (t: number) => void, onDone?: () => void, maxStep = 34): () => void {
  let time = 0, last: number | null = null, raf = 0, ended = false;
  const tick = (now: number): void => {
    if (ended) return;
    if (last !== null) time = Math.min(duration, time + Math.min(now - last, maxStep));
    last = now;
    onValue(duration ? time / duration : 1);
    if (time >= duration) { ended = true; onDone?.(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { ended = true; cancelAnimationFrame(raf); };
}
