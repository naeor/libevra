/** 总览上各卡片共用的上下文（账本、范围、主币种、跳转月份、身份）。 */
import { createContext, useContext } from "react";

export interface DashboardBook {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
}

export interface DashboardView {
  readonly books: ReadonlyMap<string, DashboardBook>;
  /** 总览范围里的账本（游客只有当前账本）。 */
  readonly bookIds: readonly string[];
  readonly currentBookId: string | null;
  /** 原币统计的主币种（账号默认币种）。 */
  readonly mainCode: string;
  /** 进入明细 / 分析时带的月份（总览时间范围的最后一个月）。 */
  readonly month: string;
  /** 本机设置的身份（`user:<id>` / `guest:<id>`）。 */
  readonly owner: string | null;
}

export const DashboardViewContext = createContext<DashboardView | null>(null);

export function useDashboardView(): DashboardView {
  const view = useContext(DashboardViewContext);
  if (view === null) throw new Error("DashboardViewContext missing");
  return view;
}
