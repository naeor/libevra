# apps/api/src/critical · 阅读入口

关键事件、回执、登记簿与恢复保护。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [apply.ts](apply.ts) | 实现模块；入口/导出：SafeRestoreReport、SafeRestoreBoundary、applySafeRestore |
| [canonical.ts](canonical.ts) | 实现模块；入口/导出：canonicalJson、sha256Hex |
| [checkpoint.ts](checkpoint.ts) | 实现模块；入口/导出：BackupCheckpoint、CheckpointedBackup、CreateCheckpointedBackupOptions、createCheckpointedBackup、checkpointHmacMaterial |
| [confirm.ts](confirm.ts) | 实现模块；入口/导出：confirmP0 |
| [operations.ts](operations.ts) | 实现模块；入口/导出：OperationStatus、StartedOperation、OperationAlreadyStartedError、PublicOperation、startCriticalOperation |
| [preview.ts](preview.ts) | 实现模块；入口/导出：RestorePreviewEvent、RestorePreview、previewSafeRestore |
| [remote-config.ts](remote-config.ts) | 实现模块；入口/导出：createRelayRemoteFromEnv |
| [remote-cos.ts](remote-cos.ts) | 实现模块；入口/导出：CosConfig、CosCriticalRemote |
| [remote.ts](remote.ts) | 实现模块；入口/导出：RemotePutResult、RemoteHeadResult、CriticalRemote、RemoteObjectExistsError、FileSystemCriticalRemote |
| [runtime-config.ts](runtime-config.ts) | 实现模块；入口/导出：createRuntimeFromEnv、installRuntimeForTests |
| [runtime.ts](runtime.ts) | 实现模块；入口/导出：CriticalEventPersistenceError、CriticalRuntime、configureCriticalEvents、getCriticalRuntime、flushPendingCriticalEvents |
| [status.ts](status.ts) | 实现模块；入口/导出：ProtectionStatus、getProtectionStatus |
| [store.ts](store.ts) | 实现模块；入口/导出：AppendedCriticalEvent、recordCriticalEvent、hashCore、coreFromRow |
| [types.ts](types.ts) | 实现模块；入口/导出：CRITICAL_EVENT_TYPES、CriticalEventType、CriticalSeverity、severityOf、CriticalActor |
<!-- directory-index:end -->
