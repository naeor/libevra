# apps/web/src/lib · 阅读入口

> 最后修改：2026-11-09 09:11（UTC+08:00）

基础逻辑与公共工具。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [admin.ts](admin.ts) | 实现模块；入口/导出：fetchAdminSelf、fetchAdminOverview、fetchAdminInvites、createAdminInvite、revokeAdminInvite |
| [analysisData.test.ts](analysisData.test.ts) | 测试：analysisData |
| [analysisData.ts](analysisData.ts) | 实现模块；入口/导出：MAX_ANALYSIS_DAYS、AnalysisRangeErrorCode、AnalysisRangeError、AnalysisWindow、AnalysisInput |
| [analysisRange.permissions.test.ts](analysisRange.permissions.test.ts) | 测试：analysisRange.permissions |
| [analysisRange.test.tsx](analysisRange.test.tsx) | 测试：analysisRange |
| [analysisRange.ts](analysisRange.ts) | 实现模块；入口/导出：AnalysisMarks、AnalysisCoverage、AnalysisRangeRead、AnalysisRangeIo、analysisMonthStored |
| [api.ts](api.ts) | 实现模块；入口/导出：primeDeviceId、primeBookId、currentBookIdHeader、ApiRequestError、buildHeaders |
| [apiHeaders.test.ts](apiHeaders.test.ts) | 测试：apiHeaders |
| [attachments.ts](attachments.ts) | 实现模块；入口/导出：useAttachments、useBookStorage、useAccountStorage、attachmentUrl、PendingAttachment |
| [avatarRewards.ts](avatarRewards.ts) | 实现模块；入口/导出：AVATAR_REWARDS_QUERY_KEY、fetchAvatarRewards、useAvatarRewards、requestAvatarRewardMakeUp、confirmAvatarRewardEvents |
| [backFallback.ts](backFallback.ts) | 实现模块；入口/导出：recordBackPress |
| [backNavigation.test.ts](backNavigation.test.ts) | 测试：backNavigation |
| [billImport.test.ts](billImport.test.ts) | 测试：billImport |
| [billImport.ts](billImport.ts) | 实现模块；入口/导出：billSourceLabel、billCommitRows、billRowProblem、billReviewCounts、previewBill |
| [billImportUi.test.ts](billImportUi.test.ts) | 测试：billImportUi |
| [billImportUi.ts](billImportUi.ts) | 实现模块；入口/导出：BILL_IMPORT_ACCEPT、formatBillFileSize、billFileProblem、BillRowStatus、billRowStatusLabel |
| [captureAttachments.test.ts](captureAttachments.test.ts) | 测试：captureAttachments |
| [captureAttachments.ts](captureAttachments.ts) | 实现模块；入口/导出：AttachmentTarget、AttachmentDraftLink、captureDraftsFor、billAttachmentMapping、resolveAttachmentDraft |
| [captureTextDraft.ts](captureTextDraft.ts) | 实现模块；入口/导出：useCaptureTextDraft |
| [clipboard.ts](clipboard.ts) | 实现模块；入口/导出：CopyOutcome、copyText |
| [colors.test.ts](colors.test.ts) | 测试：colors |
| [connectivity.ts](connectivity.ts) | 实现模块；入口/导出：BackMode、parentBackAction、useGoBack |
| [consent.ts](consent.ts) | 实现模块；入口/导出：RequiredLegalDocument、MajorAnnouncementView、ConsentStatus、fetchRequiredLegalDocuments、fetchConsentStatus |
| [copy.test.ts](copy.test.ts) | 测试：copy |
| [crossTabSync.test.ts](crossTabSync.test.ts) | 测试：crossTabSync |
| [currentBook.test.ts](currentBook.test.ts) | 测试：currentBook |
| [currentBook.ts](currentBook.ts) | 实现模块；入口/导出：currentBookId、setCurrentBook、selectBookForReload、restoreCurrentBook、forgetCurrentBook |
| [currentLedgerDestination.ts](currentLedgerDestination.ts) | 实现模块；入口/导出：currentLedgerDestination |
| [datetime.test.ts](datetime.test.ts) | 测试：datetime |
| [datetime.ts](datetime.ts) | 实现模块；入口/导出：localTimeZone、toLocalDate、toLocalIso、ALL_MONTHS、isAllMonths |
| [desktopInput.test.ts](desktopInput.test.ts) | 测试：desktopInput |
| [desktopInput.ts](desktopInput.ts) | 实现模块；入口/导出：isImeComposing、wantsNewTab、openInNewTab |
| [detailCardSync.test.ts](detailCardSync.test.ts) | 测试：detailCardSync |
| [detailCardSync.ts](detailCardSync.ts) | 实现模块；入口/导出：CardRemote、CardLocal、sameCards、validRemote、syncDetailCards |
| [detailCards.test.ts](detailCards.test.ts) | 测试：detailCards |
| [detailCards.ts](detailCards.ts) | 实现模块；入口/导出：MAIN_CARDS、SMALL_CARDS、DetailCards、DEFAULT_DETAIL_CARDS、parseDetailCards |
| [detailFilters.test.ts](detailFilters.test.ts) | 测试：detailFilters |
| [detailFilters.ts](detailFilters.ts) | 实现模块；入口/导出：DetailFilters、FILTER_DIMENSIONS、FilterDimension、emptyDetailFilters、readDetailFilters |
| [detailTransition.ts](detailTransition.ts) | 实现模块；入口/导出：readSession、writeSession、useDetailTransition |
| [deviceStorageKeys.test.ts](deviceStorageKeys.test.ts) | 测试：deviceStorageKeys |
| [deviceStorageKeys.ts](deviceStorageKeys.ts) | 实现模块；入口/导出：LIBELLUM_KEY_PREFIX、LIBEVRA_KEY_PREFIX、CURRENT_BOOK_KEY、fxModeKey、MESSAGES_SEEN_PREFIX |
| [dialogFocus.ts](dialogFocus.ts) | 实现模块；入口/导出：focusableWithin、DialogLayer、useDialogFocus |
| [duplicateMutationOffline.test.tsx](duplicateMutationOffline.test.tsx) | 测试：duplicateMutationOffline |
| [duplicateRelationSuppression.test.ts](duplicateRelationSuppression.test.ts) | 测试：duplicateRelationSuppression |
| [duplicateReview.test.ts](duplicateReview.test.ts) | 测试：duplicateReview |
| [duplicateReview.ts](duplicateReview.ts) | 实现模块；入口/导出：joinDuplicateList、duplicateFieldLabel、duplicateScopeLabel、describeDuplicateMatchText、NewCandidatesResult |
| [duplicateReviewScan.test.ts](duplicateReviewScan.test.ts) | 测试：duplicateReviewScan |
| [duplicateSettings.test.ts](duplicateSettings.test.ts) | 测试：duplicateSettings |
| [duplicateSettings.ts](duplicateSettings.ts) | 实现模块；入口/导出：DUPLICATE_SETTINGS_STORAGE_PREFIX、DUPLICATE_SETTINGS_SCHEMA_VERSION、DuplicateSettingsScope、DuplicateSettingsStorage、duplicateSettingsStorage |
| [entryFlow.ts](entryFlow.ts) | 实现模块；入口/导出：provideEntryAgain、continueEntry |
| [entryReturn.test.ts](entryReturn.test.ts) | 测试：entryReturn |
| [entryReturn.ts](entryReturn.ts) | 实现模块；入口/导出：entryReturnState、entryBackTarget、useEntryReturn |
| [errorCopy.test.ts](errorCopy.test.ts) | 测试：errorCopy |
| [format.ts](format.ts) | 实现模块；入口/导出：currencySymbol、currencyName、numberSeparators、formatMoney、minorToInput |
| [frameClock.test.ts](frameClock.test.ts) | 测试：frameClock |
| [frameClock.ts](frameClock.ts) | 实现模块；入口/导出：ClockReport、STALL_MS、onClockReport、publishClockReport、FramePace |
| [fxView.test.tsx](fxView.test.tsx) | 测试：fxView |
| [fxView.ts](fxView.ts) | 实现模块；入口/导出：readFxMode、saveFxMode、useFxMode、useFxEntry、fxMoney |
| [language.test.ts](language.test.ts) | 测试：language |
| [language.ts](language.ts) | 实现模块；入口/导出：LANGUAGE_PREFERENCES、LanguagePreference、LANGUAGE_STORAGE_KEY、LanguageStorage、isLanguagePreference |
| [languageRuntime.ts](languageRuntime.ts) | 实现模块；入口/导出：startLanguageRuntime、useLanguagePreference |
| [ledgerSwitchFlow.ts](ledgerSwitchFlow.ts) | 实现模块；入口/导出：provideReloadCover、coverForReload |
| [ledgerView.test.ts](ledgerView.test.ts) | 测试：ledgerView |
| [ledgerView.ts](ledgerView.ts) | 实现模块；入口/导出：mergeLedgerEntries、updateTransactionViews、limitToWholeDays |
| [ledgerWriter.ts](ledgerWriter.ts) | 实现模块；入口/导出：LedgerWriter、useLedgerWriter |
| [lifecycle.ts](lifecycle.ts) | 实现模块；入口/导出：BookDecisionAction、CloseMethod、DataDeletionBook、DataDeletionPreview、DataDeletionResult |
| [majorAnnouncementVisibility.test.ts](majorAnnouncementVisibility.test.ts) | 测试：majorAnnouncementVisibility |
| [majorAnnouncementVisibility.ts](majorAnnouncementVisibility.ts) | 实现模块；入口/导出：isMajorAnnouncementOlderThanApp、selectDisplayedMajorAnnouncement |
| [messageDrafts.ts](messageDrafts.ts) | 实现模块；入口/导出：messageDraftScope、readMessageDraft、updateMessageDraft、clearAllMessageDrafts |
| [monthAvailability.test.ts](monthAvailability.test.ts) | 测试：monthAvailability |
| [monthAvailability.ts](monthAvailability.ts) | 实现模块；入口/导出：MonthAvailability、MonthSamples、monthsInYear、readMonthSamples、monthAvailability |
| [motionIdle.test.ts](motionIdle.test.ts) | 测试：motionIdle |
| [motionIdle.ts](motionIdle.ts) | 实现模块；入口/导出：beginMotion、isMotionIdle、whenMotionIdle |
| [motionTokens.test.ts](motionTokens.test.ts) | 测试：motionTokens |
| [motionTokens.ts](motionTokens.ts) | 实现模块；入口/导出：MotionStyle、MotionCurve、easingFunction、MOTION_CLOCK、NAVIGATION |
| [nativeHeaderScroll.test.ts](nativeHeaderScroll.test.ts) | 测试：nativeHeaderScroll |
| [nativeHeaderScroll.ts](nativeHeaderScroll.ts) | 实现模块；入口/导出：scrollContentHeight、bindNativeHeaderScroll |
| [notDuplicateRelations.test.ts](notDuplicateRelations.test.ts) | 测试：notDuplicateRelations |
| [notDuplicateRelations.ts](notDuplicateRelations.ts) | 实现模块；入口/导出：notDuplicateRelationQueryKeys、NotDuplicateRelationQueryOptions、fetchNotDuplicateRelations、fetchNotDuplicatePairKeys、createNotDuplicateRelations |
| [notDuplicateRelationsApi.test.ts](notDuplicateRelationsApi.test.ts) | 测试：notDuplicateRelationsApi |
| [oceanGeometry.test.ts](oceanGeometry.test.ts) | 测试：oceanGeometry |
| [oceanGeometry.ts](oceanGeometry.ts) | 实现模块；入口/导出：oceanEdge、oceanPath |
| [overlayExit.test.ts](overlayExit.test.ts) | 测试：overlayExit |
| [overlayExit.ts](overlayExit.ts) | 实现模块；入口/导出：OVERLAY_EXIT_MS、createOverlayExit |
| [overlayScrollLock.test.ts](overlayScrollLock.test.ts) | 测试：overlayScrollLock |
| [overlayScrollLock.ts](overlayScrollLock.ts) | 实现模块；入口/导出：hasOverlayScrollLock、lockOverlayScroll |
| [presetNames.ts](presetNames.ts) | 实现模块；入口/导出：displayCategoryName、displayPaymentMethodName、displayCategoryDescription |
| [profile.ts](profile.ts) | 实现模块；入口/导出：useSaveProfile |
| [profileDraft.ts](profileDraft.ts) | 实现模块；入口/导出：useDraftExit |
| [qr.test.ts](qr.test.ts) | 测试：qr |
| [qr.ts](qr.ts) | 实现模块；入口/导出：QrCode、encodeQr |
| [queries.ts](queries.ts) | 实现模块；入口/导出：queryKeys、guestQueryKeys、GuestQueryNotifier、TransactionFilters、transactionFilters |
| [r2-colors.test.ts](r2-colors.test.ts) | 测试：r2-colors |
| [registration.ts](registration.ts) | 实现模块；入口/导出：fetchRegistrationConfig |
| [reviewScanController.test.ts](reviewScanController.test.ts) | 测试：reviewScanController |
| [reviewScanController.ts](reviewScanController.ts) | 实现模块；入口/导出：ReviewScanState、ReviewScanController |
| [runtimeInfo.test.ts](runtimeInfo.test.ts) | 测试：runtimeInfo |
| [runtimeInfo.ts](runtimeInfo.ts) | 实现模块；入口/导出：RuntimeSnapshot、readRuntimeSnapshot、networkLabel、formatRuntimeReport |
| [s4a.analysisData.test.ts](s4a.analysisData.test.ts) | 测试：s4a.analysisData |
| [s4b.analysisData.test.ts](s4b.analysisData.test.ts) | 测试：s4b.analysisData |
| [s4c.analysisData.test.ts](s4c.analysisData.test.ts) | 测试：s4c.analysisData |
| [scanHandoff.ts](scanHandoff.ts) | 实现模块；入口/导出：handOverForScan、takeScanHandover、SpokenDraftHandover、handOverSpoken、takeSpokenHandover |
| [share.test.ts](share.test.ts) | 测试：share |
| [share.ts](share.ts) | 实现模块；入口/导出：ShareOutcome、toFile、canShareFiles、deliverFile |
| [spaceTransition.ts](spaceTransition.ts) | 实现模块；入口/导出：SpaceTransition、readSeenPresentation、markPresentationSeen、useSpaceTransition |
| [statsView.test.ts](statsView.test.ts) | 测试：statsView |
| [statsView.ts](statsView.ts) | 实现模块；入口/导出：readStatsView、updateStatsView |
| [tabHeader.test.ts](tabHeader.test.ts) | 测试：tabHeader |
| [tagColors.ts](tagColors.ts) | 实现模块；入口/导出：TAG_COLORS、DEFAULT_TAG_COLOR、tagForeground、tagFillStyle |
| [theme.test.ts](theme.test.ts) | 测试：theme |
| [theme.ts](theme.ts) | 实现模块；入口/导出：THEME_MODES、ThemeMode、THEME_PALETTES、ThemePalette、AVAILABLE_THEME_PALETTES |
| [themePalettes.test.ts](themePalettes.test.ts) | 测试：themePalettes |
| [themeRuntime.test.ts](themeRuntime.test.ts) | 测试：themeRuntime |
| [tokens.test.ts](tokens.test.ts) | 测试：tokens |
| [transitionPhysics.test.ts](transitionPhysics.test.ts) | 测试：transitionPhysics |
| [transitionPhysics.ts](transitionPhysics.ts) | 实现模块；入口/导出：clamp01、DRAG_DISTANCE、SPRING_STIFFNESS、SPRING_DAMPING、SETTLED |
| [typeScale.test.ts](typeScale.test.ts) | 测试：typeScale |
| [uiConsistency.test.ts](uiConsistency.test.ts) | 测试：uiConsistency |
| [updateAnnouncements.test.ts](updateAnnouncements.test.ts) | 测试：updateAnnouncements |
| [updateAnnouncements.ts](updateAnnouncements.ts) | 实现模块；入口/导出：UpdateAnnouncement、ALL_ANNOUNCEMENTS |
| [useCollapsingHeader.test.ts](useCollapsingHeader.test.ts) | 测试：useCollapsingHeader |
| [useCollapsingHeader.ts](useCollapsingHeader.ts) | 实现模块；入口/导出：RESTORE_HEADER_SCROLL、useCollapsingHeader |
| [useOverlayPresentation.ts](useOverlayPresentation.ts) | 实现模块；入口/导出：useOverlayExit、useOverlayPresence、useOverlayScrollLock |
| [useTimeAnalysis.test.ts](useTimeAnalysis.test.ts) | 测试：useTimeAnalysis |
| [useTimeAnalysis.ts](useTimeAnalysis.ts) | 实现模块；入口/导出：useTimeAnalysis、useCumulativeAnalysis、useFlowAnalysis、usePeriodComparison、useMultiMonthComparison |
| [useVoiceRecorder.test.ts](useVoiceRecorder.test.ts) | 测试：useVoiceRecorder |
| [useVoiceRecorder.ts](useVoiceRecorder.ts) | 实现模块；入口/导出：RecorderState、RecorderBlocker、MediaContext、isSecureContextForMedia、detectBlocker |
| [uuid.ts](uuid.ts) | 实现模块；入口/导出：uuidV7 |
| [version.test.ts](version.test.ts) | 测试：version |
| [version.ts](version.ts) | 实现模块；入口/导出：formatAppVersion、buildStamp、buildStampLocal |
| [visualStyle.test.ts](visualStyle.test.ts) | 测试：visualStyle |
| [visualStyle.ts](visualStyle.ts) | 实现模块；入口/导出：VISUAL_STYLES、VisualStyle、VISUAL_STYLE_STORAGE_KEY、VISUAL_STYLE_QUERY_PARAM、STYLE_LAB_ENABLED |
| [voiceRipples.test.ts](voiceRipples.test.ts) | 测试：voiceRipples |
| [voiceRipples.ts](voiceRipples.ts) | 实现模块；入口/导出：RIPPLE_INTERVAL_MS、RIPPLE_INTERVAL_MIN_MS、RIPPLE_LIFE_INTERVALS、RIPPLE_LIFE_PACE_EXPONENT、RIPPLE_LOUD_DB |
| [workspaceLedger.test.ts](workspaceLedger.test.ts) | 测试：workspaceLedger |
| [workspaceLedger.ts](workspaceLedger.ts) | 实现模块；入口/导出：ViewLedgerContext、FOREIGN_KEY、foreignKey、foreignBookFor、useForeignBookId |

| 子目录 | 职责 |
|---|---|
| [chart/](chart/README.md) | 图表基础设施。 |
| [guest/](guest/README.md) | 本层组织 guest 模块的直属文件；具体契约由任务索引定位。 |
| [ledgerImport/](ledgerImport/README.md) | 本层组织 ledgerImport 模块的直属文件；具体契约由任务索引定位。 |
| [ocr/](ocr/README.md) | OCR 解析与确认。 |
| [offline/](offline/README.md) | 本地存储、操作队列、离线读写与同步；修改按同步专项验收。 |
<!-- directory-index:end -->
