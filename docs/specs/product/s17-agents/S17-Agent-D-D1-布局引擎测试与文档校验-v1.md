# S17 · Agent D · D-1 布局引擎测试与文档校验（v1）

> 最后核对: `486c603` + 本轮 D-1 提交 / 2026-10-27
> 性质：实现记录（布局层第二批次，纯数据/纯函数内核；不含 UI 与页面集成）
> 实现者：`DS-S17-D-Layout`（维护者）；上级：Lead
> 权威依据：[S17-Agent-D-完整开发规格-所有者-20261027.md](./S17-Agent-D-完整开发规格-所有者-20261027.md) §40 D-1；[S17-Agent-D-D0-布局数据模型与接口-v1.md](./S17-Agent-D-D0-布局数据模型与接口-v1.md)；布局规格 §13–§20、§19 测试矩阵。

---

## 1. 目的与范围

D-1 的目标：把 D-0 的纯函数骨架补成**可验收、可回归、可确定性复现**的布局内核，并覆盖所有者规格要求的确定性/不变量/无漂移/配置安全。

本批包含：

- 属性测试 ≥10⁴ 场景（固定种子的测试专用 PRNG；生产代码不引入随机/时间依赖）；
- 布局规格 §19.3/§19.4 中**不依赖 UI 与视口**的夹具 TC-07a/b、TC-08a/b、TC-09、TC-10、TC-11、TC-12a/b、TC-13、TC-14、TC-16、TC-17、TC-20、TC-22、TC-25、TC-26；
- 布局文档/内容文档的**结构校验、序列化往返、非法与损坏数据**；
- 真实 `typecheck` 与 `vitest` 执行（不再用临时副本冒烟替代）。

不包含（后续批次）：布局编辑器（D-2）、容器内部渲染与手势（D-3）、个人配置同步/分享（D-4/D-5）、页面集成、Schema 迁移与业务数据库。

---

## 2. 文件清单（`packages/shared/src/analysis/layout/`）

| 文件 | 职责 | 与 D-0 相比 |
|---|---|---|
| `types.ts` | 版本/网格/对象/几何/契约/投影结果的类型与常量 | 新增 `MAX_GRID_SPLIT_CHILDREN = 4`（自由分割槽位上限候选） |
| `grid.ts` | 行优先编号、占格展开、合法性、碰撞、几何校验、最早空位 | **修复** `findEarliestFreeAnchor` 行尾起点越界抛错（见 §9） |
| `projection.ts` | 跨列投影/迁移（单遍优先级贪心，默认 size-first，可切 position-first） | 未改行为；D-1 由属性测试补强验证 |
| `validation.ts` | 内容/布局文档结构校验、序列化、解析；纯函数、不抛异常、保留未知字段 | **新增** |
| `test-prng.ts` | 测试专用 mulberry32 固定种子 PRNG（nextFloat/nextInt/chance/pick/shuffle） | **新增** |
| `test-support.ts` | 夹具构造器（卡片/GridSplit/Carousel/Spacer/几何/契约/结果断言 helper） | **新增** |
| `grid.test.ts`、`projection.test.ts` | D-0 单元测试（编号/占格/碰撞/示例/降级/策略/幂等） | 保持 |
| `property.test.ts` | 4 组属性测试 ×2,600 = **10,400 场景** | **新增** |
| `fixtures.test.ts` | 布局规格 TC-07…26 中不依赖 UI 的夹具 | **新增** |
| `serialization.test.ts` | 序列化往返、未知字段保留、非法/损坏文档校验 | **新增** |
| `index.ts` | 目录内 barrel（types/grid/projection/validation） | 追加 validation 导出；**仍未接** `packages/shared/src/index.ts` |

全部代码位于新目录内，未修改任何既有业务文件、未新增迁移、未改 `@libellum/shared` 包入口（接入由 Lead/S-03 在集成批次统一评审）。

---

## 3. `validation.ts`：文档校验与序列化

导出：

- `DocumentValidationIssue { path, code, detail }`
- `DocumentValidationResult<T> = { ok: true; value: T } | { ok: false; issues }`
- `validateLayoutDocumentV1(value: unknown)`、`validateContentDocumentV1(value: unknown)`
- `serializeContentDocumentV1(doc)`、`serializeLayoutDocumentV1(doc)`
- `parseContentDocumentV1(json)`、`parseLayoutDocumentV1(json)`

设计口径（与规格 §4 版本与安全降级、§7 导入校验一致）：

1. 只做**结构与范围**检查（类型/枚举/版本/引用/数量/千分比），不拒绝“锚点越界、同锚点冲突、重叠”——这些是投影层的修复职责，不能因脏布局拒绝整份文档（避免白屏）。
2. 校验通过时**原样返回输入对象**，不重建、不删未知字段：为未来版本字段与“旧客户端只读尽力渲染”留出兼容空间（Q-20）。
3. `parse*` **永不抛异常**：JSON 解析失败返回 `invalid-json`；根不是对象返回 `invalid-document`。
4. 问题码分层：布局侧（列数/版本/模式/对象/几何/档案）与内容侧（分析引用/图表/标题/区间/容器/子对象/比例/上限），见源码常量；服务端与导入侧后续复用同一校验函数并追加白名单序列化。
5. 契约（`ObjectSizeContract`）不属于文档内容，校验不要求它存在；数值由卡片家族在 W3 声明（OQ-LM-02）。

> 已知限制（登记，不阻塞）：本批只实现 `schemaVersion === 1`；迁移链（v1→vN）与“较新版本只读降级”的完整行为留到 schema 冻结后的批次。

---

## 4. 测试支持模块

- `test-prng.ts`：mulberry32，`createTestPrng(seed)` 确定性可复现；仅测试使用，生产代码不依赖随机源。
- `test-support.ts`：`analysisCard` / `pinnedCard` / `gridSplit` / `carousel` / `spacer` / `contentOf` / `object` / `geometry` / `contract` / `contractsOf` / `anchorsOf` / `projectedOf` / `reasonsOf` / `sizesOf` 等夹具与断言 helper，统一夹具记号（`ID@锚点(宽×高)`），便于后续把布局规格 §19 的所有用例搬到真实测试文件。

---

## 5. 属性测试（10,400 场景）

| 组 | 种子 | 断言 |
|---|---|---|
| 确定性 | `0x5f17d001` | 同输入多次投影 `toEqual` 相同；打乱对象数组顺序结果不变；`columns === targetColumns` |
| 不变量 | `0x5f17d002` | `validateGeometry` 无问题；对象集合不变；尺寸 ≥1 且宽不越界；不出现 `source-invalid` |
| 幂等与无漂移 | `0x5f17d003` | 同列数二次投影几何不变；投影到其它列数**不改权威布局**（DOM 快照 JSON 不变）；重新投影结果一致 |
| 配置安全 | `0x5f17d004` | 不丢对象、不改内容文档（JSON 快照不变）；容器只在“目标列数不足/宽度不足且无紧凑档”时 collapsed；卡片永不出现 collapsed；Spacer 保持 full |

生成器覆盖：`baseCols` 1–6、目标列数 1–12、1–6 张卡片、0–2 个容器（GridSplit 2–4 子 / Carousel 2–6 子）、0–3 个 Spacer；随机合法落位（`placementFitsColumns`/`placementCells`/`findEarliestFreeAnchor`）；卡片契约随机 `minSize`/`sizeLadder`/`compatSize`，容器契约随机 `minFullCols`(1–3)/`collapsedSize`(1×1)。每个属性用例 `timeout: 120_000`，末尾另有“累计 ≥10⁴”规模断言。

---

## 6. 夹具测试（布局规格 §19 映射）

| 用例 | 场景 | 断言结果（全部通过） |
|---|---|---|
| TC-07a | 4→3 行尾放不下，策略 S | {A:1, W:2}，W 保持 2×1 full（尺寸优先） |
| TC-07b | 同上，策略 P | {A:1, W:3}，W 退 1×1 compat（位置优先） |
| TC-08a | 3→2 宽超列，家族尺寸档 | W@1 compact 2×1，记录 width-overflow |
| TC-08b | 3→2 宽超列，无契约 | W@2 compat 1×1，记录 missing-contract |
| TC-09 | 锚点缺失 | B 排最后、`sourceAnchor = null`、记录 source-invalid |
| TC-10 | 2×2/2×1/3×1/1×1 混合，多列数 | 4 列 {P:1,Q:3,R:9,S:12}；3 列 2×1 与 3×1 保持；2 列 R compact 2×1；各列数 `validateGeometry` 无问题 |
| TC-11 | Spacer 保位 | {A:1, S1:2, B:3}，Spacer 不被紧凑消除 |
| TC-12a | Spacer 夹宽 | 3×1→2×1，位置 1，记录 width-overflow |
| TC-12b | Spacer 同锚点冲突 | {A:1, S1:2}，Spacer 后移不删除 |
| TC-13 | 容器 4→3 保持完整 | G@1 full 2×2，内部配置不变 |
| TC-14 | 容器 4→1 必须收缩 | G@1 collapsed 1×1，记录 container-narrow |
| TC-16 | 宽屏恢复 2→1→2 | 权威布局不变，2 列恢复 {A:1,B:2,C:3} |
| TC-17 | 无漂移 3→4→2→3 | 回到 3 列 {A:1,B:3,C:6,S1:7}，原布局 JSON 不变 |
| TC-20 | 单列全类型可访问 | {C:1,G:2,Q:4,S1:5}，全部 colSpan=1、容器 collapsed、Spacer 锚定 |
| TC-22 | 单遍优先级贪心（否定两遍法） | {A:1,B:3,C:6}，冲突对象只后移、不回头移动已放置对象 |
| TC-25 | 迁移契约无视口高度 | 附加 `viewportHeight` 后结果完全相同（函数签名无高度参数） |
| TC-26 | 同列数投影幂等 | 在 `baseCols` 下投影等于自身 |

另：`projection.test.ts` 已覆盖所有者示例 TC-02（3→4，C@6→4）、TC-03（4→3，C@4→6）、TC-05（3→6 保位）、TC-06（同锚点贪心）与 S/P 策略对照；`grid.test.ts` 覆盖编号公式、占格、越界、碰撞与几何校验错误码。

---

## 7. 序列化与损坏数据测试

- 内容文档/布局文档（含档案与上一个布局）JSON 往返后**逐字节相同**，重复序列化字符串不变。
- 校验通过时**原样保留未知字段**（模拟未来版本字段，确认不静默丢弃）。
- 非法 JSON、`null`、数组根：返回 `invalid-json` / `invalid-document`，**不抛异常**。
- 布局结构错误：非法列数/版本/模式/对象类型/占格/重复 objectId。
- 内容结构错误：非法版本/analysisId、`rangePolicy=pinned` 缺区间、容器子数越界/引用不存在/嵌套超深/比例越界/超容器上限/重复 objectId。
- 随机损坏字符串与半截 JSON：所有输入都返回结果、不抛异常（渲染炸弹第 0 层防护）。

---

## 8. 真实执行（命令与数字）

环境：Node v24.20.0；pnpm 12.10.1（PowerShell 执行策略禁止 `pnpm.ps1`，统一用
`C:\Users\<本机用户>\AppData\Roaming\npm\pnpm.cmd`）。

| 命令 | 结果 |
|---|---|
| `pnpm.cmd install --frozen-lockfile --prefer-offline` | 成功；313 包全部来自本机 store（离线，无网络下载）；20.3s；lockfile 未改；`node_modules` 已被 `.gitignore` 忽略 |
| `pnpm.cmd --filter @libellum/shared typecheck` | **exit 0**（`tsc --noEmit` 无错误） |
| `pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` | **5 test files / 65 tests passed**，约 1.0s，exit 0 |

说明：`pnpm check:build`（全站构建）不在本批授权范围，未运行；文档侧运行 `node tools/check-links.mjs`、`node tools/doc-audit.mjs`、`node tools/check-status.mjs`（结果见提交报告）。

---

## 9. 本批发现并修复的问题

1. **`findEarliestFreeAnchor` 行尾起点越界抛错**（真实缺陷，属性测试发现）：
   - 现象：2 列下为 2×1 对象找空位时，扫描到 `anchor=2`（起点在第 2 列、宽 2 会溢出）直接调用 `placementCells` 抛 `RangeError`，投影崩溃。
   - 修复：循环内先 `if (!placementFitsColumns(anchor, size, columns)) continue;`，只把合法起点当占格参与碰撞判断（`grid.ts`）。
   - 影响：窄列 + 宽对象的投影不再崩溃；D-0 冒烟未覆盖该组合，D-1 属性测试补上。
2. **属性“配置安全”断言初稿过严**：初稿假设“容器 collapsed ⟹ target < minFullCols”；实际合法触发还包括“原始完整宽度 > 目标列数且无可用紧凑档”，已按规格 §17 的收缩触发条件修正断言（并保留原布局尺寸对照），避免把正确行为误判为缺陷。

---

## 10. 待决与占位口径（本批未虚构数值）

| 项 | 当前口径 | 阻塞 |
|---|---|---|
| OQ-LM-01 行尾放不下策略 | 默认 size-first（S）；position-first（P）已实现可切换 | 所有者决定后默认值可能变化；W5 |
| OQ-LM-03 垂直紧凑 | 未实现（投影暂不紧凑） | W5 |
| OQ-LM-04 Spacer 窄屏 | 夹宽 | W5 |
| OQ-LM-05/06 容器入口与收缩意图 | 类型字段 `presentation`/`expandedSize` 占位 | W5 |
| OQ-LM-07/08 写回与档案键 | 未实现；`LayoutProfile.profileKey` 占位 | W5/W6 |
| OQ-LM-11 卡片兼容入口 | compat 1×1（仅数据） | W3 起 |
| 尺寸数值 `minSize`/`sizeLadder`/`compatSize` | 由测试/调用方传入，未内置 | W3 / OQ-LM-02 |
| S-03 公共接口 | 未冻结；本目录未接包入口 | Lead/S-03 |

---

## 11. 下一步

1. D-2 编辑器前置：等 Codex 视觉规范与交互口径；本批先把“可渲染布局对象 + 编辑操作纯函数”清单补进接口文档。
2. 非纯算法用例（TC-15/18/19/21/23/24）留待集成与 UI 批次：容器详情可访问、档案隔离、跨设备同步、导入快照、无障碍、分享校验。
3. schema v2 迁移链占位：待 W2 契约冻结后补 `schemaVersion` 迁移纯函数与损坏修复规则（OQ-LM-12 细节）。
4. 与 S-03 对齐：把 `AnalysisReference`/`ObjectSizeContract` 作为草案提交 S-03 评审（D-Q8 仍待上游）。

---

## 12. 提交记录

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-10-27 | `77f9796` | validation.ts + 测试支持 + 属性测试 + TC 夹具 + 序列化测试 + grid 修复 + 本文件 + 任务文档 |
