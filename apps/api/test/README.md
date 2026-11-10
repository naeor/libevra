# apps/api/test · 阅读入口

服务测试。

优先阅读[任务索引](../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [admin.test.ts](admin.test.ts) | 测试：admin |
| [adminConsole.test.ts](adminConsole.test.ts) | 测试：adminConsole |
| [adminRangeParity.test.ts](adminRangeParity.test.ts) | 测试：adminRangeParity |
| [analytics.test.ts](analytics.test.ts) | 测试：analytics |
| [attachments.test.ts](attachments.test.ts) | 测试：attachments |
| [auth.test.ts](auth.test.ts) | 测试：auth |
| [avatarRewards.test.ts](avatarRewards.test.ts) | 测试：avatarRewards |
| [billImportParsers.test.ts](billImportParsers.test.ts) | 测试：billImportParsers |
| [billImportReviewFixes.test.ts](billImportReviewFixes.test.ts) | 测试：billImportReviewFixes |
| [billImportRoutes.test.ts](billImportRoutes.test.ts) | 测试：billImportRoutes |
| [books.test.ts](books.test.ts) | 测试：books |
| [categoryHierarchy.test.ts](categoryHierarchy.test.ts) | 测试：categoryHierarchy |
| [classification.test.ts](classification.test.ts) | 测试：classification |
| [conflict-protocol.test.ts](conflict-protocol.test.ts) | 测试：conflict-protocol |
| [conflicts.test.ts](conflicts.test.ts) | 测试：conflicts |
| [consent.test.ts](consent.test.ts) | 测试：consent |
| [criticalCapacity.test.ts](criticalCapacity.test.ts) | 测试：criticalCapacity |
| [criticalCheckpointShell.test.ts](criticalCheckpointShell.test.ts) | 测试：criticalCheckpointShell |
| [criticalCompatibility.test.ts](criticalCompatibility.test.ts) | 测试：criticalCompatibility |
| [criticalEvents.test.ts](criticalEvents.test.ts) | 测试：criticalEvents |
| [criticalFullRestore.test.ts](criticalFullRestore.test.ts) | 测试：criticalFullRestore |
| [criticalHighRiskRoutes.test.ts](criticalHighRiskRoutes.test.ts) | 测试：criticalHighRiskRoutes |
| [criticalKeyring.test.ts](criticalKeyring.test.ts) | 测试：criticalKeyring |
| [criticalRelayLatency.test.ts](criticalRelayLatency.test.ts) | 测试：criticalRelayLatency |
| [criticalStatus.test.ts](criticalStatus.test.ts) | 测试：criticalStatus |
| [csvImportAtomicity.test.ts](csvImportAtomicity.test.ts) | 测试：csvImportAtomicity |
| [defaultBookName.test.ts](defaultBookName.test.ts) | 测试：defaultBookName |
| [detailCards.test.ts](detailCards.test.ts) | 测试：detailCards |
| [directory.test.ts](directory.test.ts) | 测试：directory |
| [duplicateReview.test.ts](duplicateReview.test.ts) | 测试：duplicateReview |
| [entrySeq.test.ts](entrySeq.test.ts) | 测试：entrySeq |
| [export-file.test.ts](export-file.test.ts) | 测试：export-file |
| [export.test.ts](export.test.ts) | 测试：export |
| [fxIntegration.test.ts](fxIntegration.test.ts) | 测试：fxIntegration |
| [health.test.ts](health.test.ts) | 测试：health |
| [history.test.ts](history.test.ts) | 测试：history |
| [historyApi.test.ts](historyApi.test.ts) | 测试：historyApi |
| [historyCopy.test.ts](historyCopy.test.ts) | 测试：historyCopy |
| [ledger.test.ts](ledger.test.ts) | 测试：ledger |
| [ledgerImport.test.ts](ledgerImport.test.ts) | 测试：ledgerImport |
| [ledgerImportCleanup.test.ts](ledgerImportCleanup.test.ts) | 测试：ledgerImportCleanup |
| [ledgerImportD4.test.ts](ledgerImportD4.test.ts) | 测试：ledgerImportD4 |
| [ledgerImportD5.test.ts](ledgerImportD5.test.ts) | 测试：ledgerImportD5 |
| [ledgerImportIncremental.test.ts](ledgerImportIncremental.test.ts) | 测试：ledgerImportIncremental |
| [ledgerImportLegacyEntry.test.ts](ledgerImportLegacyEntry.test.ts) | 测试：ledgerImportLegacyEntry |
| [ledgerImportPhase4.test.ts](ledgerImportPhase4.test.ts) | 测试：ledgerImportPhase4 |
| [lifecycle.test.ts](lifecycle.test.ts) | 测试：lifecycle |
| [members.test.ts](members.test.ts) | 测试：members |
| [messages.test.ts](messages.test.ts) | 测试：messages |
| [notDuplicateRelations.test.ts](notDuplicateRelations.test.ts) | 测试：notDuplicateRelations |
| [ocrClient.test.ts](ocrClient.test.ts) | 测试：ocrClient |
| [permissions.test.ts](permissions.test.ts) | 测试：permissions |
| [profile.test.ts](profile.test.ts) | 测试：profile |
| [quota.test.ts](quota.test.ts) | 测试：quota |
| [recognize.test.ts](recognize.test.ts) | 测试：recognize |
| [referral.test.ts](referral.test.ts) | 测试：referral |
| [rename.test.ts](rename.test.ts) | 测试：rename |
| [roleTiers.test.ts](roleTiers.test.ts) | 测试：roleTiers |
| [setup.ts](setup.ts) | 实现模块；入口/导出：assertTestDatabase |
| [share.test.ts](share.test.ts) | 测试：share |
| [stats.test.ts](stats.test.ts) | 测试：stats |
| [support.ts](support.ts) | 实现模块；入口/导出：prisma、makeApp、testCriticalRuntime、cookieFrom、resetDatabase |
| [voice.test.ts](voice.test.ts) | 测试：voice |
| [voiceClient.test.ts](voiceClient.test.ts) | 测试：voiceClient |
| [workbench.test.ts](workbench.test.ts) | 测试：workbench |

| 子目录 | 职责 |
|---|---|
| [python/](python/README.md) | 本层组织 python 模块的直属文件；具体契约由任务索引定位。 |
<!-- directory-index:end -->
