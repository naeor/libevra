# S17 · Agent D · D-3.2：容器数据模型/占位语义与跨列迁移固定案例（headless v1）

> 最后核对: d4e4fd8 + `92452cb` / 2026-10-27
> 性质：headless 纯函数与测试记录，**不接 UI、不接包入口、不冻结公共接口**。
> 对应批次：D-3.2（Lead 2026-10-27 批准）；上游输入为所有者 OQ 方向（m10130）与布局规格 §13–§17。

## 1. 目的与范围

本批在 D-3/D-3.1 的几何与迁移基础上补齐两块纯数据能力：

1. **容器数据模型与占位语义**（布局规格 §8、§10–§13、§17）：GridSplit 千分比与槽位语义、容器子树结构校验、容器展示形态派生、1×1 占位与恢复的纯数据操作；
2. **跨列迁移固定案例**：把所有者规格中的固定示例（3→4、4→3）与退化/冲突/尺寸降级语义钉成可回归的测试表。

明确不做：任何 UI/视觉、容器内编辑交互、分割线拖拽、密度档数值、分享/同步服务端、S-01 形状修改。

## 2. 交付物

| 文件 | 说明 |
|---|---|
| `packages/shared/src/analysis/layout/containers.ts` | 容器数据模型与占位语义纯函数（约 380 行） |
| `packages/shared/src/analysis/layout/containers.test.ts` | 19 项：比例/槽位/结构校验/形态派生/折叠恢复/属性测试 |
| `packages/shared/src/analysis/layout/migration-cases.test.ts` | 12 项：所有者固定案例 + 冲突/退化/降级/容器/Spacer/无漂移 |
| `packages/shared/src/analysis/layout/index.ts` | barrel 追加 `containers.js`（仍未接 `@libellum/shared` 入口） |

## 3. 容器数据模型

### 3.1 GridSplit 比例

- 权威字段：`GridSplitConfig{ columnSplitPermille, rowSplitPermille }`，整数千分比 0–1000；0 表示该方向不分割。
- `normalizeGridSplitRatios(split)`：取整、夹到 0–1000；两个方向同时为 0 视为非法，回退等分 `500/500` 并登记 `invalid-split-ratio`；返回 `{ config, changed, issues }`，幂等。
- `describeGridSplitSlots(split)` → `{ columns: 1|2, rows: 1|2, slots: 1|2|4 }`：只描述几何槽位数量，不约束 children 的具体分配方式（“1 大 + 2 小”非对齐槽位不在首版）。

### 3.2 子树结构

- 子对象数量：`grid-split` 2–`MAX_GRID_SPLIT_CHILDREN`(4)；`carousel` `MIN_CAROUSEL_PAGES`(2)–`MAX_CAROUSEL_PAGES`(6)。
- 结构校验 `validateContainerTree(content)` 返回 `ContainerIssue{ path, code, detail }[]`（不抛异常），失败码：
  `invalid-container-type` / `invalid-children-count` / `duplicate-child` / `child-not-found` / `container-nesting`。
- **首版深度 1**：容器子对象只能是卡片；容器嵌套容器一律 `container-nesting`（`CONTAINER_MAX_DEPTH = 1`）。
- 只校验数据语义；卡片分析引用/图表配置的合法性仍由 D-1 `validateContentDocumentV1` 负责（两道校验互补，不重复造轮子）。

## 4. 展示形态派生（投影口径复用）

`deriveContainerDisplay(geometry, targetColumns, contract?)` → `{ form: "full"|"compact"|"collapsed", size, reasons }`，与投影引擎规则保持一致：

1. 用户主动 `presentation === "collapsed"` → `collapsed` + `user-collapsed`，尺寸取 `contract.collapsedSize`（缺省 1×1）；
2. `targetColumns < contract.minFullCols` → `collapsed` + `container-narrow`；
3. 完整宽度（`expandedSize ?? 原尺寸`）大于目标列数 → 命中 `sizeLadder` 则 `compact` + `width-overflow`，否则 `collapsed` + `width-overflow`；
4. 其余 → `full`（使用 `expandedSize ?? 原尺寸`）。

只读展示形态（`derived`）**永不写回**权威布局；权威布局只保存用户意图 `presentation` 与 `expandedSize`（OQ-LM-06）。

## 5. 1×1 占位与恢复（纯数据）

- `collapseContainerGeometry(geometry, collapsedSize = 1×1)`：记录 `expandedSize`（优先原 `expandedSize`，否则当前宽高）、占格改为收缩尺寸、`presentation = "collapsed"`；**幂等**（已折叠原样返回）。
- `restoreContainerGeometry(geometry)`：用 `expandedSize` 还原宽高并清除 `presentation`/`expandedSize`；**幂等**。
- `isUserCollapsed(geometry)`：判断用户主动收缩（权威字段，非派生）。
- `isPlaceholderForm(form, size)`：判断 1×1 占位形态（供入口按钮/徽标使用，本批不做 UI）。
- 恢复语义保证：内部卡片、分割比例、顺序、图表配置从未被触碰（本模块不读写内容文档内部结构）。

## 6. 跨列迁移固定案例（回归表）

| 场景 | 输入 | 目标 | 期望 |
|---|---|---|---|
| 所有者示例 3→4 | A@1(2×2)、B@3、C@6（baseCols 3） | 4 | `{A:1,B:3,C:4}`，A 为 full 2×2，几何合法 |
| 所有者示例 4→3 | A@1(2×2)、B@3、C@4（baseCols 4） | 3 | `{A:1,B:3,C:6}`，几何合法 |
| 3→2 | 同 3 列输入 | 2 | `{A:1,B:5,C:6}`（A 保持 2×2） |
| 同锚点冲突 | a@1、b@1、c@2 | 3 | `{a:1,b:2,c:3}`，b/c 带 `anchor-occupied` |
| 非法锚点 | A anchor=0、B@2 | 3 | A `sourceAnchor=null` + `source-invalid`，排到最后处理、拿到最早空位 |
| 行跨超限 | rowSpan=99 | 3 | 夹到 8 + `size-clamped` |
| 宽度降级 | W 3×1 有 ladder `[2×1]` / 无契约 | 2 | `compact` + `width-overflow` / `compat` 1×1 + `missing-contract` |
| 容器完整/收缩 | GridSplit 2×2、`minFullCols=2` | 3 / 1 | `full` 2×2 / `collapsed` 1×1 + `container-narrow` |
| Carousel 完整 | Carousel 2×1 | 4 | `full` 2×1 |
| Spacer | S1 3×1（与 A） | 2 | 夹宽 2×1 + `width-overflow`，不删除 |
| 无漂移 | 多目标重复投影 | 2/3/4/5/6/12 | 两次投影逐字节相同、输入布局 JSON 不变、几何合法 |

补充约束：投影 issues（`ProjectionIssue.reason`）只报告结构性硬问题；降级原因记录在对象的 `degradedReasons`（`width-overflow`/`size-clamped`/`anchor-occupied`/`container-narrow`/`user-collapsed`/`missing-contract`），两者分工不变（D-4 已记录该口径）。

## 7. 测试证据

- `pnpm.cmd --filter @libellum/shared typecheck` → **exit 0**。
- `pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout` → **20 test files / 265 tests passed**（D-3.1 后 234 + D-3.2 新增 31），约 1.4s，exit 0。
- 新增测试：`containers.test.ts`（19 项，含 200 场景属性测试，种子 `0x5f17d2b1`）、`migration-cases.test.ts`（12 项）。

## 8. 占位与未决

| 编号 | 内容 | 状态 |
|---|---|---|
| OQ-LM-03 | 垂直紧凑组合方式/默认启用顺序 | 仍待所有者（DIFF-01）；`verticalCompact` 默认 false |
| OQ-LM-05 | 容器展开入口形态（覆盖层/详情页）与手势细节 | 待所有者 + Codex 视觉；本批只做数据语义 |
| OQ-LM-06 | 默认收缩策略与编辑态表现 | 所有者方向已落实（不默认全缩；1×1 与恢复入口必须支持）；具体 UI 待 W5/Codex |
| OQ-LM-09 | 容器长宽比/槽位最小可读/紧凑档 | 待 W5/Codex；本批 `sizeLadder` 只执行不发明 |
| — | GridSplit 槽位与 children 的分配策略（哪个 child 进哪个槽） | 未在数据层强制；首期由内容文档顺序 + 视觉实现决定，待 W5 |
| — | 容器内部编辑命令（进入容器编辑子卡片） | 未实现；属编辑器/集成批次（依 Codex 视觉） |

## 9. 偏差与风险

- `containerChildBounds` 对未知容器类型返回 `{min:1,max:1}` 仅为类型安全兜底；运行时未知类型先被 `invalid-container-type` 拦截。
- `deriveContainerDisplay` 与投影引擎是两处实现但口径由本批测试锚定；集成批次建议让投影引擎直接复用（当前避免改动 D-3 既有投影代码）。
- 1×1 折叠后若 `expandedSize` 缺失（损坏数据），恢复退化为当前尺寸；此类损坏仍由 D-3 `repairLayoutGeometry` 与投影修复兜底。

## 10. 下一步

1. 等待 A 最终修订后的针对性复核（Lead 清单：D-V2-01/02/03、G-12b、G-12a 发布物、G-13a 编号映射、S-03 引用一致性）；
2. 集成批次前由 Lead/S-03 评审 `containers.ts` 是否作为对外接口导出；
3. D-2 UI 继续等真实 Codex 视觉规范；
4. W5 前与所有者确认 OQ-LM-03/05/06/09 细节（本批已登记占位，不自行拍板）。
