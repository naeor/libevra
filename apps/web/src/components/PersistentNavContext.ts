import { createContext } from "react";
/** 手机导航由工作区持有；页面只保留原布局中的占位。 */
export const PersistentNavContext = createContext(false);
export const SuppressNavigationContext = createContext<(hidden: boolean) => void>(() => undefined);
