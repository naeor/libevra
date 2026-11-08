# apps/web/src/workspace · 阅读入口

工作区、面板路由、返回栈与布局。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [CurrentLedgerOnly.tsx](CurrentLedgerOnly.tsx) | 界面模块；入口/导出：CurrentLedgerOnly |
| [GlobalRail.tsx](GlobalRail.tsx) | 界面模块；入口/导出：GlobalRail、PortraitSecondaryRail、AddEntryButton |
| [PaneRouter.tsx](PaneRouter.tsx) | 界面模块；入口/导出：PaneRouter |
| [PortraitSecondaryRail.test.tsx](PortraitSecondaryRail.test.tsx) | 测试：PortraitSecondaryRail |
| [RailEntryMenu.test.tsx](RailEntryMenu.test.tsx) | 测试：RailEntryMenu |
| [RailEntryMenu.tsx](RailEntryMenu.tsx) | 界面模块；入口/导出：EntryMethodList、FollowEntryChooser |
| [RailTip.tsx](RailTip.tsx) | 界面模块；入口/导出：TIP_DELAY_MS、TIP_SKIP_MS、TIP_GRACE_MS、tipDelay、RailTipBinding |
| [SecondaryNav.tsx](SecondaryNav.tsx) | 界面模块；入口/导出：DestinationIcon、DestinationItem、useDestinations、SecondaryFab、SecondaryNavPanel |
| [ShellControls.tsx](ShellControls.tsx) | 界面模块；入口/导出：ResizeController、Divider、ModeCapsule、RestoreTab、SplitHint |
| [WorkspaceShell.tsx](WorkspaceShell.tsx) | 界面模块；入口/导出：WorkspaceShell |
| [context.tsx](context.tsx) | 界面模块；入口/导出：PaneRole、NavChrome、PaneSplit、PaneSizeClass、PaneInfo |
| [entryLedgers.test.ts](entryLedgers.test.ts) | 测试：entryLedgers |
| [entryLedgers.ts](entryLedgers.ts) | 实现模块；入口/导出：EntryLedgers、entryKey、withoutInstance、parseEntryLedgers、pruneEntryLedgers |
| [entryMenu.test.ts](entryMenu.test.ts) | 测试：entryMenu |
| [entryMenu.ts](entryMenu.ts) | 实现模块；入口/导出：EntryNavigate、entrySourceLedger、entryMenuPosition、entryTarget、isEntryFlowPath |
| [follow.test.ts](follow.test.ts) | 测试：follow |
| [follow.ts](follow.ts) | 实现模块；入口/导出：followTargetFor、followsToSecondary、isFollowDetail、Destination、destinationOf |
| [geometry.test.ts](geometry.test.ts) | 测试：geometry |
| [geometry.ts](geometry.ts) | 实现模块；入口/导出：ShellMode、Orientation、CollapseSide、Rect、RAIL_FULL |
| [icons.tsx](icons.tsx) | 界面模块；入口/导出：SidebarIcon、SplitIcon、MenuIcon、BackIcon、XIcon |
| [model.test.ts](model.test.ts) | 测试：model |
| [model.ts](model.ts) | 实现模块；入口/导出：InstanceId、FollowMode、RailPreference、PaneLedgers、WorkspaceState |
| [navDrag.test.ts](navDrag.test.ts) | 测试：navDrag |
| [navDrag.ts](navDrag.ts) | 实现模块；入口/导出：DropTarget、DragPayload、secondaryModeForDrag、NavDragSnapshot、DropZone |
| [openDrag.test.ts](openDrag.test.ts) | 测试：openDrag |
| [openDrag.tsx](openDrag.tsx) | 界面模块；入口/导出：LONG_PRESS_MS、DRAG_SLOP、isLedgerScopedPath、isOpenablePath、OpenDragOptions |
| [paneHistory.test.ts](paneHistory.test.ts) | 测试：paneHistory |
| [paneHistory.ts](paneHistory.ts) | 实现模块；入口/导出：PaneAction、PaneEntry、PaneSnapshot、PaneNavigation、PaneInterceptor |
| [paneTitle.ts](paneTitle.ts) | 实现模块；入口/导出：PageKey、START_PATH、pageKeyFor、usePaneIdentity |
| [workspace.css](workspace.css) | 样式与变量 |
<!-- directory-index:end -->
