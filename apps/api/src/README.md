# apps/api/src · 阅读入口

源码入口和子模块。

优先阅读[任务索引](../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [app.ts](app.ts) | 实现模块；入口/导出：BuildAppOptions、buildApp |
| [db.ts](db.ts) | 实现模块；入口/导出：createPrismaClient |
| [env.ts](env.ts) | 实现模块；入口/导出：Env、loadEnv |
| [fastify.d.ts](fastify.d.ts) | 实现模块；按文件名定位 fastify.d.ts |
| [server.ts](server.ts) | 实现模块；按文件名定位 server.ts |

| 子目录 | 职责 |
|---|---|
| [admin/](admin/README.md) | 管理授权与规则。 |
| [auth/](auth/README.md) | 身份认证。 |
| [collab/](collab/README.md) | 协作与共享。 |
| [consent/](consent/README.md) | 协议同意与重大公告。 |
| [critical/](critical/README.md) | 关键事件、回执、登记簿与恢复保护。 |
| [export/](export/README.md) | 导出。 |
| [fx/](fx/README.md) | 历史汇率与折算。 |
| [import/](import/README.md) | 账本导入、批次、来源、锁与撤销。 |
| [ledger/](ledger/README.md) | 账本领域、访问控制与对象操作。 |
| [lib/](lib/README.md) | 基础逻辑与公共工具。 |
| [lifecycle/](lifecycle/README.md) | 生命周期与删除恢复。 |
| [ocr/](ocr/README.md) | OCR 解析与确认。 |
| [rewards/](rewards/README.md) | 特典与奖励。 |
| [routes/](routes/README.md) | HTTP 路由入口；鉴权、校验、领域操作与错误响应。 |
| [scripts/](scripts/README.md) | 管理和维护命令；运行前确认数据范围及授权。 |
| [voice/](voice/README.md) | 语音服务接线。 |
<!-- directory-index:end -->
