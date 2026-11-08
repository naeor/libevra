# apps/api/src/fx · 阅读入口

历史汇率与折算。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [backup-dev.ts](backup-dev.ts) | 实现模块；按文件名定位 backup-dev.ts |
| [benchmark.ts](benchmark.ts) | 实现模块；按文件名定位 benchmark.ts |
| [dev-database.ts](dev-database.ts) | 实现模块；按文件名定位 dev-database.ts |
| [live-check.ts](live-check.ts) | 实现模块；按文件名定位 live-check.ts |
| [prepare-real-oracle.py](prepare-real-oracle.py) | 实现模块；入口/导出：body、latest |
| [provider.test.ts](provider.test.ts) | 测试：provider |
| [provider.ts](provider.ts) | 实现模块；入口/导出：EcbFrankfurterProvider |
| [realSamples.test.ts](realSamples.test.ts) | 测试：realSamples |
| [repository.test.ts](repository.test.ts) | 测试：repository |
| [repository.ts](repository.ts) | 实现模块；入口/导出：PgFxRepository |
| [routes.ts](routes.ts) | 实现模块；入口/导出：registerFxRoutes |
| [seed-preview.ts](seed-preview.ts) | 实现模块；按文件名定位 seed-preview.ts |

| 子目录 | 职责 |
|---|---|
| [fixtures/](fixtures/README.md) | 测试夹具。 |
<!-- directory-index:end -->
