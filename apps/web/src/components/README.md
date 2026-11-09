# apps/web/src/components · 阅读入口

> 最后修改：2026-11-09 09:27（UTC+08:00）


跨页面共享组件；复用前查 UI 子目录和 Component Gallery。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

`ThemePreview` 是外观面板的只读样例，复用 `OceanBackdrop`、`Card` 和统一主题／壁纸变量，不读写账本数据。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [Alert.tsx](Alert.tsx) | 界面模块；入口/导出：Alert |
| [AttachmentPdf.tsx](AttachmentPdf.tsx) | 界面模块；入口/导出：AttachmentPdf |
| [Attachments.tsx](Attachments.tsx) | 界面模块；入口/导出：AttachmentTransfers、AttachmentPreview、AttachmentPanel、BookAttachmentSummary、AccountStorageSummary |
| [AuthLayout.tsx](AuthLayout.tsx) | 界面模块；入口/导出：AuthLayout |
| [AuthSwitcher.tsx](AuthSwitcher.tsx) | 界面模块；入口/导出：AuthSwitcher |
| [AvatarCreationNoteSheet.tsx](AvatarCreationNoteSheet.tsx) | 界面模块；入口/导出：hasCreationNote、AvatarCreationNoteSheet |
| [AvatarRewardBanner.test.tsx](AvatarRewardBanner.test.tsx) | 测试：AvatarRewardBanner |
| [AvatarRewardBanner.tsx](AvatarRewardBanner.tsx) | 界面模块；入口/导出：AvatarRewardBanner |
| [BookIdentityCard.test.tsx](BookIdentityCard.test.tsx) | 测试：BookIdentityCard |
| [BookManageSheet.tsx](BookManageSheet.tsx) | 界面模块；入口/导出：BookManageSheet |
| [BookNotificationBell.tsx](BookNotificationBell.tsx) | 界面模块；入口/导出：BookNotificationBell |
| [BookSwitcherSheet.tsx](BookSwitcherSheet.tsx) | 界面模块；入口/导出：BookSwitcherPurpose、BookSwitcherSheet、BookIdentityCard |
| [BottomNav.test.tsx](BottomNav.test.tsx) | 测试：BottomNav |
| [BottomNav.tsx](BottomNav.tsx) | 界面模块；入口/导出：ListIcon、ChartIcon、PeopleIcon、PersonIcon、PlusIcon |
| [BottomSheet.test.tsx](BottomSheet.test.tsx) | 测试：BottomSheet |
| [BottomSheet.tsx](BottomSheet.tsx) | 界面模块；入口/导出：BottomSheet |
| [BrandMark.tsx](BrandMark.tsx) | 界面模块；入口/导出：BrandMark |
| [Button.tsx](Button.tsx) | 界面模块；入口/导出：Button |
| [Card.tsx](Card.tsx) | 界面模块；入口/导出：Card、ActionCard |
| [CategoryPicker.tsx](CategoryPicker.tsx) | 界面模块；入口/导出：CategoryPicker |
| [CategoryTreeList.tsx](CategoryTreeList.tsx) | 界面模块；入口/导出：CategoryTreeList |
| [ChoiceDialog.test.tsx](ChoiceDialog.test.tsx) | 测试：ChoiceDialog |
| [ChoiceDialog.tsx](ChoiceDialog.tsx) | 界面模块；入口/导出：Choice、ChoiceDialog |
| [ConfirmDialog.test.tsx](ConfirmDialog.test.tsx) | 测试：ConfirmDialog |
| [ConfirmDialog.tsx](ConfirmDialog.tsx) | 界面模块；入口/导出：ConfirmDialog |
| [ConflictScreen.test.tsx](ConflictScreen.test.tsx) | 测试：ConflictScreen |
| [ConflictScreen.tsx](ConflictScreen.tsx) | 界面模块；入口/导出：ConflictScreen |
| [ConsentGate.test.ts](ConsentGate.test.ts) | 测试：ConsentGate |
| [ConsentGate.tsx](ConsentGate.tsx) | 界面模块；入口/导出：isInputFlow、ConsentGate、ConsentDialog |
| [CopyButton.tsx](CopyButton.tsx) | 界面模块；入口/导出：CopyButton |
| [CurrentBookCaption.tsx](CurrentBookCaption.tsx) | 界面模块；入口/导出：CurrentBookCaption |
| [CurrentBookPicker.tsx](CurrentBookPicker.tsx) | 界面模块；入口/导出：CurrentBookPicker、BookCapsuleContents |
| [DefaultAvatar.tsx](DefaultAvatar.tsx) | 界面模块；入口/导出：DefaultAvatar |
| [DuplicateDetectionSettings.test.tsx](DuplicateDetectionSettings.test.tsx) | 测试：DuplicateDetectionSettings |
| [DuplicateDetectionSettings.tsx](DuplicateDetectionSettings.tsx) | 界面模块；入口/导出：DuplicateDetectionSettingsState、useDuplicateDetectionSettings、DuplicateDetectionSettingsSection、DuplicateDetectionSettingsCard |
| [EntryFilterPanel.tsx](EntryFilterPanel.tsx) | 界面模块；入口/导出：useDetailFilters、FilterIcon、EntryFilterPanel、FilterForm |
| [EntryForm.tsx](EntryForm.tsx) | 界面模块；入口/导出：ReviewDraft、ReviewStep |
| [EntrySaved.test.tsx](EntrySaved.test.tsx) | 测试：EntrySaved |
| [EntrySaved.tsx](EntrySaved.tsx) | 界面模块；入口/导出：EntrySaved |
| [EntrySortControls.test.ts](EntrySortControls.test.ts) | 测试：EntrySortControls |
| [EntrySortControls.tsx](EntrySortControls.tsx) | 界面模块；入口/导出：EntryOrder、EntryPresentation、presentEntries、useEntryPresentation、EntrySortControls |
| [ErrorBoundary.tsx](ErrorBoundary.tsx) | 界面模块；入口/导出：ErrorBoundary |
| [FxDisplay.tsx](FxDisplay.tsx) | 界面模块；入口/导出：FxModeSetting、FxAmountView、FxAmount、FxMonthSummary |
| [FxStats.tsx](FxStats.tsx) | 界面模块；入口/导出：FxStats |
| [GuestEntry.tsx](GuestEntry.tsx) | 界面模块；入口/导出：GuestEntry |
| [GuestModeBadge.tsx](GuestModeBadge.tsx) | 界面模块；入口/导出：GuestModeBadge |
| [GuestWelcome.tsx](GuestWelcome.tsx) | 界面模块；入口/导出：GuestWelcome |
| [HistoryList.test.ts](HistoryList.test.ts) | 测试：HistoryList |
| [HistoryList.tsx](HistoryList.tsx) | 界面模块；入口/导出：HistoryList、splitSummary、historySentenceText、historyChangeText |
| [Icons.tsx](Icons.tsx) | 界面模块；入口/导出：GearIcon、MoreIcon、CopyIcon、PlusIcon、ChevronIcon |
| [InfoHint.tsx](InfoHint.tsx) | 界面模块；入口/导出：InfoIcon |
| [LanguageSwitch.tsx](LanguageSwitch.tsx) | 界面模块；入口/导出：LanguageSwitch |
| [Layouts.test.ts](Layouts.test.ts) | 测试：Layouts |
| [Layouts.tsx](Layouts.tsx) | 界面模块；入口/导出：useEntryMenu、MenuEvent、menuAfter、AppShell、PaneShell |
| [LedgerMonthPicker.tsx](LedgerMonthPicker.tsx) | 界面模块；入口/导出：LedgerMonthPicker |
| [LegacyUserAvatar.tsx](LegacyUserAvatar.tsx) | 界面模块；入口/导出：LegacyAvatarId、LegacyUserAvatar |
| [MemberList.tsx](MemberList.tsx) | 界面模块；入口/导出：MemberList |
| [MessageBoard.test.ts](MessageBoard.test.ts) | 测试：MessageBoard |
| [MessageBoard.tsx](MessageBoard.tsx) | 界面模块；入口/导出：clearMessageDraft、markMessagesSeen、newMessageCount、MessageComposer、useMessageComposer |
| [MessageQuote.test.tsx](MessageQuote.test.tsx) | 测试：MessageQuote |
| [MessageQuote.tsx](MessageQuote.tsx) | 界面模块；入口/导出：QuoteReferenceCard、pickableEvents、QuotePickerSheet、QuoteMessageSheet |
| [MonthPicker.test.tsx](MonthPicker.test.tsx) | 测试：MonthPicker |
| [MonthPicker.tsx](MonthPicker.tsx) | 界面模块；入口/导出：MonthPicker |
| [NotDuplicateRelationsSection.test.tsx](NotDuplicateRelationsSection.test.tsx) | 测试：NotDuplicateRelationsSection |
| [NotDuplicateRelationsSection.tsx](NotDuplicateRelationsSection.tsx) | 界面模块；入口/导出：NotDuplicateRelationsView、NotDuplicateRelationsSection |
| [Notifications.tsx](Notifications.tsx) | 界面模块；入口/导出：NotificationBell、NotificationPanel |
| [OceanBackdrop.tsx](OceanBackdrop.tsx) | 界面模块；入口/导出：OceanBackdrop |
| [OfflineFillProvider.tsx](OfflineFillProvider.tsx) | 界面模块；入口/导出：OfflineFillProvider |
| [OfflineStatus.tsx](OfflineStatus.tsx) | 界面模块；入口/导出：OfflineStatus |
| [PasswordField.tsx](PasswordField.tsx) | 界面模块；入口/导出：PasswordField |
| [PersistentNavContext.ts](PersistentNavContext.ts) | 实现模块；入口/导出：PersistentNavContext、SuppressNavigationContext |
| [ProfileAccountNumberSheet.tsx](ProfileAccountNumberSheet.tsx) | 界面模块；入口/导出：ProfileAccountNumberSheet |
| [QrCodeView.tsx](QrCodeView.tsx) | 界面模块；入口/导出：QrCodeView |
| [RecoveryCodeCard.tsx](RecoveryCodeCard.tsx) | 界面模块；入口/导出：RecoveryCodeCard |
| [ReferralCodeSection.tsx](ReferralCodeSection.tsx) | 界面模块；入口/导出：ReferralCodeSection |
| [Section.tsx](Section.tsx) | 界面模块；入口/导出：Section |
| [SectionFrame.tsx](SectionFrame.tsx) | 界面模块；入口/导出：SectionFrame、FrameAction |
| [SettingsCard.tsx](SettingsCard.tsx) | 界面模块；入口/导出：DefaultCurrency、currentCurrency、useDefaultCurrency、CurrencyQuickPick、SettingsCategoryCard |
| [ShareSection.tsx](ShareSection.tsx) | 界面模块；入口/导出：ShareSection |
| [States.tsx](States.tsx) | 界面模块；入口/导出：EmptyState、SkeletonRows、ErrorState |
| [StickyActionBar.tsx](StickyActionBar.tsx) | 界面模块；入口/导出：StickyActionBar |
| [StorageAdmin.tsx](StorageAdmin.tsx) | 界面模块；入口/导出：StorageAdmin |
| [SyncBanner.tsx](SyncBanner.tsx) | 界面模块；入口/导出：SyncBanner |
| [TabPageHeader.tsx](TabPageHeader.tsx) | 界面模块；入口/导出：TabPageHeader |
| [TextField.tsx](TextField.tsx) | 界面模块；入口/导出：TextField |
| [ThemePreview.tsx](ThemePreview.tsx) | 界面模块；入口/导出：ThemePreview |
| [UndoBar.tsx](UndoBar.tsx) | 界面模块；入口/导出：UndoBar |
| [UndoProvider.tsx](UndoProvider.tsx) | 界面模块；入口/导出：UndoProvider、useUndo |
| [UpdateMoreSheet.tsx](UpdateMoreSheet.tsx) | 界面模块；入口/导出：UpdateMoreSheet |
| [UserAvatar.test.tsx](UserAvatar.test.tsx) | 测试：UserAvatar |
| [UserAvatar.tsx](UserAvatar.tsx) | 界面模块；入口/导出：avatarLabel、avatarDescription、UserAvatar |
| [VoiceRipples.tsx](VoiceRipples.tsx) | 界面模块；入口/导出：VoiceRipples |
| [attachments.css](attachments.css) | 样式与变量 |
| [authSurfaces.test.tsx](authSurfaces.test.tsx) | 测试：authSurfaces |
| [current-book-caption.css](current-book-caption.css) | 样式与变量 |
| [entry-filters.css](entry-filters.css) | 样式与变量 |
| [useBookCapsuleMotion.ts](useBookCapsuleMotion.ts) | 实现模块；入口/导出：useBookCapsuleMotion |

| 子目录 | 职责 |
|---|---|
| [chart/](chart/README.md) | 图表基础设施。 |
| [charts/](charts/README.md) | 图表展示组件。 |
| [entry/](entry/README.md) | 记账入口与编辑组件。 |
| [import/](import/README.md) | 本层组织 import 模块的直属文件；具体契约由任务索引定位。 |
| [ledger/](ledger/README.md) | 账本领域。 |
| [ocr/](ocr/README.md) | OCR 解析与确认。 |
| [ui/](ui/README.md) | 通用界面组件。 |
<!-- directory-index:end -->
