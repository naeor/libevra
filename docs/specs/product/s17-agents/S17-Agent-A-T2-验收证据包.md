# Agent A · T2 只读扩展验收证据包（交 Lead 复核）

> 状态：**T2 已实现，待所有者验收（暂不合并、不进入主线）**。依据 Lead m02553（所有者条件验收：6 条条件 + 证据/测试记录/提交号/结论）。
> 说明：批准 ≠ 合并到 B-22 异常主工作区；集成仅在专用 worktree 进行（Lead m02553 决定 3）。本文件逐条列证据；「结论」列填 **A 建议**，由 Lead 复核、最终由所有者签认。
> 端点：`GET /api/v1/analytics/transactions`（区间逐笔）、`GET /api/v1/analytics/extremes`（max/min/peak-day/active-days/most-recorded-day）。分支 `deepseek/s17-finance-category`，当前 HEAD `3c5b59a`（未推送）。

## 条件 1：只提供约定的只读能力、无财务写入

| 证据 | 位置/说明 |
|---|---|
| 仅两个 GET 路由，无 POST/PATCH/DELETE | `apps/api/src/routes/analytics.ts`（`registerAnalyticsRoutes` 仅注册 `app.get`）；`apps/api/src/app.ts` 注册处注释「read strength、viewer 可读、无写路由/新权限规则」 |
| 无 schema 变更、无迁移 | 未改 `prisma/schema.prisma`、`prisma/migrations/**`；提交 `21c0438` 文件清单不含迁移 |
| 无写入逻辑改动 | 未改 `/transactions` 写入/导入/删除/恢复路由 |
| 只读核对清单 | `S17-Agent-A-T2只读扩展提案.md` §9.5（7 项；其中集成测试一项已于 `ledger_test` 跑通，见条件 4） |

## 条件 2：不绕过账本访问权限

| 证据 | 位置/说明 |
|---|---|
| 复用既有授权 | `app.ts` 中两个路由使用 `requireBookRead`（=`createRequireBook(..., {write:false})`）；无任何自定义权限判断 |
| bookId 来源 | 路由内 `request.book!.bookId`（由 `requireBook` 解析，header `x-libellum-book` 或最早成员回退） |
| 权限测试 | `apps/api/test/analytics.test.ts`（14 项）：无 session 401；非成员带 `x-libellum-book` → 403；owner GET 200；加入 viewer 成员后 GET 200 且 POST `/transactions` → 403（写入被拒） |
| 不扩读取范围 | 仅返回批准字段；不返回 `note`/`tags`/`valueHistory`/`userId`/`occurredTz`（提案 §9.1 最小暴露） |

## 条件 3：不修改原始账务事实 / 离线副本 / 同步冲突判据

| 证据 | 位置/说明 |
|---|---|
| 未改账务写入 | 未改 `apps/api/src/routes/transactions.ts` 的写入/删除/恢复、未改 `prisma` 模型与迁移 |
| 只读查询条件 | where 固定 `{bookId, deletedAt:null, occurredLocalDate:{gte,lte}}`（与 `/stats` 同口径）；不读软删记录、不写回任何字段 |
| 未改同步/离线 | 未改 `apps/web` 离线覆盖、同步冲突判据、服务端同步代码（本分支仅新增 i18n 文案与守卫测试更新：`37b0cc5`） |
| 无副作用 | 两个端点均为纯 SELECT（`findMany`/`findFirst`/`count`/`groupBy`），无事务写入 |

## 条件 4：提供实际测试记录与对应提交

| 测试 | 命令 | 结果 | 提交 |
|---|---|---|---|
| 共享契约（schema/边界/常量） | `pnpm --filter @libellum/shared exec vitest run src/analytics.test.ts` | 31 项通过 | 边界测试 `830ff5c`；初版 `21c0438` |
| 适配器（AnalysisEntry/FxEntry 映射、非 safe integer） | `pnpm --filter @libellum/shared exec vitest run src/analysis/adapters` | 11 项通过 | `830ff5c` |
| shared 全量 | `pnpm --filter @libellum/shared test` | 28 files / **638 passed** | `83021c6`（回填时基线） |
| web 全量（含 i18n 守卫：新错误码 `kind_required` 中英） | `pnpm --filter @libellum/web test` | 153 files / **1390 passed** | `37b0cc5`（rebase 1.16.23 后修复） |
| 类型检查 | `pnpm -r typecheck` | shared/api/web 全过 | `37b0cc5` 后复验 |
| API 集成测试（**已跑通**，Lead m02628 授权用 `ledger_test`） | `prisma migrate deploy`（DATABASE_URL=`ledger_test`，迁移至 60）→ `pnpm --filter @libellum/api exec vitest run test/analytics.test.ts test/stats.test.ts` | **analytics 14/14 通过、stats 11/11 通过（合计 25 passed）**；`ledger_test` 为可重建测试库（主机 127.0.0.1、库名含 test，已强校验）；真实输出见 §条件 4 附「集成测试原始输出」 | 测试随实现 `21c0438`；本轮修正测试内超长用户名后重跑通过（本地） |
| 说明 | 首次全量运行曾因测试库未就绪失败；Lead m01325 曾指示暂不跑，Lead m02628 改为**允许本地 `ledger_test`**（可重建、允许测试写入/清空；禁用生产库与 `ledger_dev`）。本次运行未连生产库、未打印口令 | — | — |

**集成测试原始输出（2026-10-27，本 worktree，`ledger_test`）**：

```
step 1/2: prisma migrate deploy on ledger_test  → migrate exit=0
step 2/2: vitest run test/analytics.test.ts test/stats.test.ts
 ✓ test/stats.test.ts (11 tests) 1740ms
 ✓ test/analytics.test.ts (14 tests) 1931ms
 Test Files  2 passed (2)
      Tests  25 passed (25)
```

## 条件 5：与 S-01 v2 的兼容关系

| 关系 | 说明 |
|---|---|
| additive | 两个端点与共享类型（`packages/shared/src/analytics.ts`）均为**新增**，既有 `Analytics*` 之外无改动；既有端点响应不变 |
| 适配器映射 | `packages/shared/src/analysis/adapters/analytics.ts`：`toAnalysisEntry`（金额→bigint）/`toFxEntry`（金额→number 且校验 safe integer），供 A 分析层与 FX 引擎复用，不新增结果形状 |
| 不新增 AnalysisResult 形状 | `analytics.ts` 只是 I/O 契约，不是 S-01 结果形状；S-01 v2 形状计数（25 结果形状/7 输入 DTO）不受影响 |
| 金额/币种语义 | 服务端不折算（T2-Q4）符合 ACC-03「原币不跨币种相加」；多币种一次返回供调用方 `aggregateFxAsync` 逐笔折算 |
| 未指定支付方式 | `paymentMethodId=null` 语义与 I17「未指定」组一致（A-Q23） |
| 读取范围 | 不超 G-11 批准的只读范围；不扩 T2 |
| `unit` 字段 | 极值响应含 `unit:"money"|"count"|"days"`（A-Q24 建议默认口径），避免客户端猜字符串含义 |

## 条件 6：没有既有消费者无法处理的破坏性变化

| 检查 | 结论（证据） |
|---|---|
| 既有 `/stats`、`/summary`、`/transactions` 响应 | 未改动（无 diff；`21c0438` 文件清单不含这些路由的响应逻辑） |
| 金额字符串化 | 仅**新端点**返回字符串金额；既有端点不变 |
| 新增错误码 | 新增 `kind_required`（中英 i18n 已补，web 守卫测试通过 `37b0cc5`），仅新端点使用 |
| 共享 barrel | `packages/shared/src/index.ts` 仅新增 `export * from "./analytics.js"`（additive），无重名导出（已核对） |
| web i18n 守卫 | `sharedMessages.test.ts` 已把 `analytics.ts` 归入 FULL_FILES；`apiErrors.test.ts` 新错误码已覆盖（1390 passed） |
| 版本号 | 未改 `version.ts`（1.17.1 由 Lead 在集成分支统一维护） |

## 复核结论列（Lead 填写）

| 条件 | 证据是否充分 | 结论（A 建议，待 Lead 复核 / 所有者签认） |
|---|---|---|
| 1 只读无写入 | ✅ 充分 | **建议通过**：仅新增两个 `GET /api/v1/analytics/*`，无写路由、无 schema/迁移、无写入逻辑改动（证据见条件 1 清单 7 项） |
| 2 不绕过权限 | ✅ 充分 | **建议通过**：复用 `requireBookRead`（`requireBook(write:false)`），api 集成测试 14 项覆盖 401 / 非成员 403 / viewer 读 200 + 写 403 |
| 3 不改账务/离线/同步 | ✅ 充分 | **建议通过**：未改 `/transactions`、导入/恢复/同步代码与 `where` 口径（仍 `deletedAt:null`），无迁移 |
| 4 测试记录与提交 | ✅ 充分 | **建议通过**：`ledger_test` 上 `prisma migrate deploy` exit 0；`test/analytics.test.ts` 14/14 + `test/stats.test.ts` 11/11 = **25 passed**；shared 边界测试 42 项、shared 全量 638 通过；证据见条件 4 原始输出 |
| 5 与 S-01 v2 兼容 | ✅ 充分 | **建议通过**：新端点 additive，适配器映射 `toAnalysisEntry`/`toFxEntry`；不新增结果形状；服务端不折算符合 ACC-03/T2-Q4；`paymentMethodId=null`→「未指定」符合 I17；读范围不超 G-11 |
| 6 无破坏性变化 | ✅ 充分 | **建议通过**：既有 `/stats`/`/summary`/`/transactions` 响应未改；金额字符串化仅新端点；新增 i18n 错误码 `kind_required` 中英已补；共享 barrel 仅新增导出 |

> A 建议结论（不代替所有者）：T2 只读扩展满足 6 条条件，**建议标记「已验收」**；最终由所有者签认。T2 不合并 B-22 主工作区、集成仅在专用 worktree（Lead m02553）。

> 提交：见任务文档 §6.2 交付行（与 4 份 S-01 v2 核验材料同批提交，未推送）。T2 保持「已实现，待所有者验收」，不合并、不进入主线。
