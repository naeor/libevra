# prisma · 阅读入口

数据库模型与不可重写的迁移序列。

优先阅读[任务索引](../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [schema.prisma](schema.prisma) | 数据库模型 |

| 子目录 | 职责 |
|---|---|
| [migrations/](migrations/README.md) | 按目录时间排序的 SQL 迁移单元；不修改已应用迁移，不在每个迁移目录生成 README。 |
<!-- directory-index:end -->
