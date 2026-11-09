/**
 * 切换账本的整页重新载入（1.19.47）。
 *
 * 进入另一本账必须整页重新载入（LedgerSpacePage 的 activateAndReload：请求头与离线范围一起换，不能半换）。
 * 手机外壳里有 S19 账本空间海浪转场时，由 `s19/motion/tide.ts` 先让海浪盖满整屏、同时完成服务器激活，
 * 再存下最后一帧交给新页面接着播放（不再白屏）；没有呈现器时直接执行。
 */
type Cover = (work: () => Promise<void>) => Promise<void>;
let cover: Cover | null = null;

/** 协调器挂载时登记、卸载时清除（传 null）。 */
export function provideReloadCover(next: Cover | null): void { cover = next; }

/** 完成 work（失败时照常抛出）；有呈现器时同时让海浪盖满整屏。返回后调用方立即重新载入。 */
export function coverForReload(work: () => Promise<void>): Promise<void> {
  return cover ? cover(work) : work();
}
