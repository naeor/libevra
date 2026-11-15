/**
 * 工作台网格把卡片交给宿主页面画的两个扩展点（1.19.100，电脑版总览）：
 *
 * - `renderNative`：总览专属卡片（`DB-` 编号，见 `nativeCards.ts`）整张由总览画；分析页不提供它，
 *   万一遇到这类卡片（例如导入了别处的配置）按未知卡片显示。
 * - `scopeFor`：分析卡片在总览上可以指定来源账本，网格画它时换成那本账的数据作用域；不提供时用网格传入的作用域。
 *
 * 两者都只影响「画什么」，不改布局、尺寸或保存。
 */
import { createContext } from "react";
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

import type { WorkbenchScope } from "./scope.js";

export interface NativeTileProps {
  readonly card: AnalysisCardNode;
  /** 在容器里时不画外框（容器自己有）。 */
  readonly bare: boolean;
  readonly oneRow: boolean;
  /** 标题行右侧的内容（横向滑动抽屉的页码点）。 */
  readonly aside?: React.ReactNode;
  readonly onOpen: () => void;
}

export interface CardRenderHooks {
  readonly renderNative?: (props: NativeTileProps) => React.ReactNode;
  /**
   * **hook**（会订阅数据）：分析卡片用哪个数据作用域。同一页面里它要么一直提供、要么一直不提供，
   * 所以调用方可以无条件地调用 `hooks.useScopeFor ?? useSameScope`。
   */
  readonly useScopeFor?: (card: AnalysisCardNode | undefined, fallback: WorkbenchScope) => WorkbenchScope;
  /** 中键或 Ctrl(⌘)+点击在新标签页打开的地址；`null` = 这张卡片不能直接在新标签页打开（例如要先切换账本）。 */
  readonly hrefFor?: (card: AnalysisCardNode) => string | null;
}

export const CardRenderContext = createContext<CardRenderHooks>({});

/** 没有宿主时：就用网格传入的作用域。 */
export function useSameScope(_card: AnalysisCardNode | undefined, fallback: WorkbenchScope): WorkbenchScope {
  return fallback;
}
