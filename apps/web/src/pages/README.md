# apps/web/src/pages · 阅读入口

业务页面；新增行为先定位产品规格与路由契约。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [AboutPage.test.tsx](AboutPage.test.tsx) | 测试：AboutPage |
| [AboutPage.tsx](AboutPage.tsx) | 界面模块；入口/导出：AboutPage |
| [AccountDataPage.tsx](AccountDataPage.tsx) | 界面模块；入口/导出：confirmationAccepted、blockedReasonText、AccountDataPage |
| [AddEntryPage.test.tsx](AddEntryPage.test.tsx) | 测试：AddEntryPage |
| [AddEntryPage.tsx](AddEntryPage.tsx) | 界面模块；入口/导出：manualDuplicateChoices、manualDuplicateDescription、AddEntryPage |
| [AdminLifecyclePage.tsx](AdminLifecyclePage.tsx) | 界面模块；入口/导出：AdminLifecyclePage |
| [AdminPages.tsx](AdminPages.tsx) | 界面模块；入口/导出：AdminOverviewPage、AdminInvitesPage |
| [ArchiveRecoveryPage.tsx](ArchiveRecoveryPage.tsx) | 界面模块；入口/导出：ArchiveRecoveryPage |
| [AttachmentsPage.tsx](AttachmentsPage.tsx) | 界面模块；入口/导出：AttachmentsPage |
| [AvatarPickerPage.test.tsx](AvatarPickerPage.test.tsx) | 测试：AvatarPickerPage |
| [AvatarPickerPage.tsx](AvatarPickerPage.tsx) | 界面模块；入口/导出：AvatarPickerPage |
| [BookDetailPage.tsx](BookDetailPage.tsx) | 界面模块；入口/导出：BookDetailPage |
| [BookRedirects.tsx](BookRedirects.tsx) | 界面模块；入口/导出：CurrentBookRedirect、StartBookRedirect |
| [BookSettingsPage.tsx](BookSettingsPage.tsx) | 界面模块；入口/导出：BookSettingsPage |
| [ChangePasswordPage.tsx](ChangePasswordPage.tsx) | 界面模块；入口/导出：ChangePasswordPage |
| [ChartLabPage.tsx](ChartLabPage.tsx) | 界面模块；入口/导出：ChartLabPage |
| [DetailPage.tsx](DetailPage.tsx) | 界面模块；入口/导出：DetailPage |
| [DownloadManagerPage.tsx](DownloadManagerPage.tsx) | 界面模块；入口/导出：DownloadManagerPage |
| [DownloadMorePage.tsx](DownloadMorePage.tsx) | 界面模块；入口/导出：DownloadMorePage |
| [DuplicateReviewPage.test.tsx](DuplicateReviewPage.test.tsx) | 测试：DuplicateReviewPage |
| [DuplicateReviewPage.tsx](DuplicateReviewPage.tsx) | 界面模块；入口/导出：DuplicateReviewPage |
| [EntryDetailPage.tsx](EntryDetailPage.tsx) | 界面模块；按文件名定位 EntryDetailPage.tsx |
| [ExportPage.locale.test.ts](ExportPage.locale.test.ts) | 测试：ExportPage.locale |
| [ExportPage.tsx](ExportPage.tsx) | 界面模块；入口/导出：ExportPage |
| [GuestMePage.tsx](GuestMePage.tsx) | 界面模块；入口/导出：GuestMePage |
| [ImportPage.bookScope.test.tsx](ImportPage.bookScope.test.tsx) | 测试：ImportPage.bookScope |
| [ImportPage.entry.test.tsx](ImportPage.entry.test.tsx) | 测试：ImportPage.entry |
| [ImportPage.test.tsx](ImportPage.test.tsx) | 测试：ImportPage |
| [ImportPage.tsx](ImportPage.tsx) | 界面模块；入口/导出：ImportPage |
| [JoinPage.tsx](JoinPage.tsx) | 界面模块；入口/导出：JoinPage |
| [LanguagePage.tsx](LanguagePage.tsx) | 界面模块；入口/导出：LanguageChoiceList、LanguagePage |
| [LedgerHistoryPage.tsx](LedgerHistoryPage.tsx) | 界面模块；入口/导出：LedgerHistoryPage |
| [LedgerImportPage.i18n.test.tsx](LedgerImportPage.i18n.test.tsx) | 测试：LedgerImportPage.i18n |
| [LedgerImportPage.test.tsx](LedgerImportPage.test.tsx) | 测试：LedgerImportPage |
| [LedgerImportPage.tsx](LedgerImportPage.tsx) | 界面模块；入口/导出：LedgerImportPage |
| [LedgerInvitePage.tsx](LedgerInvitePage.tsx) | 界面模块；入口/导出：LedgerInvitePage |
| [LedgerMorePage.test.tsx](LedgerMorePage.test.tsx) | 测试：LedgerMorePage |
| [LedgerMorePage.tsx](LedgerMorePage.tsx) | 界面模块；入口/导出：reloadConfirmation、LedgerMorePage |
| [LedgerPage.tsx](LedgerPage.tsx) | 界面模块；入口/导出：LedgerPage |
| [LedgerSpacePage.tsx](LedgerSpacePage.tsx) | 界面模块；入口/导出：LedgerSpacePage |
| [LedgerSubPages.tsx](LedgerSubPages.tsx) | 界面模块；入口/导出：LedgerInfoPage、LedgerMembersPage |
| [LegalDocumentPage.tsx](LegalDocumentPage.tsx) | 界面模块；入口/导出：LegalDocumentPage |
| [LegalPage.tsx](LegalPage.tsx) | 界面模块；入口/导出：LegalPage |
| [LoginPage.tsx](LoginPage.tsx) | 界面模块；入口/导出：LoginPage |
| [ManagePages.test.tsx](ManagePages.test.tsx) | 测试：ManagePages |
| [ManagePages.tsx](ManagePages.tsx) | 界面模块；入口/导出：CategoriesPage |
| [MePage.test.ts](MePage.test.ts) | 测试：MePage |
| [MePage.tsx](MePage.tsx) | 界面模块；入口/导出：MePage、myBookTarget |
| [MessageBoardPage.tsx](MessageBoardPage.tsx) | 界面模块；入口/导出：readQuoteRequest、MessageBoardPage |
| [MetricDetailPage.tsx](MetricDetailPage.tsx) | 界面模块；入口/导出：MetricDetailPage |
| [MonthDownloadPage.tsx](MonthDownloadPage.tsx) | 界面模块；入口/导出：MonthDownloadPage |
| [OcrOverviewPage.test.ts](OcrOverviewPage.test.ts) | 测试：OcrOverviewPage |
| [OcrOverviewPage.tsx](OcrOverviewPage.tsx) | 界面模块；入口/导出：OcrOverviewPage |
| [OcrReviewDetailPage.test.ts](OcrReviewDetailPage.test.ts) | 测试：OcrReviewDetailPage |
| [OcrReviewDetailPage.tsx](OcrReviewDetailPage.tsx) | 界面模块；入口/导出：OcrReviewDetailPage |
| [PastePage.test.tsx](PastePage.test.tsx) | 测试：PastePage |
| [PastePage.tsx](PastePage.tsx) | 界面模块；入口/导出：PasteCandidate、recognisePastedText、PastePage |
| [ProfilePage.tsx](ProfilePage.tsx) | 界面模块；入口/导出：ProfilePreview、ProfilePage |
| [RecordPage.tsx](RecordPage.tsx) | 界面模块；入口/导出：RecordPage |
| [RecoverPage.tsx](RecoverPage.tsx) | 界面模块；入口/导出：RecoverPage |
| [ReferralCodePage.tsx](ReferralCodePage.tsx) | 界面模块；入口/导出：ReferralCodePage |
| [RegenerateRecoveryCodePage.tsx](RegenerateRecoveryCodePage.tsx) | 界面模块；入口/导出：RegenerateRecoveryCodePage |
| [RegisterPage.tsx](RegisterPage.tsx) | 界面模块；入口/导出：RegisterPage |
| [ScanPage.test.ts](ScanPage.test.ts) | 测试：ScanPage |
| [ScanPage.tsx](ScanPage.tsx) | 界面模块；入口/导出：ScanPage |
| [SettingsPage.tsx](SettingsPage.tsx) | 界面模块；入口/导出：SettingsHome、SettingsPage |
| [SettingsSubPages.tsx](SettingsSubPages.tsx) | 界面模块；入口/导出：PreferencesPage、AppearancePage、SecurityPage |
| [SoftwareUpdatePage.test.tsx](SoftwareUpdatePage.test.tsx) | 测试：SoftwareUpdatePage |
| [SoftwareUpdatePage.tsx](SoftwareUpdatePage.tsx) | 界面模块；入口/导出：SoftwareUpdatePage |
| [StartBookPages.tsx](StartBookPages.tsx) | 界面模块；入口/导出：StartBookMembersPage、StartBookSharePage |
| [StatsCardDetailPage.tsx](StatsCardDetailPage.tsx) | 界面模块；入口/导出：StatsCardDetailPage |
| [StatsPage.test.ts](StatsPage.test.ts) | 测试：StatsPage |
| [StatsPage.tsx](StatsPage.tsx) | 界面模块；入口/导出：StatsPage |
| [ThemeAppearancePage.test.tsx](ThemeAppearancePage.test.tsx) | 测试：ThemeAppearancePage |
| [ThemeAppearancePage.tsx](ThemeAppearancePage.tsx) | 界面模块；入口/导出：ThemeAppearanceView、ThemeAppearancePage |
| [UpdateAnnouncementDetailPage.tsx](UpdateAnnouncementDetailPage.tsx) | 界面模块；入口/导出：UpdateAnnouncementDetailPage |
| [UpdateAnnouncementsPage.tsx](UpdateAnnouncementsPage.tsx) | 界面模块；入口/导出：UpdateAnnouncementsPage |
| [UpdateRuntimePage.tsx](UpdateRuntimePage.tsx) | 界面模块；入口/导出：UpdateRuntimePage |
| [VoiceReviewPage.draft.test.ts](VoiceReviewPage.draft.test.ts) | 测试：VoiceReviewPage.draft |
| [VoiceReviewPage.tsx](VoiceReviewPage.tsx) | 界面模块；入口/导出：draftOf、VoiceReviewPage |
| [WorkspaceStartPage.tsx](WorkspaceStartPage.tsx) | 界面模块；入口/导出：WorkspaceStartPage |
| [accountI18n.test.tsx](accountI18n.test.tsx) | 测试：accountI18n |
| [adminConsole.test.ts](adminConsole.test.ts) | 测试：adminConsole |
| [bookSettings.test.tsx](bookSettings.test.tsx) | 测试：bookSettings |
| [collabUpdateAdmin.i18n.test.tsx](collabUpdateAdmin.i18n.test.tsx) | 测试：collabUpdateAdmin.i18n |
| [scanNotDuplicateConfirmation.test.ts](scanNotDuplicateConfirmation.test.ts) | 测试：scanNotDuplicateConfirmation |
| [settingsHome.test.tsx](settingsHome.test.tsx) | 测试：settingsHome |
| [settingsRoutes.test.ts](settingsRoutes.test.ts) | 测试：settingsRoutes |
| [theme-appearance.css](theme-appearance.css) | 样式与变量 |
<!-- directory-index:end -->
