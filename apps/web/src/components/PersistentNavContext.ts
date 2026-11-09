import { createContext, useContext, useLayoutEffect } from "react";
/** 手机导航由工作区持有；页面只保留原布局中的占位。 */
export const PersistentNavContext = createContext(false);
export const SuppressNavigationContext = createContext<(hidden: boolean) => void>(() => undefined);
/** 常驻底栏此刻是否被页面要求让位（工作台编辑、专注型核对步骤）。InnerPage 据此不再给底栏留尾部空间。 */
export const NavigationSuppressedContext = createContext(false);

/**
 * 专注型任务步骤（1.19.51）：拍照单张核对、账单导入核对这类“核对并最终确认”的步骤，与次级核对页
 * （`/paste/review`、`/voice/review`、`/ocr/overview`）同一语义——常驻的五入口底栏让位，当前任务的确认栏
 * 占用底栏原来的位置，确认 / 保存 / 取消始终完整可见、可点击。步骤结束（取消、保存成功、返回、浏览器返回、
 * 卸载）即恢复底栏；普通记账工作区（选图、选文件、手动记账等）仍按原有导航规则显示底栏。
 */
export function useFocusTask(active: boolean): void {
  const suppress = useContext(SuppressNavigationContext);
  useLayoutEffect(() => {
    if (!active) return;
    suppress(true);
    return () => suppress(false);
  }, [active, suppress]);
}
