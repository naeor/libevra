/**
 * **工作台的宿主**（1.19.100）：分析页与电脑版总览共用同一套编辑引擎（网格、编辑会话、拖放、容器、列数与
 * 专属排列、尺寸面板、卡片编辑器），各自决定「存在哪、默认是什么、库里有哪些卡片、外框长什么样」。
 *
 * 分析页不传宿主，用 `STATS_SURFACE`，行为与 1.19.99 之前完全一致。
 */
import type { AnalysisCardNode, GridSize } from "@libellum/shared/analysis/layout";

import { WORKBENCH_INSTALLED } from "./configEvents.js";
import { defaultWorkbench } from "./defaults.js";
import type { NativeLibraryItem } from "./Drawer.js";
import { followSystemDefault, isSystemDefault, readStored, saveWorkbenchSafely, type Stored, type WorkbenchDocuments } from "./storage.js";

/** 编辑时要暂停的同步引擎（分析页的工作台同步、总览同步）。 */
export interface SurfaceSync {
  editing: boolean;
  run(): Promise<unknown>;
}

export interface WorkbenchSurface {
  readonly id: "stats" | "dashboard";
  readonly readStored: (accountScope: string | null) => Stored;
  readonly save: (accountScope: string, documents: WorkbenchDocuments, previousVersion: number) => Promise<number | null>;
  readonly defaults: () => WorkbenchDocuments;
  readonly isSystemDefault: (documents: WorkbenchDocuments) => boolean;
  readonly followSystemDefault: (accountScope: string, previousVersion: number) => number | null;
  /** 别处（同步、另一个标签页）装入新配置时发出的事件名，`detail` 是账号作用域。 */
  readonly installedEvent: string;
  /** 列数显示偏好的存储名（每个宿主、每个工作区各记一份）。 */
  readonly columnsKey: "stats" | "dashboard";
  /** 宿主自己的卡片（总览卡片）：建立新卡片（带缺省选项）；对分析编号返回 `null`。 */
  readonly createCard?: (analysisId: string, objectId: string) => AnalysisCardNode | null;
  readonly defaultSize?: (analysisId: string) => GridSize | null;
  readonly nativeItems?: readonly NativeLibraryItem[];
  /** 是否提供「布局预设」（分析页的系统预设与我的预设）。 */
  readonly presets: boolean;
  /**
   * 1.19.102（总览）：宿主自己的布局预设面板；`apply` 把整份工作台换成预设（一步撤销，仍要点「完成」才保存）。
   * 提供它时卡片抽屉的「预设」入口打开这个面板，而不是分析页的预设页。
   */
  readonly renderPresets?: (args: { readonly current: WorkbenchDocuments; readonly apply: (documents: WorkbenchDocuments, name: string) => boolean; readonly onClose: () => void }) => React.ReactNode;
  /** 1.19.102（总览「每本账一组」页）：浏览时显示的文档由保存的文档派生（不写回、不参与编辑）。 */
  readonly browseDocuments?: (documents: WorkbenchDocuments) => WorkbenchDocuments;
  /** 编辑时暂停的同步；`undefined` = 用分析页的工作台同步。 */
  readonly sync?: SurfaceSync | null;
  /** 换掉几句与「工作台」有关的提示。 */
  readonly texts?: { readonly saved?: string; readonly reset?: string; readonly resetHint?: string; readonly resetDone?: string };
}

export const STATS_SURFACE: WorkbenchSurface = {
  id: "stats",
  readStored,
  save: saveWorkbenchSafely,
  defaults: defaultWorkbench,
  isSystemDefault,
  followSystemDefault,
  installedEvent: WORKBENCH_INSTALLED,
  columnsKey: "stats",
  presets: true,
};
