# apps/api/src/auth · 阅读入口

身份认证。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [guard.ts](guard.ts) | 实现模块；入口/导出：createRequireAuth、createRequireBook |
| [invite-code.ts](invite-code.ts) | 实现模块；入口/导出：generateInviteCode |
| [invites.ts](invites.ts) | 实现模块；入口/导出：InviteClient、CreatedInvite、createOrdinaryInvite、createAdminInvite、createReservedInvite |
| [login-throttle.ts](login-throttle.ts) | 实现模块；入口/导出：LoginThrottleOptions、LoginThrottle |
| [password.ts](password.ts) | 实现模块；入口/导出：hashPassword、verifyPassword、getDummyHash |
| [recovery-code.ts](recovery-code.ts) | 实现模块；入口/导出：randomCrockford、generateRecoveryCode、ACCOUNT_NUMBER_DIGITS、ACCOUNT_NUMBER_FIRST、ACCOUNT_NUMBER_COUNTER_START |
| [session.ts](session.ts) | 实现模块；入口/导出：SESSION_COOKIE_NAME、SESSION_TTL_MS、generateSessionToken、hashSessionToken、sessionExpiryFrom |
<!-- directory-index:end -->
