/**
 * 分析工作台的**列数显示偏好**（1.18.01）：「自动」或某个手动列数。
 *
 * ⚠️ **它是显示偏好，不是布局数据。** 只改变这台设备上这个工作区按几列显示，不改基础布局的 `baseCols`，
 * 也不创建任何列数的专属布局——只有在编辑器里真的调整了排列并点「完成」才会写布局（见 `commitLayoutEdit`）。
 *
 * 所有者 2026-10-30 选择：**主 / 辅工作区各记一份，只记在本机**（不同步，不进工作台配置）。两个工作区宽度不同，
 * 在辅助区调成 3 列不应让主区也变成 3 列。手机外壳只有主区。
 *
 * 手动列数超过当前宽度能容纳的上限时按上限显示（不改存储的偏好，宽度恢复后回到原列数）。
 * 存储在 `libevra.` 前缀下，「清除本机全部数据」会一并清掉；读写失败（隐私模式等）时按「自动」处理。
 */
import { useCallback, useState } from "react";
import { RESPONSIVE_MAX_COLUMNS } from "@libellum/shared/analysis/layout";

import { LIBEVRA_KEY_PREFIX } from "../lib/deviceStorageKeys.js";
import type { PaneRole } from "../workspace/context.js";

export type ColumnPreference = "auto" | number;

export function columnPreferenceKey(role: PaneRole): string {
  return `${LIBEVRA_KEY_PREFIX}stats-columns:v1:${role}`;
}

export function readColumnPreference(role: PaneRole): ColumnPreference {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(columnPreferenceKey(role));
    if (raw === null || raw === "auto") return "auto";
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= RESPONSIVE_MAX_COLUMNS ? value : "auto";
  } catch {
    return "auto";
  }
}

export function writeColumnPreference(role: PaneRole, value: ColumnPreference): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === "auto") localStorage.removeItem(columnPreferenceKey(role));
    else localStorage.setItem(columnPreferenceKey(role), String(value));
  } catch {
    // 写不进去只影响「记住」，当前页面仍按选择显示。
  }
}

/** 实际显示的列数：自动 → 自动结果；手动 → 夹在 1 与当前宽度的上限之间。 */
export function effectiveColumns(preference: ColumnPreference, automatic: number, limit: number): number {
  return preference === "auto" ? automatic : Math.max(1, Math.min(preference, limit));
}

export function useColumnPreference(role: PaneRole): readonly [ColumnPreference, (value: ColumnPreference) => void] {
  const [preference, setPreference] = useState<ColumnPreference>(() => readColumnPreference(role));
  const update = useCallback(
    (value: ColumnPreference) => {
      writeColumnPreference(role, value);
      setPreference(value);
    },
    [role],
  );
  return [preference, update] as const;
}
