# S17 · 时间桶对外口径（B-17 交接页，供 C 的 P14/P15 对齐）

> 状态：**草案**（2026-10-27，B-5 交付；随 S-01 v2 冻结再对齐，不构成公共接口）。
> 目的：把 Agent B 的「时间桶键 / 五态 / 闰年 / 周一起始」对外口径整理成一页，供 C 的 **P14 小多图（small-multiples）** 与 **P15 日历（calendar）** 直接复用，避免两套时间系统。
> 实现来源：`packages/shared/src/timeCalendar.ts`（`TIME_CONTRACT_VERSION = "s17-b-time-v1"`）+ `calendarHeatmap.ts`（`CALENDAR_HEATMAP_VERSION`）。两者均为纯函数、无时区依赖。

## 1. 桶键（稳定身份，跨语言/跨端一致）

| 粒度 | 键格式 | 示例 | 自然区间（半开） |
|---|---|---|---|
| 日 | `YYYY-MM-DD` | `2026-10-27` | `[d, d+1)` |
| 周 | ISO 周键 `YYYY-Www`（**ISO 周年**，周一起始） | `2026-W53` | `[周一, 下周一)` |
| 月 | `YYYY-MM` | `2026-10` | `[1 日, 下月 1 日)` |
| 年 | `YYYY`（如需，S-01 v2 待定 quarter/year 是否进 `timeGranularity`） | `2026` | `[1/1, 次年 1/1)` |

规则：
1. 业务日期是**日历日字符串**（`YYYY-MM-DD`），不做 UTC↔本地换算；`today`/`coverageEnd` 由调用方传入。
2. 周键用 ISO 周年：`2026-12-28`～`2027-01-03` 的键是 `2026-W53`（不是 `2027-W01`）；2026 有 53 个 ISO 周。生成和反解一律用 `isoWeekOf`/`isoWeekKey`/`weekSpan`，不要自己算周数。
3. 月键/周键是**分类轴**（不相邻桶不能用线性间距假装等距）；时间比较（A01–A05）使用真实日期，不使用桶序号。
4. 桶对象携带 `span: {start, end}`（半开）与 `clippedStart/clippedEnd`（分析区间裁剪标记）；`bucketToInclusive(bucket)` 是半开→闭区间**唯一**换算，来源跳转/UI 展示用它。

## 2. 五态（完整性）

| 状态 | 判定 | 数据表达 | UI 约定 |
|---|---|---|---|
| `complete` | 桶已结束且完全落在已知覆盖内 | 金额可为 `"0"`（已知零 ≠ 未知） | 正常色阶/柱高 |
| `in-progress` | 桶包含 `today` 且尚未结束 | 金额可给，但必须标注未结束 | 降透明度/“本月未结束”；**不得**当最终值参与同比/累计结论 |
| `future` | 桶起点晚于 `today` | 金额/笔数 `null` | 不画几何；不参与累计/统计样本 |
| `unknown` | `coverageEnd` 为空或未覆盖桶末日 | 金额 `null`，不是 0 | 明确空白/未知纹理；总量 `null`；累计从该点起不确认 |
| `unavailable` | 计算不可用（如汇率不全） | 金额 `null` + 原因 | 展示不可用原因，不补 0 |

映射到 S-01 `AnalysisCompleteness`：见 B 协议草案 §4.2 的逐项映射（`complete→complete`、`in-progress→in-progress`、`future→future`、`unknown→unknown`、`unavailable→unavailable` 等，最终以 S-01 v2 冻结稿为准）。

## 3. 闰年与跨年

- 日粒度逐日枚举，2 月 29 日自然存在（2024 年有 29 个日桶）；不假设每月 30 天。
- 年网格：`leapYear` 由 2 月天数判定；周行数（P15 的 `weekCount`）按“该年与 Monday 起始 ISO 周交叠的行数”计算，跨年首末周各算一行（与月网格一致）。
- 比较对齐（A03）：目标年无 2/29 时取该年 2 月最后一天，逐条记入 `leapDayFallbacks`；日历/热力不做“闰日折算”，按真实日期。
- 月份键比较（A04/I09）：不设日上限（月数 ≤36 暂记），按月拆分枚举，不把多月拼成一次超限单区间。

## 4. 与 C 的 P14/P15 对齐点

**P14 小多图（small-multiples）**
1. 桶轴直接复用 B 的 `enumerateBuckets(granularity, span, context)` 与 `bucketKeyOf`；不得自行推算周/月边界。
2. 每个小图共享同一 `(granularity, span, today, coverageEnd)`，保证桶键/五态逐桶一致。
3. `total` 语义一致：unknown 不计入且总量为 null；in-progress 可计入但 `complete=false`。
4. 截断（topN≤24）只影响“显示哪些序列”，不影响桶轴与完整性。

**P15 日历（calendar）**
1. 日历算术（周一起始、ISO 周键、闰年、五态）唯一实现 = B 的 `timeCalendar.ts`；建议 C 的 `QC-24 CalendarResult` 只做字段投影（`weekIndex` 由 `isoWeekOf` 派生），**不另立日历系统**。
2. 强度口径以 B 的 `calendarHeatmap.ts` 分位等级（0–4，仅对完整日计算）为权威；C 的 `intensityMin/Max` 只作为图例显示区间，不作为第二套归一化。
3. `unknown`/`future` 日必须与“已知零”在视觉与数据上可区分（`level = null` vs `level = 0`）。
4. 整年视图所需月份拼行若 C 需要，由 B 扩 `calendarHeatmap`（年视图函数，归属 B），C 只消费。

## 5. 对外 API（C 可直接引用）

`packages/shared/src/timeCalendar.ts`：`TimeSpan`、`BucketState`、`TimeBucket`、`BucketContext`、`daySpan/weekSpan/monthSpan/bucketSpanOf`、`bucketKeyOf`、`isoWeekOf/isoWeekKey`、`enumerateBuckets`、`classifyBucket`、`bucketToInclusive`、`spanFromInclusiveDates/spanToInclusive`、`daysInSpan`、`isNaturalSpan`。

`packages/shared/src/calendarHeatmap.ts`：`computeCalendarHeatmap`（逐日 value/count/state/level、分位阈值、月矩阵 Monday-first）。

版本：`TIME_CONTRACT_VERSION = "s17-b-time-v1"`；两模块均已在 `packages/shared/src/index.ts` 导出（新增导出，未重排既有导出）。S-01 信封（`analysis/time.ts`）待协议冻结后由 B 补，届时 C 的时间/日历分析经同一入口。

## 6. 未决（挂 S-01 v2）

- `timeGranularity` 是否增加 `quarter`/`year`（G-08）；
- 五态→9 态映射表在 v2 冻结稿的确认（G-01/G-14）；
- P15 年视图的函数命名与字段（B 扩，C 消费）；
- A05 默认窗口政策（`same-day-index`）与 B-16 极值日阈值待所有者确认（G-05，另见 B 任务文档 §7）。
