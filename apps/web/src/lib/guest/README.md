# apps/web/src/lib/guest · 阅读入口

本层组织 guest 模块的直属文件；具体契约由任务索引定位。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [blob.ts](blob.ts) | 实现模块；入口/导出：GUEST_DATA_SCHEMA_VERSION、GuestData、newGuestEntityId、seedGuestData、isRecognisedGuestBlob |
| [bridge.ts](bridge.ts) | 实现模块；入口/导出：publishGuestSnapshot、guestReadTransactions、guestBookIdSync、requireGuestId |
| [cleanup.ts](cleanup.ts) | 实现模块；入口/导出：ClearGuestDataResult、clearGuestData、clearAllDeviceData |
| [data.books.test.ts](data.books.test.ts) | 测试：data.books |
| [data.test.ts](data.test.ts) | 测试：data |
| [data.ts](data.ts) | 实现模块；入口/导出：guestDataValue、guestWorkspaceValue、loadedGuestBookId、subscribeGuestData、resetGuestDataCache |
| [fx.test.ts](fx.test.ts) | 测试：fx |
| [fx.ts](fx.ts) | 实现模块；入口/导出：GUEST_FX_KEY_NAME、GUEST_FX_PATH、guestFxKey、createGuestFxRepository、createGuestFxProvider |
| [guestPreferences.test.ts](guestPreferences.test.ts) | 测试：guestPreferences |
| [identity.test.ts](identity.test.ts) | 测试：identity |
| [identity.ts](identity.ts) | 实现模块；入口/导出：GUEST_IDENTITY_STORAGE_KEY、GUEST_IDENTITY_SCHEMA_VERSION、GuestIdentity、GuestIdentityPatch、GuestIdentityStorage |
| [ledger.test.ts](ledger.test.ts) | 测试：ledger |
| [ledger.ts](ledger.ts) | 实现模块；入口/导出：GUEST_LEDGER_SCHEMA_VERSION、GuestLedger、DEFAULT_GUEST_LEDGER_NAME、DEFAULT_GUEST_CURRENCY、GUEST_LEDGER_NAME_MAX |
| [memoryBackend.ts](memoryBackend.ts) | 实现模块；入口/导出：MemoryGuestBackend、createMemoryGuestBackend |
| [multiLedgerWiring.test.ts](multiLedgerWiring.test.ts) | 测试：multiLedgerWiring |
| [notDuplicate.test.ts](notDuplicate.test.ts) | 测试：notDuplicate |
| [notDuplicate.ts](notDuplicate.ts) | 实现模块；入口/导出：listGuestNotDuplicateRelations、createGuestNotDuplicateRelations、revokeGuestNotDuplicateRelation |
| [runtime.ts](runtime.ts) | 实现模块；入口/导出：setGuestRuntimeId、guestRuntimeId、isGuestRuntime、installGuestWriteListener、notifyGuestWrite |
| [session.ts](session.ts) | 实现模块；入口/导出：useGuestIdentity、useGuestMode、DataModeSync |
| [storage.ts](storage.ts) | 实现模块；入口/导出：GUEST_DATABASE、hasGuestIndexedDb、GuestStorageBackend、setGuestStorageBackendForTests、GuestReadResult |
| [workspace.test.ts](workspace.test.ts) | 测试：workspace |
| [workspace.ts](workspace.ts) | 实现模块；入口/导出：GUEST_LAYOUT_VERSION、guestLegacyDataKey、guestBookDataKey、guestLegacyNotDuplicateKey、guestBookNotDuplicateKey |
<!-- directory-index:end -->
