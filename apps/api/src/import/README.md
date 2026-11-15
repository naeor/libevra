# apps/api/src/import · 阅读入口

> 最后修改：2026-11-15 17:10（UTC+08:00）

账本导入、批次、来源、锁与撤销。

账单导入（`/import/preview|recheck|commit`）：1.19.96 起解析器、判重规则与核对规则在 [packages/shared/src/billParsers](../../../../packages/shared/src/billParsers/README.md)（游客本机导入共用同一份）。这里的 `alipay.ts`、`boa.ts`、`cache.ts`、`common.ts`、`libevra.ts`、`sniff.ts`、`types.ts`、`wechat.ts` 只转出 shared，保持既有导入路径；服务器自己的部分是 `service.ts`（数据库读写、预览缓存、提交事务）、`duplicates.ts`（判重的数据库数据来源）、`extractor.ts` + `extract_document.py`（XLSX / PDF 文本抽取）。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [alipay.ts](alipay.ts) | 实现模块；按文件名定位 alipay.ts |
| [boa.ts](boa.ts) | 实现模块；按文件名定位 boa.ts |
| [cache.ts](cache.ts) | 实现模块；按文件名定位 cache.ts |
| [common.ts](common.ts) | 实现模块；按文件名定位 common.ts |
| [duplicates.ts](duplicates.ts) | 实现模块；入口/导出：DuplicateDetectionInput、DuplicateDetectionResult、detectDuplicates |
| [extract_document.py](extract_document.py) | 实现模块；入口/导出：xml、_sheet_targets、xlsx、_find_dict_end、_dict_value |
| [extractor.ts](extractor.ts) | 实现模块；入口/导出：DocumentExtractError、DocumentExtractor、ExtractorOptions、createDocumentExtractor |
| [libevra.ts](libevra.ts) | 实现模块；按文件名定位 libevra.ts |
| [service.ts](service.ts) | 实现模块；入口/导出：PreviewInput、RecheckInput、CommitInput、ImportServiceOptions、BillImportService |
| [sniff.ts](sniff.ts) | 实现模块；按文件名定位 sniff.ts |
| [types.ts](types.ts) | 实现模块；按文件名定位 types.ts |
| [wechat.ts](wechat.ts) | 实现模块；按文件名定位 wechat.ts |
<!-- directory-index:end -->
