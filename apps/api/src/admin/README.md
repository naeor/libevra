# apps/api/src/admin · 阅读入口

管理授权与规则。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [accounts.ts](accounts.ts) | 实现模块；入口/导出：AccountActionOptions、AccountActionResult、suspendAccount、restoreAccount |
| [audit.ts](audit.ts) | 实现模块；入口/导出：AuditInput、AuditWriter、recordAudit、AuditLogger、recordRefusal |
| [guard.ts](guard.ts) | 实现模块；入口/导出：AdminActor、AdminDecision、AdminGuardClient、hasActiveAdminGrant、isOnAdminAllowList |
| [invites.ts](invites.ts) | 实现模块；入口/导出：InviteRow、inviteStatus、maskInviteCode、toAdminInvite、loadInvite |
| [reauth.ts](reauth.ts) | 实现模块；入口/导出：ReauthVerifier、createReauthVerifier |
| [roster.ts](roster.ts) | 实现模块；入口/导出：countActiveAdmins、loadAdminRoster |
| [rules.ts](rules.ts) | 实现模块；入口/导出：FIRST_BATCH_ACCOUNT_FIRST、FIRST_BATCH_ACCOUNT_LAST、FIRST_BATCH_SIZE、isFirstBatchAccountNumber、RevocableRecord |
<!-- directory-index:end -->
