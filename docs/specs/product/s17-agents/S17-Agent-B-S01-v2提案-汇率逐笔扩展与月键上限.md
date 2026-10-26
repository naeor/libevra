# S-01 v2 B 侧提案：综合模式 `FxAggregate` 逐日/逐笔扩展与月键上限参数化

> 提案编号：**B-S01v2-01**（`FxAggregate` 逐日/逐笔投影，additive）/ **B-S01v2-02**（`rangeMonths` 月数上限 14→≤36）
> 提出：Agent B（`DS-S17-B-Time`），2026-10-27；交 Agent A 汇总进 **S-01 v2 draft**。
> 状态：**draft 提案，未冻结**。不改变任何已登记结果形状；S-01 仍 `s01-draft`。
> 依据：S-01 draft §17（区间上限与窗口，A worktree `1989245`）、S-01 v2 draft §4.5 与 §7 G-09（`0cb7caa`）、所有者规格 §3.4/§4.2、B-6 预研 R-B6-2/R-B6-3。
> 性质：**additive（只增不改）**——现有 `FxAggregate` 类型、`aggregateFx`/`aggregateFxAsync` 签名与返回值保持不变；当前唯一消费方 `apps/web/src/lib/fxView.ts` 零改动。

---

## 1. 问题

### 1.1 综合模式缺“逐日/逐笔”结果（R-B6-2，高）

- B-0 核查表与 B-6 已确认：**综合模式唯一允许的实现**是 `packages/shared/src/fx.ts` 的 `convertFx` / `aggregateFx` / `aggregateFxAsync`（逐笔精确有理数汇率、最多 7 天历史回退、`minor-half-away-v1` 舍入、BigInt 全程）。
- 但现有聚合结果只有：`totals`、`months`（按月合计）、`categories`、`originalByCurrency`、`failures`、`reviewDates`、`complete`、`shareDenominatorMinor`。
- 因此综合模式下 I06/I07（日粒度）、I08（周）、I09/I10（月粒度，尚可用 `months`）、I11–I16、A01–A05、A12–A20 等时间分析**拿不到与 S-01 时间桶同源的逐日/逐笔精确金额**；若让页面层自行按 `entries` 重算，会违反“只复用 FX 引擎、不得重算”（S-01 §3/§4）并产生第二套折算实现。
- 约束：不得先合计后折算；不得改 S16-D 汇率算法；不得用显示文本或 `number` 反推金额；不得静默截断（S-01 §17.1(b)）。

### 1.2 `rangeMonths` 硬编码 14 个月（R-B6-3）

- `apps/web/src/lib/fxView.ts:61-68` 的 `rangeMonths(from, to)` 在超过 14 个月时抛 `fx_range_too_long`。
- 与 S-01 §17.1(a) 冲突：月键比较**不设日上限**、月份数暂记 **≤36**（A04/I09 需 12/24/36 个月）；与 Q-BA-12a 登记一致（暂记 36，待所有者确认）。
- 该上限目前是 web 本地常量，A/C 侧无法复用；需要落位到 shared 并由调用方参数化。

---

## 2. 提案 P-FX-1：`FxAggregate` 逐日/逐笔投影（additive）

### 2.1 类型草案

```ts
/** 一笔已成功折算的流水投影；全部字段来自 convertFx 结果，不二次舍入。 */
export interface FxConvertedEntry {
  readonly id: string;
  readonly bookId: string;
  readonly date: string;                 // 业务日期（occurredLocalDate，YYYY-MM-DD）
  readonly kind: "income" | "expense";
  readonly categoryId: string;
  readonly targetMinor: string;          // 折算后金额（目标币种最小单位；字符串避免 >2^53）
  readonly originalMinor: number;        // 原始金额（最小单位，number 与 FxEntry 一致）
  readonly originalCurrency: string;
  readonly rateDate: string | null;      // 实际采用的汇率日期（7 天回退后的日期）
  readonly rateCached: boolean;
  readonly needsReview: boolean;
}

export interface FxDetailOptions {
  /** 是否输出逐笔投影；默认 false（只算 daily 时内存 O(日期数)）。 */
  readonly includeEntries?: boolean;
  /** includeEntries=true 时逐笔数量上限；默认 FX_MAX_DETAIL_ENTRIES。超限抛错，不截断。 */
  readonly maxEntries?: number;
}

export interface FxAggregateDetail {
  /** 业务日期 → 收入/支出/净额（目标币种最小单位）；只含至少一笔成功折算的日期，缺失日期不出现（≠0）。 */
  readonly daily: Readonly<Record<string, FxTotals>>;
  /** 仅 includeEntries=true 时非 null；顺序=输入 entries 原序，失败笔不在其中。 */
  readonly entries: readonly FxConvertedEntry[] | null;
}

export interface FxDetailedAggregate extends FxAggregate {
  readonly detail: FxAggregateDetail;
}

/** 逐笔投影上限（默认 50,000；低端设备可由调用方传更小值）。 */
export const FX_MAX_DETAIL_ENTRIES = 50_000;

export function aggregateFxDetailed(
  accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>,
  cache?: FxResultCache, options?: FxDetailOptions,
): FxDetailedAggregate;

export function aggregateFxDetailedAsync(
  accountId: string, bookId: string, entries: readonly FxEntry[], target: string,
  rates: ReadonlyMap<string, FxLookup>,
  options?: FxAsyncOptions, detail?: FxDetailOptions,
): Promise<FxDetailedAggregate>;
```

### 2.2 规则（8 条）

1. **additive 边界**：`aggregateFx` / `aggregateFxAsync` 的签名、返回字段、默认行为完全不变；`FxAggregate` 类型不新增必填字段。新能力只经新函数暴露，并对 `FxDetailedAggregate`（`extends FxAggregate`）使用。
2. **daily 与 totals 严格守恒**：`Σ daily[d].incomeMinor === totals.incomeMinor`，`Σ daily[d].expenseMinor === totals.expenseMinor`，`Σ daily[d].netMinor === totals.netMinor`（BigInt 精确相加）。日期键只含成功折算的流水日期。
3. **逐笔与 `convertFx` 同源**：`targetMinor = convertFx(entry, target, lookup).convertedMinor`，`rateDate/rateCached/needsReview` 直接透传；禁止再舍入或反推。`failures` 只记失败笔，`detail.entries` 只含成功笔——两者互斥，避免把 unknown 当 0。
4. **上限不静默**：`includeEntries === true` 且 `entries.length > maxEntries`（默认 `FX_MAX_DETAIL_ENTRIES`）时抛 `Error("fx_detail_limit")`；不截断、不省略、不返回部分结果。`daily` 不受该上限影响。
5. **异步分批与取消**：`aggregateFxDetailedAsync` 与现有异步版一致的 `batchSize`（1..1000，默认 200）/`signal`/`yieldControl`；每批间让出主线程；`signal` 取消时**不返回**部分结果；合并语义与 `aggregateFxAsync` 一致（`reviewDates` 去重、`failures` 拼接、`convertedCount`/`missingCount` 汇总）。上限在校验阶段按 `entries.length` 一次判断，不按批判断。
6. **权限/作用域合同不变**：仍要求调用方预过滤（权限、软删除、日期范围）；`bookId` 必须与所有 `entry.bookId` 一致，否则 `fx_scope_mismatch`；本扩展**不查询账本**、不扩大任何只读端点（G-11/T2 范围不变）。
7. **完整性与时间分析映射**：`complete`/`missingCount`/`shareDenominatorMinor` 语义不变；`complete=false` 时 `detail.daily` 仅表示“已成功折算部分”，时间分析接入时必须把 `failures` 中的日期映射为 **unknown**（不是 0），并按 S-01 §5 给整体完整性降级。
8. **缓存不变**：复用既有 `FxResultCache`（逐笔 `convertFx` 结果）；逐笔数组不额外缓存（内存由调用方控制 `includeEntries`），异步版本按批 append。

### 2.3 与现有 S-01 形状的接入点

- 时间分析（原币/综合双模式）：综合模式下由 `detail.daily` + `detail.entries` 生成与 `computeTimeSeries` 相同的 `TimeSeriesEntry` 序列（`amountMinor` 取折算后字符串，不改 `shared` 计算核心）。
- 来源追溯：`detail.entries` 的 `id` 用于 `SourceDescriptor.transactionIds`（G-02/G-11 不变，仅内部参数，不新增只读端点）。
- 图表层不重算：图表输入层仍只做像素映射。

---

## 3. 提案 P-FX-2：`rangeMonths` 14 → ≤36（参数化）

### 3.1 现状

```ts
// apps/web/src/lib/fxView.ts:61-68（1.16.23）
export function rangeMonths(from: string, to: string): string[] {
  const result: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7);) {
    result.push(month);
    const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); month = date.toISOString().slice(0, 7);
    if (result.length > 14) throw new Error("fx_range_too_long");
  }
  return result;
}
```

### 3.2 提案

1. shared 新增（`packages/shared/src/fx.ts`，靠近 `FX_POLICY`/`FX_MAX_FALLBACK_DAYS`）：

```ts
/** 月键范围上限，对齐 S-01 §17.1(a)（暂记 36，待所有者确认 Q-BA-12a/G-09）。 */
export const FX_MAX_RANGE_MONTHS = 36;

/** 含首尾月份的 YYYY-MM 枚举；超过 maxMonths 抛 fx_range_too_long（不截断）。 */
export function fxRangeMonths(from: string, to: string, maxMonths: number = FX_MAX_RANGE_MONTHS): string[];
```

2. web `rangeMonths(from, to, maxMonths = FX_MAX_RANGE_MONTHS)` 委托 shared `fxRangeMonths`；`useFxRange` 调用处保持 `rangeMonths(from, to)` 即默认 36。
3. 实现约束（S-01 §17.1(a)）：**按月拆分请求**，不把多月拼成单区间；每页/条数上限沿用现有端点；`fxView.ts` 的 `remote.size > 100000` 容量保护保留，超出仍显式报 `fx_range_capacity`（不静默）。
4. 错误码保持 `fx_range_too_long`/`fx_range_capacity`；新增非法日期/顺序错误 `fx_range_invalid`（仅新函数校验，不改变既有调用路径的合法输入）。
5. 兼容性：`rangeMonths` 现有调用点仅 `fxView.ts` 与 `fxView.test.tsx`；旧测试断言“15 年区间抛错”在 36 上限下仍成立（313 个月 > 36）。**唯一行为变化**是 15–36 个月不再抛错（draft，W1 接入时生效）。

---

## 4. 性能验证计划（P-FX-1-P）

| 项 | 内容 |
|---|---|
| 场景 | 36 个月；每月 1,500 笔（共 **54,000 笔**，收入/支出混合、~20 币种、~1,095 个日期）；`rates` Map 覆盖全部日期；`target=CNY` |
| 指标 | ① `aggregateFxDetailedAsync` 总耗时（目标本机 ≤ 3s，含 7 天回退命中）；② 单批主线程阻塞 ≤ 50ms（批间隔采样）；③ `includeEntries=true` 峰值内存增量 ≤ 30MB（54k × ~200B ≈ 11MB 目标）；④ 仅 `daily` 模式（`includeEntries=false`）相对现有 `aggregateFxAsync` 总耗时差异 ≤ 5% |
| 落位 | 新增 `packages/shared/src/fxDetail.performance.test.ts`，用 `describe.runIf(process.env.FX_PERF === "1")` 门控（默认 CI 跑轻量用例，发布前/W1 接入前跑完整基准）；不修改现有 `performance.test.ts` 基线 |
| 验收 | 数字记录进 `docs/specs/design/S17-B-性能基线.md`，供 W1 性能验收引用；回归阈值写进测试断言 |

另加**正确性性质测试**（默认 CI 运行，非性能）：`Σ daily = totals`、`entries` 与 `convertFx` 逐笔一致、`failures`/`entries` 互斥、超限抛 `fx_detail_limit`、异步=同步、预取消不返回结果、`fxRangeMonths` 36/37 月边界。

---

## 5. 兼容性影响

| 对象 | 影响 |
|---|---|
| `FxAggregate` 类型 | **不变**（新函数返回 `FxDetailedAggregate extends FxAggregate`） |
| `aggregateFx`/`aggregateFxAsync` | **签名/返回不变**，现有调用零改动 |
| 唯一消费方 `fxView.ts` | 类型引用不变；`rangeMonths` 默认上限 14→36（见 §3.2.5，draft） |
| 新增导出 | `FX_MAX_DETAIL_ENTRIES`、`aggregateFxDetailed`、`aggregateFxDetailedAsync`、`FX_MAX_RANGE_MONTHS`、`fxRangeMonths`（shared `index.ts` 仅新增，不重排） |
| 错误码 | 保留 `fx_range_too_long`/`fx_range_capacity`；新增 `fx_detail_limit`、`fx_range_invalid`（均为新路径触发） |
| S-01 形状 | 不新增结果形状、不改已登记 7+4 形状；新增内容仅作为 B 的内部投影（G-16 登记） |
| 测试 | 现有 shared 521/web 1467 用例不受影响；新增约 10 条正确性 + 1 个门控性能用例 |

---

## 6. 对 S-01 v2 的登记请求（交 A 汇总）

1. **G-09 增补**：月键比较上限常量落位——`FX_MAX_RANGE_MONTHS = 36`、`fxRangeMonths` 参数化；日窗口 `maxAnalysisDays` 默认 400 由 `analysis/*` 调用方传入（B 纯函数已参数化，不硬编码）。
2. **新增 G-16**（B 侧）：“综合模式 `FxAggregate` 逐日/逐笔投影（additive）”——字段名、默认上限、异步取消语义、与 G-02/G-11 的边界。
3. **与 G-02 衔接**：`SourceDescriptor.query.kind` 若增加 `fx`/`daily`，B 的逐笔 `id` 可直接用于来源跳转参数；不扩 T2 只读端点（G-11 不变）。
4. 冻结前 B 侧实现标 **draft**：`fx.ts` 新增 API 的 docstring 注明“S-01 v2 draft，待冻结后由 W1 接入”，不作为稳定公共契约对外承诺。

---

## 7. 实施计划（本提案提交后，Lead 已批准实现但标注 draft）

1. `packages/shared/src/fx.ts` 实现 P-FX-1/P-FX-2（新函数 + 常量，不改既有函数行为）。
2. 新增 `fxDetail.test.ts`（正确性/上限/取消/异步=同步）+ `fxDetail.performance.test.ts`（门控）。
3. `apps/web/src/lib/fxView.ts` 的 `rangeMonths` 委托 shared（默认 36），保留容量保护；不改 `StatsPage.tsx`/`FxStats.tsx`。
4. 回填任务文档 §5/§6.2/§6.4、协议草案 §15 指针、`docs/00-索引.md`。
5. 全量验证后提交（本地，不 push）；报告 Lead；**待 S-01 v2 冻结后**才在 W1 页面接入。

---

## 8. 开放问题（B 侧，待 A/Lead 答复）

| 编号 | 问题 | B 的建议 |
|---|---|---|
| Q-BP-1 | 字段命名 `daily`/`entries` vs `dailyTotals`/`convertedEntries` | 沿用短名 `daily`/`entries`（与 `months`/`categories` 风格一致） |
| Q-BP-2 | 逐笔顺序是否冻结为输入序 | 输入序（稳定、无需排序成本）；聚合结果与顺序无关 |
| Q-BP-3 | `maxEntries` 默认 50,000 是否按设备下调 | 默认 50k；低端设备由调用方传 10k（不写死多套） |
| Q-BP-4 | 逐笔投影是否需 `version`/`deletedAt` | 不需要：权限/软删由调用方预过滤（现有合同），逐笔只读投影不含敏感字段 |
| Q-BP-5 | web `rangeMonths` 默认值是否先保持 14、W1 接入时显式传 36 | 按 Lead 口径直接 36（draft，W1 前无页面调用变化；测试覆盖 36/37 边界） |
