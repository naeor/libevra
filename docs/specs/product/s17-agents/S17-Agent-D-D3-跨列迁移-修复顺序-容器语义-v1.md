# S17 · Agent D · D-3 跨列迁移、确定性修复与容器语义（headless）v1

> 最后核对: `486c603` + 本轮 D-3 提交 / 2026-10-27
> 状态：**D-3 headless 完成，待 Lead 评审**（纯函数与测试；不含 UI、视觉、页面接入）
> 提交方：`DS-S17-D-Layout`；依据：所有者《Agent D 完整开发规格》§4–§13、布局规格 §12–§17、Lead 裁定（m00547/m00548）
> 代码位置：`packages/shared/src/analysis/layout/`（**未接入** `packages/shared/src/index.ts`）
> 相关：[D0 数据模型](./S17-Agent-D-D0-布局数据模型与接口-v1.md)、[D1 测试与校验](./S17-Agent-D-D1-布局引擎测试与文档校验-v1.md)、[D2 前置交互模型](./S17-Agent-D-D2-前置-交互模型与状态机草案-v1.md)、[S-03 布局侧草案 v0.2](./S17-Agent-D-S03-接口草案-布局侧-v1.md)

---

## 1. 目标与边界

D-3 headless 交付“不依赖 Codex 视觉规范”的纯逻辑：

1. 跨列数确定性迁移（固定案例 3→4、4→3 及 1–6 基准列 × 1–12 目标列矩阵）；
2. 冲突与尺寸降级的确定性修复顺序、失败码；
3. Spacer 与垂直紧凑边界（OQ-LM-03 仅实现可切换开关，**默认不压缩**待所有者）；
4. 容器语义 headless（`presentation`/`expandedSize` 状态、投影形态、撤销/重做）；
5. 全部纯函数 + 固定案例/属性测试。

边界：不改分析结果、不读账务数据、不改时间筛选、不写回权威布局、不做 UI/视觉、不接包入口、不加迁移/API。

## 2. 代码与导出

| 文件 | 内容 | 导出 |
|---|---|---|
| `compaction.ts`（新增） | 垂直紧凑纯函数 | `CompactionResult`、`compactVertically(objects, columns)` |
| `repair.ts`（新增） | 几何确定性修复 | `GEOMETRY_REPAIR_ORDER`、`GeometryRepairCode`、`GeometryRepair`、`GeometryRepairResult`、`repairLayoutGeometry(layout)` |
| `projection.ts`（修改） | 投影接入可选垂直紧凑 | 导出不变；`ProjectOptions.verticalCompact`（默认 `false`） |
| `types.ts`（修改） | `ProjectOptions` 增 `verticalCompact?`；`MigrationStrategy` 注释锁定 size-first | 类型不变 |
| `index.ts`（修改，目录 barrel） | 追加 compaction/repair 导出 | 仍不接入包入口 |
| `test-support.ts`（修改） | 新增 `layoutOf(main, options?)` | 测试辅助 |

所有函数：不读时钟/视口/随机数/财务数据；不修改入参；同输入同输出。

## 3. 跨列数确定性迁移

- **策略锁定**：默认 `size-first`（S，Lead 按所有者 D 规格裁定）；`position-first`（P）保留为对照策略，不用于生产。
- **固定案例**（测试断言）：
  - 3→4：`A@1(2×2) B@3 C@6` → `C@4`；
  - 4→3：`A@1(2×2) B@3 C@4` → `C@6`；
  - 冲突贪心：同锚点 `a@1,b@1,c@2` → `a@1,b@2,c@3`（`anchor-occupied` 可见）；
  - 非法输入：`anchor=0 / colSpan=0 / rowSpan=99` → `sourceAnchor=null`、跨度 `1×8`、原因 `source-invalid`+`size-clamped`。
- **矩阵**：baseCols 1–6 × target {1,2,3,4,5,6,8,10,12}，断言对象不丢、`validateGeometry` 空、目标列数生效。
- **多跳无漂移**：3→4→2→3 与直接 3 列投影锚点一致，且权威布局 JSON 不变（每次从权威布局重推，禁止链式推导）。
- **内容/布局分离**：投影前后内容文档、布局文档、对象数组逐字节不变。

## 4. 确定性修复顺序与失败码

### 4.1 修复层（读取/导入后的修复副本，不写回）

`GEOMETRY_REPAIR_ORDER`（顺序固定，可被日志/测试依赖）：

| # | code | 规则 |
|---|---|---|
| 1 | `invalid-columns` | `baseCols` 非正整数/超 1–12 → 按 2 列解释 |
| 2 | `duplicate-object-id` | 重复 `objectId` 保留首次出现，其余丢弃（逐条记录） |
| 3 | `invalid-anchor` | 位置编号非正整数 → 置 0（未定位，由投影补位） |
| 4 | `invalid-size` | `colSpan`/`rowSpan` 非正整数 → 置 1 |
| 5 | `row-span-too-large` | `rowSpan > MAX_ROW_SPAN(8)` → 夹到上限 |

修复层**不处理**越界/重叠/同锚点冲突——交给投影的单遍优先级贪心（保持 `anchor-occupied` 原因可见）；与 OQ-LM-12 推荐口径一致，细节仍待 W2 冻结。

### 4.2 投影层失败码（既有）

`source-invalid`（源数据非法/未定位）、`duplicate-dropped`、`orphan-dropped`、`anchor-occupied`、`width-overflow`、`size-clamped`、`container-narrow`、`user-collapsed`、`missing-contract`。投影结果中的问题记 `ProjectionIssue{reason, detail, objectId?}`。

**两层等价性测试**：损坏布局直接投影 vs 修复副本投影，几何（锚点/宽高/形态/来源锚点）一致；差异只在 issue 记录（修复层已消化的原因不再重复报告）。

## 5. Spacer 与垂直紧凑

- `compactVertically(objects, columns)`：按 (行, 列, `objectId`) 升序处理非 Spacer；Spacer 先占位并记录底边/列区间；对象最小行 = 与下方 Spacer 列重叠时的 Spacer 底边（不得穿过）；在 [最小行, 当前行] 找首个合法空格，**列不变**；只改锚点，不改宽高/形态/顺序。
- 投影开关：`projectLayout(..., { verticalCompact: true })` 在投影后应用紧凑，结果参与合法性校验；**默认 `false`**（OQ-LM-03 未决，不在未确认前改变默认显示）。
- 属性测试（800 场景，固定种子）：几何合法、对象不丢、Spacer 锚点不动、只上移且列不变、宽高/形态不变、幂等、权威布局 JSON 不变。
- 待所有者：OQ-LM-03（紧凑与投影组合、Spacer 空行、“明确保存位置”含义）；OQ-LM-04（Spacer 窄屏降级，暂用夹宽；未经确认不自动删除 Spacer）。

## 6. 容器语义（headless）

- 容器类型：`grid-split` / `carousel`（首版深度 1；内部结构归内容文档，布局只记录外层几何）。
- 命令 `set-presentation`（`commands.ts`）：
  - 收缩（`collapsed`）：仅容器可用；写 `presentation:"collapsed"` + `expandedSize:{colSpan,rowSpan}`（保留完整尺寸）+ 几何改 `1×1`；
  - 展开（`full`）：用 `expandedSize` 还原尺寸并删除 `presentation`/`expandedSize` 两字段；
  - 重复命令为空操作（不新增撤销记录）；非容器/Spacer 报 `invalid-presentation`；
  - 已收缩容器禁止直接 `resize`（`user-collapsed`，OQ-LM-06 暂定口径）。
- 投影：`presentation="collapsed"` → `form=collapsed` + 原因 `user-collapsed`；宽度不足且无紧凑档 → `container-narrow`；源布局 `expandedSize` 不被写回。
- 撤销/重做覆盖收缩命令（折叠 → 撤销 → 重做 字段一致；折叠→展开→两次撤销回到原状）。
- **容器只表达展开/折叠与占位，不解释内部内容**（Lead 裁定第 4 条）：投影不展开容器内部、不替换容器、内部卡片仍各自拥有身份与详情入口。

## 7. 测试与真实执行结果

| 文件 | 新增用例 | 覆盖 |
|---|---|---|
| `migration.test.ts` | 18 | 示例 3→4/4→3、列数矩阵、容器完整/收缩、Spacer、多跳无漂移、冲突贪心、非法输入、确定性、内容/布局分离 |
| `compaction.test.ts` | 8 | 平移填洞、Spacer 阻挡、容器整体平移、宽高/形态不变、默认关闭/开关等价、幂等、非法列数、800 场景属性测试 |
| `repair.test.ts` | 10 | 固定顺序、重复 ID、非法锚点/跨度、超上限、不改输入/幂等、修复后投影等价、未定位补位 |
| `container.test.ts` | 12 | GridSplit/Carousel 折叠↔展开、expandedSize、重复/非法命令、resize 拒绝、撤销/重做、投影形态、内部身份 |

真实执行（本 worktree，pnpm 12.10.1，node v24.20.0）：

```
pnpm.cmd --filter @libellum/shared typecheck                                  → exit 0
pnpm.cmd --filter @libellum/shared exec vitest run src/analysis/layout        → 12 files / 150 tests passed
```

（D-1/D-2 前置 102 项 + D-3 新增 48 项，全绿；无环境限制说明——依赖已安装。）

## 8. 与 S-03 的衔接

S-03 布局侧草案已更新为 **v0.2**，记录 Lead 裁定：接受 `AnalysisReference`/`ObjectSizeContract` 为 draft；尺寸数值 W3 由卡片家族声明；暂不拆 `ContainerGeometryContract`；迁移签名纳入版本契约、缓存键仅实现约定；未知 `analysisId` 只读占位（分享 Q-15 待绑定）；OQ-LM-01 锁定 S。

## 9. 偏差与待决

- **偏差**：垂直紧凑以 `ProjectOptions.verticalCompact` 形式接入投影（而非独立后处理 API），便于集成层统一调用；默认关闭，未改变既有投影输出。
- **待决（停留待所有者/上游）**：OQ-LM-03、OQ-LM-04、OQ-LM-06（展开入口 UI 与字段细节）、OQ-LM-01 的家族/用户可配置性（当前全局 S）、容器长宽比与槽位最小可读（OQ-LM-09）、Codex 视觉规范。
- **未做**：D-2 UI（移动/缩放手势、网格线、手柄、动画）、页面/路由接入、服务端同步、分享导入导出、`packages/shared/src/index.ts` 接入。

## 10. 下一步

1. 等 Lead 评审本文件与 S-03 v0.2；
2. Codex 视觉规范到位后另行批准 D-2 UI；
3. W5 前把 D-1/D-3 的纯函数接入真实布局引擎（含 OQ-LM 裁定后的口径更新）。

> 变更须同步代码、测试与任务文档 §6.2；规格/代码不一致以所有者规格为准并登记偏差。
