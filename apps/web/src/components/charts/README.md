# apps/web/src/components/charts · 阅读入口

图表展示组件。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [AdvancedCharts.tsx](AdvancedCharts.tsx) | 界面模块；入口/导出：spreadLabels、BarRow、BarRows、DivergingRow、DivergingRows |
| [AnomalyMarkerChart.tsx](AnomalyMarkerChart.tsx) | 界面模块；入口/导出：AnomalyMarkerChartProps、AnomalyMarkerChart |
| [AnomalyPeaksCard.tsx](AnomalyPeaksCard.tsx) | 界面模块；入口/导出：AnomalyPeakText、AnomalyPeaksCardProps、AnomalyPeaksCard |
| [CalendarHeatmap.tsx](CalendarHeatmap.tsx) | 界面模块；入口/导出：CalendarHeatmap |
| [CalendarHeatmapGrid.tsx](CalendarHeatmapGrid.tsx) | 界面模块；入口/导出：CalendarHeatmapGrid |
| [CategoryCompositionCard.tsx](CategoryCompositionCard.tsx) | 界面模块；入口/导出：CategoryCompositionCardProps、CategoryCompositionCard |
| [CategoryDataTable.tsx](CategoryDataTable.tsx) | 界面模块；入口/导出：CategoryDataTableProps、CategoryDataTable |
| [CategoryDonut.tsx](CategoryDonut.tsx) | 界面模块；入口/导出：CategoryDonut |
| [CategorySeriesChart.tsx](CategorySeriesChart.tsx) | 界面模块；入口/导出：CategorySeriesChart |
| [CategoryShareBands.tsx](CategoryShareBands.tsx) | 界面模块；入口/导出：CategoryShareBands |
| [CategoryShareCard.tsx](CategoryShareCard.tsx) | 界面模块；入口/导出：CategoryShareCardProps、CategoryShareCard |
| [CategoryStackedBars.tsx](CategoryStackedBars.tsx) | 界面模块；入口/导出：CategoryStackedBars |
| [CategoryTrendsCard.tsx](CategoryTrendsCard.tsx) | 界面模块；入口/导出：CategoryTrendsCardProps、CategoryTrendsCard |
| [CumulativeExpenseCard.tsx](CumulativeExpenseCard.tsx) | 界面模块；入口/导出：CumulativeExpenseCardProps、CumulativeExpenseCard |
| [CumulativeTrendChart.tsx](CumulativeTrendChart.tsx) | 界面模块；入口/导出：CumulativeTrendChartProps、CumulativeTrendChart |
| [DailyExpenseTrendCard.test.tsx](DailyExpenseTrendCard.test.tsx) | 测试：DailyExpenseTrendCard |
| [DailyExpenseTrendCard.tsx](DailyExpenseTrendCard.tsx) | 界面模块；入口/导出：DailyExpenseTrendCardProps、DailyExpenseTrendCard |
| [IncomeExpenseBars.tsx](IncomeExpenseBars.tsx) | 界面模块；入口/导出：IncomeExpenseBars |
| [IncomeExpenseCard.tsx](IncomeExpenseCard.tsx) | 界面模块；入口/导出：IncomeExpenseCardProps、IncomeExpenseCard |
| [IncomeStabilityCard.tsx](IncomeStabilityCard.tsx) | 界面模块；入口/导出：IncomeStabilityMetricText、IncomeStabilityCardProps、IncomeStabilityCard |
| [MonthComparisonCard.tsx](MonthComparisonCard.tsx) | 界面模块；入口/导出：MonthComparisonCardProps、MonthComparisonCard |
| [MonthComparisonChart.tsx](MonthComparisonChart.tsx) | 界面模块；入口/导出：MonthComparisonChartProps、MonthComparisonChart |
| [MovingAverageCard.tsx](MovingAverageCard.tsx) | 界面模块；入口/导出：MovingAverageMetricText、MovingAverageCardProps、MovingAverageCard |
| [MovingAverageChart.tsx](MovingAverageChart.tsx) | 界面模块；入口/导出：MovingAverageChartProps、MovingAverageChart |
| [PeriodComparisonBars.tsx](PeriodComparisonBars.tsx) | 界面模块；入口/导出：PeriodComparisonBarsProps、PeriodComparisonBars |
| [PeriodComparisonCard.tsx](PeriodComparisonCard.tsx) | 界面模块；入口/导出：ComparisonCardMetric、PeriodComparisonCardProps、PeriodComparisonCard |
| [SeasonalComparisonCard.tsx](SeasonalComparisonCard.tsx) | 界面模块；入口/导出：SeasonalMonthComparisonResult、SeasonalComparisonCardProps、SeasonalComparisonCard |
| [SeasonalComparisonChart.tsx](SeasonalComparisonChart.tsx) | 界面模块；入口/导出：SeasonalComparisonChartProps、SeasonalComparisonChart |
| [SeriesTrendChart.tsx](SeriesTrendChart.tsx) | 界面模块；入口/导出：SeriesTrendChartProps、defaultSeriesColor、SeriesTrendChart |
| [Sparkline.tsx](Sparkline.tsx) | 界面模块；入口/导出：Sparkline |
| [SummaryPanel.tsx](SummaryPanel.tsx) | 界面模块；入口/导出：ComparisonPanel、YearOverview |
| [TimeSeriesCard.tsx](TimeSeriesCard.tsx) | 界面模块；入口/导出：TimeSeriesCardProps、TimeSeriesCard |
| [TrendChart.tsx](TrendChart.tsx) | 界面模块；入口/导出：TrendChart |
| [VariabilityCard.tsx](VariabilityCard.tsx) | 界面模块；入口/导出：VariabilityMetricText、VariabilityCardProps、VariabilityCard |
| [VolatilityBandChart.tsx](VolatilityBandChart.tsx) | 界面模块；入口/导出：VolatilityBandChartProps、VolatilityBandChart |
| [WeekdayBars.tsx](WeekdayBars.tsx) | 界面模块；入口/导出：WeekdayBars |
| [WeekdayPatternCard.tsx](WeekdayPatternCard.tsx) | 界面模块；入口/导出：WeekdayPatternMetricText、WeekdayPatternCardProps、WeekdayPatternCard |
| [advancedCharts.test.tsx](advancedCharts.test.tsx) | 测试：advancedCharts |
| [categoryCards.test.tsx](categoryCards.test.tsx) | 测试：categoryCards |
| [categoryCharts.test.tsx](categoryCharts.test.tsx) | 测试：categoryCharts |
| [charts.i18n.test.tsx](charts.i18n.test.tsx) | 测试：charts.i18n |
| [comparisonCards.test.tsx](comparisonCards.test.tsx) | 测试：comparisonCards |
| [comparisonCharts.test.tsx](comparisonCharts.test.tsx) | 测试：comparisonCharts |
| [movingAverageCards.test.tsx](movingAverageCards.test.tsx) | 测试：movingAverageCards |
| [seasonalAnomalyCards.test.tsx](seasonalAnomalyCards.test.tsx) | 测试：seasonalAnomalyCards |
| [stabilityCards.test.tsx](stabilityCards.test.tsx) | 测试：stabilityCards |
| [timeSeriesCards.test.tsx](timeSeriesCards.test.tsx) | 测试：timeSeriesCards |
| [timeSeriesCharts.test.tsx](timeSeriesCharts.test.tsx) | 测试：timeSeriesCharts |
<!-- directory-index:end -->
