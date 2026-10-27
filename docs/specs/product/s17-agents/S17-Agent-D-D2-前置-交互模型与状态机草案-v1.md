# S17 · Agent D · D-2 前置：交互模型与状态机草案（v1）

> 最后核对: `486c603` + 本轮 D-2 前置提交 / 2026-10-27
> 性质：**交互模型草案**（不依赖视觉规范的纯逻辑部分；视觉/动效/手势像素级细节待 Claude 视觉/适配要求另行评审——所有者 m11382 / Lead m02654：工作台 UI 由 Claude 接管，Codex 材料仅历史参考）
> 实现者：`DS-S17-D-Layout`；上级：Lead
> 权威依据：布局规格 §3（模式严格分离）、§6（拖动/吸附/缩放/撤销与键盘替代）、§11（性能与可访问）、§19（测试矩阵）；所有者规格 §40 D-2；`S17-Agent-D-完整开发规格-所有者-20261027.md` §4、§7–§9、§42。
> 对应代码：`packages/shared/src/analysis/layout/commands.ts`、`focus.ts`、`machine.ts` 及其单元测试（headless，可移植到 UI 层）。
> 2026-10-27 方向更新：D-2 阻塞条件由「等 Codex 视觉规范」改为**「等 Claude 视觉/适配要求 + Lead 验收」**；D 的布局引擎是唯一实现，Claude 通过 `S17-Agent-D-I1-集成契约映射-v1.md` 消费布局文档/投影。

---

## 1. 目的与范围

本文件把“编辑工作台布局”的**交互逻辑**固化为可测试的纯函数契约，供后续 D-2 UI 批次与 Claude 视觉/适配要求对接。包含：

- 浏览/编辑两种模式与显式入口、编辑会话生命周期；
- 编辑命令（选择/移动/换列/换行/跨列/跨行/插入/删除/撤销重做）与失败规则；
- 焦点模型、方向导航与键盘映射（拖动必须有的键盘/单指针替代）；
- 拖拽与键盘并行、触摸与鼠标差异；
- 无障碍要求（WCAG 2.2 AA）、编辑草稿与提交/取消语义。

**不包含**：视觉样式、动画曲线、手柄/网格线外观、拖拽物理与吸附动画（Codex 规范）、真实 DOM/事件绑定、页面路由接入。

---

## 2. 两种模式与入口

| 项 | 浏览模式（默认） | 布局编辑模式 |
|---|---|---|
| 进入 | 默认状态 | 分析页/工作台的**明确按钮**进入（布局规格 §3：不做长按隐式进入） |
| 文档 | 只读，使用权威布局投影后的结果 | 在内存草稿上编辑（`EditorState`），不写回已提交布局 |
| 交互 | 卡片点击→详情；滚动、筛选、图表交互可用 | 布局手势优先；卡片内部交互暂停（编辑模式不触发财务交互） |
| 退出 | — | 「完成」提交或「取消」放弃（有改动需二次确认）；系统返回=取消 |
| 写回 | 不可写 | **只有用户明确保存（完成）时才一次性原子提交**；任何中间状态不写回 |

模式状态机（`machine.ts`）：`mode: browse|edit` × `phase: idle|dragging|resizing|confirming-discard`，另有 `hasUnsavedChanges`、`pendingDiscard` 两个标记。

| 当前状态 | 事件 | 结果 | 副作用标记 |
|---|---|---|---|
| browse | `enter-edit` | edit + idle，干净 | — |
| edit + idle | `change-made` | 置脏 | — |
| edit + idle | `begin-gesture`(move/resize) | 对应拖动/缩放阶段 | — |
| dragging/resizing | `end-gesture` | 回到 idle | — |
| edit + idle | `commit` | 退出到 browse，干净 | `commit-layout`、`clear-history` |
| edit + 有改动 | `request-cancel` | confirming-discard | `notify-unsaved-changes` |
| edit + 无改动 | `request-cancel` | 退出到 browse | `discard-draft`、`clear-history` |
| edit + 任意 | `system-back` | 等同取消（有改动先确认） | 同上 |
| confirming-discard | `confirm-discard` | 退出并丢弃 | `discard-draft`、`clear-history` |
| confirming-discard | `dismiss-discard` | 回编辑 idle | — |
| browse | `system-back` | 保持浏览，交还页面处理 | `request-leave-workbench` |

非法事件返回原状态、无副作用（`accepted=false`）。弹层外观、提示文案、动效由 Codex 规范定义；状态机只决定**何时**提示与**哪些**后续动作。

未确认口径（登记，不臆造）：编辑草稿是否落本地（OQ-CF-02，先不落）；切后台/刷新后的恢复策略（W5 研究）。

---

## 3. 文档模型与命令层

`EditorState = { content, layout, selection, history }`：权威内容文档 + 权威布局文档 + 当前选中对象 + 撤销栈。所有编辑命令都经：

```
命令 → 文档转换（不可变）→ 全量校验（内容/布局/几何/交叉引用）→ 成功才入撤销栈
```

失败时**状态完全不变**，返回 `issues`（含 `LayoutValidationIssue.code`）供 UI 提示。

命令表（草案，`applyCommand` 实现）：

| 命令 | 参数 | 规则/失败码 |
|---|---|---|
| `select` | `objectId \| null` | 不存在→`unknown-object`；相同选择为空操作 |
| `move` | `objectId`、`anchor` | 与当前相同→空操作；重叠/越界由几何校验拒绝（`overlap`/`invalid-anchor`） |
| `move-by` | `rowDelta`/`colDelta` | 行列越界→`invalid-anchor`；键盘方向键的底层命令 |
| `resize` | `colSpan?`/`rowSpan?` | 非正整数→`invalid-size`；行跨度>8→`row-span-too-large`；用户收缩容器→`user-collapsed`（OQ-LM-06 暂定） |
| `set-presentation` | `presentation: full\|collapsed` | 仅容器支持（卡片→`invalid-presentation`）；折叠保存 `expandedSize` 并置 1×1；恢复清空字段 |
| `insert-card` | `card`、`anchor?`、`size?` | 重复 ID→`duplicate-object-id`；卡上限 40→`too-many-objects`；宽度超列→`width-overflow`；无锚点时取最早合法空位 |
| `insert-spacer` | `objectId`、`anchor?`、`size?` | 只写布局文档；重复 ID 拒绝 |
| `delete` | `objectId` | 同时移除内容文档与布局文档（Spacer 只移布局）；清空选中 |
| `undo` / `redo` | — | 空栈→`undo-empty`/`redo-empty`；新命令清空 redo；栈上限默认 50（候选，布局规格 §6） |

插入/删除的容器级语义（容器插入、容器内卡片移出/移除询问）留 W5；本批只覆盖卡片与 Spacer。

撤销栈为**文档快照栈**（内容+布局+选中），「完成」后清空；套用模板等操作应作为单条命令进入历史（W5）。

---

## 4. 焦点模型与键盘映射

- **焦点 ≠ 选中**：焦点可在对象间移动（`moveFocus`），只有选中对象才能执行删除/移动/缩放等命令。
- `currentFocus`：有选中返回选中对象，否则返回按行优先排序的第一个对象；空布局返回 null。
- `findDirectionalNeighbor`：四方向最近对象；评分=方向轴距离→垂直轴距离→objectId 稳定排序（可复现，不受数组顺序影响）。

默认键盘映射（草案，最终以 Codex/所有者确认为准）：

| 键 | 无选中 | 有选中（编辑模式） |
|---|---|---|
| 方向键 | 移动焦点（不改布局） | `move-by` ±1 格 |
| Shift+方向键 | —（W5 再定焦点+多选） | 左/右改列跨度、上/下改行跨度（下限 1） |
| Delete/Backspace | 无动作 | 删除选中对象 |
| Ctrl/Cmd+Z | 撤销 | 撤销 |
| Ctrl/Cmd+Shift+Z 或 Ctrl+Y | 重做 | 重做 |
| 菜单等价操作（上移/下移/左移/右移/放大/缩小） | 布局规格 §6 要求提供 | 同左 |

约束：焦点可见、键盘可达所有布局对象与容器入口（WCAG 2.2 AA）；不使用颜色作为唯一状态标识；不使用仅长按可发现的入口。

---

## 5. 拖拽与键盘并行

- 拖拽/缩放只是**预览几何**：只更新布局对象的位置/尺寸，不重算分析结果（布局规格 §11）。
- 拖动开始/结束映射状态机 `begin-gesture`/`end-gesture`；拖动产生改动时发 `change-made`。
- 键盘与拖动是并行替代路径：任何可用拖动完成的操作都应有键盘/菜单路径；反之亦然。
- 触摸：卡片手柄或长按约 250ms 进入拖动；指针：手柄或标题栏。手柄命中区 ≥44×44（视觉尺寸由 Codex 定）。
- 拖动时自动滚动、吸附动画、非法落点反馈等属 UI/Codex；逻辑层只提供合法/非法判定（`placementFitsColumns`、`validateGeometry`）。
- 缩到低于卡片 `minSize` 时拒绝（由命令层与尺寸契约配合，W5 接入）。

## 6. 触摸与鼠标差异（逻辑层约定）

| 能力 | 触摸 | 鼠标/键盘 |
|---|---|---|
| 拖动开始 | 手柄或长按 ≈250ms | 手柄/标题栏直接拖 |
| 滚动冲突 | 编辑模式下不抢纵向滚动；拖动手势需明确手柄（布局规格 §6） | 无滚动冲突优先级问题 |
| 缩放 | 支持手柄缩放；缩放手势与页面缩放冲突需真机验证（iOS Safari/PWA 未验证） | 手柄缩放 + 键盘 Shift+方向键 |
| 悬停 | 无 | 可显示菜单/手柄提示（Codex 视觉） |
| 无障碍 | 屏幕阅读器 + 键盘替代必须完整可用 | 同左 |

真机验证未完成项（W5 前）：iOS Safari/PWA 的拖动与滚动、长按与上下文菜单冲突、44×44 命中区实际可用性。

## 7. 可访问性要求（草案清单）

- 全键盘闭环：进入编辑→选中→移动/缩放→删除→撤销→保存/取消；
- 焦点环可见且不与品牌色混淆；状态变化用文字/图标+颜色双通道；
- 拖动开始/结束、非法落点、保存失败、撤销可用性需要 `aria-live` 播报（文案待定）；
- 容器 1×1 入口是可聚焦按钮，名称含容器名+N 张卡片，Esc 返回；
- 尊重 `prefers-reduced-motion`：直接跳终态；
- 320px 宽 + 200% 文字缩放下编辑可用（布局规格 §19 TC-24，集成批次验收）。

## 8. 本批测试证据

- `commands.test.ts`：选择/移动/越界/碰撞/缩放上限/折叠恢复/插入/删除/撤销重做/栈上限/投影预览；
- `focus.test.ts`：四方向导航、边界、焦点与选中分离、键盘映射；
- `machine.test.ts`：全部状态迁移、非法事件、取消二次确认、系统返回、手势阶段。
- 真实执行：`pnpm.cmd --filter @libellum/shared typecheck` exit 0；`vitest run src/analysis/layout` **8 files / 102 tests passed**（D-2 前置新增 37 项）。

## 9. 待决（不阻塞本批）

| 项 | 占位口径 | 需要谁 |
|---|---|---|
| OQ-LM-01 行尾放不下策略 | 投影默认 S（尺寸优先），P 已实现 | 所有者（W5 前） |
| OQ-LM-03 垂直紧凑 | 未实现紧凑；Spacer 不移动 | 所有者（W5 前） |
| OQ-LM-05/06 容器入口与收缩意图 | `presentation`/`expandedSize` 占位；折叠时先拒绝改尺寸 | 所有者（W5 前） |
| OQ-LM-07/08 写回与档案键 | 未实现；`profileKey` 占位 | 所有者（W5/W6） |
| 编辑草稿落本地 | 先不落 | OQ-CF-02（W6） |
| 手势/视觉细节 | 逻辑层只判定合法性；外观待 Claude 视觉/适配要求（所有者 m11382；原 Codex 材料仅历史参考） | Claude（经 Lead 对接） |
| 真机验证 | iOS Safari/PWA 待 W5 | Lead 安排 |

## 10. 下一步

1. **Claude 视觉/适配要求到位后补**（D-2 阻塞条件已由「等 Codex 视觉规范」改为「等 Claude 视觉/适配要求 + Lead 验收」，所有者 m11382 / Lead m02654）：编辑器视觉状态（网格线/手柄/高亮/动画）、弹层与提示文案、触摸手势细节；D 布局引擎是唯一实现，Claude 通过 I-1 映射文档消费布局文档/投影。
2. W5 接入：容器插入、容器内卡片移出/移除、模板套用（单条命令）、拖拽吸附预览、真机验证。
3. 与 S-03 对齐：本文件 §3–§4 的命令结果与尺寸契约需 S-03 评审（见 [S17-Agent-D-S03-接口草案-布局侧-v1.md](./S17-Agent-D-S03-接口草案-布局侧-v1.md)）。
