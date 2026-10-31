/**
 * **电脑版的「页面放在哪里」。**
 *
 * 同一个页面组件可以出现在电脑版的主展示区或右侧辅助栏里。共享的页面框架（`TabPage`、`InnerPage`、
 * `TabPageHeader`、`StickyActionBar`）读这里的值，换成桌面的呈现：稳定的工具栏代替手机的返回栏与绿色
 * 大标题、没有底部导航、内容宽度按桌面规则。没有这层上下文时（手机 / 平板）一切照旧。
 *
 * - `bar: "toolbar"`：主展示区默认，顶部稳定工具栏（可带返回）。
 * - `bar: "heading"`：外层已经有导航（设置分类、协作分页），页面只显示标题，不显示返回。
 * - `bar: "none"`：外层已经显示了标题，页面只放内容（动作按钮仍然保留）。
 * - 辅助栏（`surface: "panel"`）：紧凑标题栏 + 关闭按钮。
 */
import { createContext, useContext, useMemo } from "react";

export type DesktopSurfaceKind = "main" | "panel";
export type DesktopBar = "toolbar" | "heading" | "none";

export interface DesktopSurface {
  readonly surface: DesktopSurfaceKind;
  readonly bar: DesktopBar;
  /** 主展示区里「返回」的去处由页面自己决定；外层可以改成关闭（例如辅助栏放不下、改在主区显示时）。 */
  readonly onBack?: (() => void) | undefined;
  /** 辅助栏的关闭按钮。 */
  readonly onClose?: (() => void) | undefined;
}

const SurfaceContext = createContext<DesktopSurface | null>(null);
const DesktopActiveContext = createContext(false);

export function useDesktopSurface(): DesktopSurface | null {
  return useContext(SurfaceContext);
}

/** 是否在电脑版外壳里（不论页面在主区还是辅助栏）。 */
export function useDesktopActive(): boolean {
  return useContext(DesktopActiveContext);
}

export function DesktopActiveProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <DesktopActiveContext.Provider value={true}>{children}</DesktopActiveContext.Provider>;
}

export function DesktopSurfaceProvider({
  surface,
  bar = surface === "panel" ? "none" : "toolbar",
  onBack,
  onClose,
  children,
}: {
  readonly surface: DesktopSurfaceKind;
  readonly bar?: DesktopBar;
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const value = useMemo<DesktopSurface>(() => ({ surface, bar, onBack, onClose }), [surface, bar, onBack, onClose]);
  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
}
