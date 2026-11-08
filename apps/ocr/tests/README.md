# apps/ocr/tests · 阅读入口

专项测试。

优先阅读[任务索引](../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [__init__.py](__init__.py) | 实现模块；按文件名定位 __init__.py |
| [fixtures.py](fixtures.py) | 实现模块；入口/导出：L、wechat_single_detail、alipay_single_detail、bank_transfer_detail、wechat_transaction_list |
| [test_layouts.py](test_layouts.py) | 测试：layouts.py |
| [test_multi_extract.py](test_multi_extract.py) | 测试：multi_extract.py |
| [test_normalize.py](test_normalize.py) | 测试：normalize.py |
| [test_order_platforms.py](test_order_platforms.py) | 测试：order_platforms.py |
| [test_overview.py](test_overview.py) | 测试：overview.py |
| [test_service.py](test_service.py) | 测试：service.py |
<!-- directory-index:end -->
