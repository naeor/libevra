# apps/api/src/ledger · 阅读入口

账本领域、访问控制与对象操作。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [access.ts](access.ts) | 实现模块；入口/导出：requireBookAccess、BookContext、requireBook、requireBookForWrite、currentBookId |
| [auditContext.ts](auditContext.ts) | 实现模块；入口/导出：registerAuditContext、currentAuditContext |
| [bootstrap.ts](bootstrap.ts) | 实现模块；入口/导出：createDefaultLedger |
| [categoryTree.ts](categoryTree.ts) | 实现模块；入口/导出：lockCategoryTree、checkCategoryWriter、checkCategoryTree |
| [defaultName.ts](defaultName.ts) | 实现模块；入口/导出：DEFAULT_BOOK_NAME_EN、defaultBookNameFor |
| [events.ts](events.ts) | 实现模块；入口/导出：EventKind、FieldChange、RecordEventInput、recordEvent、trackedFieldLabel |
| [export-query.ts](export-query.ts) | 实现模块；入口/导出：ExportFilters、ExportRow、countExportRows |
| [history.ts](history.ts) | 实现模块；入口/导出：HistoryEntry、HistoryEventRow、HISTORY_EVENT_SELECT、HistoryReadOptions、readHistory |
| [importCleanup.ts](importCleanup.ts) | 实现模块；入口/导出：previewGuestCleanup、getFormalSourceDispositionByReceipt、getFormalSourceDisposition |
| [importIncremental.ts](importIncremental.ts) | 实现模块；入口/导出：IncrementalAnalysis、IncrementalOperation、IncrementalPlan、sourceNamespaceOf、sourceBookKeyOf |
| [importJob.ts](importJob.ts) | 实现模块；入口/导出：getImportJob、createImportJob |
| [importSolo.ts](importSolo.ts) | 实现模块；入口/导出：ImportDbClient、SoloImportBookSnapshot、FormalImportPair、loadSoloImportBook、loadFormalImportPair |
| [importTarget.ts](importTarget.ts) | 实现模块；入口/导出：ImportDbClient、loadTargetSnapshot、SoloBookTarget、loadExistingImportTarget |
| [importUndo.ts](importUndo.ts) | 实现模块；入口/导出：UndoOp、TransactionBefore、SourceStateBefore、StoredUndoBatch、readUndoBatch |
| [ledgerLocks.ts](ledgerLocks.ts) | 实现模块；入口/导出：IMPORT_LOCK_OWNER_PREFIX、LOCK_OWNER_SETTING、DEFAULT_CONFIRM_TIMEOUT_SECONDS、MIN_CONFIRM_TIMEOUT_SECONDS、MAX_CONFIRM_TIMEOUT_SECONDS |
| [notDuplicateRelations.ts](notDuplicateRelations.ts) | 实现模块；入口/导出：RelationRow、RelationTransactionRow、RelationViewContext、relationView、toRelationDto |
| [operations.ts](operations.ts) | 实现模块；入口/导出：RecordOperationInput、recordOperation、readOperations |
| [presets.ts](presets.ts) | 实现模块；入口/导出：PresetKind |
| [quotes.ts](quotes.ts) | 实现模块；入口/导出：readQuoteTargets、quoteTransactionTarget、quoteEventTarget、StoredMessageRow、withMessageReferences |
| [storage.ts](storage.ts) | 实现模块；入口/导出：STORAGE_DEFAULTS、storagePolicy、lockStorage、lockBookStorage、lockAccountStorage |
| [storageReconcile.ts](storageReconcile.ts) | 实现模块；入口/导出：reconcileStorage、registerStorageReconciliation |
| [transactionSeq.ts](transactionSeq.ts) | 实现模块；入口/导出：allocateTransactionSeq、formatTransactionNumber |
<!-- directory-index:end -->
