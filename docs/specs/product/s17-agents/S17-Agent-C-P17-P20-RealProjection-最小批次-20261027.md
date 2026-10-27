# S17 · Agent C · P17–P20 real projection 最小批次（2026-10-27）

> 作者：`DS-S17-C-Advanced`（Agent C）；日期：2026-10-27。
> 状态：**已实现，待 Lead 评审**（S-01 v2 冻结后第 1 批；`s01-v2` 禁止私有版本）。
> 冻结依据：Lead 2026-10-27 冻结通知（orchestrator `2b6a869`/`0aee9d8`；`s01-v2` 已冻结）；批前声明与 7 条范围已获 Lead 批准。
> 提交：实现 + 文档见 §6（回填提交号见任务文档 §6.2）。
> 边界：只改本工作区 `packages/shared/src/analysis/advanced/` + C 文档；不接页面/路由/API、不接包入口、不碰 A/B/D/Codex/集成/主工作区；不 push/merge/部署。

---

## 1. 批前声明（已获 Lead 批准，2026-10-27）

| # | 声明项 | 落实 |
|---|---|---|
| 1 | 范围：只改 `packages/shared/src/analysis/advanced/`（C 所属）+ C 文档 + 测试；P16–P20 纯函数零改动 | 见 §2、§3.4（`git diff` 仅 `index.ts` +1 行） |
| 2 | 唯一读取入口：投影层不查库/不发请求，接收注入的 `ReadonlyMap<string, FxLookup>`；区间守卫 `FxProjectionRangeGuard` 注入，本层不自建第二套上限 | `FxRealProjectionInput.rates`、`FxRealProjectionOptions.rangeGuard` |
| 3 | 守卫抛 `fx_range_too_long` → `ok:false` 显式拒绝，**无部分输出** | 测试「注入的区间守卫超限…不返回任何结果字段」（断言 `records`/`contribution`/`completeness` 不存在） |
| 4 | 折算语义只复用权威 FX 引擎；观测由 `FxSnapshot` 构造，逐笔仍走 draft `resolveFxRate` | §2.3；测试与 `convertFx`/`aggregateFx` 逐笔+合计对账 |
| 5 | 完整性：`partial` 仅 P17/P19/P20 `missingCount>0`；`unavailable` 本层不产生 | §2.4；测试「缺汇率一笔 → partial」 |
| 6 | 不做：不接页面/API、不加迁移/依赖、不碰他人工作区、不接包入口（I-0 归 D/Lead）、不改冻结协议 | §4 |
| 7 | 证据口径：typecheck + 全量测试 + 守恒/拒绝/partial/grep 证据 | §3 |

---

## 2. 实现

### 2.1 文件与接口

- 新增 `packages/shared/src/analysis/advanced/fxProjection.ts`（339 行）；
- 新增 `packages/shared/src/analysis/advanced/fxProjection.test.ts`（314 行，11 项测试）；
- `packages/shared/src/analysis/advanced/index.ts` 追加 1 行内部 barrel 导出（**非包入口**；`packages/shared/src/index.ts` 未改动，I-0 归 D/Lead 另批）。

核心 API：

```ts
export const FX_PROJECTION_BATCH = "p17-p20-real-projection-v1";
export type FxProjectionRangeGuard = (from: string, to: string) => void;

export interface FxRealProjectionInput {
  readonly targetCurrency: string;
  readonly from: string;                     // resolvedPeriod 闭区间
  readonly to: string;
  readonly entries: readonly FxEntry[];      // 调用方已按权限/软删/日期过滤（同 aggregateFx 契约）
  readonly rates: ReadonlyMap<string, FxLookup>; // 权威读取层（useFxRange）产出的逐日快照
  readonly trend?: { readonly currency: string; readonly from?: string; readonly to?: string };
}
export interface FxRealProjectionOptions {
  readonly rangeGuard?: FxProjectionRangeGuard; // 集成层注入 fxRangeMonths/useFxRange 适配器
  readonly maxFallbackDays?: number;
  readonly maxMissingRecords?: number;
}

export type FxRealProjectionResult = FxRealProjectionSuccess | FxRealProjectionRejection;
```

函数：`buildFxDraftRecords`（真实逐笔 → draft 记录，金额保持 `bigint` 最小单位）、
`buildFxRateObservations`（快照 → 「原币 → 目标币」观测；目标币不在快照时保持缺失）、
`projectFxDiagnostics`（唯一入口）、`checkFxProjectionInvariants`（证据用不变量，不改结果）。

### 2.2 投影语义

1. 记录：`FxEntry{amountCents:number}` → `DraftFxRecord{amountMinor:bigint}`，不做任何折算/单位换算。
2. 观测：快照 `rates` 为「每 EUR 的币种数」（`EUR="1"`）；`1 base = numerator/denominator quote`，
   故 pair(source→target)：`numerator = fxDecimal(rates[target])`、`denominator = fxDecimal(rates[source])`。
   目标币不在该日快照 → 不构造汇率（保持缺失，绝不造假汇率）；同 `(provider, base, quote, date)` 重复 → 显式 `RangeError`（不静默取一）。
3. 换算：仍由 draft `resolveFxRate`（exact → ≤7 天回退 → missing）与 `convertMinorAtRate`（`minor-half-away-v1`）执行——与 S16-D 语义同一套。
4. 区间守卫：`rangeGuard(from,to)` 先执行；抛错 message 含 `fx_range_too_long` → 返回 `{ok:false, reason:"fx_range_too_long"}`，**结果对象不含任何数据字段**；其他抛错 → `invalid_input`。
5. 期外逐笔：`entry.occurredLocalDate` 不在 `[from,to]` → `invalid_input`（不静默丢弃，避免「投影输入与 resolvedPeriod 不一致」的静默部分结果）。
6. P18 趋势：`trend` 可给独立离散观测窗口（默认取 resolvedPeriod）；超过 draft `FX_DRAFT_MAX_TREND_DAYS=400` → `trend.ok:false, reason:"trend_range_too_long"`，主结果仍完整（趋势是独立诊断，不静默截断）。
7. 完整性：`completeness = contribution.completeness`（`partial` 只来自缺汇率；`unavailable` 本层不产生）。

---

## 3. 证据（可复现）

### 3.1 命令与结果

```powershell
pnpm --filter @libellum/shared typecheck
# EXIT 0
pnpm --filter @libellum/shared test src/analysis/advanced/fxProjection.test.ts
# 1 file / 11 tests passed
pnpm --filter @libellum/shared test
# 27 files / 484 tests passed
node tools/check-links.mjs && node tools/doc-audit.mjs
# 见提交前输出（EXIT 0）
```

### 3.2 守恒与对账（测试名 → 断言）

| 证据 | 断言 |
|---|---|
| `P16/P17/P19/P20 投影结果与 convertFx/aggregateFx 一致且守恒` | P17 逐行 Σ`convertedMinor` == `totalConvertedMinor`；每币种行 == 该币种逐笔 `convertFx().convertedMinor` 之和；`totalConvertedMinor` == `aggregateFx().totals.incomeMinor + expenseMinor`（同一 `FxSnapshot` 构造） |
| 同上 | P19 `converted+missing == needsConversion`；`notNeeded+needs == records.length`；`notNeeded == contribution.identityCount` |
| `回退读取更早快照（≤7 天），与 P20 回退计数同源` | USD 记录回退 2 天取更早快照 → `convertedMinor=7200`、`fallbackCount=1`；P20 `fallbackRecordCount == contribution.fallbackCount`；分布含 `{fallbackDays:2,count:1}` |
| `缺汇率一笔 → partial，缺失单独计数且不折算成 0` | `completeness="partial"`；`missingCount=1`；`missingRecords=[u2]`；覆盖率 `0/1`；`amountCoverageAvailable=false` |
| `只画真实观测、不插值；缺观测日显式计数` | P18 `points` 仅 1 个真实观测、`missingDateCount=1`、`interpolation="none"` |
| 空区间 | `no-transactions`，`totalConvertedMinor=0n`，不伪造 0 值行 |

### 3.3 拒绝行为（无部分结果）

测试「注入的区间守卫超限 → fx_range_too_long，且不返回任何结果字段」：
守卫抛 `RangeError("fx_range_too_long: 48 months exceeds 36")` → `ok:false, reason:"fx_range_too_long"`，
并断言 `"records" in result === false`、`"contribution" in result === false`、`"completeness" in result === false`。
另：期外逐笔 → `invalid_input`；非法目标币 → `unsupported_currency`。

### 3.4 注入边界 / 禁止面证据

`fxProjection.ts` 的 import 仅：`../../fx.js`（类型 + `fxCurrency/fxDate/fxDecimal/validateSnapshot`）、
`./currencyComposition.js`、`./draftTypes.js`、`./fxDiagnostics.js`——
**无** `fetch(`、`aggregateFxAsync`、`useFxRange`、`fxRangeMonths`、任何 API/HTTP 模块的实际调用
（`useFxRange`/`fxRangeMonths` 仅在注释 2 处说明「由集成层注入」，L11/L42）。
`git diff HEAD --name-only`：`packages/shared/src/analysis/advanced/index.ts`（1 行）+ 两个新文件；
`currencyComposition.ts` / `fxDiagnostics.ts` / `draftTypes.ts` **未改动**。

---

## 4. 本批明确不做

- 不接页面/路由/组件/API；不改 `apps/web/**`；
- 不接 `@libellum/shared` 包入口（`src/index.ts` 未动；I-0 归 D/Lead 另批，本批只做 advanced 内部 barrel）；
- 不新增包依赖、迁移、数据库访问、环境变量、凭据；
- 不改 P16–P20 纯函数口径、不改 S-01 v2 冻结协议/版本串、不新增结果形状；
- 不碰 A/B/D/Codex 工作区、集成工作区、主工作区、1.16.23 候选；不 push/merge/部署；
- 不制造/填充真实数据；QC-12 M-22…M-26 仍为「未验证（缺数据）」，本批**不改变**该状态（本批用合成快照 + 既有夹具口径测试）。

## 5. 后续接线（集成阶段，非本批）

1. 调用方（web 数据层，归 D/Lead I-0）：按既有 `aggregateFx` 契约提供「权限+软删+resolvedPeriod 过滤后的 `FxEntry[]`」；
2. `rates` 由 `useFxRange`（现状 14 月上限，B/S-01 v2 §13.5 计划 14→36）产出；`rangeGuard` 直接传 `fxRangeMonths` 适配器；
3. 结果按 S-01 v2 `AnalysisResultBase & {shape:"fx-diagnostic"} & {diagnosticKind, ...}` 包装（形状映射属 I-0/D，本批不改）；
4. 集成后可用真实快照复核 QC-12 M-22…M-26（届时另批，不在本批声明范围）。

## 6. 回执

- 实现 + 本文档：提交号见任务文档 §6.2「P17–P20 real projection 最小批次」行（含回填提交）；
- 范围/不做事项/证据口径：见 §1/§4/§3；无接口变化（未接包入口，纯 draft 层新增文件 + 内部 barrel）。
