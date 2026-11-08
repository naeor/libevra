# apps/api/src/import · 阅读入口

账本导入、批次、来源、锁与撤销。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [alipay.ts](alipay.ts) | 实现模块；入口/导出：parseAlipayCsv |
| [boa.ts](boa.ts) | 实现模块；入口/导出：parseBoaPdf、BOA_AMOUNT_PATTERN |
| [cache.ts](cache.ts) | 实现模块；入口/导出：PreviewRecord、PreviewCache |
| [common.ts](common.ts) | 实现模块；入口/导出：MAX_SOURCE_REF_LENGTH、cleanText、compactText、isPlaceholder、truncateText |
| [duplicates.ts](duplicates.ts) | 实现模块；入口/导出：DuplicateDetectionInput、DuplicateDetectionResult、detectDuplicates |
| [extract_document.py](extract_document.py) | 实现模块；入口/导出：xml、_sheet_targets、xlsx、_find_dict_end、_dict_value |
| [extractor.ts](extractor.ts) | 实现模块；入口/导出：DocumentExtractError、DocumentExtractor、ExtractorOptions、createDocumentExtractor |
| [libevra.ts](libevra.ts) | 实现模块；入口/导出：parseLibevraCsv |
| [service.ts](service.ts) | 实现模块；入口/导出：PreviewInput、RecheckInput、CommitInput、ImportServiceOptions、BillImportService |
| [sniff.ts](sniff.ts) | 实现模块；入口/导出：SniffedKind、DecodedText、sniffKind、decodeTextFile、detectTextHeader |
| [types.ts](types.ts) | 实现模块；入口/导出：BillSource、BillFormat、ExtractedSpan、ExtractedLine、ExtractedRow |
| [wechat.ts](wechat.ts) | 实现模块；入口/导出：parseWechatXlsx、WECHAT_COLUMN_NAMES |
<!-- directory-index:end -->
