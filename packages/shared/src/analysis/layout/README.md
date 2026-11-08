# packages/shared/src/analysis/layout · 阅读入口

工作台布局模型、迁移、命令与导入导出。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [commands.test.ts](commands.test.ts) | 测试：commands |
| [commands.ts](commands.ts) | 实现模块；入口/导出：DEFAULT_UNDO_LIMIT、EditorSnapshot、EditorHistory、EditorState、CreateEditorStateOptions |
| [compaction.test.ts](compaction.test.ts) | 测试：compaction |
| [compaction.ts](compaction.ts) | 实现模块；入口/导出：CompactionResult、compactVertically |
| [container.test.ts](container.test.ts) | 测试：container |
| [containers.test.ts](containers.test.ts) | 测试：containers |
| [containers.ts](containers.ts) | 实现模块；入口/导出：ContainerFailureCode、ContainerIssue、GridSplitSlots、ContainerDisplay、normalizeGridSplitRatios |
| [document-commands.test.ts](document-commands.test.ts) | 测试：document-commands |
| [document-io.test.ts](document-io.test.ts) | 测试：document-io |
| [document-io.ts](document-io.ts) | 实现模块；入口/导出：DocumentLoadResult、DocumentRoundTripResult、emptyLayoutDocument、emptyContentDocument、loadLayoutDocument |
| [export-surface.test.ts](export-surface.test.ts) | 测试：export-surface |
| [fixtures.test.ts](fixtures.test.ts) | 测试：fixtures |
| [focus.test.ts](focus.test.ts) | 测试：focus |
| [focus.ts](focus.ts) | 实现模块；入口/导出：GridDirection、KeyInput、focusedGeometry、currentFocus、findDirectionalNeighbor |
| [grid.test.ts](grid.test.ts) | 测试：grid |
| [grid.ts](grid.ts) | 实现模块；入口/导出：isPositiveInteger、isCoordinateInColumn、positionToRowCol、rowColToPosition、placementFitsColumns |
| [import-pipeline.test.ts](import-pipeline.test.ts) | 测试：import-pipeline |
| [import-pipeline.ts](import-pipeline.ts) | 实现模块；入口/导出：ImportObjectIdFactory、ShareImportOptions、ImportRebindRequest、ImportPreview、ShareImportResult |
| [index.ts](index.ts) | 实现模块；按文件名定位 index.ts |
| [machine.test.ts](machine.test.ts) | 测试：machine |
| [machine.ts](machine.ts) | 实现模块；入口/导出：EditorMode、EditorPhase、EditorMachineState、INITIAL_EDITOR_MACHINE_STATE、EditorEffect |
| [migration-cases.test.ts](migration-cases.test.ts) | 测试：migration-cases |
| [migration-chain.test.ts](migration-chain.test.ts) | 测试：migration-chain |
| [migration-chain.ts](migration-chain.ts) | 实现模块；入口/导出：MigrationStatus、MigrationStep、MigrationChainResult、MigrationChainOptions、LAYOUT_MIGRATION_STEPS |
| [migration.test.ts](migration.test.ts) | 测试：migration |
| [params-validation.test.ts](params-validation.test.ts) | 测试：params-validation |
| [params-validation.ts](params-validation.ts) | 实现模块；入口/导出：ANALYSIS_PARAMS_SCHEMA_VERSION、MAX_ANALYSIS_PARAMS_KEYS、MAX_ANALYSIS_PARAMS_ID_ITEMS、MAX_RELATIVE_DAYS、MAX_ABSOLUTE_RANGE_DAYS |
| [placement.test.ts](placement.test.ts) | 测试：placement |
| [placement.ts](placement.ts) | 实现模块；入口/导出：PlacementPlan、planSmartPlacement |
| [profiles.test.ts](profiles.test.ts) | 测试：profiles |
| [profiles.ts](profiles.ts) | 实现模块；入口/导出：PROFILE_KEY_STRATEGY_PLACEHOLDER、PROFILE_WIDTH_BUCKETS_PLACEHOLDER、UNIFIED_EDIT_WRITEBACK_PLACEHOLDER、isValidProfileKey、profileKeyForColumns |
| [projection.test.ts](projection.test.ts) | 测试：projection |
| [projection.ts](projection.ts) | 实现模块；入口/导出：projectLayout、projectionToGeometry |
| [property.test.ts](property.test.ts) | 测试：property |
| [repair.test.ts](repair.test.ts) | 测试：repair |
| [repair.ts](repair.ts) | 实现模块；入口/导出：GEOMETRY_REPAIR_ORDER、GeometryRepairCode、GeometryRepair、GeometryRepairResult、repairLayoutGeometry |
| [responsive.test.ts](responsive.test.ts) | 测试：responsive |
| [responsive.ts](responsive.ts) | 实现模块；入口/导出：COLUMN_OVERRIDE_PREFIX、RESPONSIVE_MAX_COLUMNS、columnOverrideKey、layoutRootObjectIds、columnOverrideFor |
| [serialization.test.ts](serialization.test.ts) | 测试：serialization |
| [share-snapshot.test.ts](share-snapshot.test.ts) | 测试：share-snapshot |
| [share-snapshot.ts](share-snapshot.ts) | 实现模块；入口/导出：SHARE_SNAPSHOT_SCHEMA_VERSION、MAX_SHARE_PAYLOAD_BYTES、MAX_SHARE_TEMPLATE_NAME_LENGTH、MAX_SHARE_TEMPLATE_DESCRIPTION_LENGTH、MAX_SHARE_LANGUAGE_LENGTH |
| [storage-contract.test.ts](storage-contract.test.ts) | 测试：storage-contract |
| [storage-contract.ts](storage-contract.ts) | 实现模块；入口/导出：WORKBENCH_LOCAL_STORE_SCHEMA_VERSION、VersionedDocument、WorkbenchLocalRecordV1、createEmptyLocalRecord、DocumentMergeConflict |
| [test-prng.ts](test-prng.ts) | 实现模块；入口/导出：TestPrng、createTestPrng |
| [test-support.ts](test-support.ts) | 实现模块；入口/导出：UNIT、SPLIT_HALF、size、analysisCard、pinnedCard |
| [types.ts](types.ts) | 实现模块；入口/导出：LAYOUT_SCHEMA_VERSION、LAYOUT_ALGORITHM_VERSION、MIN_COLUMNS、MAX_COLUMNS、MAX_ROW_SPAN |
| [validation.ts](validation.ts) | 实现模块；入口/导出：DocumentValidationIssue、DocumentValidationResult、validateLayoutDocumentV1、validateContentDocumentV1、serializeContentDocumentV1 |
<!-- directory-index:end -->
