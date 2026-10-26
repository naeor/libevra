# S17 · Agent C · S-01 v2 评审材料：C-4 FX 诊断形状与常量定义（P16–P20）

> 作者：`DS-S17-C-Advanced`（Agent C）；日期：2026-10-27。
> 状态：**DRAFT 正式定义文本**，供 Lead 转 Agent A 在 S-01 v2 引用（G-17 / §6.7 `fx-diagnostic` 形状、§12 待 C 定义常量）。
> 权威实现：`packages/shared/src/analysis/advanced/{draftTypes,currencyComposition,fxDiagnostics}.ts`（C-4 交付，实现提交 `2f7a036`，文档回填 `6dfbf82`）。
> 相关 QC：**QC-29**（FX 诊断结果形状族）、**QC-30**（P16 笔数份额 vs P17 金额份额口径）；依赖 **QC-12**（真实 FX 只读投影，本 draft 用合成夹具，等 S-01 v2 冻结后接真实数据）。
> 本轮不改 A 文件；本文是 C 侧给出的可引用定义。

---

## 1. 范围与边界

- 覆盖 **P16–P20**：币种交易构成、综合金额币种贡献、汇率历史趋势、汇率完整性、回退使用。
- 只做 draft 数学 + 图表输入/适配层：**不接真实 FX API、不接页面、不改 A 文件、不新增迁移/API**。
- 折算语义只复用权威 FX 引擎（S16-D `aggregateFxAsync`：逐笔折算、7 天回退、`minor-half-away-v1` 舍入）；本草案用合成汇率观测夹具表达同一语义。
- 金额一律 `bigint` 最小单位；汇率用精确有理数 `numerator/denominator`（展示时才转定点小数）。

## 2. 公共子结构（两个形状族共享）

```ts
/** FX 诊断完整性：比基础完整性多一态「部分可折算」。 */
export type DraftFxCompleteness = "complete" | "partial" | "no-transactions" | "unavailable";

/** P16–P20 的交易视图（只含诊断需要的字段）。 */
export interface DraftFxRecord {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly occurredLocalDate: string;
}

/** 一条离散汇率观测（真实来源为 S16-D 快照；rate = 1 base = numerator/denominator 个 quote）。 */
export interface DraftFxRateObservation {
  readonly provider: string;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly rateDate: string;
  readonly rateNumerator: bigint;
  readonly rateDenominator: bigint;
}

/** 单笔交易的实际汇率解析（P17–P20 共用）。 */
export interface DraftFxRateResolution {
  readonly currency: string;
  readonly targetCurrency: string;
  readonly requestedDate: string;          // 交易业务日期
  readonly rateDate: string | null;        // 实际使用日期；缺失为 null
  readonly fallbackDays: number | null;    // 0=直接命中；null=缺失；>0=回退天数
  readonly provider: string | null;
  readonly rateNumerator: bigint | null;   // identity/missing 时为 null
  readonly rateDenominator: bigint | null;
  readonly status: "identity" | "exact" | "fallback" | "missing";
}
```

## 3. 五个结果形状（`fx-diagnostic` 形状族）

### 3.1 `CurrencyCompositionResult`（P16，不折算）

`rows: {currency, recordCount, incomeCount, expenseCount, incomeAmountMinor, expenseAmountMinor, recordShare: Rational|null}[]`、`totalRecordCount`、`currencyCount`、`completeness`。
恒定约束：只比较**笔数**；各币种金额只在该币种内合计与显示，**不折算、不跨币种相加**；`recordShare` 分母 = 总记录数。

### 3.2 `FxContributionResult`（P17，折算贡献）

`targetCurrency`、`rows: {currency, originalSumMinor, convertedMinor, convertedCount, missingCount, fallbackCount, shareOfConverted: Rational|null}[]`、`totalConvertedMinor`、`convertedCount`、`identityCount`、`fallbackCount`、`missingCount`、`sharesOverConvertedOnly: true`、`missingRecords: {id,currency,occurredLocalDate}[]`、`missingRecordsTruncated`、`completeness`。
恒定约束：`Σ rows.convertedMinor = totalConvertedMinor`；**缺汇率记录不计入分母**（份额分母只覆盖已折算部分，展示层必须写明）；缺失记录显式列出，不做 0 处理。

### 3.3 `FxRateTrendResult`（P18，离散观测）

`currency`、`targetCurrency`、`points: {currency,targetCurrency,rateDate,provider,rateNumerator,rateDenominator,rateScaled: {scaled,decimals}}[]`、`from`、`to`、`observationCount`、`missingDateCount`、`missingDates`、`interpolation: "none"`、`change: Rational|null`、`minPoint`、`maxPoint`、`completeness`。
恒定约束：只画**系统实际持有的离散观测**；`missingDateCount` 是区间内无观测的自然日数；**不得插值/补点**；`change` 少于两个观测时为 null。

### 3.4 `FxCoverageResult`（P19，完整性）

`targetCurrency`、`currencies`、`dates`、`cells: {currency,date,status:"exact"|"fallback"|"missing"|"not-needed",recordCount}[]`、`needsConversionCount`、`convertedCount`、`missingCount`、`exactCount`、`fallbackCount`、`notNeededCount`、`coverageRatio: Rational|null`、`amountCoverageAvailable: false`、`amountCoverageReason`、`missingCombinations: {currency,date,recordCount}[]`、`rows`、`completeness`。
恒定约束：覆盖率 = **记录覆盖率**（`convertedCount / needsConversionCount`），不是金额覆盖率；首版 `amountCoverageAvailable=false` 且给出原因，**不得用「记录覆盖 95%」暗示「金额覆盖 95%」**；缺失组合逐条列出。

### 3.5 `FxFallbackResult`（P20，回退使用）

`targetCurrency`、`fallbackRecordCount`、`needsConversionCount`、`maxFallbackDays`、`fallbackDaysDistribution: {fallbackDays,count}[]`、`rows: {currency,directCount,fallbackCount,missingCount,fallbackDays:{fallbackDays,count}[]}[]`、`providers: {provider,count}[]`、`dates: {date,count}[]`、`missingRateCount`、`completeness`。
恒定约束：只统计**传入的权威回退元数据**；无折算需求时整族显式 `available=false`（不得显示「0 次回退」的可靠结论）；没有元数据不得反推「一定没用过回退」。

## 4. 与 S-01 v2 §6.7 `FxDiagnosticResult` 的字段映射（供 A 收录）

| owner 规格 §6.7 要求字段 | C-4 对应 |
|---|---|
| 原始币种 | `rows[].currency`（P16/P17/P19/P20）；`FxRateTrendResult.currency`（P18） |
| 目标币种（适用时） | `targetCurrency`（P17–P20；P16 不适用） |
| 汇率日期 | `DraftFxRateResolution.rateDate`；`FxRateTrendResult.points[].rateDate` |
| 实际汇率来源（如有） | `provider`（观测/解析/回退） |
| 实际折算状态 | `DraftFxRateResolution.status`（identity/exact/fallback/missing） |
| 可折算 / 不可折算记录数量 | `convertedCount` / `missingCount`（P17/P19）；`fallbackRecordCount`（P20） |
| 统计完整性 | `DraftFxCompleteness`（complete/partial/no-transactions/unavailable） |
| 适用来源 | `completeness` + `missingRecords`/`missingCombinations`（可追溯） |
| 与权威 FX 引擎的可追溯关联 | `status`/`fallbackDays`/`provider` + 复用 S16-D 折算语义（不另立引擎） |

**建议的 v2 收录形态**：`fx-diagnostic` 作为 5 个子形状的判别联合（`diagnosticKind: "currency-composition" | "contribution" | "rate-trend" | "coverage" | "fallback-usage"`），公共字段 `targetCurrency?`、`completeness`、`source`；若 A 希望保持单形状，至少保留上表 9 个字段的等价语义。

## 5. 常量定义（Lead 第 3 项；含归属与越界行为）

### 5.1 FX 引擎常量（shared 已实现）

| 常量 | 值 | 单位/适用 | 越界行为 | 归属 |
|---|---|---|---|---|
| `FX_DRAFT_MAX_FALLBACK_DAYS` | 7 | 自然日，≥0 | 回退超过 7 天 → `status="missing"`，不放大回退 | C-4（对齐 S16-D） |
| `FX_DRAFT_RATE_DECIMALS` | 6 | 定点小数位（仅展示） | 权威仍是分数；展示舍入按 `minor-half-away-v1`，不得用于折算 | C-4 |
| `FX_DRAFT_MAX_TREND_DAYS` | 400 | 自然日，P18 区间 | 超限 → `unavailable` 并说明，不静默裁剪 | C-4（与 `MAX_STATS_DAYS` 对齐） |
| `FX_DRAFT_MAX_MISSING_RECORDS` | 200 | 条，缺失明细 | 超出截断明细并置 `missingRecordsTruncated=true`；总数仍以 `missingCount` 为准 | C-4 |

### 5.2 C 侧图表/展示契约常量（**本次正式定义**；A 可在 v2 §12 引用）

| 常量 | 值 | 单位/适用形状 | 越界行为 | 归属 |
|---|---|---|---|---|
| `C_AMOUNT_DISPLAY_TIERS_MINOR` | `[10_000n, 1_000_000n, 100_000_000n, 1_000_000_000n]` | 最小单位（分）；= 100 元 / 1 万元 / 100 万元 / 1000 万元。用于坐标轴/数值卡的量级缩写档位（元/万/百万/千万/亿） | 仅影响**展示文本**，不改变权威金额；缩写不得替代完整值（完整值必须在 title/详情/数据表出现）；< 1e4 用元；≥ 1e9 用千万/亿缩写并保留完整值 | C（图表输入/展示契约） |
| `C_MAX_VISIBLE_SERIES` | 30 | 个；单图表的可见序列/图例/色类上限（堆叠、多序列、分组柱、小多图图例） | 超出必须合并为「其它」并**金额守恒**（`foldRemainder` 语义；折叠金额不得丢失）+ `noteText` 说明；**不得静默截断**；表格/长表不适用（另受行上限） | C |
| `C_PARETO_KEY_FEW_SHARE` | 0.3（30%） | 比例；帕累托图「关键少数」参考线 | **纯参考线/默认展开提示**，不参与计算、不改变累计值；分类数 > 30 时默认只画到参考线附近并把其余折叠为「其它（N 项）」+ note，展开全部时数值不变 | C |
| `C_COVERAGE_NEAR_COMPLETE_THRESHOLD` | 0.95 | 比例；P19 文案阈值（记录覆盖率） | ≥ 0.95 可标「接近完整」；< 0.95 必须标「不完整」；任何情况**不得四舍五入显示 100%**（保留一位小数实际值）；缺失记录仍须计数并列出；该阈值不是「可忽略缺失」 | C（P19 展示契约） |
| `C_SANKEY_MAX_LINKS` | 4000 | 条；与 shared `MAX_SANKEY_LINKS` 对齐 | 图表输入层门控：超限→不渲染桑基、退回层级表并给原因；**不得截断连线金额**（破坏守恒） | C（与 C-3 共享） |
| `C_HIERARCHY_TABLE_MAX_ROWS` | 500 | 行；层级表可见行上限（web `adapters4.ts` 已用 500） | 显示前 500 行 + `rowsTruncated=true` + 「共 N 行，显示前 500」说明；金额合计仍用 shared 全量；**不得只截断不标记** | C（与 C-3 共享） |

> 归属声明：5.1 已在 `packages/shared/src/analysis/advanced/fxDiagnostics.ts` 落成代码常量；5.2 是 C 侧图表输入/展示契约，**W3 图表家族与 Codex 视觉组件实现时必须落成代码常量**；如需不同取值须走 S-01 v2 评审，不得各家族自行改。

## 6. 不变量与测试证据

- 不变量：每笔交易只计一次折算（`Σ convertedMinor` 与 `totalConvertedMinor` 相等）；缺失 ≠ 0；份额分母只含已折算；P16 不跨币种求和；P18 观测数 ≤ 区间自然日数且不插值；P19 覆盖率口径 = 记录；混币/负金额/非法日期在输入层拒绝。
- shared `batch4.test.ts`：20 项（合成汇率夹具覆盖 direct/fallback/missing/失败、日期算术、贡献守恒、趋势缺失、完整性、回退分布）；
- web `adapters5.test.ts`：12 项（五类图表输入的文本/份额/门控/不可用原因）；
- 当前 HEAD `6dfbf82`：shared typecheck 0、26 文件/473 测试；web typecheck 0、162 文件/1502 测试。

## 7. 待 A/Lead 裁定（QC-29/QC-30）

1. **QC-29**：`fx-diagnostic` 用 5 子形状判别联合，还是单形状 + 9 字段等价语义？
2. **QC-30**：P16「笔数份额」与 P17「金额份额（分母仅已折算）」是不同口径；C 已在图表输入强制 `basisNote`/`sharesOverConvertedOnly`/`missingText`，展示层是否允许同屏并列、文案如何写。
3. **QC-12**：真实 FX 只读投影（快照/解析/回退元数据）字段与权限——登记为「等 S-01 v2 冻结后接真实数据」，C-4 draft 不阻塞。

## 8. 维护与提交号

- 权威路径：`docs/specs/product/s17-agents/S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md`；实现 `packages/shared/src/analysis/advanced/{draftTypes,currencyComposition,fxDiagnostics}.ts` + `apps/web/src/analysis/adapters5.ts`。
- 提交：C-4 实现 `2f7a036`、回填 `6dfbf82`；本文所在提交见 Lead 报告（不 push）。
