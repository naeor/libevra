# packages/shared/src/analysis · 阅读入口

共享财务分析计算与结果契约。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [analysisCatalog.test.ts](analysisCatalog.test.ts) | 测试：analysisCatalog |
| [analysisCatalog.ts](analysisCatalog.ts) | 实现模块；入口/导出：ANALYSIS_CATALOG_IDS、CatalogAnalysisId、AnalysisCatalogEntry、ANALYSIS_CATALOG_DRAFT、ANALYSIS_CATALOG |
| [context.test.ts](context.test.ts) | 测试：context |
| [context.ts](context.ts) | 实现模块；入口/导出：DefaultKind、WorkbenchState、makePeriod、resolveDefinitionPeriod、resolveFilters |
| [fixtures.ts](fixtures.ts) | 实现模块；入口/导出：AnalysisSample、SAMPLE_A_EMPTY_BOOK、SAMPLE_B_INCOME_ONLY、SAMPLE_C_EXPENSE_ONLY、SAMPLE_D_EQUAL_AMOUNTS |
| [index.ts](index.ts) | 实现模块；按文件名定位 index.ts |
| [primitives.test.ts](primitives.test.ts) | 测试：primitives |
| [primitives.ts](primitives.ts) | 实现模块；入口/导出：AnalysisKind、AnalysisEntry、UNSPECIFIED_PAYMENT_METHOD_ID、UNSPECIFIED_PAYMENT_METHOD_LABEL、KindTotals |
| [rational.test.ts](rational.test.ts) | 测试：rational |
| [rational.ts](rational.ts) | 实现模块；入口/导出：Ratio、ratioOf、compareRatio、ratioToNumber、ratioToDecimalText |
| [timeKeys.fixtures.ts](timeKeys.fixtures.ts) | 实现模块；入口/导出：TIMEKEY_OCTOBER_2026、TIMEKEY_LEAP_FEBRUARY_2028、TIMEKEY_YEAR_BOUNDARY、TIMEKEY_PARTIAL_MONTHS、TIMEKEY_FOUR_HUNDRED_DAYS |
| [timeKeys.test.ts](timeKeys.test.ts) | 测试：timeKeys |
| [timeKeys.ts](timeKeys.ts) | 实现模块；入口/导出：MAX_ANALYSIS_DAYS、TimeKeyGranularity、CalendarDate、CalendarDateParts、HalfOpenSpan |
| [types.ts](types.ts) | 实现模块；入口/导出：ANALYSIS_PROTOCOL_VERSION、ANALYSIS_ROUNDING_POLICY、ResolvedCurrency、ResolvedPeriod、ResolvedFilters |
| [w1Boundary.test.ts](w1Boundary.test.ts) | 测试：w1Boundary |

| 子目录 | 职责 |
|---|---|
| [adapters/](adapters/README.md) | 分析协议适配。 |
| [advanced/](advanced/README.md) | 深入分析计算。 |
| [analyses/](analyses/README.md) | 分析指标实现。 |
| [charts/](charts/README.md) | 图表展示组件。 |
| [layout/](layout/README.md) | 工作台布局模型、迁移、命令与导入导出。 |
<!-- directory-index:end -->
