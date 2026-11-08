# packages/shared/src/analysis/advanced · 阅读入口

深入分析计算。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [batch2.test.ts](batch2.test.ts) | 测试：batch2 |
| [batch3.test.ts](batch3.test.ts) | 测试：batch3 |
| [batch4.test.ts](batch4.test.ts) | 测试：batch4 |
| [boxplot.ts](boxplot.ts) | 实现模块；入口/导出：BOXPLOT_MIN_RELIABLE_SAMPLE、BOXPLOT_DEFAULT_MAX_OUTLIERS、BOXPLOT_QUANTILE_METHOD、BoxplotOptions、boxplotByCategory |
| [bubble.test.ts](bubble.test.ts) | 测试：bubble |
| [bubble.ts](bubble.ts) | 实现模块；入口/导出：BubbleInputDatum、bubblesOf |
| [calendar.ts](calendar.ts) | 实现模块；入口/导出：AnnualCalendarOptions、isLeapYear、weekIndexOf、annualCalendarOf |
| [contribution.ts](contribution.ts) | 实现模块；入口/导出：CategoryAmountInput、contributionBetween、normaliseCategoryAmounts、shareChangeOf、deltaSharesSumToOne |
| [crossCube.ts](crossCube.ts) | 实现模块；入口/导出：MAX_CUBE_DIMENSIONS、MAX_CUBE_COMBINATIONS、CrossCubeSpec、DraftCrossCubeOutcome、crossCubeOf |
| [currencyComposition.ts](currencyComposition.ts) | 实现模块；入口/导出：currencyCompositionOf |
| [dimensions.ts](dimensions.ts) | 实现模块；入口/导出：AdvancedRecord、AdvancedDimension、ADVANCED_DIMENSIONS、UNSPECIFIED_PAYMENT_METHOD_KEY、UNSPECIFIED_PAYMENT_METHOD_LABEL |
| [distribution.ts](distribution.ts) | 实现模块；入口/导出：HISTOGRAM_DOMINANT_MAX_BINS、floorDiv、integerSqrt、populationVariance、standardDeviationScaled |
| [draftTypes.ts](draftTypes.ts) | 实现模块；入口/导出：ADVANCED_DRAFT_VERSION、DraftRational、DraftCompleteness、DraftQuantile、DraftHistogramBin |
| [fxDiagnostics.ts](fxDiagnostics.ts) | 实现模块；入口/导出：FX_DRAFT_MAX_FALLBACK_DAYS、FX_DRAFT_RATE_DECIMALS、FX_DRAFT_MAX_TREND_DAYS、FX_DRAFT_MAX_MISSING_RECORDS、FX_DRAFT_FALLBACK_UNAVAILABLE_NO_TRANSACTIONS |
| [fxProjection.test.ts](fxProjection.test.ts) | 测试：fxProjection |
| [fxProjection.ts](fxProjection.ts) | 实现模块；入口/导出：FX_PROJECTION_BATCH、FxProjectionRangeGuard、FxRealProjectionInput、FxRealProjectionOptions、FxRealProjectionRejection |
| [h1.test.ts](h1.test.ts) | 测试：h1 |
| [hierarchy.ts](hierarchy.ts) | 实现模块；入口/导出：HIERARCHY_ROOT_ID、HIERARCHY_DIRECT_SUFFIX、MAX_HIERARCHY_NODES、DraftHierarchyMetric、DraftHierarchyOptions |
| [index.ts](index.ts) | 实现模块；按文件名定位 index.ts |
| [math.test.ts](math.test.ts) | 测试：math |
| [matrix.ts](matrix.ts) | 实现模块；入口/导出：MatrixDatum、MatrixOptions、buildMatrix、matrixCell、matrixIsConserved |
| [migration.test.ts](migration.test.ts) | 测试：migration |
| [migration.ts](migration.ts) | 实现模块；入口/导出：RankSnapshotEntry、rankMigration |
| [pivot.ts](pivot.ts) | 实现模块；入口/导出：PIVOT_METRICS、MAX_PIVOT_CELLS、PivotSpec、pivotOf |
| [quantiles.ts](quantiles.ts) | 实现模块；入口/导出：sortMinorAscending、type7Position、quantileOfSorted、medianOf、quantilesOf |
| [ranking.ts](ranking.ts) | 实现模块；入口/导出：RankRecordsOptions、rankRecords、ConcentrationInput、ConcentrationOptions、paretoOf |
| [rational.ts](rational.ts) | 实现模块；入口/导出：gcdBigInt、makeRational、RATIONAL_ZERO、RATIONAL_ONE、rationalFromBigInt |
| [sankey.ts](sankey.ts) | 实现模块；入口/导出：MAX_SANKEY_LINKS、buildHierarchySankey、sankeyIsConserved |
| [scatter.test.ts](scatter.test.ts) | 测试：scatter |
| [scatter.ts](scatter.ts) | 实现模块；入口/导出：ScatterRecord、ScatterOptions、scatterOf |
| [smallMultiples.ts](smallMultiples.ts) | 实现模块；入口/导出：DEFAULT_SMALL_MULTIPLES_TOP_N、MAX_SMALL_MULTIPLES_TOP_N、SmallMultiplesOptions、smallMultiplesOf |
| [streaks.test.ts](streaks.test.ts) | 测试：streaks |
| [streaks.ts](streaks.ts) | 实现模块；入口/导出：NoExpenseDayState、NoExpenseDay、NoExpenseStreak、NoExpenseStreakResult、noExpenseStreaksOf |
| [structures.test.ts](structures.test.ts) | 测试：structures |
<!-- directory-index:end -->
