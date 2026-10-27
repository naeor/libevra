# S-01 v2.0.2 冻结后一致性修正：信封版本串 / 唯一字段表 / 协议标识

> 状态：**冻结后澄清（v2.0.2，冻结不变）** ｜ 日期：2026-10-27 ｜ 协议标识：`s01-v2`
> 依据：冻结记录 `2b6a869`/`0aee9d8`（`S17-S01v2-冻结核定-20261027.md`）、Lead m04214、D I-1 集成契约映射（D 工作区 `47eae0c`，只读）、A 侧 v2.0.1 裁定
> 性质：**不改结构/字段集合/枚举/26 项 specs**；只修正「冻结文本 vs 实现/头部」的不一致（G-1）与协议标识常量（G-2）。

## 1. G-1：信封版本串与字段表一致性

**问题**（D I-1 契约映射 `47eae0c` 发现）：
- v2 §2 `version` 行仍写 `"s01-v2-draft"`，与文档头部「已冻结、统一 `s01-v2`」冲突。
- Legacy m02502 表述中出现 `ok` / `data` / `calculation` 字段，但 v2 冻结信封文本中不存在这三个字段（实际为 `completeness` / `unavailableReason` / `computation`）。

**处理**（已落 v2 §2/§16.5）：
1. §2 `version` 更正为 **`"s01-v2"`**（唯一正式版本串）；`s01-draft` / `s01-v2-draft` 仅历史标识，A 侧模块不再产出。
2. §2 标题改为「统一结果信封（v2 冻结，唯一一份；`s01-v2`）」。
3. 新增「**冻结信封字段清单（唯一一份）**」，字段以实现 `packages/shared/src/analysis/types.ts` 的 `AnalysisResultBase` 为准：
   `version`（固定 `"s01-v2"`）、`analysisId`、`analysisType`、`metric`、`resolvedFilters`、`resolvedPeriod`、`resolvedCurrency`、`completeness`（整结果层 9 态）、`unavailableReason?`、`dataVersion`（`string | null`）、`computation{rounding, method?, sampling?, coverageEnd?, analysisLimit?}`、`source`；结果负载字段按 §3 形状表（A 四形状 / 全量 25 形状）。
4. §2 `dataVersion` / `computation` / `source` 三行残留 🟡 状态更新为冻结口径（`string|null`；字段名按表、`method` 见 v2.0.1；`kind` 映射见 §4.4/未知 kind 必须报 `unavailableReason`）。
5. **Legacy 对照（不适用 v2）**：`ok` / `data` / `calculation` 不是 v2 字段——「成功/不可用状态」由 `completeness`（+`unavailableReason?`）承载、「结果数据」由 §3 结果负载承载、「计算过程元信息」由 `computation` 承载；v2 结果信封外不得另加这三个字段。
6. §16.5 兼容迁移策略同步：s01-draft 数据按 `s01-v2` 兼容读取（必填字段校验通过即接受、不重算）；`s01-v2-draft` → `s01-v2` 只做版本串升级；旧标识不并行维护。

**不变量**：字段集合本来就存在且已冻结，本次只对齐残留 draft 标注与旧表述，**不改字段、不改 25 形状、不改 §3**。

## 2. G-2：协议标识常量 `ANALYSIS_PROTOCOL_VERSION`

**问题**：A 侧 `packages/shared/src/analysis/types.ts` 的 `ANALYSIS_PROTOCOL_VERSION` 仍为 `"s01-draft"`，冻结后应为 `"s01-v2"`。

**改动**：
- `types.ts` 常量值 `"s01-draft"` → **`"s01-v2"`**；文件头注释由「S-01 draft / Not frozen yet」改为「S-01 v2（frozen `s01-v2`，2026-10-27；冻结基线 r7.2 + G-12a v1.1）」；常量注释说明：旧标识仅历史、本模块不再产出、旧数据按 §16.5 兼容读取、版本变更须走 v2.x 变更记录。
- `w1Boundary.test.ts`：唯一硬编码字面量 `version: "s01-draft" as const` 改为常量导入 + `AnalysisDefinition` 类型标注（`version: ANALYSIS_PROTOCOL_VERSION`）。

**影响面评估（决定：直接替换，不做兼容读取 shim）**：
| 位置 | 影响 | 处理 |
|---|---|---|
| `analysis/types.ts` | 常量值 + 注释 | 已改 |
| `analysis/context.ts` | 两处 `version: ANALYSIS_PROTOCOL_VERSION` 透传 | 无需改（自动使用新值） |
| `analysis/analysisCatalog.test.ts` | 已用常量断言 | 无需改 |
| `analysis/w1Boundary.test.ts` | 字面量 `"s01-draft"` | 已改用常量导入 |
| `apps/**` | grep `s01-draft`/`ANALYSIS_PROTOCOL_VERSION` 0 引用 | 无需改 |
| 持久化数据/外部工具 | 分析结果尚未持久化到生产；无外部工具依赖该串 | 无需 shim（旧数据读取规则按 §16.5） |

**验证（全部通过）**：
- `pnpm typecheck`（`tsc -b`：shared/api/web 均 `Done`）→ exit 0
- `pnpm --filter @libellum/shared test` → **31 files / 690 tests passed**
- `node tools/check-links.mjs` → 213 份 Markdown / 976 相对链接，无失效
- `node tools/check-status.mjs` → 路由 75 / 版本 1.16.23 / 迁移 60
- `node tools/doc-audit.mjs` → exit 0（仅既有跨工作区只读引用告警）

## 3. 影响文件清单

- 文档：`S17-Agent-A-S01-v2-结构草案.md`（§2、§16.5、§16.10）；本文件。
- 代码：`packages/shared/src/analysis/types.ts`、`packages/shared/src/analysis/w1Boundary.test.ts`。
- **不改**：`apps/**`、API、Prisma/迁移、其他 Agent 工作区、A 26 项 specs、G-12a 发布物、协议结构/枚举。

## 4. 冻结记录行（供 Lead 代填 orchestrator）

> orchestrator 工作区对 A 只读；请 Lead 将下行填入 `S17-S01v2-冻结核定-20261027.md`「变更记录」小节：

```markdown
- 2026-10-27 **v2.0.2 冻结后一致性修正**（A，提交 `ed50876`）：G-1 §2 信封 `version` 更正为 `s01-v2`、新增唯一冻结字段清单（与 `AnalysisResultBase` 一致）+ Legacy 对照（`ok`/`data`/`calculation` 非 v2 字段：状态由 `completeness`+`unavailableReason?`、结果由 §3、计算元信息由 `computation` 承载）；G-2 `ANALYSIS_PROTOCOL_VERSION = "s01-v2"`（旧标识仅历史、无兼容 shim；typecheck 0、shared 31 files/690 tests 通过）。不改结构/字段/枚举/26 项 specs，无需重新冻结；D 可继续 I-1b 信封接线。
```

## 5. 下一步

- Lead：代填冻结记录行；转 D/B/C。
- D：按 v2 §2「冻结信封字段清单」开始 I-1b 信封接线（`47eae0c` 映射即可据此收敛）。
- B/C：无协议结构变化，无需改动；如引用旧版本串，按 `s01-v2` 更新。
- A：提交本文与代码改动，回执提交号；待命后续批次。
