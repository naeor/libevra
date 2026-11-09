# apps/web/src/statsWorkbench · 阅读入口

> 最后修改：2026-11-08 23:23（UTC+08:00）

分析工作台配置、编辑器、布局与卡片接线。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [CardEditor.tsx](CardEditor.tsx) | 界面模块；入口/导出：CardEditorProps、CardEditor |
| [CompositeCard.tsx](CompositeCard.tsx) | 界面模块；入口/导出：CompositeSlotView、useCompositeSlots、CompositeBody、CompositeDetail |
| [Drawer.tsx](Drawer.tsx) | 界面模块；入口/导出：DrawerHeight、ContainerScopeView、Drawer |
| [ExchangePanel.tsx](ExchangePanel.tsx) | 界面模块；入口/导出：ExchangePanel |
| [FilterPanel.tsx](FilterPanel.tsx) | 界面模块；入口/导出：FilterOption、timeLabel、FilterPanel |
| [FxStatus.tsx](FxStatus.tsx) | 界面模块；入口/导出：FxStatus |
| [Grid.tsx](Grid.tsx) | 界面模块；入口/导出：GRID_GAP、autoColumnsFor、columnLimitFor、displayFor、GridTrack |
| [HierarchyView.tsx](HierarchyView.tsx) | 界面模块；入口/导出：HierarchyView |
| [PresetSheet.tsx](PresetSheet.tsx) | 界面模块；入口/导出：PresetSheet |
| [Sheets.tsx](Sheets.tsx) | 界面模块；入口/导出：SheetHeader、MenuAction、ObjectMenuSheet、SizeSheet、LayoutArrangement |
| [SourceEntries.test.ts](SourceEntries.test.ts) | 测试：SourceEntries |
| [SourceEntries.tsx](SourceEntries.tsx) | 界面模块；入口/导出：sourceEntriesFor、SourceEntries |
| [StatsControls.tsx](StatsControls.tsx) | 界面模块；入口/导出：statusNotice、StatBar、StatsSettingsSheet |
| [SyncBridge.tsx](SyncBridge.tsx) | 界面模块；入口/导出：WorkbenchSyncBridge、useWorkspaceSync |
| [SyncControls.tsx](SyncControls.tsx) | 界面模块；入口/导出：SyncControls |
| [advancedCards.test.tsx](advancedCards.test.tsx) | 测试：advancedCards |
| [advancedCards.tsx](advancedCards.tsx) | 界面模块；入口/导出：ADVANCED_CARD_IDS、AdvancedCardProps、AdvancedCardView |
| [cAnalyses.ts](cAnalyses.ts) | 实现模块；入口/导出：toRecords、inRange、fraction、ratio、roundRational |
| [cCards.test.tsx](cCards.test.tsx) | 测试：cCards |
| [cCards.tsx](cCards.tsx) | 界面模块；入口/导出：C_CARD_IDS、CCardProps、CNumber、CCardView |
| [cards.test.tsx](cards.test.tsx) | 测试：cards |
| [cards.tsx](cards.tsx) | 界面模块；入口/导出：CardBodyProps、displayCard、cardRange、familyOf、CardErrorBoundary |
| [carouselGesture.test.ts](carouselGesture.test.ts) | 测试：carouselGesture |
| [carouselGesture.ts](carouselGesture.ts) | 实现模块；入口/导出：SWIPE_SLOP、SWIPE_AXIS_RATIO、SWIPE_COMMIT、SwipeAxis、swipeAxis |
| [catalog.ts](catalog.ts) | 实现模块；入口/导出：ChartFamily、FORMAL_CHART_FAMILIES、formalChartFamily、CardGroup、CardType |
| [columns.ts](columns.ts) | 实现模块；入口/导出：ColumnPreference、columnPreferenceKey、readColumnPreference、writeColumnPreference、effectiveColumns |
| [compositeCards.test.tsx](compositeCards.test.tsx) | 测试：compositeCards |
| [composition.test.ts](composition.test.ts) | 测试：composition |
| [composition.ts](composition.ts) | 实现模块；入口/导出：COMPOSITION_VERSION、MAX_SLOTS、MAX_NUMBER_SLOTS、MAX_CHART_SLOTS、SlotKind |
| [compute.ts](compute.ts) | 实现模块；入口/导出：mergedEntries、liveEntries、entriesInCurrency、currenciesUsed、statsFor |
| [configEvents.ts](configEvents.ts) | 实现模块；入口/导出：WORKBENCH_CHANGED、WORKBENCH_INSTALLED、notifyWorkbenchChange |
| [customCards.test.tsx](customCards.test.tsx) | 测试：customCards |
| [customCards.ts](customCards.ts) | 实现模块；入口/导出：CUSTOM_CARD_TYPES、isSelectableAnalysis、CUSTOM_NAME_MAX、CompositeDraft、DraftProblem |
| [defaults.ts](defaults.ts) | 实现模块；入口/导出：newObjectId、newCard、defaultWorkbench、legacyDefaultWorkbench |
| [dnd.ts](dnd.ts) | 实现模块；入口/导出：DragPayload、DragState、DragController、useDragController、cellAt |
| [drawerGesture.test.ts](drawerGesture.test.ts) | 测试：drawerGesture |
| [drawerGesture.ts](drawerGesture.ts) | 实现模块；入口/导出：DRAG_SLOP、MIN_TRAVEL、DrawerEnd、releaseTarget、travelFor |
| [drawerLayout.test.tsx](drawerLayout.test.tsx) | 测试：drawerLayout |
| [drawerLayout.ts](drawerLayout.ts) | 实现模块；入口/导出：DrawerMode、drawerModeFor、drawerGeometry |
| [editOrigins.test.ts](editOrigins.test.ts) | 测试：editOrigins |
| [editOrigins.ts](editOrigins.ts) | 实现模块；入口/导出：EditOrigins |
| [exchange.ts](exchange.ts) | 实现模块；入口/导出：ExchangeEntry、ImportEntry、compatibilityProblems、portableEntry、exportWorkspaceFile |
| [filters.css](filters.css) | 样式与变量 |
| [filters.dimensions.test.tsx](filters.dimensions.test.tsx) | 测试：filters.dimensions |
| [filters.phase2.test.tsx](filters.phase2.test.tsx) | 测试：filters.phase2 |
| [filters.ts](filters.ts) | 实现模块；入口/导出：TimeChoice、WorkbenchFilters、WorkbenchFilterIds、MAX_FILTER_IDS、DEFAULT_TIME |
| [fxCards.test.tsx](fxCards.test.tsx) | 测试：fxCards |
| [fxFixture.ts](fxFixture.ts) | 实现模块；入口/导出：TODAY、RANGE、MIXED_ENTRIES、HAND_CONVERTED、PREVIOUS_ENTRIES |
| [fxPolicy.ts](fxPolicy.ts) | 实现模块；入口/导出：FxCardClass、FxCardPolicy、FX_CARD_POLICIES、fxPolicyFor |
| [fxProjection.test.ts](fxProjection.test.ts) | 测试：fxProjection |
| [fxProjection.ts](fxProjection.ts) | 实现模块；入口/导出：FxKindScope、FxMissingReason、FxMissingRecord、FxMissingSummary、FxProjection |
| [fxTestSupport.ts](fxTestSupport.ts) | 实现模块；入口/导出：FX_TEST_RATES、lookupFor、FxViewOptions、buildFxView、tx |
| [hierarchy.test.tsx](hierarchy.test.tsx) | 测试：hierarchy |
| [ledgerFilterBridge.test.ts](ledgerFilterBridge.test.ts) | 测试：ledgerFilterBridge |
| [ledgerFilterBridge.ts](ledgerFilterBridge.ts) | 实现模块；入口/导出：workbenchFromLedgerFilter、ledgerFilterFromWorkbench、takeAnalysisParams、ledgerFilterFromPreset、useAnalysisFilters |
| [metricCatalog.test.ts](metricCatalog.test.ts) | 测试：metricCatalog |
| [metricCatalog.ts](metricCatalog.ts) | 实现模块；入口/导出：DirectorySectionId、DirectorySubgroup、DirectorySection、DIRECTORY、directorySections |
| [presets.test.ts](presets.test.ts) | 测试：presets |
| [presets.ts](presets.ts) | 实现模块；入口/导出：SystemPresetId、SYSTEM_PRESET_IDS、Translate、SystemPresetSpec、SYSTEM_PRESETS |
| [responsiveGrid.test.ts](responsiveGrid.test.ts) | 测试：responsiveGrid |
| [results.test.tsx](results.test.tsx) | 测试：results |
| [results.ts](results.ts) | 实现模块；入口/导出：NativeResultBridge、originalCompleteness、scopeResolvedFilters、fxResultBridge、timeResultBridge |
| [scope.tsx](scope.tsx) | 界面模块；入口/导出：FxRangeView、WorkbenchScope、useWorkbenchScope、WorkbenchScopeProvider、useScope |
| [session.ts](session.ts) | 实现模块；入口/导出：SessionResult、startSession、sessionDocuments、command、geometryOf |
| [slotContext.ts](slotContext.ts) | 实现模块；入口/导出：SlotPresentationContext、useSlotMode、CardSpaceContext、useCardSpace |
| [statsWorkbench.css](statsWorkbench.css) | 样式与变量 |
| [statsWorkbench.test.ts](statsWorkbench.test.ts) | 测试：statsWorkbench |
| [storage.migration.test.ts](storage.migration.test.ts) | 测试：storage.migration |
| [storage.ts](storage.ts) | 实现模块；入口/导出：workbenchStorageKey、WorkbenchDocuments、LoadOutcome、documentsProblems、loadWorkbench |
| [sync.test.ts](sync.test.ts) | 测试：sync |
| [sync.ts](sync.ts) | 实现模块；入口/导出：SyncStatus、SyncSnapshot、syncStorageKey、localConfiguration、SyncTransport |
| [timeWindows.test.ts](timeWindows.test.ts) | 测试：timeWindows |
| [timeWindows.ts](timeWindows.ts) | 实现模块；入口/导出：RELATIVE_WINDOWS、RelativeWindow、isRelativeWindow、cardWindow、withWindow |
| [ui.tsx](ui.tsx) | 界面模块；入口/导出：Density、densityFor、ElementSizeOptions、useElementSize、FitAmount |
<!-- directory-index:end -->
