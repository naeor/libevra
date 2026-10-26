import { CURRENCIES, STATS_RANGES, type Currency, type StatsRangeKey } from "@libellum/shared";

/** 导航状态不保存金额，财务与权限仍由原查询决定。 */
export function readStatsView(params: URLSearchParams) {
  const preset = params.get("range"), currency = params.get("currency"), month = params.get("month") ?? "";
  return {
    combined: params.get("analysis") !== "currency",
    preset: STATS_RANGES.includes(preset as StatsRangeKey) ? preset as StatsRangeKey : "30d" as const,
    currency: CURRENCIES.includes(currency as Currency) ? currency as Currency : null,
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month.slice(0, 4) !== "0000" ? month : "",
    kind: params.get("kind") === "income" ? "income" as const : "expense" as const,
    heatRange: params.get("heat") === "7d" ? "7d" as const : "month" as const,
  };
}
export function updateStatsView(params: URLSearchParams, patch: Readonly<Record<string, string | null>>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next;
}
