/**
 * **总览的系统预设**（1.19.102，候选清单 E2）：按当前账本生成的几套总览布局，在编辑里「预设」套用
 * （一步撤销，仍要点「完成」才保存）。只是卡片与位置，不含任何金额；套用时对象 id 全部重新生成。
 *
 * | 预设 | 用途 |
 * |---|---|
 * | 日常 | 与默认总览相同：各账本、多账本收支、趋势、最近账目、待处理 |
 * | 家庭多账本 | 每本账一张账本卡片，下面是多账本收支、账本对比、月历、最近账目与支出分类 |
 * | 月末对账 | 待整理、收支合计、支出分类、分类变化、最近账目、本期要点 |
 * | 极简 | 每本账一个数字，加一条支出趋势与快捷操作 |
 */
import type { AnalysisCardNode, GridSize } from "@libellum/shared/analysis/layout";

import { cardSizing } from "../statsWorkbench/composition.js";
import { newCard } from "../statsWorkbench/defaults.js";
import { newNativeCard, type NativeKind, type NativeOptions } from "../statsWorkbench/nativeCards.js";
import type { WorkbenchDocuments } from "../statsWorkbench/storage.js";
import { defaultDashboardDocuments, packCards } from "./dashboardStore.js";

export type DashboardPresetId = "daily" | "family" | "month-end" | "minimal";
export const DASHBOARD_PRESET_IDS: readonly DashboardPresetId[] = ["daily", "family", "month-end", "minimal"];

type Entry = { readonly card: AnalysisCardNode; readonly size: GridSize };

function native(kind: NativeKind, id: string, size: GridSize, options: NativeOptions = {}): Entry {
  return { card: newNativeCard(kind, `p-${id}`, options), size };
}

function analysis(analysisId: string, id: string, family?: string): Entry {
  const base = newCard(analysisId, `p-${id}`);
  const card = family === undefined ? base : { ...base, chart: { chartFamily: family } };
  return { card, size: cardSizing(card).defaultSize };
}

const S = (colSpan: number, rowSpan: number): GridSize => ({ colSpan, rowSpan });

export function buildDashboardPreset(id: DashboardPresetId, bookIds: readonly string[]): WorkbenchDocuments {
  const multi = bookIds.length > 1;
  switch (id) {
    case "daily":
      return defaultDashboardDocuments(bookIds);
    case "family":
      return packCards([
        ...bookIds.map((bookId) => native("ledger", `ledger-${bookId}`, S(2, 2), { bookId })),
        ...(multi ? [native("cross", "cross", S(2, 2)), native("compare", "compare", S(2, 2))] : []),
        native("calendar", "calendar", S(2, 3)),
        native("recent", "recent", S(2, 3)),
        analysis("AN-I01", "categories"),
      ]);
    case "month-end":
      return packCards([
        native("inbox", "inbox", S(2, 2)),
        multi ? native("cross", "cross", S(2, 2)) : native("ledger", "ledger", S(2, 2), bookIds[0] === undefined ? {} : { bookId: bookIds[0] }),
        analysis("AN-I01", "categories"),
        analysis("AN-A17", "category-change"),
        native("recent", "recent", S(2, 3)),
        analysis("AN-A06", "insights", "insights"),
      ]);
    case "minimal":
      return packCards([
        ...bookIds.map((bookId) => native("ledger", `ledger-${bookId}`, S(1, 1), { bookId })),
        native("trend", "trend", S(2, 1)),
        native("quick", "quick", S(2, 1)),
      ]);
  }
}
