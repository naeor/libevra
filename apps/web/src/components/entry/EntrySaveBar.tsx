import type { ReactNode, RefObject } from "react";

import { useKeyboardInset } from "./keyboardInset.js";

/**
 * 保存行动条：粘在手动记账页滚动区的底部。
 *
 * ⚠️ **它在滚动区里，不在 `TabPage` 的布局里。** 这是刻意的：
 * - 不碰 `Layouts.tsx` / `BottomNav.tsx`（同一轮还有别的改动在那两个文件里）；
 * - `sticky` 的元素仍在文档流里，所以滚到底时最后一块内容不会被永久盖住，
 *   不需要再给表单补一块「避免遮挡」的空白；
 * - 底部导航是滚动区的**兄弟节点**，所以滚动区底边就是导航上沿，两者不会重叠。
 *
 * ⚠️ **`env(safe-area-inset-bottom)` 在这里不重复加。** `BottomNav` 已经用
 * `pb-[env(safe-area-inset-bottom)]` 把系统区让出来了，而这条行动条位于导航**上方**
 * （滚动区底边 = 导航上沿）。这里再加一次，iPhone 上会凭空多出 34px 的空档，
 * 恰好与「更少滚动」相反。系统区由导航统一承担，这一条不需要。
 *
 * ⚠️ **底部 20px 是给导航中间那颗抬起的 `+` 留的。** 它向上探出导航约 9px（外加 4px
 * ring），行动条底边正好落在导航上沿；不留这段，保存按钮的下缘会被它压住。
 *
 * 软键盘弹出时由 `useKeyboardInset` 把整条抬到键盘上方；键盘收起时 `bottom` 回到 0，
 * 视觉与普通 `sticky bottom-0` 完全一致。
 */
export function EntrySaveBar({
  scrollRef,
  children,
}: {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}): React.JSX.Element {
  const keyboardInset = useKeyboardInset(scrollRef);

  return (
    <div
      data-entry-actions="sticky"
      style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
      className="sticky bottom-0 z-20 mt-5 bg-canvas"
    >
      <div className="border-t border-line px-6 pt-3 pb-5">{children}</div>
    </div>
  );
}
