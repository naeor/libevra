# apps/web/src/lib/ocr · 阅读入口

OCR 解析与确认。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [batch.test.ts](batch.test.ts) | 测试：batch |
| [batch.ts](batch.ts) | 实现模块；入口/导出：CreateBatchOptions、TRANSFER_CATEGORY_NAME、createBatch、batchItem、updateBatchItem |
| [batchStore.test.ts](batchStore.test.ts) | 测试：batchStore |
| [batchStore.ts](batchStore.ts) | 实现模块；入口/导出：BatchStorage、batchStorage、saveBatch、loadBatch、clearBatch |
| [category.test.ts](category.test.ts) | 测试：category |
| [category.ts](category.ts) | 实现模块；入口/导出：CategoryLike、CategorySuggestion、usableCategories、inferCategory、applyCategorySuggestions |
| [duplicateReminderSafety.test.ts](duplicateReminderSafety.test.ts) | 测试：duplicateReminderSafety |
| [duplicates.test.ts](duplicates.test.ts) | 测试：duplicates |
| [duplicates.ts](duplicates.ts) | 实现模块；入口/导出：OcrDuplicateOptions、OcrDuplicateGroup、duplicateReason、UnionFind、findSuspectedDuplicates |
| [import.test.ts](import.test.ts) | 测试：import |
| [import.ts](import.ts) | 实现模块；入口/导出：NOTE_TRANSFER_MARKER、NOTE_MAX_LENGTH、OcrImportBlocker、OcrImportPlanItem、OcrImportPlan |
| [importExecution.test.ts](importExecution.test.ts) | 测试：importExecution |
| [importExecution.ts](importExecution.ts) | 实现模块；入口/导出：OcrImportWriter、executeImport |
| [importSession.test.ts](importSession.test.ts) | 测试：importSession |
| [importSession.ts](importSession.ts) | 实现模块；入口/导出：IMPORT_SESSION_STORAGE_KEY、MAX_SESSION_BATCHES、OcrImportSessionBatch、OcrImportSession、ImportSessionStorage |
| [routeDecision.test.ts](routeDecision.test.ts) | 测试：routeDecision |
| [routeDecision.ts](routeDecision.ts) | 实现模块；入口/导出：RecognitionRoute、isReadable、readableItems、routeRecognition |
| [testFixtures.ts](testFixtures.ts) | 实现模块；入口/导出：candidate、item、batchCandidate、MemoryStorage、memoryStorage |
| [types.ts](types.ts) | 实现模块；入口/导出：OcrCategorySource、OcrBatchCandidate、OcrBatchPage、OcrBatch、OcrOverviewFilter |
<!-- directory-index:end -->
