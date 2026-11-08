/**
 * 「再记一笔」的呈现入口（1.19.45）。
 *
 * 记账页在保存成功后清空表单、回到新的一笔，这是同一路由里的状态切换，协调器看不到导航。
 * 页面把清空动作交给 {@link continueEntry}：手机外壳里有 S19 转场时由 `s19/motion/enterMode.ts`
 * 包裹成工作区内的轻切换（上一笔收起、新的一笔升入）；没有呈现器（大屏、原始风格、测试）时直接执行。
 *
 * ⚠️ 提交是同步的：「再记一笔」要在点击里把焦点交回金额框，iOS 只在用户手势内弹出键盘。
 */
type Handler = (commit: () => void) => void;
let handler: Handler | null = null;

/** 协调器挂载时登记、卸载时清除（传 null）。 */
export function provideEntryAgain(next: Handler | null): void { handler = next; }

export function continueEntry(commit: () => void): void {
  if (handler) handler(commit); else commit();
}
