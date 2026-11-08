# apps/web/src/analysis · 阅读入口

分析查询与展示适配；计算契约位于 shared。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [adapters.test.ts](adapters.test.ts) | 测试：adapters |
| [adapters.ts](adapters.ts) | 实现模块；入口/导出：AdapterOptions、toRankingTableInput、toDivergingBarsInput、WaterfallLabels、toWaterfallInput |
| [adapters2.test.ts](adapters2.test.ts) | 测试：adapters2 |
| [adapters3.test.ts](adapters3.test.ts) | 测试：adapters3 |
| [adapters3.ts](adapters3.ts) | 实现模块；入口/导出：toBoxplotByCategoryInput、PivotLabels、toPivotTableInput、toSmallMultiplesInput、toCalendarHeatmapInput |
| [adapters4.test.ts](adapters4.test.ts) | 测试：adapters4 |
| [adapters4.ts](adapters4.ts) | 实现模块；入口/导出：HIERARCHY_TABLE_MAX_ROWS、toHierarchyTableInput、toSunburstInput、toTreemapInput、toSankeyInput |
| [adapters5.test.ts](adapters5.test.ts) | 测试：adapters5 |
| [adapters5.ts](adapters5.ts) | 实现模块；入口/导出：COMPOSITION_BASIS_NOTE、CONTRIBUTION_BASIS_NOTE、RATE_TREND_BASIS_NOTE、COVERAGE_BASIS_NOTE、FALLBACK_BASIS_NOTE |
| [format.ts](format.ts) | 实现模块；入口/导出：RatioLike、formatMinorText、formatSignedMinorText、formatRatioPercent、roundRatioToInteger |
| [geometry.test.ts](geometry.test.ts) | 测试：geometry |
| [geometry.ts](geometry.ts) | 实现模块；入口/导出：Point、LayoutBox、BarLayoutOptions、BarSegment、computeBarLayout |
| [geometry2.test.ts](geometry2.test.ts) | 测试：geometry2 |
| [geometry3.test.ts](geometry3.test.ts) | 测试：geometry3 |
| [geometry4.test.ts](geometry4.test.ts) | 测试：geometry4 |
| [geometry4.ts](geometry4.ts) | 实现模块；入口/导出：SunburstArcNode、SunburstLayoutOptions、SunburstArc、computeSunburstArcs、TreemapItem |
| [sharedTypes.ts](sharedTypes.ts) | 实现模块；入口/导出：RatioLike、SharedMoney、SharedRankingItem、SharedRankingResult、SharedContributionRow |
| [types.ts](types.ts) | 实现模块；入口/导出：ChartSource、MoneyText、RankingTableRow、RankingTableInput、DivergingBarDatum |
<!-- directory-index:end -->
