# apps/web/src/i18n/content · 阅读入口

本层组织 content 模块的直属文件；具体契约由任务索引定位。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [announcements.test.ts](announcements.test.ts) | 测试：announcements |
| [index.ts](index.ts) | 实现模块；入口/导出：sameAnnouncementShape、localizeUpdateAnnouncement、localizeMajorAnnouncement |
| [majorAnnouncements.en.ts](majorAnnouncements.en.ts) | 实现模块；入口/导出：MAJOR_ANNOUNCEMENTS_EN |
| [types.ts](types.ts) | 实现模块；入口/导出：AnnouncementSectionText、UpdateAnnouncementText、MajorAnnouncementText |
| [updateAnnouncements.en.ts](updateAnnouncements.en.ts) | 实现模块；入口/导出：UPDATE_ANNOUNCEMENTS_EN |
<!-- directory-index:end -->
