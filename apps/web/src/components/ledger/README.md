# apps/web/src/components/ledger · 阅读入口

账本领域。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [BatchActionBar.tsx](BatchActionBar.tsx) | 界面模块；入口/导出：BatchActionBar |
| [BatchEditSheet.tsx](BatchEditSheet.tsx) | 界面模块；入口/导出：BatchEditSheet |
| [BatchRoleProbe.tsx](BatchRoleProbe.tsx) | 界面模块；入口/导出：BatchRoleProbe |
| [DetailCardEditor.tsx](DetailCardEditor.tsx) | 界面模块；入口/导出：DetailCardEditor |
| [DetailMiniChart.test.tsx](DetailMiniChart.test.tsx) | 测试：DetailMiniChart |
| [DetailMiniChart.tsx](DetailMiniChart.tsx) | 界面模块；入口/导出：MiniEntry、netSeries、miniSeries、DetailMiniChart |
| [DetailOverview.test.tsx](DetailOverview.test.tsx) | 测试：DetailOverview |
| [DetailOverview.tsx](DetailOverview.tsx) | 界面模块；入口/导出：DetailOverview |
| [DetailTools.tsx](DetailTools.tsx) | 界面模块；入口/导出：DetailTools |
| [LedgerEntryRow.tsx](LedgerEntryRow.tsx) | 界面模块；入口/导出：entryNewTabPath、LedgerEntryRow |
| [SelectionBar.tsx](SelectionBar.tsx) | 界面模块；入口/导出：SelectionBar |
| [batch.test.ts](batch.test.ts) | 测试：batch |
| [batch.ts](batch.ts) | 实现模块；入口/导出：selectedLoadedIds、toggleSelection、allLoadedSelected、selectAllLoaded、EntryTapAction |
| [batchUi.test.tsx](batchUi.test.tsx) | 测试：batchUi |
| [detail-card-editor.css](detail-card-editor.css) | 样式与变量 |
| [detail-overview.css](detail-overview.css) | 样式与变量 |
| [metricSnapshot.test.ts](metricSnapshot.test.ts) | 测试：metricSnapshot |
| [metricSnapshot.ts](metricSnapshot.ts) | 实现模块；入口/导出：OverviewMetric、MetricSnapshot、MetricContent、keepMetricSnapshot、readMetricSnapshot |
| [refreshFeedback.test.ts](refreshFeedback.test.ts) | 测试：refreshFeedback |
| [refreshFeedback.ts](refreshFeedback.ts) | 实现模块；入口/导出：refreshMessage |
| [useLedgerBatch.ts](useLedgerBatch.ts) | 实现模块；入口/导出：useLedgerBatch、LedgerBatch |
<!-- directory-index:end -->
