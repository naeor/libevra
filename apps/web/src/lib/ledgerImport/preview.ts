/**
 * S14-D D1 · 只读导入预览。
 *
 * 这个文件把来源/目标快照、taxonomy 映射和重复检测组合成一份可直接渲染、可测试、无副作用的预览。
 * **它不调用任何写接口，也不决定删除任何账目。**
 */
import type { DuplicateDetectionSettings } from "@libellum/shared";

import type { ImportPreview, ImportSource, ImportTarget, ImportTotals } from "./types.js";
import { detectDuplicateGroups } from "./duplicates.js";
import { buildTaxonomyMappingPlan, type TaxonomyResolutionMap } from "./mapping.js";

function compareCurrency(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function buildTotals(source: ImportSource): ImportTotals[] {
  const byCurrency = new Map<string, { expenseCents: number; incomeCents: number; count: number }>();
  for (const transaction of source.transactions) {
    const current = byCurrency.get(transaction.currency) ?? { expenseCents: 0, incomeCents: 0, count: 0 };
    if (transaction.kind === "expense") current.expenseCents += transaction.amountCents;
    else current.incomeCents += transaction.amountCents;
    current.count += 1;
    byCurrency.set(transaction.currency, current);
  }
  return [...byCurrency.entries()]
    .sort(([left], [right]) => compareCurrency(left, right))
    .map(([currency, value]) => ({
      currency,
      expenseCents: value.expenseCents,
      incomeCents: value.incomeCents,
      count: value.count,
    }));
}

function dateRangeOf(source: ImportSource): { from: string | null; to: string | null } {
  if (source.transactions.length === 0) return { from: null, to: null };
  const times = source.transactions
    .map((transaction) => transaction.occurredAt)
    .filter((time) => !Number.isNaN(Date.parse(time)));
  if (times.length === 0) return { from: null, to: null };
  times.sort((left, right) => Date.parse(left) - Date.parse(right));
  return { from: times[0] ?? null, to: times.at(-1) ?? null };
}

/**
 * 生成一份完整预览。
 *
 * ⚠️ **冲突项在用户选择前按“复用目标对象”计算重复检测**，所以预览会说“若保留目标同名对象，可能重复这些”。
 * D2 让用户改选“新建同名副本”后必须重新运行；这也是为什么本函数不产生最终写入数据。
 */
export function buildImportPreview(
  source: ImportSource,
  target: ImportTarget,
  resolutions?: TaxonomyResolutionMap,
  options?: {
    readonly excludeDuplicateSourceIds?: ReadonlySet<string>;
    readonly excludeDuplicateTargetIds?: ReadonlySet<string>;
    /** 用户重复检测设置（S15-E2）；缺省用统一默认规则。 */
    readonly duplicateSettings?: DuplicateDetectionSettings;
  },
): ImportPreview {
  const mapping = buildTaxonomyMappingPlan(source, target, resolutions);
  const duplicates = detectDuplicateGroups(
    source,
    target,
    mapping,
    options?.excludeDuplicateSourceIds,
    options?.excludeDuplicateTargetIds,
    options?.duplicateSettings,
  );
  const totals = buildTotals(source);
  const dateRange = dateRangeOf(source);
  const duplicateSourceCount = duplicates.duplicateSourceIds.size;
  const duplicateTargetCount = duplicates.duplicateTargetIds.size;
  const warnings: string[] = [];

  if (source.hiddenDeletedCount > 0) {
    warnings.push(`来源账本有 ${String(source.hiddenDeletedCount)} 条已删除记录，不会导入。`);
  }
  if (mapping.conflicts.length > 0) {
    warnings.push(
      `分类、支付方式或标签有 ${String(mapping.conflicts.length)} 项同名但属性不同，导入前需要逐项确认；冲突项在你选择前按“复用目标对象”估算。`,
    );
  }
  if (duplicates.groups.length > 0) {
    warnings.push(
      `发现 ${String(duplicates.groups.length)} 组可能重复的账目（来源 ${String(duplicateSourceCount)} 条、目标 ${String(duplicateTargetCount)} 条），需要逐组核对后再写入。`,
    );
  }
  if (target.transactions.length > 0) {
    warnings.push(`目标账本已有 ${String(target.transactions.length)} 条账目，导入只会追加或按你的选择处理重复项，不会静默修改它们。`);
  }
  if (source.kind === "guest") {
    warnings.push("这是本机游客账本；预览和导入都不会自动删除游客数据，清理仍是单独操作。");
  }

  return {
    source,
    target,
    mapping,
    duplicateGroups: duplicates.groups,
    totals,
    dateRange,
    counts: {
      sourceTransactions: source.transactions.length,
      sourceSkippedDeleted: source.hiddenDeletedCount,
      importableWithoutConflict: source.transactions.length - duplicateSourceCount,
      duplicateSourceRecords: duplicateSourceCount,
      duplicateTargetRecords: duplicateTargetCount,
      duplicateGroups: duplicates.groups.length,
      targetTransactions: target.transactions.length,
      targetExisting: target.transactions.length,
    },
    warnings,
  };
}
