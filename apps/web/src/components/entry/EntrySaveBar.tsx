import type { ReactNode, RefObject } from "react";

import { usePane } from "../../workspace/context.js";
import { useKeyboardInset } from "./keyboardInset.js";

/**
 * 保存行动条：粘在手动记账页滚动区的底部，**与底部导航严丝合缝**。
 *
 * ⚠️ **它在滚动区里，不在 `TabPage` 的布局里。** 这是刻意的：
 * - 不碰 `Layouts.tsx` / `BottomNav.tsx`（同一轮还有别的改动在那两个文件里）；
 * - `sticky` 的元素仍在文档流里，所以滚到底时最后一块内容不会被永久盖住；
 * - 底部导航是滚动区的**兄弟节点**，所以滚动区底边就是导航上沿，两者不会重叠。
 *
 * ⚠️ **S15-C 第四轮：贴着导航（`bottom-0`），把抬起的 `+` 交给层叠顺序，不再把整条上移。**
 * 第三轮为了露出中央那颗 `+`（它从导航里向上探出约 7px，外圈还有 4px `ring`），把整条
 * 抬高了 20px（`bottom-5`）。那 20px 是**条外的空白**：条与导航之间露出一道缝，下面的
 * 内容从缝里透出来，看起来像页面断了一截——所有者看到的就是这个。
 *
 * 现在条的下边缘**就是**滚动区底边、也就是导航上沿（`bottom-0`）：没有缝，没有透出的内容。
 * `+` 之所以能压在条上，靠的是 **z 序而不是留空**：导航是 `z-10`，这条是 `z-0`，
 * 两者都在根层叠上下文里（滚动区不是层叠上下文），所以导航连同它的 `+` 画在保存条之上。
 * **没有提高 `+` 的 z-index，也没有动导航的公共语义。**
 *
 * ⚠️ **`+` 只压在不透明底垫上，不压保存按钮。** 条内仍是 `pb-5`（20px）：
 * `+` 侵入的高度约 11px（7px 按钮 + 4px ring），小于 20px，所以保存按钮的下边缘到
 * `+` 的上缘还留着约 9px。`bg-canvas` 是不透明的，`+` 的 ring 下面是纸面而不是内容。
 * **这就是"条内的留白"，而不是第三轮那种"条外的缝"。**
 *
 * ⚠️ **`env(safe-area-inset-bottom)` 在这里不重复加。** `BottomNav` 已经用
 * `pb-[env(safe-area-inset-bottom)]` 把系统区让出来了，而这条行动条位于导航**上方**
 * （滚动区底边 = 导航上沿）。这里再加一次，iPhone 上会凭空多出 34px 的空档。
 *
 * ⚠️ **1.19.51：手机外壳里软键盘弹出时不再把整条抬到键盘上方**（所有者决定）。原来的做法在 iPhone 上
 * 把 84px 的保存条抬到可见区中部、压住「分类」，还和 iOS 26 键盘上方的半透明地址栏、辅助条叠成几层。
 * 现在它留在原位、像被键盘盖住一样隐藏（`data-entry-bar` + `lib/softKeyboard.ts` + navigation.css），
 * 收起键盘后淡入；需要保存时先点键盘上的 ✓。Pad 的大屏工作区不在本次范围，仍沿用原来的抬升。
 *
 * ⚠️ **S19 材质**：`bg-canvas` 在 S19 手机外壳里会被重映射成不透明的 `--s19-canvas`，在壁纸上形成色块。
 * `data-bar-surface="chrome"` 让 S19 浅色四风格改用「底部操作区」操作表面（s19/entry-workspace.css）；
 * Original、深色、大屏仍是原来的纸面。
 */
export function EntrySaveBar({
  scrollRef,
  children,
}: {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}): React.JSX.Element {
  const pane = usePane();
  const keyboardInset = useKeyboardInset(scrollRef, pane.shell !== "phone");

  return (
    <div
      data-entry-actions="sticky"
      style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
      className="sticky bottom-0 z-0 mt-5 bg-canvas"
      data-lv-bottom-bar=""
      data-entry-bar=""
      data-bar-surface="chrome"
    >
      <div className="border-t border-line px-6 pt-3 pb-5">{children}</div>
    </div>
  );
}
