# apps/web/src/lib/billExtract · 阅读入口

> 最后修改：2026-11-15 17:10（UTC+08:00）

账单文件的浏览器端文本抽取（只有游客本机导入需要）：XLSX 用 `DecompressionStream` + `DOMParser`，PDF 用项目已打包的 pdf.js；输出与服务器 `apps/api/src/import/extract_document.py` 同形状的 `ExtractedDocument`，交给 `@libellum/shared/billParsers` 的解析器。与 Python 版的一致性由 `billExtract.test.ts` 逐个夹具比对（`pythonOutputs.json` 是 Python 现场运行的存档）。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [billExtract.test.ts](billExtract.test.ts) | 测试：billExtract |
| [fixtures.ts](fixtures.ts) | 实现模块；入口/导出：DATE_STYLES、wechatWorkbook、Fixture、BOA_SUMMARY、BOA_DETAIL |
| [index.ts](index.ts) | 实现模块；入口/导出：BillExtractOptions、extractBillDocument |
| [pdf.ts](pdf.ts) | 实现模块；入口/导出：MAX_PDF_PAGES、MAX_PDF_TEXT、MIN_PDF_TEXT、PdfTextItemLike、PdfPageLike |
| [pythonOutputs.json](pythonOutputs.json) | 结构化配置、资源或夹具 |
| [testSupport.ts](testSupport.ts) | 实现模块；入口/导出：ZipInput、buildZip、SPREADSHEET_NS、RELATIONSHIP_NS、XlsxInput |
| [xlsx.ts](xlsx.ts) | 实现模块；入口/导出：MAX_ROWS、MAX_COLUMNS、MAX_CELL、MAX_SHARED_STRINGS、XmlNodeLike |
| [zip.ts](zip.ts) | 实现模块；入口/导出：MAX_ZIP_ENTRIES、MAX_EXPANDED_BYTES、MAX_ENTRY_BYTES、MAX_COMPRESSION_RATIO、ZipEntry |
<!-- directory-index:end -->
