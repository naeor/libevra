---
name: libevra-desktop-ui
description: Libevra 电脑端 / 宽屏 / 键鼠交互的设计与实现规范。在 Libevra 仓库里设计、实现或审查电脑端界面时使用——鼠标悬停（hover）、右键菜单（context menu）、键盘快捷键与焦点、多选与批量、拖放、tooltip、信息密度、多工作区与窗口尺寸变化、桌面表格与详情面板；也用于 S18 跨设备适配、S19 交互优化，以及审查改动是否把手机交互原样搬到了电脑端。
---

# Libevra 电脑端界面（Desktop UI）规范

> 状态：**v0.1 草案，待所有者审阅**（2026-10-31）。本文件只做入口与总则；细则在 `references/`，分页面要求在 `pages/`。
> 一句话：**电脑版不是放大的平板（P-05）**。功能与品牌语言不变，按「输入能力 × 可用空间」给出适合键鼠的体验；**悬停和右键只是增强，永远不能是唯一入口**。

## 0. 什么时候用

- 用：电脑端或宽屏下的页面、组件、交互的设计 / 实现 / 审查；任何新增 hover、右键、快捷键、选择、拖放、tooltip、分栏、表格的改动；S18 跨设备适配与 S19 交互优化任务。
- 不用：纯数据 / API / 同步逻辑；宣传片；只针对手机竖屏、且不改变共享组件行为的改动（照既有规范做即可）。

## 1. 开工前必做（门禁）

1. 按 [AGENTS.md](../../../AGENTS.md) 正常开工（`pnpm agent:brief` 或 `docs/STATUS.md`），不重新审计仓库。
2. **判定这次涉及的设计决定处于什么状态**，读 [S18-B 设计讨论记录](../../../docs/specs/design/S18-B-跨设备自适应布局与交互-设计讨论记录-20261027.md) §8（草图门禁）与 §10（决策清单）：

   | 状态 | 能做什么 |
   |---|---|
   | 【已确认】/【已批准实施】 | 按原文实施 |
   | 【设计候选】 | 只能讨论、提方案；**不得实现成正式页面** |
   | 【待所有者草图】 | **不可实施**：保留原有 UI，标「待所有者设计确认」，说明缺哪项决定，只做不依赖它的工程准备 |
   | 【待技术验证】 | 可做原型与验证，结论交所有者 |

3. 本 skill 自己的条目分两类：
   - **【规范默认】**：来自平台与无障碍规范（Apple HIG、Microsoft Windows 设计指南、WAI-ARIA APG、WCAG 2.2）的交互惯例，例如「Esc 关闭最上层浮层」「右键菜单可用 Shift+F10 打开」。**所有者 2026-10-31 已同意：这类条目直接实施，不必逐项请示**；前提是不改变页面结构与视觉布局。
   - **【候选】**：本 skill 提出的具体清单（快捷键表、右键菜单项、新增的复制 / 拖入文件等功能）。**首次落地前必须经所有者确认**，确认后把状态改写进对应规格，不在本 skill 里另记一份。
   - 凡是会影响主导航、侧栏、详情面板、分析网格、绿色记账按钮等**页面结构或整体视觉**的，无论本 skill 怎么写，都先过 §8 门禁。
4. 读对应的 `pages/*.md`，再按需要读 `references/*.md`。

## 2. 硬约束（项目既有规则摘要，以原文为准）

| 约束 | 依据 |
|---|---|
| 具体布局（导航、侧栏、详情面板、分析网格、Logo、绿色加号）必须先有所有者草图 / 明确意见；禁止自行生成最终布局方案 | S18-B §8、§10.3 |
| 界面上「是否显示 / 是否可点」的判断**只许新增、不许改动**；移动、合并、抽公共函数都算改动。右键菜单、快捷键、批量栏要引用现有判断，不能另写一套或把它们挪到一起 | AGENTS.md §6「敏感权限判断」 |
| 颜色只用现有主题 token；**不新增颜色 token、不绕过主题系统**；7 套色盘 × 浅 / 深都要成立 | [颜色语义与配色规范](../../../docs/specs/design/颜色语义与配色规范.md)、[颜色主题系统实现规范](../../../docs/specs/design/颜色主题系统实现规范.md)、S18-B §5.3 |
| 复用既有组件，**不引入新的 UI / 动画库**（包括菜单、快捷键、拖放库） | S18-B 附录 A.5 第 2 条 |
| 金额完整呈现：不截断、不用 `transform: scale` 缩放文字；数字用 `tabular-nums` | S18-B 附录 B 第 7 条、[文字语义与排版规范](../../../docs/specs/design/文字语义与排版规范.md) |
| 派生布局不写回权威布局；窗口尺寸变化不得静默改动用户保存的配置 | P-10、附录 B 第 2–4 条 |
| 离线优先：键鼠入口和触控入口能力一致；离线不可用的操作在菜单 / 快捷键里同样不可用并说明原因 | AGENTS.md「一句话」、[离线与同步设计决定](../../../docs/specs/product/离线与同步-设计决定.md) |
| 所有新文案进 `zh-CN` / `en-US` 资源（`apps/web/src/i18n/resources/`），交付前过 `pnpm i18n:scan`；快捷键按平台显示 | [国际化与本地化规范](../../../docs/specs/design/国际化与本地化规范.md) |
| 用户可见改动：升版本号 + changelog 一条；检查按 AGENTS §6.1 分级；不用 shell 做 UTF-8 源码字符串替换 | AGENTS.md §6 |

## 3. 心智模型：手机与电脑差在哪

| 维度 | 手机 / 触控 | 电脑 / 键鼠 |
|---|---|---|
| 指针 | 手指，粗、会遮挡，没有悬停 | 鼠标 / 触控板，精确，有悬停，有右键、中键、滚轮 |
| 主力输入 | 点按、滑动、长按 | 点击 + 键盘；熟练用户大量用键盘 |
| 屏幕 | 一次一件事，靠跳转 | 并排、多栏、常驻面板，少跳转（P-01、P-03） |
| 窗口 | 尺寸基本固定 | 随时被拖成任意宽高，可能同时开多个标签页 / 窗口 |
| 使用时长 | 碎片化 | 连续工作数分钟到数小时，追求效率 |
| 文字 | 很少复制 | 期望能选中、复制金额与备注，能 Ctrl/⌘+F 查找 |
| 滚动条 | 隐藏式 | Windows 常显、占宽度 |
| 链接 | 点了就走 | 期望中键 / Ctrl(⌘)+点击在新标签打开、能后退前进 |

**输入能力和窗口大小是两个独立维度（P-06）**：触屏笔记本、接触控板的 iPad 都存在，**禁止用宽度推断「有鼠标」**。细则见 [references/input-and-hover.md](references/input-and-hover.md)。

## 4. 十条核心规则

1. **每个可交互元素状态齐全**：常态 / 悬停 / 按下 / 键盘焦点 / 选中 / 禁用（必要时加载中、拖放目标）。悬停反馈 ≤100ms，颜色取现有 token。→ [input-and-hover](references/input-and-hover.md)
2. **悬停只揭示、不承诺**：悬停不导航、不提交、不改数据；悬停露出的控件在键盘聚焦时也露出，触控下常驻或另有入口；唯一入口不得藏在悬停里。→ [input-and-hover](references/input-and-hover.md)
3. **右键 = 当前对象的快捷命令集合**：只放界面上别处已有的命令；右键未选中的对象先选中它；Shift+F10 / 菜单键可打开；不拦截输入框、选中文字的原生菜单。→ [context-menu](references/context-menu.md)
4. **键盘全可达**：Tab 顺序 = 阅读顺序；组合控件内用方向键；Esc 逐层关闭；浮层关闭后焦点回到触发处；`focus-visible` 焦点环不被遮挡。→ [keyboard-and-focus](references/keyboard-and-focus.md)
5. **快捷键少而稳**：避开浏览器 / 系统 / 输入法 / 读屏保留键；输入框内不触发单键快捷键；**中文输入法组字时 Enter 不提交**；按平台显示 ⌘ / Ctrl；在 tooltip 或菜单中可发现。→ [keyboard-and-focus](references/keyboard-and-focus.md)
6. **选择与批量用桌面惯例**：Ctrl/⌘+点击切换、Shift+点击连选、Ctrl/⌘+A 全选（范围用文字说清）、Esc 清空；焦点与选中外观不同；复用 `SelectionBar` / `BatchActionBar`。→ [selection-and-dnd](references/selection-and-dnd.md)
7. **拖放必有替代**：每个拖放都有点击 / 菜单 / 键盘等价操作；Esc 取消；复用现有拖动体系，不建第三套。→ [selection-and-dnd](references/selection-and-dnd.md)
8. **加信息量，不放大组件（P-01）**：鼠标目标 ≥24×24 CSS px，有触控能力时仍保 44px（`.touch-target`）；密度靠更多列与并排，而不是更小的字。→ [layout-density-window](references/layout-density-window.md)
9. **任意窗口尺寸连续可用**：按容器而不是视口布局；内容区优先（P-03）；滚动归属清楚；浏览器缩放 200% 可用；多标签页同时打开不出错。→ [layout-density-window](references/layout-density-window.md)
10. **不破坏 Web 原生能力**：导航用真实链接；不禁用缩放、粘贴、文字选择；不劫持滚轮与后退；tooltip、弹层、反馈符合 WCAG 1.4.13 等要求。→ [overlays-and-feedback](references/overlays-and-feedback.md)

## 5. 工作流程

**设计 / 实现任务**

1. 判定决定状态（§1）。落在【待所有者草图】的部分：停下，标记，汇报缺什么。
2. 为本次涉及的每个可交互对象填一行「输入方式矩阵」（单击 / 双击 / 悬停 / 右键 / 键盘 / 拖放 / 触控 / 替代入口），模板在 [review-checklist](references/review-checklist.md)。矩阵里出现空格就是缺口。
3. 先找现有实现复用。**电脑版外壳已存在（`apps/web/src/desktop/`）**：外壳选择 `shellKind.ts`（输入能力 × 宽度，760 进 / 720 出，`?shell=`）；页面画框 `DesktopFrames.tsx` + `surface.tsx`（`TabPage` / `InnerPage` / `StickyActionBar` 在电脑版自动换框，页面不用分叉）；工具栏 `DesktopToolbar.tsx`；主区 + 辅助栏 `DesktopSplit.tsx` / `split.ts`（窄时覆盖或隐藏）；弹出面板 `DesktopPopover.tsx`；页面分组 `sections.ts`；总览模型 `dashboardModel.ts`；样式只放 `desktop.css`（`lv-desk-*` / `lv-dash-*`，悬停写在 `@media (hover: hover)` 内）；文案在 `desktop` 命名空间。其它可复用：输入法组字判断与新标签页点击（`lib/desktopInput.ts` 的 `isImeComposing`、`wantsNewTab` / `openInNewTab`）、紧凑侧栏名称提示（`workspace/RailTip.tsx`；需要通用 tooltip 时从它抽，单独一件事）、菜单键盘逻辑（`workspace/RailEntryMenu.tsx`）、右键与 Shift+F10（`workspace/openDrag.tsx`）、拖放（`workspace/navDrag.ts`、`openDrag.tsx`、`statsWorkbench/dnd.ts`）、批量（`components/ledger/`）、撤销（`UndoProvider`）、确认（`ConfirmDialog`）、底部操作（`StickyActionBar`）。
4. 实现。同一对象的命令只定义一次，「更多」按钮、右键菜单、快捷键、批量栏消费同一份定义。
5. 用 [review-checklist](references/review-checklist.md) 自查；按 AGENTS §6.1 选检查级别，每条命令跑一次；交互走查至少做「只用鼠标」「只用键盘」「触控模拟」「中文输入法」各一遍。
6. 汇报 ≤10 行：区分「已实现并验证」与「只写了代码」，列出未在真实平台验证的项（Windows Edge、macOS Safari、触屏笔记本等）。

**审查任务**：按 [review-checklist](references/review-checklist.md) 逐项看，输出 `文件:行 — 问题 — 依据 — 建议`，不顺手改代码。

## 6. 文件索引

| 文件 | 内容 |
|---|---|
| [references/input-and-hover.md](references/input-and-hover.md) | 输入能力判断、交互状态体系、悬停揭示、光标、点击 / 中键 / 滚轮语义 |
| [references/context-menu.md](references/context-menu.md) | 右键菜单：触发、拦截边界、内容与排序、定位、键盘、实现与候选清单 |
| [references/keyboard-and-focus.md](references/keyboard-and-focus.md) | 键盘可达、焦点管理、标准按键、中文输入法、快捷键设计与保留键 |
| [references/selection-and-dnd.md](references/selection-and-dnd.md) | 选择模型、批量操作、拖放、剪贴板 |
| [references/layout-density-window.md](references/layout-density-window.md) | 已确认原则、已批准大屏结构、密度、表格、窗口与滚动、Web / PWA 行为 |
| [references/overlays-and-feedback.md](references/overlays-and-feedback.md) | tooltip、弹出菜单、对话框 / 面板、反馈与动效 |
| [references/review-checklist.md](references/review-checklist.md) | 输入方式矩阵模板、逐项清单、走查脚本、测试写法、汇报格式 |
| [references/sources.md](references/sources.md) | 外部依据，以及对 Anthropic frontend-design、Vercel web-design-guidelines 的核查与取舍 |
| [pages/shell-and-nav.md](pages/shell-and-nav.md) | 外壳、全局侧栏、多工作区、导航 |
| [pages/entries.md](pages/entries.md) | 明细与交易详情 |
| [pages/capture.md](pages/capture.md) | 记账与识别（手动、粘贴、语音、拍照 / OCR、导入） |
| [pages/analysis.md](pages/analysis.md) | 分析工作台（浏览、布局编辑、卡片详情、图表） |
| [pages/ledger.md](pages/ledger.md) | 账本与协作（账本空间、成员、邀请、留言、历史） |
| [pages/me-settings.md](pages/me-settings.md) | 我的与设置 |

## 7. 外部参考

已核查来源与内容，**没有安装任何第三方 skill 或包**；只吸收与本项目相符的部分。详见 [references/sources.md](references/sources.md)。

- Anthropic 官方 `frontend-design`：只采用其质量底线（焦点可见、减少动态、响应式、对比度、CSS 优先级小心、文案以用户为中心）。**不采用**「另定新配色 / 新字体 / 大胆审美冒险」——与本项目主题 token 体系和 §8 草图门禁冲突。
- Vercel `web-design-guidelines`（MIT）：吸收其 Web Interface Guidelines 中的交互、表单、动效、内容规则。**不安装**该 skill：它每次运行都从 GitHub `main` 分支实时拉取规则，内容未锁定版本；且其中「Vercel 专属」文案风格不适用于本项目。
