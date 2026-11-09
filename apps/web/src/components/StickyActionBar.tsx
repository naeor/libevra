import { useContext, type ReactNode } from "react";

import { NavigationSuppressedContext } from "./PersistentNavContext.js";

import { DesktopActionBar } from "../desktop/DesktopFrames.js";
import { useDesktopSurface } from "../desktop/surface.js";

/**
 * `entry`（1.19.51）：记账工作区的核对 / 确认栏。软键盘打开时与常驻底栏一起让位（lib/softKeyboard.ts），
 * S19 浅色四风格使用「底部操作区」操作表面（s19/entry-workspace.css）；其他调用处保持原样。
 */
export function StickyActionBar({ children, entry = false }: { readonly children: ReactNode; readonly entry?: boolean }): React.JSX.Element {
  const replacesNav = useContext(NavigationSuppressedContext);
  if (useDesktopSurface() !== null) return <DesktopActionBar>{children}</DesktopActionBar>;
  return (
    <div
      data-lv-bottom-bar=""
      data-replaces-nav={entry && replacesNav ? "" : undefined}
      data-entry-bar={entry ? "" : undefined}
      data-bar-surface={entry ? "chrome" : undefined}
      className="sticky bottom-0 z-10 -mx-6 border-t border-line bg-canvas px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
    >
      {children}
    </div>
  );
}
