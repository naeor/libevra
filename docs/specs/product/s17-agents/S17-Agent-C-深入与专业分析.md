# S17 · Agent C 任务文档：深入与专业分析

> 本文件是 **DS-S17-C-Advanced** 的唯一权威任务文档。所有长期有效的职责、接口、进度、问题与交接必须写入本文件，不得只存在于聊天上下文。
> 建立：2026-10-27（Lead 初始化）；维护者：Agent C 自己。
> 当前状态：**规格已收到（2026-10-27）；C-0 数据契约与公共协议已交付（2026-10-27）；C-1 排行/分布/变化贡献基础已交付（2026-10-27，提交 `0da1997`）；C-2 第一批（P01–P04、P08–P11）已交付本地候选（2026-10-27，提交 `dca9c9e`）；C-2 后半（P12–P15、P21）已交付本地候选（2026-10-27，提交 `48de9b7`）；C-3 分类层级（P05–P07：层级聚合 + 旭日/Treemap/桑基/层级表）已交付本地候选（2026-10-27）；C-4 汇率诊断（P16–P20，draft 数学 + 图表输入）已交付本地候选（2026-10-27）；QC-29/QC-30 已由 Lead 裁定（2026-10-27，见 C-4 文档 §7）；C-5 集成准备文档已建立（纯准备，待所有者批准 W3 后实施）；S-01 v2 冻结前交叉核验清单与 QC-12 脱敏抽样指标清单已交付（2026-10-27）；QC-12 脱敏抽样核对（本机夹具库 23 项核对全过）已交付（2026-10-27）；S-01 v2 r4 形状映射与差异回执已交付（2026-10-27）**。
> **最后核对**：`67a87c8`（S-01 v2 r4 形状映射与差异回执）/ 2026-10-27。

---

## 1. Agent 身份

| 项 | 值 |
|---|---|
| 名称 | `DS-S17-C-Advanced` |
| 角色 | S17 深入与专业分析负责人（专业统计、复杂图表、数据表） |
| 工作区 | `C:\Users\ZhuanZ（无密码）\Desktop\工作\记账程序\记账程序v1-s17-c-advanced` |
| Git 分支 | `deepseek/s17-advanced-analysis` |
| 基线 | `486c603`（origin/main = 1.16.22 生产版）；待 1.16.23 发布后统一 rebase（见索引 B-1） |
| 负责模块 | 交易金额排行与分布、分位数与箱线图、分类变化贡献、多维交叉、矩阵热力图、分类结构、Treemap、桑基图、瀑布图、多币种专业统计、专业数据表；**同时负责本领域的计算函数与绘图函数** |
| 不负责 | 基础统计（A）、时间序列/趋势（B）、网格与布局/配置/分享（D）、视觉设计规范（Codex）、代码审查（Claude）、生产发布 |
| 上级协调 | Lead（`lead`）；不得直接指挥/修改其他 Agent |

**长期目标（2026-10-27 登记，待 Lead 在所有者直接轮次代建 `create_goal`）**：完成 S17 Agent C 全部 34 项深入与专业分析、公共协议与测试交付。

### 工作区纪律（硬约束）

- 只在自己分支与工作区写代码/文档；不得 reset/clean/删除/覆盖他人 worktree（含主工作区未提交的 1.16.23 候选与 Claude 文档工作区，见索引 §1.3）。
- 不合并 main、不 push、不部署、不操作生产环境；未经批准不新增迁移/不改业务数据库。
- 只复用已确认的权威财务计算与分析结果协议（S-01）与 A 的统计框架；**不得建立不兼容的另一套框架**。
- 公共接口未评审前不得冻结；接口变化登记本文件 §6 并告知 Lead。
- 候选功能较多，未来可按图表家族在内部再分批，但**不得擅自删除已确定的候选清单**。

---

## 2. 任务范围

### 2.1 负责的能力编号（唯一负责人）

- **I18**：1 项常用分析（单列）。
- **A06–A11**：6 项深入分析（专业组）。
- **A15–A17**：3 项深入分析（专业组）。
- **P01–P24**：24 项专业探索。
- 合计 **34 项**。状态：规格已收到（2026-10-27）；C-0 数据契约与公共协议已交付；**C-1 函数基础（I18 + A06–A11 + A15–A17 + 基础图表）已交付本地候选（2026-10-27）**；**C-2 第一批（P01–P04、P08–P11）与 C-2 后半（P12–P15、P21）已交付本地候选（2026-10-27）**；**C-3 分类层级（P05–P07，依赖模型占位）已交付本地候选（2026-10-27）**；**C-4 汇率诊断（P16–P20，draft）已交付本地候选（2026-10-27）**。见本文件 §2.2 规格登记与 §5 进度。

### 2.2 开发阶段

- **W1 财务统计正确性**：配合 A 校验专业统计的财务语义（资金流 vs 分类构成、支付方式 vs 真实账户、不同原币）——具体范围以所有者细则为准。
- **W2 计算与展示分层**：参与 S-01 评审；提供复杂图表/数据表类结果形状需求，不另立框架。
- **W3/W4**：按所有者清单分批实现专业卡片与图表；P01–P24 视依赖逐步进入。
- **C-0 公共协议与数据能力确认**：已交付（2026-10-27），见 [`S17-Agent-C-C0-数据契约与公共协议-20261027.md`](S17-Agent-C-C0-数据契约与公共协议-20261027.md)。结论：34 项中 T1×3（A08、P08、P15）、T2×27（需 Q1–Q5 只读投影）、T3×1（A15 零金额语义）、T4×3（P05/P06/P07 分类层级）、T5×0；7 类结果协议草案 + 20 图表成本约束 + 测试矩阵已登记；QC-01/QC-02 阻塞 C-1 的来源验收与协议冻结。
- **C-1 排行/分布/变化贡献基础**：已交付本地候选（2026-10-27）。范围经 Lead 2026-10-27 口径确认：**I18 + A06–A11 + A15–A17 的函数基础 + 基础图表（精确排行表/发散条/直方图/箱线/集中度/瀑布）**；先做不依赖未定接口的部分（纯数学函数 + 模拟数据、几何核心、适配器），draft 结构显式标注「待 S-01 v2 映射」。**数学权威在 shared、几何在 web；几何层不得重算金额/占比/分位。** 第二批「内容/故事与模板层」不在 C-1（Lead 已更正）。
- **C-2 矩阵与分布扩展（第一批）**：已交付本地候选（2026-10-27）。范围经 Lead 2026-10-27 批准：**P01–P04（分类×月份 / 分类×星期 / 分类×支付方式矩阵、时间×支付方式堆叠）+ P08–P11（帕累托集中度曲线、排名迁移、散点、气泡）**；shared 新增 `migration/scatter/bubble` 三个数学模块并扩展 `draftTypes` 的 `Draft*` 命名空间；web 新增 5 类图表输入 + 适配器 + 热力/堆叠/散点/气泡/迁移几何。仍未接页面、未接 A 的 T2 端点、未冻结公共类型。**Lead 优先级：先 P01–P04 + P08–P11，再做 P12–P15、P21；A17 相关（QC-17）排 C-2 之后。**
- **C-2 矩阵与分布扩展（后半）**：已交付本地候选（2026-10-27）。范围经 Lead 2026-10-27 批准：**P12 分类金额箱线图、P13 多指标交叉表、P14 分类周期小多图、P15 全年日历、P21 自定义多维**。shared 新增 `dimensions/boxplot/pivot/smallMultiples/calendar/crossCube` 六个模块并扩展 draft 命名空间（QC-21…QC-25）；web 新增 5 类图表输入 + `adapters3` + 箱线/小多图/日历几何。仍不接页面、不碰 A 的 T2 端点、不新增 API/schema/迁移、未冻结公共类型；真实数据夹具待 Lead 统一提供。
- **C-3 分类层级（P05–P07）**：已交付本地候选（2026-10-27）。范围经 Lead 2026-10-27 批准：**P05 分类层级（真实父子/无循环/父级不重复计子）、P06 嵌套 Treemap（面积=金额占比，极小分类不无限放大）、P07 桑基（只表示真实层级金额归属，禁止收入→支付方式→消费冒充资金流）**。shared 新增 `hierarchy/sankey` 两个模块并扩展 draft 命名空间（QC-26…QC-28）；web 新增 4 类图表输入（层级表/旭日/Treemap/桑基）+ `adapters4` + 旭日/Treemap/桑基几何。**模型依赖处理（QC-03 未批准）**：不猜父子、不使用名称相似度推断；`parentId` 由 `DraftCategoryRelation` 显式输入占位；无真实层级时 `isRealHierarchy=false`，旭日/桑基**拒绝启用**（给原因），Treemap 退化为单层扁平（面积仍=金额占比），层级表显示扁平清单 + 未纳入说明。仍不接页面、不碰 A 的 T2 端点、不新增 API/schema/迁移、未冻结公共类型；真实数据夹具待 Lead 统一提供。
- **C-4 汇率诊断（P16–P20，draft 层）**：已交付本地候选（2026-10-27）。Lead 批准范围：**P16 币种交易构成、P17 综合金额币种贡献、P18 汇率历史趋势、P19 汇率完整性、P20 回退使用**；只做 draft 数学 + 图表输入/适配层，用合成夹具，**不接真实 FX API、不接页面、不修改 A 的 S-01 文件**。shared 新增 `currencyComposition`（笔数构成，不折算）与 `fxDiagnostics`（折算共享、贡献、离散观测趋势、完整性矩阵、回退元数据）并扩展 draft 命名空间（QC-29/QC-30）；web 新增 5 类图表输入 + `adapters5`（强制携带计算依据 `basisNote` 与五类不可用原因）。QC-12 依赖登记为「等 S-01 v2 冻结后接真实数据」。仍不 push/merge、不碰 1.16.23。
- **S-01 v2 冻结前交叉核验（C 负责域）**：已交付（2026-10-27）。按所有者要求，对 A 的 v2 定稿候选（588 行）逐条核验 C 域接口/类型/常量，登记 XC-01…XC-50（一致/冲突/重复/不兼容/预期差异），其中「冻结前需解决」12 项（直方图算法、P13 归属、P16/P20 字段、C 结果 base 包装形态、B/C 时间与日历归属、枚举/常量补登等）；**只登记事实与差异、不替所有者下结论**，见 [`S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md`](S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md)。
- **QC-12 脱敏抽样指标清单**：已交付（2026-10-27）。30 项指标（基础统计/时间边界/分布与离散度/归因矩阵迁移/多币种 FX/权限边界）及期望值来源（既有权威实现、Lead 独立对账、夹具、手算）、脱敏样本包 S1–S10、结果记录方式；**C 不直接读库、不读任何凭据**，等待 Lead 提供脱敏样本后逐项登记「一致/差异/未验证」，见 [`S17-Agent-C-QC12-脱敏抽样指标清单-20261027.md`](S17-Agent-C-QC12-脱敏抽样指标清单-20261027.md)。
- 后续阶段配合详情页、布局接入与集成。

### 2.3 预期计算函数（登记，待详细需求细化）

- 交易金额排行/分位数/分布统计（含异常值与样本不足时的显式降级）。
- 分类变化贡献（结构变化拆解；需明确基准与权重口径）。
- 多维交叉（分类 × 时间/支付方式/币种等；稀疏矩阵的空值语义）。
- 分类结构分析（真实资金流与分类构成必须区分，不得混为同一口径）。
- 多币种专业统计（分币种；折算只走 S16-D；不得把不同原币直接相加）。
- 专业数据表（可排序/分页语义的数据记录；来源可追溯）。
- 具体定义、来源追溯、异常情况均以所有者第二轮明细为准；本文件不臆造定义。

### 2.4 预期绘图函数（登记，待详细需求细化）

- 箱线图、散点图、气泡图、矩阵热力图、Treemap、桑基图、瀑布图、排名变化图、帕累托图、直方图等（按所有者清单与变体归类）。
- 复用共享绘图核心与 Codex 视觉规范（S-02）；不得自创视觉体系；不复制仅指标不同的组件。
- 图表不得为了视觉效果伪造数据；缺失数据必须可见（不画成 0）。

### 2.5 依赖接口

- **S-01 分析结果协议**：A 主要拟定、统一评审；本 Agent 参与评审与需求输入。
- S-02 图表视觉/绘图核心：Codex + Lead 统一裁定。
- S-03 卡片注册协议：与 Lead、D、Codex 对齐。
- S-04 查询与权限：只增量复用现有 `ledger/access.ts` 与 API；新查询必须权限测试。
- S-06 历史汇率合同（S16-D）：只读复用；P16–P20 的 FX 只读投影（快照/解析/回退元数据）按 QC-12 等 S-01 v2 冻结后接真实数据，draft 阶段只用合成夹具。
- **数据模型依赖**：若能力需要当前模型不支持的字段（如真实账户余额、预算、转账双边），必须**明确标记为“依赖数据模型扩展”**，不得自行大规模修改业务数据库；由所有者决定是否新增模型。

### 2.6 测试范围

- 分布/分位数/贡献拆解的数值正确性（含小样本、空样本、异常值）。
- 多维交叉的稀疏性、空值与总和对齐；分类构成与资金流口径隔离。
- 多币种：分币种计算、不得混加；折算只走 S16-D。
- 专业数据表：排序/分页/来源追溯/权限过滤一致性。
- 依赖缺失时的降级（显式“数据不支持”，不伪造）。
- 权限：成员/只读/非成员/跨账本隔离。
- 绘图：数据映射与空态；视觉验收交给 Codex/Lead E2E。

---

## 3. 输入与输出协议（待统一确认）

> **本轮未冻结任何公共接口。** 以下为登记，最终以 S-01 统一评审为准。

- 输入（预期）：账本 ID、权限上下文、时间范围、维度组合、币种/过滤、数据版本；不得直接读 UI 状态。
- 输出（预期）：结构化结果（数值/分组/稀疏矩阵/记录集 + 币种 + 单位 + 样本量 + 缺失标记 + 来源追溯 + 数据版本），不含 DOM/尺寸/布局。
- 必须携带“样本量/覆盖率”等可信度信息，便于卡片降级显示。
- 金额精度沿用 shared money；不得为了绘图另定精度。

---

## 4. 财务与安全限制（所有 Agent 共同遵守）

- 不改原始账务数据；不更改已有财务计算语义。
- 不直接混加不同货币；折算只走 S16-D 合同。
- 不绕过账本权限；新查询必须做权限测试。
- 不把缺失数据视为零。
- 不因为显示尺寸影响金额。
- 不修改其他用户的个人配置；不读取无权限账本。
- 不得伪造数据、偷换分析定义、把同一指标的多展示误算成不同能力。
- 真实资金流与分类构成必须区分；支付方式不得当作真实资金账户。

---

## 5. 持续进度记录

| 能力组 | 状态 | 备注 |
|---|---|---|
| C-0 数据契约与公共协议 | **已完成（草案交付）** | 2026-10-27；见 C-0 文档与 §6.2 提交 |
| C-1 排行/分布/变化贡献基础 | **已交付本地候选** | 2026-10-27；shared 数学层 + web 几何/适配器；shared 20 文件 410 测试、web 154 文件 1408 测试（含新增 23 条）；见 §6.2 |
| C-2 矩阵/迁移/散点/气泡（第一批） | **已交付本地候选** | 2026-10-27；shared 新增 3 模块后 23 文件 421 测试、web 156 文件 1429 测试（含新增 11 + 21 条）；见 §6.2 |
| C-2 箱线/交叉表/小多图/日历/多维（后半） | **已交付本地候选** | 2026-10-27；shared 6 模块后 24 文件 438 测试（新增 12）、web 158 文件 1454 测试（新增 25）；见 §6.2 |
| C-3 分类层级（P05–P07） | **已交付本地候选** | 2026-10-27；shared 新增 `hierarchy/sankey` 后 25 文件 453 测试（新增 15）、web 160 文件 1485 测试（新增 31）；层级模型未批准，`isRealHierarchy=false` 时旭日/桑基拒绝、Treemap 扁平；QC-26…QC-28；见 §6.2 |
| C-4 汇率诊断（P16–P20） | **已交付本地候选（draft）** | 2026-10-27；shared 新增 `currencyComposition/fxDiagnostics` 后 26 文件 473 测试（新增 20）、web 162 文件 1502 测试（新增 12）；P16 笔数构成不折算、P17 折算贡献（份额分母只含已折算）、P18 只画离散观测、P19 记录覆盖率（非金额覆盖）、P20 回退元数据；QC-29/QC-30；见 §6.2 |
| C-5 集成准备 | **准备文档完成（未实施）** | 2026-10-27；[`S17-Agent-C-C5-集成准备-20261027.md`](S17-Agent-C-C5-集成准备-20261027.md)：S-01 v2 对接清单、组件输入/几何边界、集成期测试计划、不可证明项清单、里程碑；实施门槛=所有者批准 W3 + S-01 v2 冻结 + Codex 视觉规范 + D 布局/卡片注册接口 + 真实夹具（QC-12）；本轮不接页面/真实 FX、不动视觉；见 §6.2 |
| I18 | **函数基础完成（C-1）** | 精确排行表数据/适配器已实现并测试；来源追溯仍待 Q1 记录级只读投影（QC-02） |
| A06–A11 / A15–A17 | **函数基础完成（C-1）** | 贡献/分布/分位/箱线/集中度/瀑布数学与适配器已实现并测试；A10/A11 分位与离散度表示待 QC-10/QC-11 统一；A17 展示口径待 QC-17 |
| P01–P24 | **P01–P04、P08–P15、P21 函数基础完成（C-2）**；**P05–P07 依赖模型占位完成（C-3）**；**P16–P20 draft 函数基础完成（C-4）** | P05/P06/P07 依赖分类层级模型（QC-03/QC-27）；P16–P20 依赖真实 FX 只读投影（QC-12 登记：等 S-01 v2 冻结后接真实数据）；P12–P15/P21 的 draft 形状待 S-01 v2 映射（QC-21…QC-25），层级 draft 形状待 QC-26/QC-28 |
| S-01 参与评审 | **已提交 C 侧需求（QC-01）**；S-01 v2 评审意见已回 Lead（2026-10-27） | 7 类结果协议草案见 C-0 文档 §3.2；C-3 新增 QC-26…QC-28 待 A/Lead 收口；B-17 日历归属已确认接受（C 只做投影）；G-16 层级正式定义 + C-4 FX 形状/常量收口材料已建立（2026-10-27，见 §6.2）；**S-01 v2 冻结前交叉核验清单已交付（XC-01…XC-50，2026-10-27，见 §6.2）** |
| S-01 v2 冻结前交叉核验（C 负责域） | **已交付（2026-10-27）** | 50 条登记（一致/冲突/重复/不兼容/预期差异），其中「冻结前需解决」12 项；只登记事实与差异、不替所有者下结论，待所有者逐项确认（C-Q31）；见[交叉核验文档](S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md)与 §6.2 |
| QC-12 真实数据抽样 | **已核对（2026-10-27，本机脱敏夹具库）** | 19 项一致（M-01/M-02/M-12…M-28 等）；FX 形状族（M-22…M-26）因夹具无汇率观测登记「未验证（缺数据）」；M-05/M-07/M-09/M-10/M-29/M-30 登记「未验证（缺样本）」；0 实现差异（4 条差异均为核对脚本自身错误已修正）；见[核对表](S17-Agent-C-QC12-核对表-20261027.md)与 §6.2（C-Q33） |
| S-01 v2 r4 形状映射与差异回执 | **已交付（2026-10-27）** | 按 A r4（`4939efd`，只读）逐形状映射：14 个结果形状 → `AnalysisResultBase & {shape} & <C 字段清单>`；P01–P20 落点；12 项冻结前 XC 回执（r4 已解决 6 项、待所有者/Lead 9 项）；补登建议 2 项（P08 帕累托/浓度投影、`analysisLimit?` 的 C 键名）；见[回执文档](S17-Agent-C-S01-v2-r4-形状映射与差异回执-20261027.md)与 §6.2（C-Q34） |
| W1 专业口径核对 | 等待基线 | 前置：1.16.23 发布（索引 B-1）不变 |
| 复杂图表实现 | **C-1 基础图表 + C-2 矩阵/堆叠/散点/气泡/迁移/箱线/小多图/日历/交叉表 + C-3 层级表/旭日/Treemap/桑基已实现** | 排行表/发散条/直方图/箱线/集中度/瀑布（C-1）；热力矩阵/堆叠柱/散点/气泡/排名迁移（C-2 第一批）；分类箱线/交叉表/小多图/年度日历/多维长表（C-2 后半）；层级表/旭日/Treemap/层级桑基（C-3，均为几何核心 + 输入层，未接视觉组件）；币种构成/折算贡献/汇率观测/完整性矩阵/回退分布（C-4，draft 输入层，FX 图族待 CF 编号）；视觉组件与其余家族依赖 S-02 与 CF 编号（QC-15） |

---

## 6. 开发交接记录

### 6.1 汇报格式（向 Lead）

`状态 / 已完成 / 修改文件 / 相关提交 / 测试命令与结果 / 接口变化 / 已知问题 / 下一步`；同时在 §6.2 记录。

### 6.2 记录

| 日期 | 内容 | 修改文件 | 提交 | 测试 | 接口变化 | 已知问题 | 下一步 |
|---|---|---|---|---|---|---|---|
| 2026-10-27 | 工作区/分支/任务文档初始化（Lead 创建）；未开发 | 本文件 | 随初始化提交 | 未运行 | 无 | 见 §7 | 等待所有者第二轮需求；先评审 A 的 S-01 草案 |
| 2026-10-27 | 初始化确认：已阅读规格与边界，未开始开发 | 本文件 | 随初始化确认提交 | 未运行（本轮仅只读核实） | 无 | 见 §7 | 等待所有者第二轮详细需求 |
| 2026-10-27 | **C-1 交付（函数基础 + 基础图表）**：Lead 口径确认范围为 I18 + A06–A11 + A15–A17 的函数基础 + 基础图表（精确排行表/发散条/直方图/箱线/集中度/瀑布）；shared 数学权威层（`advanced/draftTypes.ts` draft 命名空间，未冻结）+ web 几何/适配器；新增单测 33（shared）+ 23（web） | 本文件；`packages/shared/src/analysis/advanced/{draftTypes,rational,quantiles,distribution,contribution,matrix,ranking,index}.ts` + `{math,structures}.test.ts`；`apps/web/src/analysis/{types,format,sharedTypes,geometry,adapters}.ts` + `{geometry,adapters}.test.ts` | `0da1997` | `pnpm --filter @libellum/shared typecheck` EXIT 0；`pnpm --filter @libellum/shared test` 20 文件/410 测试全过；`pnpm --filter @libellum/web typecheck` EXIT 0；`pnpm --filter @libellum/web test` 154 文件/1408 测试全过（含新增 23）；`node tools/check-links.mjs`、`node tools/doc-audit.mjs` 提交前跑 | 新增 draft 类型命名空间（`Draft*` 前缀，文件头声明「不是公共协议、不得被其他 Agent 引用、待映射到 S-01 v2 = QC-16」）；未接入 A 的 T2 端点，未冻结公共类型；未新增迁移 | Type 7 分位与总体标准差表示待 QC-10/QC-11；A17 增长展示口径待 QC-17；真实 DB 只读抽样未做（凭据禁令，见 C-0 文档 §7 QC-14） | 回填提交号；等 Lead 验收 C-1 → 进入 C-2（P01–P04、P08–P15、P21） |
| 2026-10-27 | **C-2 交付（矩阵/迁移/散点/气泡 + 图表输入）**：Lead 批准范围为 P01–P04 + P08–P11（先做），再做 P12–P15、P21；shared 新增 `migration/scatter/bubble` 数学模块并扩展 draft 命名空间，web 新增 5 类图表输入 + 适配器 + 几何；新增单测 11（shared）+ 21（web） | 本文件；`packages/shared/src/analysis/advanced/{draftTypes,index}.ts`、新增 `{migration,scatter,bubble}.ts` + `{migration,scatter,bubble}.test.ts`；`apps/web/src/analysis/{types,sharedTypes,adapters,geometry}.ts`、新增 `{adapters2,geometry2}.test.ts` | `dca9c9e` | `pnpm --filter @libellum/shared typecheck` EXIT 0；`pnpm --filter @libellum/shared test` 23 文件/421 测试全过（新增 11）；`pnpm --filter @libellum/web typecheck` EXIT 0；`pnpm --filter @libellum/web test` 156 文件/1429 测试全过（新增 21）；`node tools/check-links.mjs`、`node tools/doc-audit.mjs` 提交前跑 | 新增 `DraftRankMigrationResult`/`DraftScatterResult`/`DraftBubbleResult` 三个 draft 形状（QC-18/QC-19/QC-20，待 S-01 v2 映射）；web 新增 `Heatmap`/`StackedBars`/`RankMigration`/`Scatter`/`Bubble` 5 类输入；未冻结公共类型 | 首跑发现并修正 1 条测试断言（负金额行内占比应为 +1 非 -1，属测试错误非实现错误）；真实数据夹具待 Lead 提供；A17 增长展示口径待 QC-17 | 回填提交号；等 Lead 验收 C-2 → C-2 后半（P12–P15、P21）→ C-3 |
| 2026-10-27 | **C-2 后半交付（P12–P15、P21）**：owner 规格 §47 C-2 范围；shared 新增 `dimensions/boxplot/pivot/smallMultiples/calendar/crossCube` 并扩展 draft 命名空间（QC-21…QC-25）；web 新增 5 类图表输入 + `adapters3` + 箱线/小多图/日历几何；新增单测 12（shared）+ 25（web） | 本文件；`packages/shared/src/analysis/advanced/{draftTypes,index}.ts`、新增 `{dimensions,boxplot,pivot,smallMultiples,calendar,crossCube}.ts` + `batch2.test.ts`；`apps/web/src/analysis/{types,sharedTypes,adapters3,geometry}.ts`、新增 `{adapters3,geometry3}.test.ts` | `48de9b7` | `pnpm --filter @libellum/shared typecheck` EXIT 0；`pnpm --filter @libellum/shared test` 24 文件/438 测试全过（新增 12）；`pnpm --filter @libellum/web typecheck` EXIT 0；`pnpm --filter @libellum/web test` 158 文件/1454 测试全过（新增 25）；`node tools/check-links.mjs`、`node tools/doc-audit.mjs` 提交前跑 | 新增 `DraftBoxplotResult`/`DraftPivotResult`/`DraftSmallMultiplesResult`/`DraftCalendarResult`/`DraftCrossCubeResult` 5 个 draft 形状（QC-21…QC-25，待 S-01 v2 映射）；web 新增 `BoxplotByCategory`/`PivotTable`/`SmallMultiples`/`CalendarHeatmap`/`CrossCubeTable` 输入；`DraftCrossCubeOutcome` 含显式拒绝分支；未冻结公共类型 | 首跑修正 2 条测试期望（箱线默认 padding 12 下 boxHeight=17.6；平均指标 1500 minor=15.00）；真实数据夹具待 Lead 提供；`BOXPLOT_MIN_RELIABLE_SAMPLE=5` 阈值待 A 确认 | 回填提交号；等 Lead 验收 → C-3（P05–P07 依赖模型）与 C-4（P16–P20）按 S-01 v2 / W3 安排 |
| 2026-10-27 | **C-3 分类层级交付（P05–P07）**：owner 规格 §13 P05/P06/P07 + §46.5/§46.8 守恒要求；shared 新增 `hierarchy`（`DraftCategoryRelation` 显式输入占位、循环/自我父级/重复父级守卫、孤立父引用登记、`isRealHierarchy`/`hasUnknownCategories`/`orphanRelationCategoryIds`、四项守恒）与 `sankey`（层级派生连线、`${id}::direct` 终端、四项守恒、≤4000 连线）；web 新增层级表/旭日/Treemap/桑基输入 + `adapters4`（含拒绝原因门控）+ 旭日/Treemap/桑基几何（几何不重算金额/占比）；新增单测 15（shared）+ 31（web） | 本文件；`packages/shared/src/analysis/advanced/{draftTypes,index}.ts`、新增 `{hierarchy,sankey}.ts` + `batch3.test.ts`；`apps/web/src/analysis/{types,sharedTypes}.ts`、新增 `{adapters4,geometry4}.ts` + `{adapters4,geometry4}.test.ts` | `11b31bb` | `pnpm --filter @libellum/shared typecheck` EXIT 0；`pnpm --filter @libellum/shared test` 25 文件/453 测试全过（新增 15）；`pnpm --filter @libellum/web typecheck` EXIT 0；`pnpm --filter @libellum/web test` 160 文件/1485 测试全过（新增 31）；`node tools/check-links.mjs`、`node tools/doc-audit.mjs` 提交前跑 | 新增 `DraftHierarchyResult`/`DraftSankeyResult` 2 个 draft 形状（QC-26/QC-28）；新增 `DraftCategoryRelation` 输入占位（QC-27，父级关系需模型扩展，未批准）；web 新增 `HierarchyTable`/`Sunburst`/`Treemap`/`Sankey` 4 类输入 + 拒绝分支；未冻结公共类型 | 首跑修正 2 条测试期望（最深层级含「· 直接」终端为 2；桑基列比例尺改为 `usable/max(列合计,1)`，不逐列拉满以保守恒）；无真实层级数据，`isRealHierarchy=false` 路径已测；真实数据夹具待 Lead 提供 | 回填提交号；等 Lead 验收 → C-4（P16–P20，依赖 FX 只读投影与 S-01 v2 收口） |
| 2026-10-27 | **rebase 到 1.16.23 基线**：Lead 通知生产已发布 1.16.23（`release/1.16.23` @ `d4e4fd8`，发布提交 `207a5ad`，无迁移、60 迁移），B-1 前置满足；本地 rebase（不 push/merge）。旧备份分支名 `pre-1.16.23-20261027` 已被 Agent A 占用，改用独立备份 `backup/agent-c-pre-1.16.23-20261027` @ `c2ba5d7`（rebase 前 HEAD）。13 个本地提交全部重放，**零冲突**（1.16.23 仅改 FxDisplay/FxStats/StatsPage/DetailPage/statsView/i18n fx/docker-compose/STATUS/changelog/version，与本 Agent 的 analysis 目录不重叠）。提交映射：`11b31bb→c633d80`（C-3 feat）、`c2ba5d7→d8970e1`（C-3 回填）；rebase 后 HEAD `d8970e1`，且 `git merge-base --is-ancestor d4e4fd8 HEAD` 成立，工作区 clean | 本文件 | `d8970e1`（rebase 后 HEAD；映射见左） | shared typecheck 0；shared test 25 文件/453 测试；web typecheck 0；web test **161 文件/1490 测试**（较 rebase 前 +1 文件/+5 测试，来自 1.16.23 新增的 `apps/web/src/lib/statsView.test.ts`，非 C 改动）；`check-links` 195 文件/979 链接 EXIT 0；`doc-audit` EXIT 0；`check:status` EXIT 0（代码版本 1.16.23、60 迁移、STATUS 一致）；`check:build` EXIT 0 | 无（rebase 未改接口） | 无冲突；备份分支仅在本地，未 push；全局评审（A/B/D 的评审意见文件）尚未出现在磁盘，待 Lead 通知 | 等待 A 的全局评审文件；收到后按 A 的格式提交 C 的《全局评审意见》并填汇总；C-4 待 Lead 批准 |
| 2026-10-27 | **S-01 v2 收口材料（G-16 + C-4 FX 形状 + 常量定义）**：按 Lead 要求建立两份可引用的正式定义——①`S17-Agent-C-S01-v2评审-C-2-分类层级模型正式定义.md`：G-16 `DraftCategoryRelation` 字段文本、输入约束（重复/自引用/循环→拒绝，孤立父引用登记，未声明分类显式标记）、守恒四项、与 `HierarchyResult`/派生桑基关系、常量与门控、QC-26…QC-28；②`S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md`：`fx-diagnostic` 五形状（P16–P20）+ S-01 v2 §6.7 字段映射 + 4 项 FX 引擎常量 + 6 项 C 侧展示常量（金额分档 1e4/1e6/1e8/1e9、序列上限 30、Pareto 0.3 参考线、覆盖率 95% 文案阈值、桑基 4000、层级表 500 行）及归属/越界行为；QC-29/QC-30 | 本文件；新增两份文档 | `465d21e` | 未运行（纯文档；所引用的 C-3/C-4 测试证据见上两行） | 无代码接口变化；常量 §5.2 为 C 侧契约草案（W3/Codex 落成代码常量） | 常量语义待 A 在 v2 §12 引用确认；QC-29/QC-30 待 A/Lead 裁定 | 回填提交号；把文件路径 + 提交号发 Lead → 由 Lead 转 A 合并 v2 |
| 2026-10-27 | **C-4 交付（P16–P20 汇率诊断，draft）**：Lead 批准（2026-10-27）先交 S-01 v2 评审意见再做 C-4；shared 新增 `currencyComposition`（P16 笔数构成，不折算、不跨币种相加）与 `fxDiagnostics`（P17 折算共享/贡献、P18 离散汇率观测、P19 完整性矩阵与记录覆盖率、P20 回退元数据），draft 命名空间新增 QC-29/QC-30；web 新增 5 类图表输入 + `adapters5`（`basisNote` 计算依据 + 五类不可用原因），未接真实 FX API/页面；新增单测 20（shared）+ 12（web） | 本文件；`packages/shared/src/analysis/advanced/{draftTypes,index}.ts`、新增 `{currencyComposition,fxDiagnostics}.ts` + `batch4.test.ts`；`apps/web/src/analysis/{types,sharedTypes}.ts`、新增 `adapters5.ts` + `adapters5.test.ts` | `2f7a036` | `pnpm --filter @libellum/shared typecheck` EXIT 0；`pnpm --filter @libellum/shared test` 26 文件/473 测试全过（新增 20）；`pnpm --filter @libellum/web typecheck` EXIT 0；`pnpm --filter @libellum/web test` 162 文件/1502 测试全过（新增 12）；`node tools/check-links.mjs`、`node tools/doc-audit.mjs` 提交前跑 | 新增 5 个 `Draft*` 结果形状（P16–P20，QC-29）；web 新增 `CurrencyComposition`/`FxContribution`/`FxRateTrend`/`FxCoverageMatrix`/`FxFallback` 输入；未接真实 FX API、未冻结公共类型 | 真实 FX 数据/夹具待 S-01 v2 冻结后接；P19 金额覆盖率首版显式不可用（不猜测）；P16「笔数份额」与 P17「金额份额」口径不同，须并列显示依据（QC-30） | 回填提交号；等 Lead 验收 → S-01 v2 收口 → C-5 集成 |
| 2026-10-27 | **QC-29/QC-30 裁定补记 + C-5 集成准备**：按 Lead 2026-10-27 裁定，C-4 文档补记 QC-29（v2 采用判别联合，`diagnosticKind` 5 值，§6.7 更新并引用本文为权威定义）、QC-30（P16 笔数份额与 P17 金额份额不得同屏合成单一占比；默认分开、各自标注分母；仅同币种同过滤条件可并排且带口径标签；W3 文案模板由 C 给出，v2 只登记规则）、常量 `FX_DRAFT_*`/`C_*` 采纳（v2 §12 引用、归属 C）；G-16 文档补记验收/合并状态（转 A 合并 v2，QC-27 模型扩展仍待批准）；新建 C-5 集成准备文档（纯准备，不实施） | 本文件；`S17-Agent-C-S01-v2评审-C-4-FX诊断形状与常量定义.md`、`S17-Agent-C-S01-v2评审-C-2-分类层级模型正式定义.md`、新增 `S17-Agent-C-C5-集成准备-20261027.md` | `e3f57f1` | 未运行（纯文档；引用 C-1…C-4 测试证据：shared 26 文件/473、web 162 文件/1502） | 无代码接口变化；QC-29/QC-30 状态由「待裁定」改为「已裁定」 | 真实数据夹具/FX 只读投影（QC-12）、Codex 视觉规范、D 布局接口、所有者 W3 批准仍未就绪（C-5 不阻塞准备，但实施需门槛） | 回填提交号并发 Lead；W3 视觉实现等 Codex 规范 |
| 2026-10-27 | **S-01 v2 冻结前交叉核验 + QC-12 脱敏抽样指标清单**：按所有者要求（不能以 Agent 互评代替所有者确认）只读 A 的 v2 定稿候选（588 行 @ `826c950`）与 C 实现，逐条登记 XC-01…XC-50（一致/冲突/重复/不兼容/预期差异），其中「冻结前需解决」12 项（直方图算法、P13 归属、P16/P20 字段、C 结果 base 包装形态、B/C 时间与日历归属、枚举/常量补登等）；另提交 QC-12 指标清单（30 项指标 + 期望值来源 + 脱敏样本包 S1–S10 + 结果记录方式）；未改 A 文件、未接页面、未写入真实数据 | 本文件；新增 `S17-Agent-C-S01-v2冻结前交叉核验清单-20261027.md`、`S17-Agent-C-QC12-脱敏抽样指标清单-20261027.md` | `613e863` | 未运行（纯文档；引用 C-1…C-4 证据：shared 26 文件/473、web 162 文件/1502）；提交前跑 check-links/doc-audit | 无代码接口变化；交叉核验为事实登记与差异标注，不是冻结结论、不替所有者决定 | 12 项冻结前需确认（XC-07/19/22/24/31/32/50 等）；QC-12 样本未到，相关指标暂「未验证（缺样本）」 | 回填提交号并发 Lead（文件+提交号+QC-12 清单摘要）；等所有者逐项确认与 QC-12 脱敏样本 |
| 2026-10-27 | **S-01 v2 r4 形状映射与差异回执**：按 Lead m01808 与 A r4（`4939efd`，只读）逐形状映射——14 个结果形状 → `AnalysisResultBase & {shape} & <C 字段清单>`（字段以 C `draftTypes.ts` 为准、冻结时逐字并入）；P01–P20 落点；12 项冻结前 XC 回执与分类（r4 已解决 6 项：XC-22②/④、XC-24、XC-31、XC-32、XC-38；待所有者/Lead 9 项：G-24…G-30/G-33/G-31/G-32 中与 C 相关项）；补登建议 2 项（P08 帕累托/浓度投影行、`analysisLimit?` C 键名）；只登记、不裁定、不冻结 | 本文件；新增 `S17-Agent-C-S01-v2-r4-形状映射与差异回执-20261027.md` | `67a87c8` | 未运行（纯文档；引用 C-1…C-4 证据：shared 26 文件/473、web 162 文件/1502） | 无代码接口变化；映射是事实清单，不是冻结文本；C 不先改名/不先改算法 | 9 项待所有者/Lead；P08 帕累托投影 v2 未收录；XC-46 维持「集成阶段由 Lead 收敛」 | 回填提交号并发 Lead（文件+提交号+≤10 行摘要）；之后 standby |
| 2026-10-27 | **QC-12 脱敏抽样核对（C 实现 vs 独立 SQL）**：Lead 提供本机夹具库 `libevra_s17_w1_fixture` 与主夹具账本/隔离账本；C 用只读 SELECT 导出独立期望值（Type 7 分位、总体 σ/var_pop、两期贡献、矩阵、排名迁移、箱线、日历、多维交叉、币种构成），直接调用 `@libellum/shared` 纯函数比对；23 项临时核对测试全过——19 项一致、FX 形状族（M-22…M-26）与若干缺样本项登记「未验证」；4 条差异均为核对脚本自身错误（混币/类型/SQL having 过滤/metric 语义），无实现缺陷；未改任何数据、未把明细或凭据写入仓库/聊天、临时脚本与导出已删除 | 本文件；新增 `S17-Agent-C-QC12-核对表-20261027.md` | 本次提交 | 临时核对：`QC12_EXPECTED=... pnpm --filter @libellum/shared test src/analysis/advanced/__qc12.fixture.test.ts` 23 项全过（临时文件已删，不入库）；提交前跑 check-links/doc-audit | 无代码/接口变化（仅临时核对脚本，未提交） | M-22…M-26 缺真实汇率观测（等 S-01 v2 冻结后 G-11/T2 只读投影）；M-05/M-07/M-09/M-10/M-29/M-30 缺样本（手算或既有单测兜底）；夹具为脱敏派生数据 | 回填提交号并发 Lead（文件+提交号+差异摘要：0 实现差异）；等 A 的 r4 做最终形状映射回执 |

---

| 编号 | 问题 | 影响 | 需要谁决定 |
|---|---|---|---|
| C-Q1 | 所有者编号 I/A/P 与现行能力目录 `AN-xxx` 的映射未定 | 明细对齐 | 所有者/Lead（索引 B-3） |
| C-Q2 | W1 基线要求 1.16.23 发布，目前为未提交候选 | 不能按规格启动 | 所有者（索引 B-1） |
| C-Q3 | P01–P24 中依赖缺失数据模型（真实账户/预算/转账）的项目需逐项标记 | 范围与迁移风险 | 所有者第二轮明细 |
| C-Q4 | “资金流 vs 分类构成”的具体口径定义需所有者确认 | 影响多张专业图 | 所有者 W1/W3 细则 |
| C-Q5 | 复杂图表的共享绘图核心能力边界（哪些图需要新原语） | 计划与实现 | Lead + Codex |
| C-Q6 | 卡片尺寸/视觉规范未定（D/Codex） | 无法开工 | Lead 协调 |
| C-Q7 | **QC-01**：A 的 S-01（s01-draft）只含 4 形状，未纳入 C 的 7 形状；`SourceDescriptor.query.kind` 无记录级/FX 投影 | C-1–C-4 全部结果协议 | Lead 主持评审（A 对齐） |
| C-Q8 | **QC-02**：记录级来源查询缺失（`/stats` 无 record ids；`/transactions` 仅 month、无金额排序、无任意 from/to） | I18/A16/P10/P12/P23 来源追溯；A06 归因下钻 | Lead/后端（批准 Q1 只读投影） |
| C-Q9 | **QC-03**：分类无 `parentId`，P05/P06/P07 无真实层级 | C-3；依赖数据模型扩展 | 所有者/Lead |
| C-Q10 | **QC-04**：退款/撤销未建模（金额非负、kind 二元） | 分布类（A09/A10/A11/P10/P12/P23）+ 跨 Agent B10 | 所有者 |
| C-Q11 | **QC-05**：`MAX_STATS_DAYS=400` 限制跨年/12 月/36 月桶 | P01/P14/P15/P18/P09 + B 时间扩展 | A/B/Lead |
| C-Q12 | **QC-06/QC-07**：`dataVersion` 与离线 `coverageEnd` 无统一合同 | 全部结果复用/完整性 | Lead/B/同步模块 |
| C-Q13 | **QC-10/QC-11**：分位数方法（Type 7）与标准差/CV 表示法需 A/C 统一 | A10/A11/P12/P23 | A + Lead |
| C-Q14 | **QC-12/QC-13**：FX 诊断字段对齐 + 新只读投影权限/where 评审 | P16–P20 | 后端/Claude |
| C-Q15 | **QC-09/QC-14/QC-15**：analysis 导出归属、DTO 归档状态、CF 家族编号对齐 | 合并/S-02/S-03 | A/Lead/Codex |
| C-Q16 | **QC-16（C-1 新增）**：C 的 7 类结果形状（RankedRecords/Distribution/Contribution/Matrix/Hierarchy/Scatter/FXDiagnostic）尚未进入 A 的 S-01；C-1 实现以 `advanced/draftTypes.ts` 的 `Draft*` 前缀承载，显式「非公共协议、不得被其他 Agent 引用」，待 S-01 v2 统一映射 | C-1–C-4 结果协议映射；S-01 v2 评审 | A + Lead（S-01 v2 统一收口） |
| C-Q17 | **QC-17（C-1 新增）**：A17 分类增长排行的「新增/消失分类」增长率展示口径（`growth` 为 null 时显示「新分类/已消失」而非 0 或 ∞）需确认 | A17 卡片、导出与数据表 | Lead/所有者 |
| C-Q18 | **QC-18（C-2 新增）**：排名迁移（P09 Bump）结果形状 `RankMigrationResult`（上期/本期名次 + `amount-desc-id-asc-ties-share-rank` 并列策略 + moved/new/removed 计数）尚未在 S-01 v2 定义；C-2 以 `DraftRankMigrationResult` 承载 | C-2 P09；C-3 P22 同期瀑布可复用 | A + Lead（S-01 v2 统一收口） |
| C-Q19 | **QC-19（C-2 新增）**：散点（P10）结果形状 `ScatterResult`（点数上限策略 `none`/`top-amount`、`omittedCount`、`complete`）尚未在 S-01 v2 定义；采样语义与完整性字段需统一 | C-2 P10；与 QC-06/QC-07 完整性合同相关 | A + Lead（S-01 v2 统一收口） |
| C-Q20 | **QC-20（C-2 新增）**：气泡（P11）结果形状 `BubbleResult`（count/sum/mean/share；无笔数时 `mean`/`share` 为 null）尚未在 S-01 v2 定义 | C-2 P11 | A + Lead（S-01 v2 统一收口） |
| C-Q21 | **QC-21（C-2 后半新增）**：箱线图结果形状 `BoxplotResult`（Type 7 线性分位、1.5×IQR 围栏、`BOXPLOT_MIN_RELIABLE_SAMPLE=5`、`BOXPLOT_DEFAULT_MAX_OUTLIERS=20`）尚未在 S-01 v2 定义；C 以 `DraftBoxplotResult` 承载；阈值 5 待 A 确认 | P12；与 QC-10/QC-11 分位与离散度口径同批收口 | A + Lead（S-01 v2） |
| C-Q22 | **QC-22（C-2 后半新增）**：交叉表结果形状 `PivotResult`（amount/count/average/share 四指标；行/列/总合计由 shared 提供；`conservation` 守恒校验；稀疏空单元格语义=「未发生」非 0；`MAX_PIVOT_CELLS=2500`）尚未在 S-01 v2 定义 | P13；表格组件与导出 | A + Lead（S-01 v2） |
| C-Q23 | **QC-23（C-2 后半新增）**：小多图结果形状 `SmallMultiplesResult`（`scaleMode` shared/independent、`topN` 默认 12 上限 24、`bucketKeys/bucketLabels` 须与 B 时间序列同口径、截断说明）尚未在 S-01 v2 定义 | P14；与 B 时间扩展同批对齐（QC-05 时间桶上限） | A/B + Lead |
| C-Q24 | **QC-24（C-2 后半新增）**：年度日历结果形状 `CalendarResult`（五态 complete/no-data/in-progress/future/unknown、`weekIndex` 周一起始、`leapYear/weekCount`、`intensityMin/Max`）尚未在 S-01 v2 定义；须符合「与 B I12 日历同结果、不另立日历系统」 | P15；与 B I12 结果一致性 | A/B + Lead |
| C-Q25 | **QC-25（C-2 后半新增）**：多维交叉结果形状 `CrossCubeResult`（受控维度/指标允许列表、最多 3 维、最多 5,000 组合、跨币种必须含 currency 维度、长表输出、拒绝原因枚举）尚未在 S-01 v2 定义；只读投影与 where 条件需权限评审（与 QC-13 同类） | P21；C 的自定义多维 | A/后端 + Lead（S-01 v2） |
| C-Q26 | **QC-26（C-3 新增）**：分类层级结果形状 `HierarchyResult`（`isRealHierarchy`/`hasUnknownCategories`/`orphanRelationCategoryIds` + 四项守恒 `rootSubtreeAmountMinor`/`nodesConserved`/`noDoubleCounting`/`edgesConserved`；父级不重复计子）尚未在 S-01 v2 定义；无模型批准时 `isRealHierarchy=false`，P06/P07 不得启用 | C-3 P05；P06/P07 门控 | A + Lead（S-01 v2 收口，与 QC-03 合并裁定） |
| C-Q27 | **QC-27（C-3 新增）**：`DraftCategoryRelation{categoryId,categoryLabel,parentCategoryId:string|null}` 为**未来模型扩展的显式输入占位**：当前 `Category` 无 `parentId`，C 不猜父子、不用名称相似度推断；需所有者批准数据模型扩展后才可产出真实层级 | P05/P06/P07 真实数据接入；迁移审批 | 所有者/Lead（数据模型扩展，禁止本轮改库） |
| C-Q28 | **QC-28（C-3 新增）**：派生桑基形状 `SankeyResult`（`nodes`/`links{fromId,toId,amountMinor,shareOfSource}` + 四项守恒）由 `HierarchyResult` 纯投影派生（`${id}::direct` 直接终端、≤4,000 连线）；是否作为正式结果形状进 S-01 v2，或仅作为图表输入层（不新增结果形状）需裁定；旭日/桑基在 `!isRealHierarchy` 或 `hasUnknownCategories` 时**拒绝启用并给原因**（不给假层级图） | C-3 P07；S-01 v2 形状计数（§3.4「C 结果形状共 14」需重算） | A + Lead（S-01 v2 收口） |

| C-Q29 | **QC-29（C-4 新增）**：FX 诊断结果形状族——`CurrencyCompositionResult`（P16：笔数构成 + 各币种内部原币合计，不折算）、`FxContributionResult`（P17：折算贡献 + 份额分母仅含已折算）、`FxRateTrendResult`（P18：离散观测 + 缺失日期计数，不插值）、`FxCoverageResult`（P19：记录覆盖率 + 币种×日期状态 + 缺失组合；金额覆盖率显式不可用）、`FxFallbackResult`（P20：回退元数据）——尚未进入 S-01 v2 的 `fx-diagnostic` 形状；C 以 `Draft*` 承载，需 A 决定收录/合并/拒绝 | C-4 P16–P20；与 QC-12 同批收口；C-5 集成 | **已裁定（Lead 2026-10-27）**：v2 采用判别联合 `diagnosticKind` 5 值，§6.7 `FxDiagnosticResult` 更新并引用 C-4 文档为权威定义；不采用单形状等价 |
| C-Q30 | **QC-30（C-4 新增）**：P16「按笔数份额（不折算、各币种金额不可比）」与 P17「按折算后金额份额（分母仅已折算）」是**不同口径**；C 已在图表输入强制携带 `basisNote`/`sharesOverConvertedOnly`/`missingText` 区分。工作台并列展示时仍可能被误读为同一指标，展示层文案与是否允许同屏需裁定 | C-4 卡片/详情；S-01 图表输入 | **已裁定（Lead 2026-10-27）**：不得同屏合成单一占比；默认分开、各自标注分母（P16=笔数、P17=仅已折算金额，缺失≠0）；仅同币种+同过滤条件可并排且带口径标签；W3 文案模板由 C 给出，v2 只登记规则 |
| C-Q31 | **S-01 v2 冻结前交叉核验（2026-10-27 新增）**：C 负责域登记 XC-01…XC-50，其中「冻结前需解决」12 项需**所有者逐项确认**（XC-07 直方图分箱算法与 method、XC-19 P13 归属 matrix/pivot、XC-22 P16/P20 字段与 P19 `rows` 字段、XC-24 C 结果 base 包装形态、XC-31/XC-32 B/C 时间轴与日历归属、XC-50 枚举常量补登等）；C 只给事实与建议动作，不下结论 | S-01 v2 冻结内容与形状计数 | 所有者（A 汇总）；C 待通知后修订映射 |
| C-Q32 | **QC-12 真实数据抽样（2026-10-27 新增）**：30 项指标清单与期望值来源已提交 Lead；脱敏样本到达前，真实数据口径状态=「未验证（缺样本）」；样本到达后由 Lead 转交、C 只做口径比对，不改库、不接测试、不写真实金额进仓库 | C-4 真实数据接入与 P16–P20 口径证明；W1 核对 | Lead（样本抽取）→ 所有者（如需扩大范围） |
| C-Q33 | **QC-12 真实数据口径核对（2026-10-27 完成）**：本机夹具库只读核对 19 项一致、0 实现差异；FX 形状族缺真实汇率观测（夹具库无 `fx_snapshots`），P17–P20 的真实数据口径仍「未验证（缺数据）」，等 S-01 v2 冻结后走 G-11/T2 投影或 Lead 提供脱敏折算输出 | C-4 真实数据接入证明；W1 核对 | Lead（投影/样本）→ 所有者（如需扩范围） |
| C-Q34 | **S-01 v2 r4 形状映射回执（2026-10-27 新增）**：A r4 已接受修订 6 项（XC-22②/④、XC-24、XC-31、XC-32、XC-38），C 可照做；仍待所有者/Lead 裁定 9 项：G-24 直方图算法、G-25 分位点集合、G-26 P13 归属、G-27 三/四态映射语义、G-28 P16 三态/P20 `available` 归属、G-29 calendar/small-multiples 归属确认、G-30 枚举常量、G-33 常量 F/C/O/P、G-31 Codex 单一来源（集成期）；补登建议：P08 帕累托/浓度投影未在 v2 收录、`analysisLimit?` 的 C 键名未细化 | S-01 v2 冻结内容；C 冻结后 types.ts 收敛 | 所有者/Lead（A 收口） |

| C-Q33 | **QC-12 真实数据口径核对（2026-10-27 完成）**： [`S17-Agent-C-C0-数据契约与公共协议-20261027.md`](S17-Agent-C-C0-数据契约与公共协议-20261027.md) §7；QC-18…QC-20 为 C-2 新增、QC-21…QC-25 为 C-2 后半新增、QC-26…QC-28 为 C-3 新增、QC-29…QC-30 为 C-4 新增，均仅登记、未实现公共类型（C-3 的 `DraftHierarchyResult`/`DraftSankeyResult`/`DraftCategoryRelation` 同样以 `Draft*` 前缀承载、显式非公共协议）。**QC-29/QC-30 已于 2026-10-27 由 Lead 裁定（见 C-4 文档 §7）；QC-26/QC-28 随 S-01 v2 收口，QC-27 数据模型扩展仍待所有者批准。**

---

## 8. 恢复步骤（上下文丢失时）

1. 读仓库 `AGENTS.md` → `docs/STATUS.md` → 索引 → 本文件。
2. 检查工作区 `git status --short`、`git log --oneline -5`，与 §6.2 核对；不一致立即停手报告 Lead。
3. 只在本分支工作；禁止触碰索引 §1.3 受保护工作区。
4. 向 `lead` 发送恢复报告（身份/状态/已完成/未决/下一步）。

---

## 2.2 所有者完整开发规格（2026-10-27，逐字登记）

| 项 | 值 |
|---|---|
| 文件 | [`S17-Agent-C-完整开发规格-所有者-20261027.md`](S17-Agent-C-完整开发规格-所有者-20261027.md)（28,600 字符，含 34 项定义、财务合同、数学规则、7 类结果协议、20 个图表家族、测试矩阵、C-0–C-5 批次与完成标准） |
| 来源 | 所有者直接消息（2026-10-27）；由 Lead 从 DSH 会话日志逐字提取，未做摘要改写 |
| 状态 | **已收到；C-0 已交付（2026-10-27）；C-1 已交付本地候选（2026-10-27）；C-2 第一批（P01–P04、P08–P11）与 C-2 后半（P12–P15、P21）已交付本地候选（2026-10-27）；C-3 分类层级（P05–P07，依赖模型占位）已交付本地候选（2026-10-27）；C-4 汇率诊断（P16–P20，draft）已交付本地候选（2026-10-27）；C-5 集成准备文档已建立（2026-10-27，纯准备，待所有者批准 W3 后实施）；S-01 v2 冻结前交叉核验清单（XC-01…XC-50）与 QC-12 脱敏抽样指标清单已交付（2026-10-27）；QC-12 脱敏抽样核对表已交付（2026-10-27，19 项一致、0 实现差异，FX 形状族未验证）；S-01 v2 r4 形状映射与差异回执已交付（2026-10-27）**，见 C-0 文档与 §6.2；QC-29/QC-30 已裁定，待 S-01 v2 收口与 W3 批准 |
| C-0 交付文档 | [`S17-Agent-C-C0-数据契约与公共协议-20261027.md`](S17-Agent-C-C0-数据契约与公共协议-20261027.md)（数据契约 18 项 + 34 项状态 + 7 结果协议草案 + 20 图表成本 + 测试矩阵 + AC-C01 + QC-01…QC-17） |
| 边界 | 只读访问授权：所有子 Agent 可只读读取本机绝大部分文件；**私钥/凭据等秘密文件绝对禁止读取**（见索引 §1.4） |