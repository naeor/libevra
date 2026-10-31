import type { ReactNode } from "react";

import { DesktopActionBar } from "../desktop/DesktopFrames.js";
import { useDesktopSurface } from "../desktop/surface.js";

export function StickyActionBar({ children }: { readonly children: ReactNode }): React.JSX.Element {
  if (useDesktopSurface() !== null) return <DesktopActionBar>{children}</DesktopActionBar>;
  return (
    <div
      data-lv-bottom-bar=""
      className="sticky bottom-0 z-10 -mx-6 border-t border-line bg-canvas px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
    >
      {children}
    </div>
  );
}
