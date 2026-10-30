import type { ReactNode } from "react";

/**
 * **表单页的主要确认按钮固定在底部**（1.17.23：核对、识别结果确认这类页面，在手机上不用先滚到底才能确认）。
 *
 * - `sticky` 而不是 `fixed`：它仍在文档流里，滚到底时停在原位，最后一项内容不会被永久盖住；
 *   内容比一屏短时就在内容末尾，不会和内容隔着一大段空白。
 * - 这些页面（`InnerPage`）没有底部导航，所以底部安全区在这里让出；`-mx-6` 抵消页面主体的左右留白，
 *   让分隔线与底色铺满页面宽度（与手动记账页的保存条同一外观）。
 * - `data-lv-bottom-bar`：大屏辅助工作区右下角的导航按钮会自动抬到它上方（S18）。
 * - 只放一个主要操作；次要操作（改为手动记账、标记无效等）留在内容末尾，不挤进固定区域。
 */
export function StickyActionBar({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <div
      data-lv-bottom-bar=""
      className="sticky bottom-0 z-10 -mx-6 border-t border-line bg-canvas px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
    >
      {children}
    </div>
  );
}
