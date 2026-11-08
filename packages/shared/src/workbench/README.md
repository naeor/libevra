# packages/shared/src/workbench · 阅读入口

共享工作台配置。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [configuration.ts](configuration.ts) | 实现模块；入口/导出：WORKSPACE_SCHEMA_VERSION、WORKSPACE_MAX_BYTES、WORKSPACE_MAX_PRESETS、WorkspaceDocuments、WorkspacePreset |
| [envelope.test.ts](envelope.test.ts) | 测试：envelope |
| [envelope.ts](envelope.ts) | 实现模块；入口/导出：S01V2Envelope、EnvelopeIssue、EnvelopeBuildInput、EnvelopeBuildOptions、EnvelopeBuildResult |
| [legacyDefault.test.ts](legacyDefault.test.ts) | 测试：legacyDefault |
| [legacyDefault.ts](legacyDefault.ts) | 实现模块；入口/导出：LEGACY_DEFAULT_WORKSPACE、isLegacyDefaultWorkspace、withoutLegacyDefault |
| [pipeline.test.ts](pipeline.test.ts) | 测试：pipeline |
| [pipeline.ts](pipeline.ts) | 实现模块；入口/导出：LayoutPipelineDocuments、LayoutPipelineIssue、LayoutPipelineOptions、LayoutPipelineResult、LayoutPipelineInput |
<!-- directory-index:end -->
