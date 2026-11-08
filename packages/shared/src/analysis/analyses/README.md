# packages/shared/src/analysis/analyses · 阅读入口

分析指标实现。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [basic.test.ts](basic.test.ts) | 测试：basic |
| [basic.ts](basic.ts) | 实现模块；入口/导出：assembleTotalExpense、assembleTotalIncome、assembleNetAmount、assembleExpenseCount、assembleIncomeCount |
| [category.test.ts](category.test.ts) | 测试：category |
| [category.ts](category.ts) | 实现模块；入口/导出：OTHER_GROUP_ID、OTHER_GROUP_LABEL、assembleExpenseCategoryComposition、assembleIncomeCategoryComposition、assembleExpenseCategoryRanking |
| [statistics.test.ts](statistics.test.ts) | 测试：statistics |
| [statistics.ts](statistics.ts) | 实现模块；入口/导出：assembleMedianExpense、assembleMaxExpenseTransaction、assembleMinExpenseTransaction、assembleMaxIncomeTransaction、assemblePeakExpenseDay |
<!-- directory-index:end -->
