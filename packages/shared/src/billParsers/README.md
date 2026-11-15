# packages/shared/src/billParsers · 阅读入口

> 最后修改：2026-11-15 17:10（UTC+08:00）

账单导入（微信 XLSX / 支付宝 CSV / BOA PDF / Libevra CSV）的解析、判重与核对规则（1.19.96 从 `apps/api/src/import/` 移来）。服务器 `apps/api/src/import/service.ts` 与游客本机导入 `apps/web/src/lib/guest/billImport.ts` 共用这一份；平台相关的只有 XLSX / PDF 的文本抽取（服务器 Python `extract_document.py`，浏览器 `apps/web/src/lib/billExtract/`）与数据读写（判重的数据来源以 `BillDuplicateSource` 传入）。通过子路径 `@libellum/shared/billParsers` 引用，不从 shared 主入口转出。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [alipay.ts](alipay.ts) | 实现模块；入口/导出：parseAlipayCsv |
| [billParsers.test.ts](billParsers.test.ts) | 测试：billParsers |
| [boa.ts](boa.ts) | 实现模块；入口/导出：parseBoaPdf、BOA_AMOUNT_PATTERN |
| [cache.ts](cache.ts) | 实现模块；入口/导出：PreviewRecord、PreviewCache |
| [common.ts](common.ts) | 实现模块；入口/导出：MAX_SOURCE_REF_LENGTH、cleanText、compactText、isPlaceholder、truncateText |
| [document.ts](document.ts) | 实现模块；入口/导出：BillDocumentExtractor、isBoaDocument、parseBillDocument、parseBillFile |
| [duplicates.ts](duplicates.ts) | 实现模块；入口/导出：BILL_DUPLICATE_CHUNK、BILL_DUPLICATE_MAX_EXISTING_SCAN、BILL_DUPLICATE_MAX_COMPARISONS、BillDuplicateRefRow、BillDuplicateIdRow |
| [hash.ts](hash.ts) | 实现模块；入口/导出：sha256Bytes、sha256HexOfBytes、sha256HexOfText、randomUuid |
| [index.ts](index.ts) | 实现模块；按文件名定位 index.ts |
| [libevra.ts](libevra.ts) | 实现模块；入口/导出：parseLibevraCsv |
| [review.ts](review.ts) | 实现模块；入口/导出：BILL_REVIEW_MESSAGES、BILL_IMPORT_TAG_COLOR、BillReviewError、BillBookData、systemCategoryByKind |
| [sniff.ts](sniff.ts) | 实现模块；入口/导出：SniffedKind、DecodedText、sniffKind、decodeTextFile、detectTextHeader |
| [types.ts](types.ts) | 实现模块；入口/导出：BillSource、BillFormat、ExtractedSpan、ExtractedLine、ExtractedRow |
| [wechat.ts](wechat.ts) | 实现模块；入口/导出：parseWechatXlsx、WECHAT_COLUMN_NAMES |
<!-- directory-index:end -->
