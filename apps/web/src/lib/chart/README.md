# apps/web/src/lib/chart · 阅读入口

图表基础设施。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [advancedChart.test.ts](advancedChart.test.ts) | 测试：advancedChart |
| [advancedChart.ts](advancedChart.ts) | 实现模块；入口/导出：AdvancedBox、AdvancedChartKind、MovingAveragePointGeometry、MovingAverageChartModel、buildMovingAverageModel |
| [categoryChart.test.ts](categoryChart.test.ts) | 测试：categoryChart |
| [categoryChart.ts](categoryChart.ts) | 实现模块；入口/导出：FlowBar、FlowBarModel、buildFlowBarModel、StackSegment、StackedBucketMark |
| [chart.test.ts](chart.test.ts) | 测试：chart |
| [chartFamilies.test.ts](chartFamilies.test.ts) | 测试：chartFamilies |
| [chartFamilies.ts](chartFamilies.ts) | 实现模块；入口/导出：ChartResultShape、FamilyDataState、ChartFamilyDefinition、CHART_FAMILIES、chartFamily |
| [chartTheme.test.ts](chartTheme.test.ts) | 测试：chartTheme |
| [comparisonChart.test.ts](comparisonChart.test.ts) | 测试：comparisonChart |
| [comparisonChart.ts](comparisonChart.ts) | 实现模块；入口/导出：ComparisonBox、ComparisonPadding、GroupedBarRect、ComparisonSide、ComparisonBarGroup |
| [format.ts](format.ts) | 实现模块；入口/导出：formatCompactNumber、formatAxisAmount、formatExactAmount、formatPercent、formatChange |
| [geometry.test.ts](geometry.test.ts) | 测试：geometry |
| [geometry.ts](geometry.ts) | 实现模块；入口/导出：Point、linePath、areaPath、polarToCartesian、arcPath |
| [guards.ts](guards.ts) | 实现模块；入口/导出：ChartSubject、ChartState、SeriesSummary、summariseSeries、canCompare |
| [scales.ts](scales.ts) | 实现模块；入口/导出：LinearScale、createLinearScale、extentOf、niceDomain、ticksFor |
| [theme.ts](theme.ts) | 实现模块；入口/导出：CATEGORICAL_COLORS、categoricalColor、HEAT_COLORS、heatColor、EXPENSE_COLOR |
| [timeSeriesChart.test.ts](timeSeriesChart.test.ts) | 测试：timeSeriesChart |
| [timeSeriesChart.ts](timeSeriesChart.ts) | 实现模块；入口/导出：ChartBox、SeriesChartKind、SeriesValuePoint、SeriesBar、SeriesChartModel |
<!-- directory-index:end -->
