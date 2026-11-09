/**
 * 切换账本的整页重新载入（1.19.47）。
 *
 * 进入另一本账必须整页重新载入（LedgerSpacePage 的 activateAndReload：请求头与离线范围一起换，不能半换）。
 * 手机外壳里有 S19 账本空间海浪转场时，由 `s19/motion/tide.ts` 先让海浪盖满整屏、同时完成服务器激活，
 * 再存下最后一帧交给新页面接着播放（不再白屏）；没有呈现器时直接执行。
 */
/** hint：等待提示；rise：海浪从下缘涌上、再从上缘离开（从当前账本胶囊切换），否则从顶栏向下划过（账本空间）。 */
export interface CoverOptions { readonly hint?: string; readonly rise?: boolean }
type Cover = (work: () => Promise<void>, options: CoverOptions) => Promise<void>;
let cover: Cover | null = null;

/** 协调器挂载时登记、卸载时清除（传 null）。 */
export function provideReloadCover(next: Cover | null): void { cover = next; }

/**
 * 完成 work（失败时照常抛出）；有呈现器时同时让海浪盖满整屏。返回后调用方立即重新载入。
 * hint：等待稍久时海浪 1 号深色核心里显示的一行提示（已翻译的界面文字）。
 * 只改变载入期间看到什么：切换账本仍是“激活成功后整页重新载入”，失败照常抛出、不载入。
 */
export function coverForReload(work: () => Promise<void>, options: CoverOptions = {}): Promise<void> {
  return cover ? cover(work, options) : work();
}
