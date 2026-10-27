/**
 * S17 Agent A · A-4 前置 scaffolding：区间键适配测试夹具（draft，不冻结）。
 *
 * 仅用于 `timeKeys.test.ts`；不进入 `analysis/index.ts` barrel，也不被生产代码引用。
 */

import type { InclusiveRange } from "./timeKeys.js";

/** 完整自然月（2026-10，31 天；10-01 为周四）。 */
export const TIMEKEY_OCTOBER_2026: InclusiveRange = { from: "2026-10-01", to: "2026-10-31" };

/** 闰年 2 月（2028-02，29 天）。 */
export const TIMEKEY_LEAP_FEBRUARY_2028: InclusiveRange = { from: "2028-02-01", to: "2028-02-29" };

/** 跨年区间（2026-12-20…2027-01-10，含 ISO 2026-W53 与 2027-W01）。 */
export const TIMEKEY_YEAR_BOUNDARY: InclusiveRange = { from: "2026-12-20", to: "2027-01-10" };

/** 非整月区间（2026-01-25…2026-03-05，首尾月被裁剪）。 */
export const TIMEKEY_PARTIAL_MONTHS: InclusiveRange = { from: "2026-01-25", to: "2026-03-05" };

/** 恰好 400 天（2026-01-01…2027-02-04，含两端）。 */
export const TIMEKEY_FOUR_HUNDRED_DAYS: InclusiveRange = { from: "2026-01-01", to: "2027-02-04" };

/** 401 天（2026-01-01…2027-02-05，含两端）→ 越界。 */
export const TIMEKEY_FOUR_HUNDRED_ONE_DAYS: InclusiveRange = { from: "2026-01-01", to: "2027-02-05" };

/** 单日区间。 */
export const TIMEKEY_SINGLE_DAY: InclusiveRange = { from: "2026-10-01", to: "2026-10-01" };

/** 月末对齐边界日期。 */
export const TIMEKEY_MONTH_END_DATES = {
  jan31: "2026-01-31",
  feb28: "2026-02-28",
  mar31: "2026-03-31",
  apr30: "2026-04-30",
  leapDay: "2028-02-29",
} as const;

/** 已知 ISO 周事实（用于断言，独立于实现）。 */
export const TIMEKEY_ISO_WEEK_FACTS = {
  /** 2026-01-01 为周四 → 2026-W01（周一 2025-12-29）。 */
  newYear2026: { date: "2026-01-01", key: "2026-W01", monday: "2025-12-29" },
  /** 2026-12-31 为周四 → 2026-W53（2026 有 53 周）。 */
  endOf2026: { date: "2026-12-31", key: "2026-W53", monday: "2026-12-28" },
  /** 2027-01-01 为周五 → 仍属 2026-W53。 */
  newYear2027: { date: "2027-01-01", key: "2026-W53", monday: "2026-12-28" },
  /** 2027-01-04 周一 → 2027-W01。 */
  firstMonday2027: { date: "2027-01-04", key: "2027-W01", monday: "2027-01-04" },
  /** 2028-02-29 周二 → 2028-W09（周一 2028-02-28）。 */
  leapDay2028: { date: "2028-02-29", key: "2028-W09", monday: "2028-02-28" },
} as const;

/** 全部夹具（测试遍历用）。 */
export const TIMEKEY_RANGES: ReadonlyArray<{ readonly name: string; readonly range: InclusiveRange }> = [
  { name: "october-2026", range: TIMEKEY_OCTOBER_2026 },
  { name: "leap-february-2028", range: TIMEKEY_LEAP_FEBRUARY_2028 },
  { name: "year-boundary", range: TIMEKEY_YEAR_BOUNDARY },
  { name: "partial-months", range: TIMEKEY_PARTIAL_MONTHS },
  { name: "four-hundred-days", range: TIMEKEY_FOUR_HUNDRED_DAYS },
  { name: "single-day", range: TIMEKEY_SINGLE_DAY },
];
