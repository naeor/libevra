export * from "./billImport.js";

export {
  DEFAULT_DECIMALS,
  decimalsFor,
  formatMinor,
  parseAmountToMinor,
  sumMinor,
} from "./money.js";

export {
  DEFAULT_BOOK_NAME,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHOD_NAMES,
  UNCATEGORISED,
  categoriesFor,
  type CategoryPreset,
} from "./presets.js";

export {
  MAX_RECOGNIZE_BYTES,
  MAX_RECOGNIZE_IMAGES,
  OCR_CHANNELS,
  OCR_CHANNEL_LABELS,
  OCR_DIRECTIONS,
  OCR_DIRECTION_LABELS,
  OCR_PAGE_TYPES,
  OCR_PAGE_TYPE_LABELS,
  RECOGNIZE_MIME_TYPES,
  ocrCandidateSchema,
  ocrChannelSchema,
  ocrDirectionSchema,
  ocrDraftSchema,
  ocrIssueSchema,
  ocrItemResultSchema,
  ocrPageTypeSchema,
  recognizeResponseSchema,
} from "./ocr.js";

export type {
  OcrCandidate,
  OcrChannel,
  OcrDirection,
  OcrDraft,
  OcrIssue,
  OcrItemResult,
  OcrPageType,
  RecognizeResponse,
} from "./ocr.js";

export {
  MAX_STATS_DAYS,
  RANGE_LABELS,
  STATS_BUCKETS,
  STATS_RANGES,
  addDays,
  averagePerDay,
  bucketForPreset,
  calendarDateSchema,
  comparisonRangeFor,
  daysBetween,
  endOfMonth,
  fillSeriesGaps,
  isEndOfMonth,
  isFirstOfMonth,
  periodTotalsSchema,
  rangeForPreset,
  startOfMonth,
  statsBucketSchema,
  statsQuerySchema,
  statsRangeSchema,
  statsResponseSchema,
} from "./stats.js";

export type {
  CategoryTotal,
  DateRange,
  PeriodTotals,
  StatsBucket,
  StatsComparison,
  StatsQuery,
  StatsRangeKey,
  StatsResponse,
  StatsSeriesPoint,
} from "./stats.js";

export {
  TIME_CONTRACT_VERSION,
  WEEK_START_DAY,
  assertCalendarDate,
  bucketKeyOf,
  bucketSpanOf,
  bucketStartOf,
  bucketToInclusive,
  classifyBucket,
  dayKey,
  daySpan,
  daysInSpan,
  enumerateBuckets,
  isCalendarDate,
  isSpanValid,
  isoDayOfWeek,
  isoWeekKey,
  isoWeekOf,
  monthKey,
  monthSpan,
  nextBucketStart,
  parseTimeSpan,
  spanContains,
  spanFromInclusiveDates,
  spanToInclusive,
  weekSpan,
} from "./timeCalendar.js";

export type {
  BucketContext,
  BucketState,
  InclusivePeriod,
  TimeBucket,
  TimeGranularity,
  TimeSpan,
} from "./timeCalendar.js";

export {
  FLOW_SERIES_VERSION,
  TIME_SERIES_VERSION,
  accumulateSeries,
  computeFlowSeries,
  computeTimeSeries,
  isTimeSeriesOptionsValid,
} from "./timeSeries.js";

export type {
  CountKind,
  CumulativeBucketPoint,
  CumulativeResult,
  FlowSeriesBucketPoint,
  FlowSeriesOptions,
  FlowSeriesResult,
  TimeSeriesBucketPoint,
  TimeSeriesEntry,
  TimeSeriesMetric,
  TimeSeriesOptions,
  TimeSeriesResult,
  UnknownReason,
} from "./timeSeries.js";

export {
  MOVING_AVERAGE_VERSION,
  computeTrailingMovingAverage,
  movingAverageSeries,
} from "./movingAverage.js";

export type {
  MovingAverageGapReason,
  MovingAverageOptions,
  MovingAveragePoint,
  MovingAverageResult,
} from "./movingAverage.js";

export {
  DEFAULT_EXTREME_SIGMA,
  EXTREME_SIGMA_SCALE,
  VARIABILITY_VERSION,
  computeDailyExpenseVariability,
  computeIncomeStability,
} from "./variability.js";

export type {
  AmountSummary,
  CoefficientsOfVariation,
  DailyExpenseVariability,
  IncomeStability,
  Ratio,
  SqrtValue,
  VariabilityMetric,
  VariabilityOptions,
  VarianceKind,
} from "./variability.js";

export {
  ANALYSIS_METHOD,
  ANOMALY_METHOD_STRINGS,
  FROZEN_METHOD_ALIASES,
  anomalyMethodString,
  canonicalMethodString,
} from "./analysisMethod.js";

export type {
  AnomalyMethodString,
  CanonicalMethodString,
} from "./analysisMethod.js";

export {
  SEASONAL_COMPARISON_VERSION,
  computeSeasonalComparison,
} from "./seasonal.js";

export type {
  SeasonalComparisonResult,
  SeasonalDescriptiveReason,
  SeasonalGranularity,
  SeasonalMonthCell,
  SeasonalOptions,
  SeasonalQuarterCell,
  SeasonalYear,
} from "./seasonal.js";

export {
  ANOMALY_VERSION,
  anomalyThresholdReference,
  detectDailyExpenseAnomalies,
} from "./anomaly.js";

export type {
  AnomalyBaseline,
  AnomalyMark,
  AnomalyMethod,
  AnomalyOptions,
  AnomalyParameters,
  AnomalyResult,
} from "./anomaly.js";

export {
  CATEGORY_SERIES_VERSION,
  OTHER_CATEGORY_KEY,
  computeCategorySeries,
  computeCategoryShares,
  isCategorySeriesOptionsValid,
  isCompositionComplete,
  topCategoriesByTotal,
} from "./categorySeries.js";

export type {
  CategorySeriesBucket,
  CategorySeriesEntry,
  CategorySeriesOptions,
  CategorySeriesPoint,
  CategorySeriesResult,
  CategoryShareBucket,
  CategorySharePoint,
  CategoryShareResult,
  CategoryShareState,
  CategoryUnknownReason,
  ShareRatio,
} from "./categorySeries.js";

export {
  WEEKDAY_MIN_SAMPLE_DAYS,
  WEEKDAY_PATTERN_VERSION,
  computeWeekdayPattern,
  isWeekdayPatternOptionsValid,
} from "./weekdayPattern.js";

export type {
  Weekday,
  WeekdayAverage,
  WeekdayPatternOptions,
  WeekdayPatternResult,
  WeekdayPoint,
} from "./weekdayPattern.js";

export {
  CALENDAR_HEAT_LEVELS,
  CALENDAR_HEATMAP_VERSION,
  computeCalendarHeatmap,
  isCalendarHeatmapOptionsValid,
} from "./calendarHeatmap.js";

export type {
  CalendarDayCell,
  CalendarHeatmapIntensity,
  CalendarHeatmapOptions,
  CalendarHeatmapResult,
  CalendarMetric,
  CalendarMonth,
  CalendarWeek,
} from "./calendarHeatmap.js";

export {
  PERIOD_COMPARISON_VERSION,
  computePeriodComparison,
  isComparisonRequestValid,
  resolveComparison,
} from "./periodComparison.js";

export type {
  ComparisonEntry,
  ComparisonKind,
  ComparisonMetric,
  ComparisonMode,
  ComparisonNote,
  ComparisonOptions,
  ComparisonRequest,
  ComparisonResolution,
  ComparisonResult,
  GrowthResult,
  GrowthUnavailableReason,
  LeapDayFallback,
  MonthToDatePolicy,
  SideComparison,
} from "./periodComparison.js";

export {
  MULTI_MONTH_COMPARISON_VERSION,
  computeMultiMonthComparison,
  daysInMonth,
  isMonthKey,
  isMultiMonthComparisonValid,
  normalizeMonthKeys,
} from "./multiMonthComparison.js";

export type {
  MonthComparisonNote,
  MonthComparisonOptions,
  MonthComparisonPoint,
  MonthComparisonRequest,
  MonthEntry,
  MonthMetric,
  MonthPointState,
  MonthRankingEntry,
  MonthUnavailableReason,
  MultiMonthComparisonResult,
} from "./multiMonthComparison.js";

export {
  chineseNumeralToDigits,
  findChineseAmount,
  isNumeralChar,
} from "./chineseNumerals.js";

export {
  matchCategory,
  type CategoryCandidate,
  type CategoryMatch,
} from "./categoryMatch.js";

export {
  MAX_SPEECH_BYTES,
  MAX_SPEECH_SECONDS,
  cleanNote,
  isSpeechless,
  parseSpokenEntry,
  parseSpokenEntryWithCategory,
  type SpokenEntry,
} from "./speech.js";

export { transcribeResponseSchema, type TranscribeResponse } from "./voiceParsing.js";

export {
  fieldStatusSchema,
  hasMultipleTransactions,
  looksStructured,
  parseTransactionText,
  parseTransactionTexts,
  splitTransactionTexts,
  transactionFieldStatusSchema,
  transactionIssueSchema,
  transactionTextResultSchema,
  type FieldStatus,
  type ParseTransactionTextOptions,
  type TransactionFieldStatus,
  type TransactionIssue,
  type TransactionTextResult,
} from "./transactionText.js";

export { healthResponseSchema, type HealthResponse } from "./health.js";

export {
  csvField,
  csvRow,
  csvRowEscaped,
  escapeFormula,
  parseCsv,
  startsFormula,
  unescapeFormula,
} from "./spreadsheet.js";

export {
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  MAX_EXPORT_ROWS,
  MAX_IMPORT_ROWS,
  TEMPLATE_COLUMN_KEYS,
  exportFormatSchema,
  exportQuerySchema,
  exportReceiptSchema,
  importReportSchema,
  importRequestSchema,
  importRowErrorSchema,
  type ExportColumnKey,
  type ExportFormat,
  type ExportQuery,
  type ExportReceipt,
  type ImportReport,
  type ImportRequest,
  type ImportRowError,
} from "./export.js";

export {
  EXPORT_REF_PREFIX,
  IMPORT_REF_PREFIX,
  REF_LENGTH,
  REF_PATTERN,
  exportRefSchema,
  fileRefSchema,
  importRefSchema,
  isExportRef,
  isImportRef,
  isOurRef,
  newExportRef,
  newImportRef,
  refStamp,
  type ExportRef,
  type FileRef,
  type ImportRef,
} from "./refs.js";

export {
  INVITE_CODE_PATTERN,
  INVITE_REJECTION_CODE,
  INVITE_REJECTION_MESSAGE,
  INVITE_VALID_DAYS,
  INVITE_VALID_MS,
  SECONDARY_INVITE_LIMIT,
  SHARE_LINK_MAX_DAYS,
  SHARE_LINK_MAX_PEOPLE,
  SHARE_LINK_MIN_DAYS,
  SHARE_LINK_MIN_PEOPLE,
  rejectInvite,
  type InviteRejection,
} from "./invites.js";

export {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  apiErrorSchema,
  acceptedAgreementSchema,
  authResponseSchema,
  changePasswordRequestSchema,
  displayNameSchema,
  inviteCodeSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordSchema,
  recoverRequestSchema,
  recoveryCodeResponseSchema,
  regenerateRecoveryCodeRequestSchema,
  registerRequestSchema,
  registrationConfigResponseSchema,
  registrationModeSchema,
  sessionUserSchema,
  updatePreferencesRequestSchema,
  usernameSchema,
  type ApiError,
  type AuthResponse,
  type MeResponse,
  type RecoveryCodeResponse,
  type RegistrationConfigResponse,
  type RegistrationMode,
  type SessionUser,
  type UpdatePreferencesRequest,
} from "./auth.js";

export {
  CURRENCIES,
  LEDGER_OPERATION_ACTIONS,
  LEDGER_OPERATION_OBJECT_TYPES,
  MAX_AMOUNT_CENTS,
  MAX_TAGS_PER_TRANSACTION,
  TAGS_SHOWN_IN_LIST,
  TRANSACTION_KINDS,
  UNCATEGORISED_NAME,
  amountCentsSchema,
  bookRoleSchema,
  categoryNameSchema,
  categorySchema,
  classificationDeleteResponseSchema,
  classificationUsageResponseSchema,
  createCategorySchema,
  createPaymentMethodSchema,
  createTagSchema,
  createTransactionSchema,
  formatTransactionNumber,
  currencySchema,
  currencySummarySchema,
  duplicateCheckResponseSchema,
  duplicateCheckSchema,
  ledgerMetaResponseSchema,
  ledgerOperationActionSchema,
  ledgerOperationListResponseSchema,
  ledgerOperationObjectTypeSchema,
  ledgerOperationSchema,
  paymentMethodNameSchema,
  paymentMethodSchema,
  permanentDeleteCategorySchema,
  permanentDeletePaymentMethodSchema,
  summaryResponseSchema,
  tagColorSchema,
  tagNameSchema,
  tagSchema,
  transactionKindSchema,
  transactionListResponseSchema,
  transactionSchema,
  updateCategorySchema,
  updatePaymentMethodSchema,
  updateTagSchema,
  updateTransactionSchema,
  uuidSchema,
  type Category,
  type ClassificationDeleteResponse,
  type ClassificationUsageResponse,
  type CreateCategoryInput,
  type CreatePaymentMethodInput,
  type CreateTagInput,
  type CreateTransactionInput,
  type Currency,
  type CurrencySummary,
  type DuplicateCheckInput,
  type DuplicateCheckResponse,
  type LedgerMetaResponse,
  type LedgerOperation,
  type LedgerOperationAction,
  type LedgerOperationListResponse,
  type LedgerOperationObjectType,
  type PaymentMethod,
  type PermanentDeleteCategoryInput,
  type PermanentDeletePaymentMethodInput,
  type SummaryResponse,
  type Tag,
  type Transaction,
  type TransactionKind,
  type TransactionListResponse,
  type UpdateCategoryInput,
  type UpdatePaymentMethodInput,
  type UpdateTagInput,
  type UpdateTransactionInput,
} from "./ledger.js";
export {
  AUXILIARY_MATCH_FIELDS,
  DEFAULT_DUPLICATE_DETECTION_SETTINGS,
  DUPLICATE_SCOPE_LABELS,
  DUPLICATE_TIME_WINDOW_MAX_SECONDS,
  DUPLICATE_TIME_WINDOW_MIN_SECONDS,
  DUPLICATE_TIME_WINDOW_PRESETS_SECONDS,
  describeDuplicateMatch,
  duplicatePairKey,
  evaluateDuplicateCandidates,
  evaluateDuplicatePair,
  recoverDuplicateDetectionSettings,
  validateDuplicateDetectionSettings,
  type DuplicateBatchResult,
  type DuplicateCandidateFields,
  type DuplicateCandidateKind,
  type DuplicateDetectionSettings,
  type DuplicateExclusionCode,
  type DuplicateField,
  type DuplicatePairResult,
  type DuplicateResultExtensions,
  type DuplicateRule,
  type DuplicateRuleEvaluation,
  type DuplicateRuleOutcome,
  type DuplicateSettingsField,
  type DuplicateSettingsIssue,
  type DuplicateSettingsIssueCode,
  type DuplicateSettingsRecovery,
  type DuplicateSettingsValidation,
  type DuplicateTimePrecision,
} from "./duplicateDetection.js";

export {
  AUDIT_ACTIONS,
  FIRST_BATCH_ACCOUNT_FIRST,
  FIRST_BATCH_ACCOUNT_LAST,
  FIRST_BATCH_SIZE,
  isFirstBatchAccountNumber,
  adminAccountActionResponseSchema,
  adminAuditListResponseSchema,
  adminCreateInviteRequestSchema,
  adminCreateInviteResponseSchema,
  adminInviteListResponseSchema,
  adminInviteSchema,
  adminInviteShapeSchema,
  adminInviteStatusSchema,
  adminOverviewResponseSchema,
  adminRestoreRequestSchema,
  adminRevokeInviteRequestSchema,
  adminRosterEntrySchema,
  adminRosterResponseSchema,
  adminSelfResponseSchema,
  adminSuspendRequestSchema,
  adminUserSchema,
  adminUserSearchResponseSchema,
  auditEntrySchema,
  type AdminAccountActionResponse,
  type AdminAuditListResponse,
  type AdminCreateInviteRequest,
  type AdminCreateInviteResponse,
  type AdminInvite,
  type AdminInviteListResponse,
  type AdminInviteShape,
  type AdminInviteStatus,
  type AdminOverviewResponse,
  type AdminRestoreRequest,
  type AdminRevokeInviteRequest,
  type AdminRosterEntry,
  type AdminRosterResponse,
  type AdminSelfResponse,
  type AdminSuspendRequest,
  type AdminUser,
  type AdminUserSearchResponse,
  type AuditAction,
  type AuditEntry,
} from "./admin.js";

export { APP_VERSION } from "./version.js";

export {
  RELEASE_MAJOR_ANNOUNCEMENT_1_14_18,
  RELEASE_MAJOR_ANNOUNCEMENT_1_15_00,
  RELEASE_MAJOR_ANNOUNCEMENT_1_17_11,
  TEST_LEGAL_DOCUMENT,
  TEST_MAJOR_ANNOUNCEMENT,
  activeLegalDocuments,
  activeMajorAnnouncements,
  legalDocumentById,
  majorAnnouncementById,
  type LegalDocument,
  type MajorAnnouncement,
} from "./consent.js";

export {
  MAX_IMPORT_TRANSACTIONS,
  canonicalGuestSourceText,
  canonicalTargetSnapshotText,
  duplicateDecisionSchema,
  duplicateGroupSourceActionSchema,
  duplicateGroupTargetActionSchema,
  DEFAULT_IMPORT_BATCH_SIZE,
  fingerprintGuestSource,
  fingerprintImportSourceRecord,
  fingerprintTargetSnapshot,
  formalImportPreviewRequestSchema,
  formalImportPreviewResponseSchema,
  formalSourceDispositionSchema,
  guestCleanupPreviewRequestSchema,
  guestCleanupPreviewResponseSchema,
  guestImportCategorySchema,
  guestImportPaymentMethodSchema,
  guestImportSourceSchema,
  guestImportTagSchema,
  guestImportTransactionSchema,
  IMPORT_BATCH_THRESHOLD,
  incrementalDecisionActionValues,
  incrementalDecisionSchema,
  incrementalPreviewRequestSchema,
  incrementalPreviewResponseSchema,
  incrementalSourceStatusSchema,
  incrementalSourceStatusValues,
  importJobRequestSchema,
  importJobStatusSchema,
  importTargetSnapshotSchema,
  ledgerImportRequestSchema,
  ledgerImportResultSchema,
  sha256Hex,
  taxonomyResolutionSchema,
  type DuplicateDecision,
  type DuplicateGroupSourceAction,
  type DuplicateGroupTargetAction,
  type FormalSourceDisposition,
  type GuestCleanupPreviewRequest,
  type GuestCleanupPreviewResponse,
  type IncrementalDecision,
  type IncrementalDecisionAction,
  type IncrementalPreviewRequest,
  type IncrementalPreviewResponse,
  type IncrementalSourceStatus,
  type IncrementalSourceStatusValue,
  type FormalImportPreviewRequest,
  type FormalImportPreviewResponse,
  type GuestImportCategory,
  type GuestImportPaymentMethod,
  type GuestImportSource,
  type GuestImportTag,
  type GuestImportTransaction,
  type ImportTargetSnapshot,
  type ImportJobRequest,
  type ImportJobStatus,
  type LedgerImportRequest,
  type LedgerImportResult,
  type TaxonomyResolution,
} from "./ledgerImport.js";

export {
  MAX_NOT_DUPLICATE_GROUP_SIZE,
  MAX_NOT_DUPLICATE_PAIRS_PER_REQUEST,
  NOT_DUPLICATE_DECISION_SOURCES,
  NOT_DUPLICATE_DECISION_SOURCE_LABELS,
  NOT_DUPLICATE_KEY_FIELDS,
  NOT_DUPLICATE_RELATIONSHIP,
  NOT_DUPLICATE_REVOCATION_REASONS,
  buildNotDuplicateBasis,
  createNotDuplicateRelationsSchema,
  expandNotDuplicatePairs,
  isNotDuplicateBasisStale,
  keyFieldsChanged,
  normalizeNotDuplicatePair,
  notDuplicatePairKey,
  notDuplicatePairKeySet,
  notDuplicatePairSchema,
  notDuplicateRelationListResponseSchema,
  notDuplicateRelationMutationResponseSchema,
  notDuplicateRelationSchema,
  notDuplicateRelationTransactionSchema,
  readNotDuplicateBasis,
  type CreateNotDuplicateRelationsInput,
  type NotDuplicateBasis,
  type NotDuplicateBasisStaleness,
  type NotDuplicateBasisTransaction,
  type NotDuplicateCurrentTransaction,
  type NotDuplicateDecisionSource,
  type NotDuplicateKeyField,
  type NotDuplicatePair,
  type NotDuplicatePairError,
  type NotDuplicatePairResult,
  type NotDuplicateRelation,
  type NotDuplicateRelationListResponse,
  type NotDuplicateRelationMutationResponse,
  type NotDuplicateRelationTransaction,
  type NotDuplicateRevocationReason,
  type NotDuplicateRelationship,
} from "./notDuplicateRelations.js";

export {
  duplicateRulesSchema, duplicateCandidateSchema, duplicateCandidatesRequestSchema, duplicateReviewRequestSchema,
  duplicateImportReviewRequestSchema,
  groupDuplicatePairs,
  type DuplicateCandidatesResponse,
  type DuplicateImportReviewRequest,
  type DuplicateImportReviewResponse,
  type DuplicatePairGroup,
  type DuplicateReviewChunk,
  type DuplicateReviewCursor,
} from "./duplicateReview.js";
export { AVATAR_IDS, APPROVED_AVATAR_IDS, SELECTABLE_AVATAR_IDS, avatarIdSchema, updateProfileRequestSchema, type AvatarId, type UpdateProfileRequest } from "./profile.js";

export {
  AVATAR_REWARD_ACTIVITIES,
  AVATAR_REWARD_RULE_KINDS,
  AVATAR_REWARD_SOURCES,
  SPECIAL_AVATAR_IDS,
  avatarRewardActivityById,
  avatarRewardActivityForAvatar,
  avatarRewardActivitySchema,
  avatarRewardEventConfirmParamsSchema,
  avatarRewardEventSchema,
  avatarRewardMakeUpActivities,
  avatarRewardMakeUpRequestSchema,
  avatarRewardMakeUpResponseSchema,
  avatarRewardSourceSchema,
  avatarRewardUnlockSchema,
  avatarRewardsResponseSchema,
  isClassicAvatarId,
  isSpecialAvatarId,
  specialAvatarIdSchema,
  type AvatarRewardActivity,
  type AvatarRewardActivitySummary,
  type AvatarRewardEvent,
  type AvatarRewardMakeUpRequest,
  type AvatarRewardMakeUpResponse,
  type AvatarRewardRule,
  type AvatarRewardRuleKind,
  type AvatarRewardSource,
  type AvatarRewardUnlock,
  type AvatarRewardsResponse,
  type SpecialAvatarId,
} from "./rewards.js";

export {
  QUOTE_REFERENCE_KINDS,
  messageReferenceInputSchema,
  quoteReferenceKindSchema,
  type MessageReferenceInput,
  type MessageReferenceView,
  type QuoteEventTargetView,
  type QuoteReferenceKind,
  type QuoteSnapshot,
  type QuoteTargetView,
  type QuoteTargetsResponse,
  type QuoteTransactionTargetView,
  type QuotedEventChange,
  type QuotedEventSnapshot,
  type QuotedTransactionSnapshot,
} from "./messages.js";
export * from "./fx.js";
export * from "./fxHistory.js";

// ---- S17 工作台布局层（Agent D · I-0；Lead m02333 批准） ----
// additive 精选导出：只导出集成/卡片/编辑器需要的公共面；**禁止 `export *` 全量并入**。
// 低层辅助与测试符号（test-support/test-prng、*_PLACEHOLDER、迁移步骤表、修复顺序表、
// findForbiddenKey/sharePayloadByteLength 等）只留在 `./analysis/layout/*` 子路径。
// 布局层为纯数据/纯函数：不做财务计算、不读写账务、无 I/O/DOM/时钟/随机（随机源由调用方注入）。
// 静态守卫见 `./analysis/layout/export-surface.test.ts`。

// 1) 布局文档模型与常量
export {
  LAYOUT_SCHEMA_VERSION,
  LAYOUT_ALGORITHM_VERSION,
  MIN_COLUMNS,
  MAX_COLUMNS,
  MAX_ROW_SPAN,
  MAX_OBJECTS_PER_WORKBENCH,
  MAX_CONTAINERS_PER_WORKBENCH,
  MIN_CAROUSEL_PAGES,
  MAX_CAROUSEL_PAGES,
  MAX_GRID_SPLIT_CHILDREN,
  CONTAINER_MAX_DEPTH,
  type GridSize,
  type LayoutObjectKind,
  type LayoutMode,
  type AnalysisReference,
  type ChartPresentation,
  type CardTitleSpec,
  type TitleKind,
  type RangePolicy,
  type AnalysisCardNode,
  type GridSplitConfig,
  type GridSplitNode,
  type CarouselNode,
  type ContainerNode,
  type SpacerNode,
  type WorkbenchNode,
  type WorkbenchContentDocumentV1,
  type ObjectGeometry,
  type LayoutGeometry,
  type LayoutProfile,
  type LayoutDocumentV1,
} from "./analysis/layout/types.js";

// 2) 尺寸契约与投影类型
export type {
  DisplayForm,
  ObjectSizeContract,
  MigrationStrategy,
  DegradeReason,
  ProjectedObject,
  ProjectionIssue,
  ProjectionResult,
  LayoutValidationIssue,
  ProjectOptions,
} from "./analysis/layout/types.js";

// 3) 行优先网格几何与投影
export {
  isPositiveInteger,
  isCoordinateInColumn,
  positionToRowCol,
  rowColToPosition,
  placementFitsColumns,
  placementCells,
  placementCellsOverlap,
  toCellSet,
  findEarliestFreeAnchor,
  validateGeometry,
} from "./analysis/layout/grid.js";

export { projectLayout, projectionToGeometry } from "./analysis/layout/projection.js";

// 4) 文档校验 / 序列化 / 损坏容错
export {
  emptyLayoutDocument,
  emptyContentDocument,
  loadLayoutDocument,
  loadContentDocument,
  roundTripLayoutDocument,
  roundTripContentDocument,
  type DocumentLoadResult,
  type DocumentRoundTripResult,
} from "./analysis/layout/document-io.js";

export {
  validateLayoutDocumentV1,
  validateContentDocumentV1,
  serializeContentDocumentV1,
  serializeLayoutDocumentV1,
  parseContentDocumentV1,
  parseLayoutDocumentV1,
  type DocumentValidationIssue,
  type DocumentValidationResult,
} from "./analysis/layout/validation.js";

// 5) 配置版本迁移链与投影缓存键
export {
  readDeclaredSchemaVersion,
  runMigrationChain,
  migrateLayoutDocument,
  migrateContentDocument,
  deriveProjectionCacheKey,
  type MigrationStatus,
  type MigrationStep,
  type MigrationChainResult,
  type MigrationChainOptions,
  type ProjectionCacheKeyInput,
} from "./analysis/layout/migration-chain.js";

// 6) 独立布局档案与统一/独立模式迁移
export {
  isValidProfileKey,
  profileKeyForColumns,
  profileKeyForWidth,
  findProfile,
  isProfileMaterialized,
  listProfileKeys,
  resolveProfile,
  materializeProfile,
  switchLayoutMode,
  adoptProfileAsMain,
  findUnplacedContentObjects,
  type ProfileProjectionOptions,
  type ProfileResolution,
  type MaterializeProfileResult,
  type ModeSwitchResult,
  type AdoptProfileResult,
} from "./analysis/layout/profiles.js";

// 7) 容器数据模型 / 1×1 占位语义 / 垂直紧凑 / 确定性修复
export {
  normalizeGridSplitRatios,
  describeGridSplitSlots,
  containerChildBounds,
  validateContainerTree,
  deriveContainerDisplay,
  collapseContainerGeometry,
  restoreContainerGeometry,
  isUserCollapsed,
  isPlaceholderForm,
  type ContainerFailureCode,
  type ContainerIssue,
  type GridSplitSlots,
  type ContainerDisplay,
} from "./analysis/layout/containers.js";

export { compactVertically, type CompactionResult } from "./analysis/layout/compaction.js";

export {
  repairLayoutGeometry,
  type GeometryRepairCode,
  type GeometryRepair,
  type GeometryRepairResult,
} from "./analysis/layout/repair.js";

// 8) 编辑器（headless 命令/焦点/状态机）
export {
  createEditorState,
  applyCommand,
  type EditorSnapshot,
  type EditorHistory,
  type EditorState,
  type CreateEditorStateOptions,
  type CommandResult,
  type LayoutCommand,
  type ApplyCommandOptions,
} from "./analysis/layout/commands.js";

export {
  focusedGeometry,
  currentFocus,
  findDirectionalNeighbor,
  moveFocus,
  commandForKey,
  type GridDirection,
  type KeyInput,
} from "./analysis/layout/focus.js";

export {
  INITIAL_EDITOR_MACHINE_STATE,
  transitionEditorMachine,
  type EditorMode,
  type EditorPhase,
  type EditorMachineState,
  type EditorEffect,
  type EditorMachineTransition,
  type EditorMachineEvent,
} from "./analysis/layout/machine.js";

// 9) G-12a v1.1 分析参数白名单校验与分享导入门
export {
  ANALYSIS_PARAMS_SCHEMA_VERSION,
  MAX_ANALYSIS_PARAMS_KEYS,
  MAX_ANALYSIS_PARAMS_ID_ITEMS,
  MAX_RELATIVE_DAYS,
  MAX_ABSOLUTE_RANGE_DAYS,
  MAX_LONG_RANGE_DAYS,
  TIME_PRESETS,
  TIME_FIXED_PRESETS,
  COMPARISON_POLICIES,
  ANALYSIS_KINDS,
  isAnalysisParamsErrorCode,
  isKnownAnalysisId,
  analysisParamsKeys,
  validateAnalysisParams,
  checkShareImportGate,
  isAcceptableAnalysisReference,
  type TimePreset,
  type TimeFixedPreset,
  type ComparisonPolicy,
  type AnalysisKind,
  type AnalysisParamsErrorCode,
  type AnalysisParamsIssue,
  type AnalysisParamsStatus,
  type AnalysisParamsReadonlyReason,
  type AnalysisParamsValidationResult,
  type AnalysisParamsValidationOptions,
  type ShareImportGateResult,
} from "./analysis/layout/params-validation.js";

// 10) 分享快照纯函数 / 导入管道 / 本地存储契约（W6 前只登记契约）
export {
  SHARE_SNAPSHOT_SCHEMA_VERSION,
  MAX_SHARE_PAYLOAD_BYTES,
  MAX_SHARE_TEMPLATE_NAME_LENGTH,
  MAX_SHARE_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_SHARE_LANGUAGE_LENGTH,
  SHARE_CODE_ALPHABET,
  SHARE_CODE_MIN_LENGTH,
  SHARE_CODE_MAX_LENGTH,
  SHARE_CODE_DEFAULT_LENGTH,
  buildShareSnapshot,
  validateShareSnapshot,
  parseShareSnapshot,
  parseShareSnapshotJson,
  serializeShareSnapshot,
  exportShareSnapshot,
  normalizeShareCode,
  isValidShareCode,
  createShareCode,
  type ShareTemplateInfo,
  type ShareCardPayload,
  type ShareGridSplitPayload,
  type ShareCarouselPayload,
  type ShareContainerPayload,
  type ShareGeometryPayload,
  type ShareProfilePayload,
  type ShareLayoutPayload,
  type ShareSnapshotV1,
  type ShareExportOptions,
  type ShareSerializeResult,
  type ShareCodeRandomSource,
} from "./analysis/layout/share-snapshot.js";

export {
  prepareShareImport,
  isWithinImportLimits,
  type ImportObjectIdFactory,
  type ShareImportOptions,
  type ImportRebindRequest,
  type ImportPreview,
  type ShareImportResult,
} from "./analysis/layout/import-pipeline.js";

export {
  WORKBENCH_LOCAL_STORE_SCHEMA_VERSION,
  createEmptyLocalRecord,
  mergeLayoutDocuments,
  mergeContentDocuments,
  type VersionedDocument,
  type WorkbenchLocalRecordV1,
  type DocumentMergeConflict,
  type LayoutMergeResult,
  type ContentMergeResult,
  type SyncPushResult,
  type SyncPullResult,
  type WorkbenchSyncTransport,
  type WorkbenchLocalStore,
} from "./analysis/layout/storage-contract.js";

export * from "./analysis/index.js";
/** T2 read-only analytics endpoints (owner-approved 2026-10-27; see task doc §15). */
export * from "./analytics.js";
export * from "./categoryTree.js";
