import type { MiniEntry } from "./DetailMiniChart.js";
import { uuidV7 } from "../../lib/uuid.js";
export type OverviewMetric = "overview" | "income" | "expense" | "balance" | "daily" | "count";
export interface MetricSnapshot {
  owner: string; book: string | null; pane: string; returnTo: string; metric: OverviewMetric;
  label: string; currency: string; from: string; to: string; days: number | null;
  values: Record<string, string>; entries: readonly MiniEntry[]; incomplete: boolean;
}
export type MetricContent = Omit<MetricSnapshot, "owner" | "book" | "pane" | "returnTo">;
// 只保留点击时显示的上下文，不持久化数据副本、不进入同步 schema。
const snapshots = new Map<string, MetricSnapshot>();
export function keepMetricSnapshot(value: MetricSnapshot): string {
  const key = uuidV7(); snapshots.set(key, value);
  while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
  return key;
}
export function readMetricSnapshot(key: unknown, owner: string, book: string | null, pane: string): MetricSnapshot | undefined {
  const value = typeof key === "string" ? snapshots.get(key) : undefined;
  return value?.owner === owner && value.book === book && value.pane === pane ? value : undefined;
}
