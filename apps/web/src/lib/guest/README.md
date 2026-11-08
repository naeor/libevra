# apps/web/src/lib/guest · 阅读入口

本层组织 guest 模块的直属文件；具体契约由任务索引定位。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [bridge.ts](bridge.ts) | 实现模块；入口/导出：publishGuestSnapshot、guestReadTransactions、guestBookIdSync、requireGuestId |
| [cleanup.ts](cleanup.ts) | 实现模块；入口/导出：ClearGuestDataResult、clearGuestData、clearAllDeviceData |
| [data.test.ts](data.test.ts) | 测试：data |
| [data.ts](data.ts) | 实现模块；入口/导出：GUEST_DATA_SCHEMA_VERSION、GuestData、guestDataValue、subscribeGuestData、resetGuestDataCache |
| [identity.test.ts](identity.test.ts) | 测试：identity |
| [identity.ts](identity.ts) | 实现模块；入口/导出：GUEST_IDENTITY_STORAGE_KEY、GUEST_IDENTITY_SCHEMA_VERSION、GuestIdentity、GuestIdentityPatch、GuestIdentityStorage |
| [ledger.test.ts](ledger.test.ts) | 测试：ledger |
| [ledger.ts](ledger.ts) | 实现模块；入口/导出：GUEST_LEDGER_SCHEMA_VERSION、GuestLedger、DEFAULT_GUEST_LEDGER_NAME、DEFAULT_GUEST_CURRENCY、guestLedgersKey |
| [runtime.ts](runtime.ts) | 实现模块；入口/导出：setGuestRuntimeId、guestRuntimeId、isGuestRuntime、installGuestWriteListener、notifyGuestWrite |
| [session.ts](session.ts) | 实现模块；入口/导出：useGuestIdentity、useGuestMode、DataModeSync |
| [storage.ts](storage.ts) | 实现模块；入口/导出：GUEST_DATABASE、hasGuestIndexedDb、readGuestValue、writeGuestValue、clearGuestDatabase |
<!-- directory-index:end -->
