# apps/api/src/routes · 阅读入口

HTTP 路由入口；鉴权、校验、领域操作与错误响应。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [admin.ts](admin.ts) | 实现模块；入口/导出：AdminRouteOptions、registerAdminRoutes |
| [adminLifecycle.ts](adminLifecycle.ts) | 实现模块；入口/导出：AdminLifecycleRouteOptions、registerAdminLifecycleRoutes |
| [analytics.ts](analytics.ts) | 实现模块；入口/导出：AnalyticsRouteOptions、registerAnalyticsRoutes |
| [attachmentExport.ts](attachmentExport.ts) | 实现模块；入口/导出：attachmentTarHeader、registerAttachmentExport |
| [attachments.ts](attachments.ts) | 实现模块；入口/导出：attachmentMediaType、registerAttachmentRoutes |
| [auth.ts](auth.ts) | 实现模块；入口/导出：AuthRouteOptions、registerAuthRoutes |
| [avatarRewards.ts](avatarRewards.ts) | 实现模块；入口/导出：AvatarRewardRouteOptions、registerAvatarRewardRoutes |
| [billImport.ts](billImport.ts) | 实现模块；入口/导出：BillImportRouteOptions、registerBillImportRoutes |
| [books.ts](books.ts) | 实现模块；入口/导出：BooksRouteOptions、registerBooksRoutes |
| [classification.ts](classification.ts) | 实现模块；入口/导出：ClassificationRouteOptions、registerClassificationRoutes |
| [consent.ts](consent.ts) | 实现模块；入口/导出：registerLegalRoutes、registerAccountConsentRoutes |
| [detailCards.ts](detailCards.ts) | 实现模块；入口/导出：detailRecords、publicWorkbench、preserveDetailCards、registerDetailCardRoutes |
| [directory.ts](directory.ts) | 实现模块；入口/导出：DirectoryRouteOptions、registerDirectoryRoutes |
| [duplicateReview.ts](duplicateReview.ts) | 实现模块；入口/导出：candidateFromTransaction、duplicateWhere、suppressConfirmed、registerDuplicateReviewRoutes |
| [entryNotices.ts](entryNotices.ts) | 实现模块；入口/导出：registerEntryNoticeRoutes |
| [export.ts](export.ts) | 实现模块；入口/导出：registerExportRoutes |
| [health.ts](health.ts) | 实现模块；入口/导出：HealthDeps、registerHealthRoute |
| [import.ts](import.ts) | 实现模块；入口/导出：registerImportRoutes |
| [ledger.ts](ledger.ts) | 实现模块；入口/导出：LedgerRouteOptions、registerLedgerRoutes |
| [ledgerImport.ts](ledgerImport.ts) | 实现模块；入口/导出：ResolvedTaxonomy、importRefFor、assertSourceIsSelfConsistent、assertTaxonomyCoverage、resolveTaxonomy |
| [ledgerImportJobs.ts](ledgerImportJobs.ts) | 实现模块；入口/导出：LedgerImportJobRouteOptions、registerLedgerImportJobRoutes |
| [lifecycle.ts](lifecycle.ts) | 实现模块；入口/导出：LifecycleRouteOptions、registerLifecycleRoutes |
| [notDuplicateRelations.ts](notDuplicateRelations.ts) | 实现模块；入口/导出：NotDuplicateRelationRouteOptions、registerNotDuplicateRelationRoutes |
| [notifications.ts](notifications.ts) | 实现模块；入口/导出：NotificationsRouteOptions、registerNotificationRoutes |
| [p0-operation.ts](p0-operation.ts) | 实现模块；入口/导出：idempotencyKeyOf、beginP0Operation、runP0Operation |
| [recognize.ts](recognize.ts) | 实现模块；入口/导出：registerRecognizeRoutes |
| [share.ts](share.ts) | 实现模块；入口/导出：ShareRouteOptions、registerShareRoutes |
| [stats.ts](stats.ts) | 实现模块；入口/导出：registerStatsRoutes |
| [storageAdmin.ts](storageAdmin.ts) | 实现模块；入口/导出：registerStorageAdminRoutes |
| [transactions.ts](transactions.ts) | 实现模块；入口/导出：TransactionRouteOptions、registerTransactionRoutes |
| [voice.ts](voice.ts) | 实现模块；入口/导出：registerVoiceRoutes |
| [workbench.ts](workbench.ts) | 实现模块；入口/导出：registerWorkbenchRoutes |
<!-- directory-index:end -->
