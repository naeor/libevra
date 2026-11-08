# apps/web/src/lib/offline · 阅读入口

本地存储、操作队列、离线读写与同步；修改按同步专项验收。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [bookIsolation.test.ts](bookIsolation.test.ts) | 测试：bookIsolation |
| [cache.ts](cache.ts) | 实现模块；入口/导出：CACHE_MAX_AGE_MS、CACHE_KEY、shouldPersistQuery、VOLATILE、cachePersister |
| [cacheMerge.test.ts](cacheMerge.test.ts) | 测试：cacheMerge |
| [cacheResilience.test.ts](cacheResilience.test.ts) | 测试：cacheResilience |
| [conflictChoices.ts](conflictChoices.ts) | 实现模块；入口/导出：ConflictOption、ConflictQuestion、conflictQuestions、applyConflictChoices |
| [conflictFlow.test.ts](conflictFlow.test.ts) | 测试：conflictFlow |
| [connectivity.test.ts](connectivity.test.ts) | 测试：connectivity |
| [connectivity.ts](connectivity.ts) | 实现模块；入口/导出：reportReachability、isAccountOffline、offlineReason、subscribeConnectivity、connectivitySnapshot |
| [dbstatus.ts](dbstatus.ts) | 实现模块；入口/导出：DatabaseReport、databaseReport、QuotaReport、quotaReport |
| [deadline.test.ts](deadline.test.ts) | 测试：deadline |
| [deadline.ts](deadline.ts) | 实现模块；入口/导出：LOCAL_READ_DEADLINE_MS、RaceResult、withDeadline |
| [device.ts](device.ts) | 实现模块；入口/导出：deviceId |
| [diagnostics.ts](diagnostics.ts) | 实现模块；入口/导出：LogEntry、logOffline、readOfflineLog、clearOfflineLog、logTime |
| [downloadManager.test.ts](downloadManager.test.ts) | 测试：downloadManager |
| [downloadManager.ts](downloadManager.ts) | 实现模块；入口/导出：NEVER_DOWNLOAD_KEY、MANAGER_MONTHS、MonthRow、monthLabel、bytesForMonth |
| [fallback.test.ts](fallback.test.ts) | 测试：fallback |
| [fallback.ts](fallback.ts) | 实现模块；入口/导出：LOCAL_FALLBACK_MS、FALLBACK_MARKER、FallbackOptions、meansNoAnswer、withLocalFallback |
| [fill.test.ts](fill.test.ts) | 测试：fill |
| [fill.ts](fill.ts) | 实现模块；入口/导出：DEFAULT_MONTHS_BACK、monthOf、monthsToFetch、isMeteredConnection、OfflineFillStop |
| [fillContext.ts](fillContext.ts) | 实现模块；入口/导出：OfflineFillStatus、OfflineFillContext、useOfflineFillStatus |
| [fillCoverage.test.ts](fillCoverage.test.ts) | 测试：fillCoverage |
| [fillCoverage.ts](fillCoverage.ts) | 实现模块；入口/导出：FILL_MONTH_ENTRY_LIMIT、FILL_PAGE_SIZE、MAX_FILL_PAGES、PageOfEntries、CollectedMonth |
| [fillPagination.test.ts](fillPagination.test.ts) | 测试：fillPagination |
| [forgetMonth.test.ts](forgetMonth.test.ts) | 测试：forgetMonth |
| [fx.test.ts](fx.test.ts) | 测试：fx |
| [fx.ts](fx.ts) | 实现模块；入口/导出：OfflineFxRepository、createOfflineFxService、refillFxDates、OfflineFxCalculator |
| [ledgerMerge.test.ts](ledgerMerge.test.ts) | 测试：ledgerMerge |
| [ledgerOrder.test.ts](ledgerOrder.test.ts) | 测试：ledgerOrder |
| [localCleanup.device.test.ts](localCleanup.device.test.ts) | 测试：localCleanup.device |
| [localCleanup.test.ts](localCleanup.test.ts) | 测试：localCleanup |
| [localCleanup.ts](localCleanup.ts) | 实现模块；入口/导出：clearBookLocalData、clearAccountLocalData |
| [localLedger.analysisRange.test.ts](localLedger.analysisRange.test.ts) | 测试：localLedger.analysisRange |
| [localLedger.test.ts](localLedger.test.ts) | 测试：localLedger |
| [localLedger.ts](localLedger.ts) | 实现模块；入口/导出：transactionsFromCache、transactionsFromCacheCached、readLocalTransactions、ledgerMonthsKey、ledgerMarksKey |
| [localStats.test.ts](localStats.test.ts) | 测试：localStats |
| [localStats.ts](localStats.ts) | 实现模块；入口/导出：StatsRange、summaryFor、monthRange、entriesInRange、totalsFor |
| [merge.test.ts](merge.test.ts) | 测试：merge |
| [merge.ts](merge.ts) | 实现模块；入口/导出：MergeField、FieldConflict、AutomaticPick、MergeResult、FIELD_LABELS |
| [offline.test.ts](offline.test.ts) | 测试：offline |
| [persistence.ts](persistence.ts) | 实现模块；入口/导出：requestPersistentStorage、StorageReport、storageReport、StorageBreakdown、storageBreakdown |
| [reset.ts](reset.ts) | 实现模块；入口/导出：resetEverything、RESET_OFFER_BYTES |
| [scope.test.ts](scope.test.ts) | 测试：scope |
| [scope.ts](scope.ts) | 实现模块；入口/导出：setOfflineAccount、setOfflineBook、setOfflineScope、clearOfflineScope、offlineScope |
| [scopedStorage.test.ts](scopedStorage.test.ts) | 测试：scopedStorage |
| [staleEntries.test.ts](staleEntries.test.ts) | 测试：staleEntries |
| [storage.ts](storage.ts) | 实现模块；入口/导出：TraceLine、readTrace、clearTrace、traceLine、readSnapshot |
| [sync.ts](sync.ts) | 实现模块；入口/导出：retryAbandonedWrites、SyncReport、syncAll、RefusedField |
| [syncController.ts](syncController.ts) | 实现模块；入口/导出：syncNow、startSyncTriggers、pendingCount |
| [syncDelete404.test.ts](syncDelete404.test.ts) | 测试：syncDelete404 |
| [worker.ts](worker.ts) | 实现模块；入口/导出：canRegisterWorker、registerServiceWorker |
| [write.ts](write.ts) | 实现模块；入口/导出：SharedLedgerOfflineReadOnlyError、WriteOutcome、localEntry、republishLedger、installQueryNotifier |
| [writePolicy.test.ts](writePolicy.test.ts) | 测试：writePolicy |
| [writePolicy.ts](writePolicy.ts) | 实现模块；入口/导出：setSharedLedger、isSharedLedger、sharedLedgerSnapshot、subscribeSharedLedger、isSharedLedgerOfflineReadOnly |
<!-- directory-index:end -->
