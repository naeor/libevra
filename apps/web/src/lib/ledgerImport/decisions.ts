/**
 * S14-D D3 · 重复组的草稿决定。
 *
 * ⚠️ 这里只产生**草稿**：source 是导入还是一边跳过、target 是保留还是软删除。直到用户点击
 * 最终确认、服务端事务提交前，不修改任何数据库；服务端还会再校验每一笔 target 的归属和有效性。
 */
import type { DuplicateGroup, ImportPreview } from "./types.js";

export type SourceHandling = "import" | "skip";
export type TargetHandling = "keep" | "remove";
export type GroupPresetAction = "keep_a" | "keep_b" | "keep_both" | "keep_neither";

export interface GroupDecisionDraft {
  readonly action: GroupPresetAction | "custom";
  readonly source: ReadonlyMap<string, SourceHandling>;
  readonly target: ReadonlyMap<string, TargetHandling>;
}

export type GroupDecisionMap = ReadonlyMap<string, GroupDecisionDraft>;

export function isOneToOne(group: DuplicateGroup): boolean {
  return group.sourceCount === 1 && group.targetCount === 1;
}

export function presetDecision(group: DuplicateGroup, action: GroupPresetAction): GroupDecisionDraft {
  const source = new Map<string, SourceHandling>();
  const target = new Map<string, TargetHandling>();
  const skipSource = action === "keep_a" || action === "keep_neither";
  const removeTarget = action === "keep_b" || action === "keep_neither";
  for (const record of group.records) {
    if (record.side === "source") source.set(record.transaction.id, skipSource ? "skip" : "import");
    else target.set(record.transaction.id, removeTarget ? "remove" : "keep");
  }
  return { action, source, target };
}

/** 切换一条来源记录：保留其他记录的决定，组动作退化为 custom。 */
export function withSourceHandling(
  decision: GroupDecisionDraft,
  sourceId: string,
  handling: SourceHandling,
): GroupDecisionDraft {
  const source = new Map(decision.source);
  source.set(sourceId, handling);
  return { action: "custom", source, target: decision.target };
}

/** 切换一条目标记录：只有用户主动点「移除」才会进入删除清单。 */
export function withTargetHandling(
  decision: GroupDecisionDraft,
  targetId: string,
  handling: TargetHandling,
): GroupDecisionDraft {
  const target = new Map(decision.target);
  target.set(targetId, handling);
  return { action: "custom", source: decision.source, target };
}

export function sourceHandling(decision: GroupDecisionDraft | undefined, sourceId: string): SourceHandling {
  return decision?.source.get(sourceId) ?? "import";
}

export function targetHandling(decision: GroupDecisionDraft | undefined, targetId: string): TargetHandling {
  return decision?.target.get(targetId) ?? "keep";
}

export function skippedSourceIds(preview: ImportPreview, decisions: GroupDecisionMap): ReadonlySet<string> {
  const skipped = new Set<string>();
  for (const group of preview.duplicateGroups) {
    const decision = decisions.get(group.id);
    if (decision === undefined) continue;
    for (const record of group.records) {
      if (record.side === "source" && decision.source.get(record.transaction.id) === "skip") {
        skipped.add(record.transaction.id);
      }
    }
  }
  return skipped;
}

export interface RemovedTarget {
  readonly groupId: string;
  readonly transactionId: string;
  readonly seq: number | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly occurredLocalDate: string;
  readonly categoryLabel: string;
  readonly note: string | null;
}

/** 最终确认和提交都只从这里取删除范围；没有在这个列表里的 A 记录不会被删除。 */
export function removedTargets(preview: ImportPreview, decisions: GroupDecisionMap): readonly RemovedTarget[] {
  const removed: RemovedTarget[] = [];
  for (const group of preview.duplicateGroups) {
    const decision = decisions.get(group.id);
    if (decision === undefined) continue;
    for (const record of group.records) {
      if (record.side !== "target") continue;
      if (decision.target.get(record.transaction.id) !== "remove") continue;
      removed.push({
        groupId: group.id,
        transactionId: record.transaction.id,
        seq: record.transaction.seq ?? null,
        amountCents: record.transaction.amountCents,
        currency: record.transaction.currency,
        occurredLocalDate: record.transaction.occurredLocalDate,
        categoryLabel: record.categoryLabel,
        note: record.transaction.note,
      });
    }
  }
  return removed;
}

export function unresolvedGroupCount(preview: ImportPreview, decisions: GroupDecisionMap): number {
  return preview.duplicateGroups.filter((group) => decisions.get(group.id) === undefined).length;
}

export function importedSourceCount(preview: ImportPreview, decisions: GroupDecisionMap): number {
  return preview.source.transactions.length - skippedSourceIds(preview, decisions).size;
}
