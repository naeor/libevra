/**
 * **连续使用**（1.19.82，所有者 2026-11-15）：“尽可能记住面板当时的状态……经过某次事件，相当于用户不连续使用时，
 * 就可以重置每个页面的滚动位之类的了。”
 *
 * 判断“不连续使用”只看一件事：**应用离开屏幕（页面不可见）超过 30 分钟**。回来时记住的滚动位置与面板状态全部重新开始；
 * 30 分钟以内回来（切去别的应用回个消息、锁屏一会儿）照常接着看。
 *
 * - 为什么不是“每天固定时刻”：固定时刻会在用户正用着的时候把位置清掉（深夜记账跨过零点），而隔了一夜才回来的人
 *   按“离开超过 30 分钟”同样会重新开始。
 * - 为什么不是“每次登录”：登录状态通常一直保持，按登录重置几乎永远不会发生。
 * - 30 分钟参照安卓的默认做法：用户离开一个任务较久（约 30 分钟）再回来，系统把它清回起始页；iOS 没有固定时限。
 * - 重新载入页面（刷新、系统在后台回收后重新打开）本来就从头开始：这些记忆只在内存里，不写存储。
 * - 换账号、换账本由各自的作用域清理（s19/motion/relations.ts 的作用域、切换账本整页重新载入），不在这里。
 */
export const CONTINUITY_GAP_MS = 30 * 60 * 1000;

const listeners = new Set<() => void>();
let hiddenAt: number | null = null;
let attached = false;

function attach(): void {
  if (attached || typeof document === "undefined") return;
  attached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const since = hiddenAt;
    hiddenAt = null;
    if (since !== null && Date.now() - since > CONTINUITY_GAP_MS) resetContinuity();
  });
}

/** 用户“不连续使用”后回来时调用 `listener`（清掉记住的滚动位置、面板状态）。返回取消订阅。 */
export function onContinuityReset(listener: () => void): () => void {
  attach();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 立即按“重新开始”处理（测试与以后可能的手动入口）。 */
export function resetContinuity(): void {
  for (const listener of [...listeners]) listener();
}
