# apps/ocr · 阅读入口

OCR sidecar 与识别测试；真实样本是本机私密材料。

优先阅读[任务索引](../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [extract.py](extract.py) | 实现模块；入口/导出：Line、Draft、to_lines、_row_value、_first_of |
| [layouts.py](layouts.py) | 实现模块；入口/导出：is_amount_like、is_date_like、vertical_bands、AmountRow、PageStructure |
| [make_samples.py](make_samples.py) | 实现模块；入口/导出：font、make、main |
| [measure.py](measure.py) | 实现模块；入口/导出：main |
| [model.py](model.py) | 实现模块；入口/导出：Issue、Candidate |
| [multi_extract.py](multi_extract.py) | 实现模块；入口/导出：register_custom_extractor、ExtractionContext、PageExtraction、extract_page、_extract_single |
| [multi_preview.py](multi_preview.py) | 实现模块；入口/导出：lines_of、main |
| [normalize.py](normalize.py) | 实现模块；入口/导出：AmountRead、DateTimeRead、parse_reference_date、_clean_number、currency_in |
| [overview.py](overview.py) | 实现模块；入口/导出：OverviewSummary、Overview、build_overview、describe_overview |
| [requirements.txt](requirements.txt) | 配置或资料：requirements.txt |
| [run_real.py](run_real.py) | 实现模块；入口/导出：main |
| [service.py](service.py) | 实现模块；入口/导出：describe_page、recognise、_year_of、main |
| [try_ocr.py](try_ocr.py) | 实现模块；入口/导出：main |
| [update_plan.py](update_plan.py) | 实现模块；入口/导出：main |

| 子目录 | 职责 |
|---|---|
| [real-samples/](real-samples/README.md) | 本层组织 real-samples 模块的直属文件；具体契约由任务索引定位。 |
| [tests/](tests/README.md) | 专项测试。 |
<!-- directory-index:end -->
