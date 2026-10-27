# S-01 v2 修订 r7 记录（所有者签认后四项闭合，2026-10-27）

> 状态：`s01-v2-draft`，**未冻结**。本记录对应 Lead m03659（2026-10-27）与所有者签认记录 `S17-S01v2-所有者签认-20261027.md`（orchestrator `3760675`）；C 侧冻结前证据回执 `bf6de96`（Lead 验收登记 `5b5bb0c`）。r7 只改文档，不改协议字段/代码/迁移，未 push。
>
> 依据文件：`S17-Agent-A-S01-v2-结构草案.md`（§1/§3.3/§3.4/§5.1/§7/§8/§10/§11/§12/§15/§16；r7 后 800 行级）；`S17-Agent-A-S01-v2-最终冻结核对结果.md`（r7 版）；`S17-Agent-A-S01-v2-评审意见汇总表.md`（X-12、§4、§6）。

## 1. 范围与性质

- 输入：所有者签认（四项必须先闭合：G-28a、G-30、#3 月窗口 vs FX 读取范围、σ/CV 展示精度与单位语义）+ G-24/G-25/G-26/G-27/G-28b/G-29 落定 + #13 保持 O。
- 输出：v2 文档修订（§3.3/§3.4/§5.1/§7/§8/§10/§11/§12/§15/§16）+ 本记录 + 最终冻结核对结果 r7 版 + 评审表 X-12/§4/§6 + 任务文档更新。
- 不改：协议 TS 字段名/类型、常量值语义（除按签认落定状态）、代码/测试/迁移、其他 Agent 工作区；不 push、不冻结。

## 2. 八项逐项落实

| # | 项 | 签认/裁定 | r7 动作 | 位置 | 回执状态 |
|---|---|---|---|---|---|
| 1 | G-24 直方图分箱 | 同意默认 `nice-bin-width`；Sturges 只作保留方案、未实现不得宣称已支持 | 删除「Sturges 已支持/候选实现」措辞；`method` 串只列 `histogram-nice-bin-width` 为已支持，`histogram-sturges` 标「仅候选」 | §3.3 `distribution` 行、§5.1-10、§7 G-24、§12 `method` 行 | 已闭合 |
| 2 | G-25 分位点集合 | 同意原建议 | P25/P50/P75 + IQR 必填；P10/P90 仅在显式参数时输出；不得两 Agent 不同集合 | §5.1-9、§3.3、§7 G-25 | 已闭合 |
| 3 | G-26 P13 归属 | 同意 P13 归 `pivot` | matrix 只保留 P01–P04；P13 不双挂；pivot 行即 P13 正式归属 | §3.3 `matrix`、§3.4 `pivot`、§7 G-26 | 已闭合 |
| 4 | G-27 `partial` 语义 | 有条件同意：`partial → fx-incomplete` 仅限明确因汇率缺失导致；其他原因按自身映射 | 重写映射规则：仅当 FX 引擎 `failures` / 某笔 `resolution.status="missing"` / `missingCount>0` 且无其他阻断；写 4 条反例与混合原因优先级 `no-permission > request-failed > fx-incomplete > unknown`；标注 `contributionCompleteness` 调用点仅 P17/P19/P20，fallback 成功不计 missing | §5.1-3、§15.2、§7 G-27 | C 回执（`bf6de96`）；B 待确认 |
| 5 | G-28a P16 状态集合 | 暂不签认原文；按 C-4 实现重写三态与触发规则、删除矛盾 | P16 = `complete｜no-transactions｜unavailable`（无 `partial`）；纯函数只产生 2 态（rows 非空→complete、空集→no-transactions），`unavailable` 仅上游（no-permission/request-failed/not-applicable）；P16 不折算、每笔必有币种、`recordShare` 分母=总记录数（空集 null）；删除「三态含 partial」矛盾 | §3.3 `fx-diagnostic` 行、§5.1-8、§15.2、§15.3 P16 行、§15.4 统计完整性行、§7 G-28a | **已闭合**；C 实现证据（`currencyComposition.ts:91`）+ Lead 验收 `5b5bb0c` |
| 6 | G-28b P20 `available` | 同意进结果层 | 结果层 `available:boolean` + 可选 `unavailableReason`；web 适配层只消费不推导；无折算需求不得显示「0 次回退」 | §5.1-8、§7 G-28b、§15.3 P20 行 | 已闭合 |
| 7 | G-29 B/C 日历归属 | 同意 B 维护唯一日历基础实现 | B `calendar-heatmap` 唯一冻结形状；C `calendar` 纯投影；C `small-multiples` 必带 `granularity` 并复用 B `TimeAxisHint` | §4.7、§3.4、§7 G-29 | 已闭合（B/C 回执确认） |
| 8 | G-30 枚举 | 原则同意；须列出准确值、无重复、无未实现却宣称可用 | `PIVOT_METRICS=["amount","count","average","share"]`（4）；`ADVANCED_DIMENSIONS=["category","paymentMethod","kind","currency","month","week","weekday"]`（7）；`diagnosticKind` 5、`DraftHierarchyNodeKind` 3、`rankingPolicy` 单值、`MAX_SMALL_MULTIPLES_TOP_N=24`（默认 12） | §12 枚举组、§3.4 pivot/cross-cube、§7 G-30 | **已闭合**：C 逐值实现核对（`pivot.ts:34`、`dimensions.ts:37-45`），无重复、全实现 |
| 9 | #3 `maxMonths` | 同意默认 36、上限 60（**分析窗口**）；须写清「**现有** S16-D 汇率读取范围」区别 | §16.7 重写三层区分：①**S16-D 现状读取上限 = 14 个月**（`apps/web/src/lib/fxView.ts:61-69` 的 `rangeMonths` 上限，超限抛 `fx_range_too_long`）；②**B 提案（draft）`FX_MAX_RANGE_MONTHS=36`**，W1 接入生效前 web 实际仍 14，**不得宣称 36 已生效**；③**分析窗口**默认 36/上限 60，与 FX 读取范围不同轴。原币模式可 60；折算模式不得超过**当时生效**读取上限（当前 14；W1 后 36），超限显式拒绝（`fx_range_too_long`/`analysisLimit`/`unavailableReason`）或整结果 `fx-incomplete` + 可追溯原因 + UI 显式标记，禁止静默部分结果；B/C 各自检查 | §16.7、§12 `maxMonths` 行、§7 G-09 行 | **已闭合**（Lead m03807 事实修正）；B 待确认窗口规则 |
| 10 | #13 金额缩写 | 同意继续 O、不冻结数值 | 保持 O；不写具体阈值；仅记录待办 T-3（单位/多币种小数位/格式提案） | §12 `C_AMOUNT_DISPLAY_TIERS_MINOR` 行、§16.2 | 保持 O（符合签认） |
| 11 | σ/CV 展示精度与单位 | 新增闭合项：不得把货币最小单位舍入套到无量纲 CV | §16.6 重写：σ=最小单位定点（`standardDeviationScaled`，6 位），展示按币种小数位一次 `minor-half-away-v1`；CV=无量纲定额（`coefficientOfVariation`），`percent-100` 1 位小数、`formatRatioPercent`；CV 不得用 `formatRatioMinorText`/货币缩略；跨币种 σ 归 W3；旧版缺失=null 不补 0 | §16.6、§12 注、§15.2 | **已闭合**；C 证据 `bf6de96`（`fxDiagnostics.ts`）；B 待确认 |
| 12 | T2 只读扩展 | 条件验收通过 | 保持「已实现、待所有者签认、暂不合并」；本记录不扩大读取范围 | §9 备注、任务文档 §9.3 | 待所有者签认 |
| 13 | G-31 Codex 单一来源 | 知悉，集成期消除竞争定义 | 保留 O/集成期项，不由 A 单方闭合 | §16.2 O 项、§16.4 | 集成期 |
| 14 | G-32 G-12a 实现 | — | 发布物已产出；分享导入保持关闭（`shareImportAllowed=false`），D 实现 + 30 条测试通过后由 Lead 放行 | G-12a 发布物 §9 | 待 D 实现 |

## 3. 四项闭合的判定依据（摘要）

1. **G-28a**：C 实现 `packages/shared/src/analysis/advanced/currencyComposition.ts` 第 91 行 `const completeness: DraftCompleteness = rows.length === 0 ? "no-transactions" : "complete"`，函数无 `partial` 分支；`batch4.test.ts` 覆盖空集→`no-transactions`、非法记录→`RangeError`。`unavailable` 只能由上游取数层置位（纯函数无 I/O）。
2. **G-30**：C `pivot.ts:34` 定义 `PIVOT_METRICS` 4 值；`dimensions.ts:37-45` 定义 `ADVANCED_DIMENSIONS` 7 值；逐值核对无重复、全部已实现；`share` 分母=全表合计（`grandTotalMinor`，cells/rowTotals/colTotals 同基），`average` 量纲=最小单位/笔，`share` 无量纲。
3. **#3**：三层区分——**S16-D 现状汇率读取上限 = 14 个月**（`apps/web/src/lib/fxView.ts:61-69`，超限 `fx_range_too_long`）；**B 提案 draft `FX_MAX_RANGE_MONTHS=36`** 未生效（W1 接入前 web 实际仍 14，不得宣称）；**分析窗口**默认 36、上限 60（原币模式可 60）；折算模式不得超**当时生效**读取上限，超限显式拒绝给原因或整结果 `fx-incomplete` + 可追溯 + UI 标记，禁止静默部分结果（Lead m03807 修正）。
4. **σ/CV**：C `fxDiagnostics.ts` 中 σ 为 `standardDeviationScaled`（最小单位定点 6 位）、CV 为无量纲 `Ratio` `coefficientOfVariation`；比例显示走 `formatRatioPercent`（无量纲独立精度），`formatRatioMinorText` 只用于最小单位量纲；金额缩略常量只作用于金额；σ 的币种换算归 W3。

## 4. 修改文件清单

- `docs/specs/product/s17-agents/S17-Agent-A-S01-v2-结构草案.md`（§1 三行来源、§3.3/§3.4、§5.1-3/-8/-9/-10、§7 G-24…G-30、§8 r7 进展、§10 1.10、§11 r7 行、§12 枚举与常量状态、§15.2/§15.3/§15.4、§16.2/§16.6/§16.7/§16.9/§16.10）
- `docs/specs/product/s17-agents/S17-Agent-A-S01-v2-最终冻结核对结果.md`（r7 版）
- `docs/specs/product/s17-agents/S17-Agent-A-S01-v2-评审意见汇总表.md`（X-12、§4 r7 行、§6 变更行）
- `docs/specs/product/s17-agents/S17-Agent-A-基础与分类分析.md`（§5、§6.2、§7 A-Q25、§9.3）
- 新增：`docs/specs/product/s17-agents/S17-Agent-A-S01-v2-r7-记录.md`（本文件）
- 事实修正（Lead m03807）：**S16-D 现状 FX 读取上限为 14 个月**（`apps/web/src/lib/fxView.ts:61-69`），B 提案 draft `FX_MAX_RANGE_MONTHS=36` 未生效；已同步 v2 §16.7/§12/§7 G-09/§13.3/§13.4/§13.5、最终核对表；C 侧 FX 诊断 P16–P20 纯函数、无独立折算读取入口（`draftTypes.ts:578`），real projection 经 `useFxRange`/`fxRangeMonths`，C 不新增第二读取入口。

## 5. 剩余门禁（r7 后）

1. **D 单点复核**：针对 r7 增量（P16 三态、G-30 列值、#3 窗口规则、σ/CV 展示语义），确认与 S-03/布局接口无冲突。
2. **B/C 受影响接口核对**：C 已回 G-27/G-30/σ-CV 证据（`bf6de96`）；B 待确认 #3 窗口规则与 §16.7（`rangeMonths` 参数化、折算超范围行为）。
3. **所有者签认 → Lead 标记 `s01-v2`**：全部回执后由 Lead 统一版本串并标记冻结；在此之前本文件与 v2 保持 `s01-v2-draft`，**不冻结、不发布、不 push**。
4. 非阻塞待办：T-1 3,660 天保护、T-2 60 月实现落地、T-3 金额缩写提案（保持 O）、T-4 箱线文案、T-5 桑基常量来源、T-6 展示层虚拟化；#13 保持 O；G-31/G-32 归集成期/D 侧。

## 6. 边界

- r7 未新增协议字段、未改 TS 类型/常量值、未改代码/测试/迁移、未触碰主工作区与其他 Agent 工作区、未 push。
- 引用文件均为只读：所有者签认 `3760675`、C 回执 `bf6de96`/Lead 验收 `5b5bb0c`。
- 提交状态：r7 本地提交（提交号回填见任务文档 §6.2 与本文件 §7）。

## 7. 变更记录

- 2026-10-27 r7：依据所有者签认 `3760675`（Lead m03659）与 C 回执 `bf6de96`（Lead 验收 `5b5bb0c`）完成八项落实与四项闭合；v2 §16.9 改为闭合状态表；最终冻结核对结果升 r7 版；评审表登记 X-12。本地提交 `76aa278 docs(s17): S-01 v2 r7 落实所有者签认四项闭合（G-28a/G-30/#3 三层/σ-CV）`（未推送）；校验 `check-links`（212 份/976 链接）/`doc-audit`/`check-status` 均 exit 0。
- 2026-10-27 r7 事实修正（Lead m03807）：S16-D 现状 FX 读取上限 **14 个月**（`fxView.ts:61-69`）、B 提案 draft 36 未生效、分析窗口 36/60 三层区分落到 v2 §16.7/§12/§7 G-09/§13.3/§13.4/§13.5 与最终核对表；C 侧 FX 诊断 P16–P20 纯函数无独立折算读取入口（`draftTypes.ts:578`）记入 §16.7。
