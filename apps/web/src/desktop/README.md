# apps/web/src/desktop · 阅读入口

电脑端外壳与键鼠交互；遵循 desktop-ui skill。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [DashboardGrid.tsx](DashboardGrid.tsx) | 界面模块；入口/导出：DashboardGrid |
| [DashboardMessages.test.tsx](DashboardMessages.test.tsx) | 测试：DashboardMessages |
| [DashboardMessages.tsx](DashboardMessages.tsx) | 界面模块；入口/导出：DashboardMessages |
| [DesktopBookPage.tsx](DesktopBookPage.tsx) | 界面模块；入口/导出：DesktopBookPage |
| [DesktopCollabPage.tsx](DesktopCollabPage.tsx) | 界面模块；入口/导出：DesktopCollabPage |
| [DesktopDashboardPage.tsx](DesktopDashboardPage.tsx) | 界面模块；入口/导出：DesktopDashboardPage |
| [DesktopEntriesPage.tsx](DesktopEntriesPage.tsx) | 界面模块；入口/导出：ENTRY_PARAM、DesktopEntriesPage |
| [DesktopFrames.tsx](DesktopFrames.tsx) | 界面模块；入口/导出：DesktopTabPage、DesktopInnerPage、DesktopTabHeader、DesktopActionBar |
| [DesktopLedgerParts.tsx](DesktopLedgerParts.tsx) | 界面模块；入口/导出：DesktopMembers、DesktopMemberManagement、DesktopHistory |
| [DesktopNav.tsx](DesktopNav.tsx) | 界面模块；入口/导出：DesktopNavItem、navIdFor、desktopEntryDisabled、DesktopNav、pathAfterSwitch |
| [DesktopPopover.tsx](DesktopPopover.tsx) | 界面模块；入口/导出：PopoverPlacement、popoverPosition、DesktopPopover、moveFocusInList |
| [DesktopSection.tsx](DesktopSection.tsx) | 界面模块；入口/导出：DesktopSection |
| [DesktopShell.tsx](DesktopShell.tsx) | 界面模块；入口/导出：DesktopShell |
| [DesktopSplit.tsx](DesktopSplit.tsx) | 界面模块；入口/导出：useElementWidth、DesktopSplit |
| [DesktopStatsPage.tsx](DesktopStatsPage.tsx) | 界面模块；入口/导出：STATS_CARD_PARAM、DesktopStatsPage |
| [DesktopToolbar.tsx](DesktopToolbar.tsx) | 界面模块；入口/导出：DesktopToolbar |
| [dashboardActivation.test.tsx](dashboardActivation.test.tsx) | 测试：dashboardActivation |
| [dashboardModel.ts](dashboardModel.ts) | 实现模块；入口/导出：CardSize、CardKind、LedgerMetric、DashboardCard、DashboardConfig |
| [dashboardNavigation.ts](dashboardNavigation.ts) | 实现模块；入口/导出：dashboardAnalysisCard、dashboardDestination |
| [desktop.css](desktop.css) | 样式与变量 |
| [desktopDetailLayout.test.tsx](desktopDetailLayout.test.tsx) | 测试：desktopDetailLayout |
| [desktopModel.test.ts](desktopModel.test.ts) | 测试：desktopModel |
| [desktopNav.test.tsx](desktopNav.test.tsx) | 测试：desktopNav |
| [desktopPages.test.tsx](desktopPages.test.tsx) | 测试：desktopPages |
| [desktopRedesign.test.ts](desktopRedesign.test.ts) | 测试：desktopRedesign |
| [entriesView.ts](entriesView.ts) | 实现模块；入口/导出：EntryKindFilter、entryMatches、DayGroup、groupByDay、dailyTotals |
| [icons.tsx](icons.tsx) | 界面模块；入口/导出：DashboardIcon、SearchIcon、RefreshIcon、SelectIcon、SignOutIcon |
| [landing.ts](landing.ts) | 实现模块；入口/导出：shouldLandOnDashboard、readTabVisited、markTabVisited |
| [sections.ts](sections.ts) | 实现模块；入口/导出：DesktopSection、sectionFor、SettingsItemId、SettingsItem、settingsItems |
| [shellKind.ts](shellKind.ts) | 实现模块；入口/导出：ShellKind、ShellOverride、DESKTOP_ENTER_WIDTH、DESKTOP_EXIT_WIDTH、DESKTOP_MIN_HEIGHT |
| [split.ts](split.ts) | 实现模块；入口/导出：PANEL_DEFAULT、PANEL_MIN、PANEL_MAX、MIN_MAIN、PANEL_WIDTH_KEY |
| [surface.tsx](surface.tsx) | 界面模块；入口/导出：DesktopSurfaceKind、DesktopBar、DesktopSurface、useDesktopSurface、useDesktopActive |
| [useShellKind.ts](useShellKind.ts) | 实现模块；入口/导出：useShellKind |
<!-- directory-index:end -->
