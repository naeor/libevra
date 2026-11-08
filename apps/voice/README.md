# apps/voice · 阅读入口

语音识别 sidecar。

优先阅读[任务索引](../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [service.py](service.py) | 实现模块；入口/导出：_model_name、_thread_count、_env_flag、decode_audio、detect_speech |
| [test_service.py](test_service.py) | 测试：service.py |
<!-- directory-index:end -->
