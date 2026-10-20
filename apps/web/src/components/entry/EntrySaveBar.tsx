import type { ReactNode, RefObject } from "react";

import { useKeyboardInset } from "./keyboardInset.js";

/**
 * 保存行动条：粘在手动记账页滚动区的底部。
 *
 * ⚠️ **它在滚动区里，不在 `TabPage` 的布局里。** 这是刻意的：
 * - 不碰 `Layouts.tsx` / `BottomNav.tsx`（同一轮还有别的改动在那两个文件里）；
 * - `sticky` 的元素仍在文档流里，所以滚到底时最后一块内容不会被永久盖住；
 * - 底部导航是滚动区的**兄弟节点**，所以滚动区底边就是导航上沿，两者不会重叠。
 *
 * ⚠️ **S15-C 第三轮：为中央那颗抬起的 `+` 让出的是"外面的留白"，不是"里面的内边距"。**
 * `+` 的按钮用 `-mt-8` 从导航里向上探出约 9px，外圈还有 4px `ring`；而保存条原来是
 * `sticky bottom-0`，它不透明的 `bg-canvas` 一直画到导航上沿，于是 `+` 的上半圈被压在
 * 保存条的底色下面——看起来像被削平了。之前写在 `pb-5` 里的 20px 本意是给它留位，
 * 但内边距仍属于这条不透明的条，**留白在条里面，等于没留**。
 *
 * 现在整条向上让 20px（`bottom-5`）：条的下边缘停在 `+` 的 ring 之上，那 20px 是真正的
 * 空白，`+` 完整可见；保存按钮仍在条的 `pb-5` 之上，点击范围没有减少。**没有提高 `+`
 * 的 z-index，也没有动导航的公共语义。**
 *
 * ⚠️ **`env(safe-area-inset-bottom)` 在这里不重复加。** `BottomNav` 已经用
 * `pb-[env(safe-area-inset-bottom)]` 把系统区让出来了，而这条行动条位于导航**上方**
 * （滚动区底边 = 导航上沿）。这里再加一次，iPhone 上会凭空多出 34px 的空档。
 *
 * 软键盘弹出时由 `useKeyboardInset` 把整条抬到键盘上方；此时底部导航在键盘后面，
 * 不需要再额外让 20px，所以内联的 `bottom` 直接取键盘遮挡高度。键盘收起时回到
 * 类名里的 `bottom-5`。
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
      className="sticky bottom-5 z-20 mt-5 bg-canvas"
    >
      <div className="border-t border-line px-6 pt-3 pb-5">{children}</div>
    </div>
  );
}
