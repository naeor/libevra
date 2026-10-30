/**
 * 默认工作台与对象 ID。
 *
 * ⚠️ **第一次打开分析页不需要任何配置**（总需求规格 §7）：没有保存过布局的账号直接看到系统默认。
 * **1.17.23 起系统默认 = 「新手」系统预设**（第一张是「支出分类」），不再是旧版的「日常总览」。
 * 默认工作台不写进存储：没有保存过的账号每次都按当前代码与界面语言生成，所以新账号、从未改过布局的
 * 旧账号、以及被识别为「仍是旧版默认」而迁移为 `workspace: null` 的账号（见
 * `@libellum/shared/workbench/legacyDefault`）看到的是同一套。用户编辑后保存的是自己的副本；
 * 「恢复默认」只换编辑会话里的工作台，点「完成」才保存。
 */
import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";
import { LEGACY_DEFAULT_WORKSPACE } from "@libellum/shared/workbench/legacyDefault";

import { t } from "../i18n/index.js";
import { cardType, type ChartFamily } from "./catalog.js";
import { buildSystemPreset } from "./presets.js";
import type { WorkbenchDocuments } from "./storage.js";

/**
 * 新对象的稳定 ID。用 `getRandomValues` 而不是 `randomUUID`：后者只在安全上下文存在，局域网
 * http 调试时会是 `undefined`（vite.config.ts 里记录过同一个坑）。
 */
export function newObjectId(prefix: "card" | "box" | "gap"): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** 某种分析的一张新卡片（默认展示方式、跟随顶部筛选、预置标题）。 */
export function newCard(analysisId: string, objectId: string = newObjectId("card")): AnalysisCardNode {
  const type = cardType(analysisId);
  const family: ChartFamily = type?.families[0] ?? "number";
  return {
    objectId,
    type: "analysis-card",
    analysis: { analysisId, params: {} },
    chart: { chartFamily: family },
    title: { kind: "preset" },
    rangePolicy: "inherit",
  };
}

/**
 * 系统默认工作台：「新手」系统预设（对象 ID 固定为 `preset-beginner-*`，卡片标题按**调用时**的界面语言生成）。
 * 只在没有保存过工作台时显示；一旦保存，就是用户自己的副本。
 */
export function defaultWorkbench(): WorkbenchDocuments {
  return buildSystemPreset("beginner", (key) => t(key as never));
}

/**
 * 旧版系统默认「日常总览」的一份副本：只用于识别与测试夹具，**不再作为默认显示**。
 * 冻结的原文在 `@libellum/shared/workbench/legacyDefault`（服务器一次性迁移用同一份）。
 */
export function legacyDefaultWorkbench(): WorkbenchDocuments {
  return JSON.parse(JSON.stringify(LEGACY_DEFAULT_WORKSPACE)) as WorkbenchDocuments;
}
