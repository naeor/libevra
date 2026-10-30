/**
 * **单条历史记录的账本**（S18 第二轮 · 账本隔离）：跟随打开、拖入打开的那一页属于**来源工作区**的那本账
 * （主区在看「我的账本」，点开的一笔显示在正看「旅行账本」的辅助区里，那一页仍是「我的账本」的这一笔）。
 *
 * ⚠️ 键是「实例:记录 key」（`entryKey`）：两个实例的第一条记录都叫 `"default"`，只用记录 key 会让一侧的
 * 覆盖落到另一侧（例如整页重新载入后，主区的新第一页继承了辅助区第一页的账本）。
 */
import type { InstanceId } from "./model.js";
import type { SerializedPaneHistory } from "./paneHistory.js";

export type EntryLedgers = Readonly<Record<string, string>>;

const INSTANCES: readonly InstanceId[] = ["w1", "w2"];

export function entryKey(instance: InstanceId, key: string): string {
  return `${instance}:${key}`;
}

/** 去掉某个实例的全部记录账本（它的历史被重建时）。 */
export function withoutInstance(map: EntryLedgers, instance: InstanceId): EntryLedgers {
  const prefix = `${instance}:`;
  if (!Object.keys(map).some((key) => key.startsWith(prefix))) return map;
  const result: Record<string, string> = {};
  for (const [key, ledger] of Object.entries(map)) if (!key.startsWith(prefix)) result[key] = ledger;
  return result;
}

/** 会话内恢复：只接受「实例:key → 非空字符串」。 */
export function parseEntryLedgers(value: unknown): EntryLedgers {
  if (value === null || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, ledger] of Object.entries(value as Record<string, unknown>)) {
    if (!/^w[12]:/.test(key)) continue;
    if (typeof ledger === "string" && ledger !== "") result[key] = ledger;
  }
  return result;
}

/** 只保留两个实例历史里还存在的记录（被替换、被截断的记录不再需要）。 */
export function pruneEntryLedgers(map: EntryLedgers, histories: Readonly<Record<InstanceId, SerializedPaneHistory>>): EntryLedgers {
  const keys = new Set(INSTANCES.flatMap((instance) => histories[instance].entries.map((entry) => entryKey(instance, entry.key))));
  const result: Record<string, string> = {};
  for (const [key, ledger] of Object.entries(map)) if (keys.has(key)) result[key] = ledger;
  return result;
}
