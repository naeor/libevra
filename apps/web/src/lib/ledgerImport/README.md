# apps/web/src/lib/ledgerImport · 阅读入口

本层组织 ledgerImport 模块的直属文件；具体契约由任务索引定位。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [cleanup.ts](cleanup.ts) | 实现模块；入口/导出：previewGuestCleanup、getFormalSourceDisposition、getFormalSourceDispositionByReceipt |
| [decisions.ts](decisions.ts) | 实现模块；入口/导出：SourceHandling、TargetHandling、GroupPresetAction、GroupDecisionDraft、GroupDecisionMap |
| [duplicates.sample.test.ts](duplicates.sample.test.ts) | 测试：duplicates.sample |
| [duplicates.test.ts](duplicates.test.ts) | 测试：duplicates |
| [duplicates.ts](duplicates.ts) | 实现模块；入口/导出：DuplicateDetectionResult、detectDuplicateGroups |
| [formal.ts](formal.ts) | 实现模块；入口/导出：FormalPreviewData、loadFormalImportPreview |
| [incremental.ts](incremental.ts) | 实现模块；入口/导出：loadIncrementalPreview、defaultIncrementalAction、decisionsForRequest、incrementalExclusions |
| [job.ts](job.ts) | 实现模块；入口/导出：createImportJob、getImportJob、resumeImportJob、cancelImportJob、confirmImportJob |
| [journal.ts](journal.ts) | 实现模块；入口/导出：PendingImportTask、savePendingTask、removePendingTask、loadPendingTasks |
| [mapping.test.ts](mapping.test.ts) | 测试：mapping |
| [mapping.ts](mapping.ts) | 实现模块；入口/导出：TaxonomyResolutionAction、TaxonomyResolutionMap、taxonomyResolutionKey、normalizeObjectName、categoryMatchKey |
| [preview.test.ts](preview.test.ts) | 测试：preview |
| [preview.ts](preview.ts) | 实现模块；入口/导出：buildImportPreview |
| [recovery.test.ts](recovery.test.ts) | 测试：recovery |
| [recovery.ts](recovery.ts) | 实现模块；入口/导出：duplicateGroupSignature、recoverTaxonomyResolutions、GroupDecisionRecovery、recoverGroupDecisions、DraftRecoveryMessageId |
| [sources.ts](sources.ts) | 实现模块；入口/导出：ImportBookSummary、isSoloImportBook、loadBookImportSource、loadBookImportTarget、hasLocalGuestIdentity |
| [submit.ts](submit.ts) | 实现模块；入口/导出：guestSourceOfSource、guestSourceOf、targetSnapshotOf、buildLedgerImportRequest、unresolvedConflicts |
| [types.ts](types.ts) | 实现模块；入口/导出：ImportSourceKind、ImportBookIdentity、ImportSnapshot、ImportSource、ImportTarget |
<!-- directory-index:end -->
