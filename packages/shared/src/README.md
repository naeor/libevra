# packages/shared/src · 阅读入口

源码入口和子模块。

优先阅读[任务索引](../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [admin.ts](admin.ts) | 实现模块；入口/导出：AUDIT_ACTIONS、AuditAction、auditEntrySchema、AuditEntry、adminSelfResponseSchema |
| [analysisMethod.test.ts](analysisMethod.test.ts) | 测试：analysisMethod |
| [analysisMethod.ts](analysisMethod.ts) | 实现模块；入口/导出：ANALYSIS_METHOD、CanonicalMethodString、FROZEN_METHODS、FrozenMethod、OPEN_EXTENSION_METHODS |
| [analytics.test.ts](analytics.test.ts) | 测试：analytics |
| [analytics.ts](analytics.ts) | 实现模块；入口/导出：ANALYTICS_DEFAULT_PAGE_SIZE、ANALYTICS_MAX_PAGE_SIZE、analyticsAmountMinorSchema、analyticsTransactionsQuerySchema、AnalyticsTransactionsQuery |
| [anomaly.test.ts](anomaly.test.ts) | 测试：anomaly |
| [anomaly.ts](anomaly.ts) | 实现模块；入口/导出：ANOMALY_VERSION、AnomalyMethod、AnomalyOptions、AnomalyParameters、AnomalyBaseline |
| [attachments.ts](attachments.ts) | 实现模块；入口/导出：ATTACHMENT_CHUNK_BYTES、AttachmentView、StorageLimits、AccountStorageView、BookStorageView |
| [auth.ts](auth.ts) | 实现模块；入口/导出：USERNAME_PATTERN、PASSWORD_MIN_LENGTH、PASSWORD_MAX_LENGTH、DISPLAY_NAME_MAX_LENGTH、usernameSchema |
| [avatarIds.ts](avatarIds.ts) | 实现模块；入口/导出：AVATAR_IDS、APPROVED_AVATAR_IDS、SELECTABLE_AVATAR_IDS、avatarIdSchema、AvatarId |
| [billImport.ts](billImport.ts) | 实现模块；入口/导出：MAX_BILL_IMPORT_BYTES、MAX_BILL_IMPORT_ROWS、BILL_IMPORT_PREVIEW_TTL_MS、billImportCommitRowSchema、BillImportCommitRow |
| [calendarHeatmap.test.ts](calendarHeatmap.test.ts) | 测试：calendarHeatmap |
| [calendarHeatmap.ts](calendarHeatmap.ts) | 实现模块；入口/导出：CALENDAR_HEATMAP_VERSION、CalendarMetric、CALENDAR_HEAT_LEVELS、CalendarHeatmapOptions、CalendarDayCell |
| [categoryMatch.test.ts](categoryMatch.test.ts) | 测试：categoryMatch |
| [categoryMatch.ts](categoryMatch.ts) | 实现模块；入口/导出：CategoryCandidate、CategoryMatch、matchCategory |
| [categorySeries.test.ts](categorySeries.test.ts) | 测试：categorySeries |
| [categorySeries.ts](categorySeries.ts) | 实现模块；入口/导出：CATEGORY_SERIES_VERSION、OTHER_CATEGORY_KEY、CategoryUnknownReason、CategorySeriesEntry、CategorySeriesOptions |
| [categoryTree.test.ts](categoryTree.test.ts) | 测试：categoryTree |
| [categoryTree.ts](categoryTree.ts) | 实现模块；入口/导出：CategoryNode、MAX_CATEGORY_DEPTH、categoryPath、categoryBranchIds、validateCategoryTree |
| [chineseNumerals.test.ts](chineseNumerals.test.ts) | 测试：chineseNumerals |
| [chineseNumerals.ts](chineseNumerals.ts) | 实现模块；入口/导出：chineseNumeralToDigits、findChineseAmount、isNumeralChar |
| [consent.test.ts](consent.test.ts) | 测试：consent |
| [consent.ts](consent.ts) | 实现模块；入口/导出：LegalDocument、MajorAnnouncement、TEST_LEGAL_DOCUMENT、TEST_MAJOR_ANNOUNCEMENT、RELEASE_MAJOR_ANNOUNCEMENT_1_14_18 |
| [detailCards.test.ts](detailCards.test.ts) | 测试：detailCards |
| [detailCards.ts](detailCards.ts) | 实现模块；入口/导出：detailNumbers、detailCharts、detailMetricSchema、DetailMetric、isDetailChart |
| [duplicateDetection.test.ts](duplicateDetection.test.ts) | 测试：duplicateDetection |
| [duplicateDetection.ts](duplicateDetection.ts) | 实现模块；入口/导出：DuplicateCandidateKind、DuplicateTimePrecision、DUPLICATE_TIME_WINDOW_MIN_SECONDS、DUPLICATE_TIME_WINDOW_MAX_SECONDS、DUPLICATE_TIME_WINDOW_PRESETS_SECONDS |
| [duplicateReview.test.ts](duplicateReview.test.ts) | 测试：duplicateReview |
| [duplicateReview.ts](duplicateReview.ts) | 实现模块；入口/导出：duplicateRulesSchema、duplicateCandidateSchema、duplicateCandidatesRequestSchema、duplicateReviewCursorSchema、DuplicateReviewCursor |
| [export.ts](export.ts) | 实现模块；入口/导出：EXPORT_COLUMNS、ExportColumnKey、TEMPLATE_COLUMN_KEYS、EXPORT_FORMATS、exportFormatSchema |
| [flowSeries.test.ts](flowSeries.test.ts) | 测试：flowSeries |
| [fx.test.ts](fx.test.ts) | 测试：fx |
| [fx.ts](fx.ts) | 实现模块；入口/导出：FX_POLICY、FX_MAX_FALLBACK_DAYS、FX_MAX_RANGE_MONTHS、FX_MAX_DETAIL_ENTRIES、FxReason |
| [fxDetail.test.ts](fxDetail.test.ts) | 测试：fxDetail |
| [fxHistory.ts](fxHistory.ts) | 实现模块；入口/导出：FxError、FxStored、FxRepository、FxProvider、MemoryFxRepository |
| [fxPerformance.test.ts](fxPerformance.test.ts) | 测试：fxPerformance |
| [health.test.ts](health.test.ts) | 测试：health |
| [health.ts](health.ts) | 实现模块；入口/导出：healthResponseSchema、HealthResponse |
| [index.ts](index.ts) | 实现模块；按文件名定位 index.ts |
| [invites.test.ts](invites.test.ts) | 测试：invites |
| [invites.ts](invites.ts) | 实现模块；入口/导出：INVITE_VALID_DAYS、INVITE_VALID_MS、InviteRejection、rejectInvite、INVITE_REJECTION_MESSAGE |
| [ledger.ts](ledger.ts) | 实现模块；入口/导出：CURRENCIES、currencySchema、Currency、TRANSACTION_KINDS、transactionKindSchema |
| [ledgerImport.ts](ledgerImport.ts) | 实现模块；入口/导出：MAX_IMPORT_TRANSACTIONS、DEFAULT_IMPORT_BATCH_SIZE、MAX_IMPORT_BATCH_SIZE、IMPORT_BATCH_THRESHOLD、guestImportCategorySchema |
| [messages.ts](messages.ts) | 实现模块；入口/导出：QUOTE_REFERENCE_KINDS、quoteReferenceKindSchema、QuoteReferenceKind、messageReferenceInputSchema、MessageReferenceInput |
| [money.test.ts](money.test.ts) | 测试：money |
| [money.ts](money.ts) | 实现模块；入口/导出：DEFAULT_DECIMALS、decimalsFor、parseAmountToMinor、formatMinor、sumMinor |
| [movingAverage.test.ts](movingAverage.test.ts) | 测试：movingAverage |
| [movingAverage.ts](movingAverage.ts) | 实现模块；入口/导出：MOVING_AVERAGE_VERSION、MovingAverageGapReason、MovingAveragePoint、MovingAverageResult、MovingAverageOptions |
| [multiMonthComparison.test.ts](multiMonthComparison.test.ts) | 测试：multiMonthComparison |
| [multiMonthComparison.ts](multiMonthComparison.ts) | 实现模块；入口/导出：MULTI_MONTH_COMPARISON_VERSION、MonthMetric、MonthEntry、MonthPointState、MonthUnavailableReason |
| [notDuplicateRelations.test.ts](notDuplicateRelations.test.ts) | 测试：notDuplicateRelations |
| [notDuplicateRelations.ts](notDuplicateRelations.ts) | 实现模块；入口/导出：NOT_DUPLICATE_RELATIONSHIP、NotDuplicateRelationship、NOT_DUPLICATE_DECISION_SOURCES、NotDuplicateDecisionSource、NOT_DUPLICATE_DECISION_SOURCE_LABELS |
| [ocr.test.ts](ocr.test.ts) | 测试：ocr |
| [ocr.ts](ocr.ts) | 实现模块；入口/导出：OCR_CHANNELS、ocrChannelSchema、OcrChannel、OCR_CHANNEL_LABELS、OCR_PAGE_TYPES |
| [performance.test.ts](performance.test.ts) | 测试：performance |
| [periodComparison.test.ts](periodComparison.test.ts) | 测试：periodComparison |
| [periodComparison.ts](periodComparison.ts) | 实现模块；入口/导出：PERIOD_COMPARISON_VERSION、ComparisonKind、MonthToDatePolicy、ComparisonMetric、ComparisonEntry |
| [presets.ts](presets.ts) | 实现模块；入口/导出：CategoryPreset、EXPENSE_CATEGORIES、INCOME_CATEGORIES、PAYMENT_METHOD_NAMES、categoriesFor |
| [profile.test.ts](profile.test.ts) | 测试：profile |
| [profile.ts](profile.ts) | 实现模块；入口/导出：updateProfileRequestSchema、UpdateProfileRequest |
| [properties.test.ts](properties.test.ts) | 测试：properties |
| [refs.test.ts](refs.test.ts) | 测试：refs |
| [refs.ts](refs.ts) | 实现模块；入口/导出：EXPORT_REF_PREFIX、IMPORT_REF_PREFIX、REF_PATTERN、REF_STAMP_SQL、REF_LENGTH |
| [rewards.ts](rewards.ts) | 实现模块；入口/导出：SPECIAL_AVATAR_IDS、SpecialAvatarId、specialAvatarIdSchema、AVATAR_REWARD_SOURCES、AvatarRewardSource |
| [seasonal.test.ts](seasonal.test.ts) | 测试：seasonal |
| [seasonal.ts](seasonal.ts) | 实现模块；入口/导出：SEASONAL_COMPARISON_VERSION、SeasonalGranularity、SeasonalDescriptiveReason、SeasonalOptions、SeasonalMonthCell |
| [speech.test.ts](speech.test.ts) | 测试：speech |
| [speech.ts](speech.ts) | 实现模块；入口/导出：AmountCandidate、SpokenEntry、parseSpokenEntry、findAmountCandidates、findSpokenAmount |
| [spokenEntry.test.ts](spokenEntry.test.ts) | 测试：spokenEntry |
| [spreadsheet.test.ts](spreadsheet.test.ts) | 测试：spreadsheet |
| [spreadsheet.ts](spreadsheet.ts) | 实现模块；入口/导出：startsFormula、escapeFormula、unescapeFormula、csvField、csvRow |
| [stats.test.ts](stats.test.ts) | 测试：stats |
| [stats.ts](stats.ts) | 实现模块；入口/导出：calendarDateSchema、addDays、daysBetween、startOfMonth、endOfMonth |
| [timeCalendar.test.ts](timeCalendar.test.ts) | 测试：timeCalendar |
| [timeCalendar.ts](timeCalendar.ts) | 实现模块；入口/导出：TIME_CONTRACT_VERSION、WEEK_START_DAY、TimeGranularity、TimeSpan、BucketState |
| [timeSeries.test.ts](timeSeries.test.ts) | 测试：timeSeries |
| [timeSeries.ts](timeSeries.ts) | 实现模块；入口/导出：TIME_SERIES_VERSION、TimeSeriesMetric、CountKind、UnknownReason、TimeSeriesEntry |
| [transactionText.test.ts](transactionText.test.ts) | 测试：transactionText |
| [transactionText.ts](transactionText.ts) | 实现模块；入口/导出：FieldStatus、TransactionIssue、TransactionFieldStatus、TransactionTextResult、ParseTransactionTextOptions |
| [unknownDates.test.ts](unknownDates.test.ts) | 测试：unknownDates |
| [variability.test.ts](variability.test.ts) | 测试：variability |
| [variability.ts](variability.ts) | 实现模块；入口/导出：VARIABILITY_VERSION、VariabilityMetric、VariabilityOptions、Ratio、SqrtValue |
| [version.ts](version.ts) | 实现模块；入口/导出：APP_VERSION |
| [voiceParsing.ts](voiceParsing.ts) | 实现模块；入口/导出：transcribeResponseSchema、TranscribeResponse |
| [weekdayPattern.test.ts](weekdayPattern.test.ts) | 测试：weekdayPattern |
| [weekdayPattern.ts](weekdayPattern.ts) | 实现模块；入口/导出：WEEKDAY_PATTERN_VERSION、WEEKDAY_MIN_SAMPLE_DAYS、Weekday、WeekdayPatternOptions、WeekdayAverage |

| 子目录 | 职责 |
|---|---|
| [analysis/](analysis/README.md) | 共享财务分析计算与结果契约。 |
| [workbench/](workbench/README.md) | 共享工作台配置。 |
<!-- directory-index:end -->
