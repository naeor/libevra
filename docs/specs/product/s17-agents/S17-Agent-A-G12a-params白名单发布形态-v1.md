# G-12a 正式发布物：params 白名单发布形态 v1（S-01 v2，2026-10-27）

> 状态：**发布形态 v1（draft 随 S-01 v2，未冻结；供 D 实施准备）**。
> 依据：所有者裁定 2026-10-27（`f215fa9`）§1.4「G-12a 的 params 白名单必须形成可供 D 实施的正式发布物；未完成校验与测试前，不开放不安全的分享导入行为」；Lead m03434；v2 §7 G-12a、§8、§16.5。
> 适用范围：布局卡片实例 `AnalysisReference.params`（D 的 S-03 契约，只作引用/校验，不解释财务语义）。
> **分享导入门：关闭（`shareImportAllowed = false`）**。本发布物+D 的校验实现与测试通过前，任何导入/分享路径不得接收外部布局或 params；待 Lead 放行后再开。

## 1. 定位与边界

- `AnalysisReference = { analysisId, analysisVersion?, params }`：布局只存**引用 + 参数**，不存结果金额/区间展开/图表配置。
- `params` 只允许**分析语义参数**（筛选、区间策略、分析选项）；**禁止**布局几何（尺寸/位置/密度）、图表样式、展示文案、账务数据。
- 校验**失败即拒绝**（不静默补默认值、不猜测、不做容错合并）；卡片保留已存配置，展示为错误占位并提示重新配置。
- 未知 `analysisId` 或较新 `analysisVersion`：**保留配置 + 只读占位**，不迁移、不删除、不回写、不自动改参数（v2 §6.1 G-12b）。
- 权限与账本：params 中**不得出现任何账本/用户/成员标识**；数据权限仍由查询层 `requireBook` 决定，布局层不扩权。

## 2. 通用参数键（所有 26 项可用，除单独限制）

| 键 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `paramsSchemaVersion` | `"1"`（字符串字面量） | 否 | 省略时按 "1" 校验；未知版本拒绝 | 发布物自身版本 |
| `kind` | `"income" \| "expense" \| "both"` | 否 | 与该分析允许取值一致（见 §3）；`both` 仅 B03/B18/B19/B20/I17-count 允许 | 覆盖分析默认收支范围 |
| `categoryIds` | `string[]`（uuid v4） | 否 | 1..50 个；去重；必须在当前账本存在且 kind 一致 | 分类筛选 |
| `paymentMethodIds` | `string[]`（uuid v4） | 否 | 1..50 个；去重；必须在当前账本存在 | 支付方式筛选 |
| `tagIds` | `string[]`（uuid v4） | 否 | 1..50 个；去重；必须在当前账本存在 | 标签筛选（任一命中） |
| `timePreset` | `"7d" \| "30d" \| "90d" \| "365d"` | 否 | 与 `timeRelativeDays`/`timeFixed` 互斥 | 继承工作台以外的预设区间 |
| `timeRelativeDays` | `integer` | 否 | 1..400（默认上限）；>400 必须同时显式 `allowLongRange:true` 且 ≤3660 | 相对今天区间（含今天） |
| `timeFixed` | `{ from: "YYYY-MM-DD"; to: "YYYY-MM-DD" }` | 否 | from≤to；天数 ≤400（或显式 `allowLongRange` 时 ≤3660） | 固定区间 |
| `allowLongRange` | `boolean` | 否 | 仅当区间 >400 天才允许为 `true`；**未显式请求时按 400 拒绝**（性能保护，C-1 #2） | 长区间显式请求 |
| `comparisonPolicy` | `"same-day-index" \| "equal-length-window"` | 否 | 仅用于比较类分析（B03 等）；默认 `same-day-index`；必须随结果回写 `policyId`（Q4） | 比较窗口策略 |

> 区间参数三者**最多出现一个**（`timePreset`/`timeRelativeDays`/`timeFixed`），否则 `params_conflict`。省略时继承工作台区间（`time.mode="inherit"`）。

## 3. 逐分析白名单（26 项）

| analysisId | 允许的额外键 | 允许 kind | 说明/专属约束 |
|---|---|---|---|
| AN-B01 总支出 | — | expense | 无额外键 |
| AN-B02 总收入 | — | income | 无额外键 |
| AN-B03 收支差额 | `comparisonPolicy` | both | 比较策略显式记录 |
| AN-B04 支出笔数 | — | expense | — |
| AN-B05 收入笔数 | — | income | — |
| AN-B06 日均支出 | — | expense | 分母=区间自然日（不接受自定义分母） |
| AN-B07 单笔平均支出 | — | expense | — |
| AN-B08 中位数支出 | — | expense | 分位口径固定 Type 7，不接受自定义 p |
| AN-B09 最大单笔支出 | — | expense | — |
| AN-B10 最小单笔支出 | — | expense | 不接受「最小正数」开关（语义待 A-Q3） |
| AN-B11 最高单日支出 | — | expense | — |
| AN-B12 最高单日收入 | — | income | — |
| AN-B13 有支出记录天数 | — | expense | — |
| AN-B14 无支出记录天数 | — | expense | 完整性不足时明示 |
| AN-B15 最大支出分类 | — | expense | 未分类参与排序（与 I14 同口径） |
| AN-B16 分类总数量 | `includeSystemCategories`（boolean，默认 false） | expense\|both\|income | 真实分类计数不含系统分类 |
| AN-B17 最大单笔收入 | — | income | — |
| AN-B18 收支比 | — | both | income=0 不可计算 |
| AN-B19 账面结余比例 | — | both | 非储蓄率，名称固定 |
| AN-B20 交易最多的一天 | — | both | 按收入+支出合计计数 |
| AN-I01 支出分类构成 | `maxParts`（integer 1..30，默认 8） | expense | 折叠组金额守恒、可展开 |
| AN-I02 收入分类构成 | `maxParts`（integer 1..30，默认 8） | income | 同上 |
| AN-I03 支出分类排行 | `topN`（integer 1..30，默认 10） | expense | 排序确定性（金额降序→分类 ID 升序） |
| AN-I04 收入分类排行 | `topN`（integer 1..30，默认 10） | income | 同上 |
| AN-I05 各分类交易笔数 | `topN`（integer 1..30，默认 10） | expense\|income | 笔数排序，不与金额排行混用 |
| AN-I17 支付方式构成 | `metric`（`"amount" \| "count"`，默认 amount）、`maxParts`（1..30，默认 8） | expense\|income | count 模式不与 amount 混报；未指定组恒在末位 |

**白名单外一律拒绝**（`params_unknown_key`）。

## 4. 隐私黑名单（出现即拒绝 `params_private_data`）

- 禁止键（大小写不敏感）：`bookId`、`ledgerId`、`accountId`、`userId`、`memberId`、`ownerId`、`categoryName`、`tagName`、`paymentMethodName`、`amount`、`amountMinor`、`amountCents`、`amounts`、`result`、`results`、`value`、`values`、`totals`、`title`、`subtitle`、`customTitle`、`note`、`notes`、`email`、`username`、`displayName`、`color`、`chartFamily`、`width`、`height`、`size`、`density`、`x`、`y`、`w`、`h`。
- 禁止任何自由文本值（字符串只允许枚举常量、日期串、uuid、`"1"`）；禁止嵌套对象（`timeFixed` 除外，且只允许 `from`/`to` 两个日历日期键）。
- 理由：G-12c（params 值约束与隐私黑名单）——布局/分享不得携带个人账务与身份数据；展示文案归 i18n/S-02，不进 params。

## 5. 校验规则（D 实现要求）

1. `params` 必须是普通对象（非数组/null）；JSON 可解析；键总数 ≤ 12。
2. 先按 `analysisId` 取白名单，再校验值类型/范围/互斥/隐私黑名单；**未知键一律拒绝**（不做前缀匹配、不做大小写归一）。
3. `analysisVersion`：缺省=当前目录版本；等于/较旧→按对应版本白名单校验；较新→只读占位（不校验不迁移）。
4. 校验必须**纯函数**（无网络/无存储副作用），错误带稳定错误码与字段路径，供 UI 提示。
5. 校验通过后仍由查询层按权限过滤；布局层不得直接读取账务数据。
6. 校验失败/未知版本/未知 analysisId 一律**保留原配置**，只占位不写回；不得删除未知字段。
7. 分享导入路径在 `shareImportAllowed=false` 期间**直接拒绝**任何导入（提示「分享导入尚未开放」），不得绕过校验。

## 6. 错误码（D 侧实现使用）

| 错误码 | 触发 | 用户可见提示（建议） |
|---|---|---|
| `params_invalid` | 非对象/JSON 不可解析/键数超限 | 卡片参数无效，请重新配置 |
| `params_unknown_key` | 白名单外键 | 该卡片不支持此参数 |
| `params_type` | 类型不符 | 卡片参数类型错误 |
| `params_out_of_range` | 数值/日期/数量越界 | 卡片参数超出允许范围 |
| `params_conflict` | 区间参数互斥冲突 | 时间范围设置冲突 |
| `params_private_data` | 命中隐私黑名单/自由文本 | 卡片参数包含不允许的信息 |
| `params_unknown_analysis` | 未知 analysisId | 卡片类型未知，已只读保留 |
| `params_newer_version` | 较新 analysisVersion | 卡片版本较新，已只读保留，请更新应用 |
| `share_import_closed` | 分享导入门未开放 | 分享导入尚未开放 |

## 7. 版本与演进

- 本发布物版本：**v1**（`paramsSchemaVersion="1"`），随 S-01 v2 冻结后由 Lead 统一版本口径。
- 白名单随分析目录/`analysisVersion` 演进：新增键=新 `analysisVersion`，旧版本卡片只读占位；禁止在不升版本的情况下改变键语义。
- D 按本发布物校验，不重新冻结协议；如发现白名单缺键，走最小修订单（Lead 裁定），不得自行扩展。

## 8. 测试用例（D 与 A 复核共用；实现后须全过才可请求放行分享导入）

| # | 输入 | 期望 |
|---|---|---|
| 1 | 空 params `{}` | 通过（全部继承默认） |
| 2 | `{kind:"expense"}` on B01 | 通过 |
| 3 | `{kind:"income"}` on B01 | 拒绝 `params_type`（B01 仅 expense） |
| 4 | `{categoryIds:[uuid]}` | 通过 |
| 5 | `{categoryIds:"uuid"}` | 拒绝 `params_type` |
| 6 | `{categoryIds:[uuid,uuid]}` 重复 | 去重后通过 |
| 7 | `{tagIds:[uuid]}` on B01 | 通过（通用键） |
| 8 | `{unknownKey:1}` | 拒绝 `params_unknown_key` |
| 9 | `{bookId:"..."}` | 拒绝 `params_private_data` |
| 10 | `{categoryName:"餐饮"}` | 拒绝 `params_private_data` |
| 11 | `{amountMinor:"100"}` | 拒绝 `params_private_data` |
| 12 | `{title:"我的卡片"}` | 拒绝 `params_private_data`（v1 不允许自定义文案） |
| 13 | `{timePreset:"30d"}` | 通过 |
| 14 | `{timePreset:"30d", timeRelativeDays:7}` | 拒绝 `params_conflict` |
| 15 | `{timeRelativeDays:400}` | 通过 |
| 16 | `{timeRelativeDays:401}` | 拒绝 `params_out_of_range` |
| 17 | `{timeRelativeDays:3660, allowLongRange:true}` | 通过（显式请求） |
| 18 | `{timeRelativeDays:3661, allowLongRange:true}` | 拒绝 `params_out_of_range` |
| 19 | `{timeFixed:{from:"2026-10-01",to:"2026-09-01"}}` | 拒绝 `params_out_of_range` |
| 20 | `{timeFixed:{from:"2026-02-30",to:"2026-03-01"}}` | 拒绝 `params_out_of_range` |
| 21 | `{maxParts:0}` on I01 | 拒绝 `params_out_of_range` |
| 22 | `{topN:30}` on I03 | 通过 |
| 23 | `{metric:"count"}` on I17 | 通过 |
| 24 | `{metric:"share"}` on I17 | 拒绝 `params_type` |
| 25 | `{includeSystemCategories:true}` on B16 | 通过 |
| 26 | `{comparisonPolicy:"equal-length-window"}` on B03 | 通过，结果回写 policyId |
| 27 | `{comparisonPolicy:"random"}` on B03 | 拒绝 `params_type` |
| 28 | 未知 analysisId | 只读占位 `params_unknown_analysis`，保留配置 |
| 29 | 较新 analysisVersion | 只读占位 `params_newer_version`，保留配置 |
| 30 | 分享导入（门关闭） | 拒绝 `share_import_closed` |

## 9. 放行条件（给 Lead/D 的检查单）

- [ ] D 在布局侧实现校验纯函数 + 错误码 + 只读占位（不迁移/不删除/不回写）。
- [ ] 上表 30 条测试全部通过（D 侧测试记录 + 提交号）。
- [ ] B/C 受影响接口核对通过（params 不含其私有数据）。
- [ ] Lead 复核后置 `shareImportAllowed=true`。
- [ ] 放行后分享导入仍须走同一校验；任何失败不得写回布局。

## 10. 变更记录

- 2026-10-27 v1：随所有者裁定（`f215fa9`）产出，供 D 实施；shareImportAllowed=false。
