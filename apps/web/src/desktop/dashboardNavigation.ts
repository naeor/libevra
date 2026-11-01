import type { AnalysisCardNode } from "@libellum/shared/analysis/layout";

/** 总览图表是临时分析实例，不向用户的工作台增卡或改布局。 */
export function dashboardAnalysisCard(value: string | null): AnalysisCardNode | undefined {
  if (value !== "expense" && value !== "income" && value !== "balance") return undefined;
  return {
    objectId: `dashboard-${value}`,
    type: "analysis-card",
    analysis: { analysisId: value === "expense" ? "AN-I06" : value === "income" ? "AN-I07" : "AN-I08", params: {} },
    chart: { chartFamily: "bar" },
    rangePolicy: "inherit",
  };
}

export function dashboardDestination(month: string, metric?: "expense" | "income" | "balance", currency?: string): string {
  const query = new URLSearchParams({ month });
  if (metric === undefined) return `/?${query.toString()}`;
  query.set("dashboardChart", metric);
  query.set("analysis", "currency");
  if (currency !== undefined) query.set("currency", currency);
  return `/stats?${query.toString()}`;
}
