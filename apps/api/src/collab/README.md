# apps/api/src/collab · 阅读入口

协作与共享。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [directory.ts](directory.ts) | 实现模块；入口/导出：FoundAccount、findByAccountNumber、findByUsername |
| [members.ts](members.ts) | 实现模块；入口/导出：MemberRole、MemberView、listMembers、changeMemberRole、removeMember |
| [notify.ts](notify.ts) | 实现模块；入口/导出：NOTIFICATION_TTL_MS、NotificationKind、NotificationPayload、sendNotification、withdrawNotification |
| [quota.ts](quota.ts) | 实现模块；入口/导出：PER_SUBJECT_DAILY_LIMIT、TOTAL_DAILY_LIMIT、isQuotaExempt、QuotaRefusal、QuotaReservation |
| [referral.ts](referral.ts) | 实现模块；入口/导出：REFERRAL_REMINDER_TTL_MS、REFERRAL_CODE_LIFETIME_LIMIT、MintedReferral、mintReferralCode、recordReferral |
| [respond.ts](respond.ts) | 实现模块；入口/导出：Decision、DecisionResult、decideNotification |
| [share.ts](share.ts) | 实现模块；入口/导出：SHARE_LINK_MIN_DAYS、SHARE_LINK_MAX_DAYS、SHARE_LINK_MIN_USES、SHARE_LINK_MAX_USES、ShareLinkView |
<!-- directory-index:end -->
