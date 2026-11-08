# apps/api/src/lib · 阅读入口

基础逻辑与公共工具。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [conflicts.ts](conflicts.ts) | 实现模块；入口/导出：HISTORY_LIMIT、CONFLICT_FIELDS、ConflictField、ConflictClaim、asArray |
| [errors.ts](errors.ts) | 实现模块；入口/导出：AppError、badRequest、unauthorized、forbidden、conflict |
<!-- directory-index:end -->
