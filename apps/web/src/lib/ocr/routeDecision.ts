/**
 * 识别之后走哪条路（S15-B §2）。
 *
 * 规则只有三条，按优先级：
 *  1. 任一张图是**交易列表且确实切出了候选** → 整次上传进批次；
 *  2. 任一张图**无法判断页面类型**（或声称是列表却切不出交易） → 问用户；
 *  3. 其余 → 原有单笔流程。
 *
 * 多张混合时选择第 1 条：单笔详情图也作为 1 笔候选并入批次。这样同一次上传只有
 * 一个核对流程，不会出现“两张图在概览、一张图在逐笔弹窗”的割裂；单笔图在批次里
 * 是完整候选，不需要额外编辑。
 *
 * `pageType === null` 是旧服务（S15-B 之前）的响应：它只认识单笔，所以按单笔处理，
 * 保持原有行为不退化。
 */

import type { OcrItemResult } from "@libellum/shared";

export type RecognitionRoute = "single" | "batch" | "ask";

/** 这张图读出了至少一笔（新响应看候选，旧响应看 draft）。 */
export function isReadable(item: OcrItemResult): boolean {
  return item.ok && (item.candidates.length > 0 || item.draft !== null);
}

export function readableItems(items: readonly OcrItemResult[]): OcrItemResult[] {
  return items.filter(isReadable);
}

function claimsTransactions(item: OcrItemResult): boolean {
  return item.pageType === "transaction-list" && item.candidates.length > 0;
}

function needsPageTypeChoice(item: OcrItemResult): boolean {
  if (item.pageType === "unknown") return true;
  // 版式说这是列表，却一笔也没切出来：数量不可信，交给用户决定。
  if (item.pageType === "transaction-list" && item.candidates.length === 0) return true;
  return false;
}

export function routeRecognition(items: readonly OcrItemResult[]): RecognitionRoute {
  if (items.some(claimsTransactions)) return "batch";
  if (items.some(needsPageTypeChoice)) return "ask";
  return "single";
}
