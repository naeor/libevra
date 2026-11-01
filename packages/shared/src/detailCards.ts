import { z } from "zod";

export const detailNumbers = ["expense", "income", "balance", "daily", "count"] as const;
export const detailCharts = ["expenseTrend", "incomeTrend", "expenseBars", "categoryRank"] as const;
export const detailMetricSchema = z.enum([...detailNumbers, ...detailCharts]);
export type DetailMetric = z.infer<typeof detailMetricSchema>;
export const isDetailChart = (id: string): boolean => (detailCharts as readonly string[]).includes(id);
/** 主卡两格；微型图表使用整张主卡，副卡一项数字。 */
export const detailCardSchema = z.strictObject({
  main: z.enum(["overview", "expense", "income"]),
  first: z.enum(detailNumbers), second: z.enum(detailNumbers),
  mainMetrics: z.array(detailMetricSchema).min(1).max(2).optional(),
}).refine(v => !v.mainMetrics || new Set(v.mainMetrics).size === v.mainMetrics.length && v.mainMetrics.reduce((n, id) => n + (isDetailChart(id) ? 2 : 1), 0) <= 2);
export type DetailCardConfiguration = z.infer<typeof detailCardSchema>;
export function mainDetailMetrics(v: DetailCardConfiguration): DetailMetric[] {
  return v.mainMetrics ?? (v.main === "overview" ? ["expense", "income"] : [v.main]);
}
