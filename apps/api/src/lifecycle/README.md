# apps/api/src/lifecycle · 阅读入口

生命周期与删除恢复。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [account.ts](account.ts) | 实现模块；入口/导出：CloseMethod、BookDecisionAction、BookDecisionInput、AccountBookOption、AccountLifecycleView |
| [book.ts](book.ts) | 实现模块；入口/导出：BookLifecycleSummary、ArchiveBookResult、PurgeBookResult、getBookLifecycle、leaveBookSafely |
| [constants.ts](constants.ts) | 实现模块；入口/导出：SELF_RESTORE_DAYS、ARCHIVE_RETENTION_DAYS、RECOVERY_REQUEST_DAYS、PURGE_SCHEDULE_NOTE、addDays |
| [events.ts](events.ts) | 实现模块；入口/导出：LifecycleEventKind、LifecycleActor、recordLifecycleEvent、generateRecoveryCredential、hashRecoveryCredential |
<!-- directory-index:end -->
