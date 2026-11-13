# 外部依据与取舍（2026-10-31 核查）

> 本 skill 的【规范默认】条目来自下列公开规范；与项目已确认规则冲突时，**项目规则优先**。外部链接只作出处，执行时不需要联网读取。

## 1. 平台与无障碍规范

| 来源 | 采用的内容 |
|---|---|
| [Apple HIG · Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices) | 鼠标 / 触控板手势一致、次级点击 = 上下文菜单、macOS 光标样式与用途、悬停揭示控件、修饰键改变拖放语义、不要只依赖单一手势 |
| [Apple HIG · Context menus](https://developer.apple.com/design/human-interface-guidelines/context-menus) | 只放相关高频命令、短、≤3 组、子菜单一层、危险项放末尾、全应用一致、每项在主界面也可达 |
| [Apple HIG · Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards) | 支持纯键盘使用、不挪用标准快捷键、⌘ 为主 ⇧ 为辅 ⌥ 少用 ⌃ 避免、修饰键顺序 ⌃⌥⇧⌘、标准快捷键表 |
| [Apple HIG · Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos) | 大屏用更多内容与更少层级、窗口可调、键盘快捷键、高精度输入、触控与键鼠密度并存 |
| [Microsoft · Mouse interactions](https://learn.microsoft.com/windows/apps/design/input/mouse-interactions) | 悬停用于了解而不承诺、左键主操作、右键选中并给命令、静态内容不给悬停反馈、鼠标不显示焦点框、同一目标同时高亮 |
| [Microsoft · Menus and context menus](https://learn.microsoft.com/windows/apps/design/controls/menus-and-context-menus) | 按钮挂菜单、内容对象挂上下文菜单；菜单不承载任意内容；高频命令直接放出来 |
| [Microsoft · Keyboard accelerators](https://learn.microsoft.com/windows/apps/design/input/keyboard-accelerators) | 常用快捷键表、在 tooltip 与菜单中显示快捷键、作用域、不覆盖控件默认行为、本地化 |
| [WAI-ARIA APG · Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | 组合控件一个 Tab 停靠点、roving tabindex / activedescendant、焦点与选中区分、禁用项可聚焦、快捷键选择与保留键 |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | 1.4.13 悬停 / 焦点内容、2.1.1 键盘、2.1.4 单字符快捷键、2.4.7 焦点可见、2.4.11 焦点不被遮挡、2.5.7 拖动替代、2.5.8 目标尺寸 24px |
| [NN/g · Timing Guidelines for Exposing Hidden Content](https://www.nngroup.com/articles/timing-exposing-content/) | 0.1s 内反馈、0.3–0.5s 意图判断、离开后 0.5s 宽限、斜向移动问题 |
| [NN/g · Drag–and–Drop](https://www.nngroup.com/articles/drag-drop/) | 把手与光标、拖动中反馈、以中心越界触发重排、放置区宽容、键盘拖动 |
| [NN/g · Data Tables](https://www.nngroup.com/articles/data-tables/) | 固定表头 / 首列、行悬停高亮、筛选可见、不只靠悬停露出行操作、详情用非模态侧边面板 |
| [CSS-Tricks · Interaction Media Features and Their Potential (for Incorrect Assumptions)](https://css-tricks.com/?p=320427) | `hover` / `pointer` 与 `any-*` 的区别、混合设备误判 |

## 2. 两个参考 skill 的核查结果（未安装）

### Anthropic `frontend-design`

- **来源**：Anthropic 官方 [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) 仓库的 `plugins/frontend-design/skills/frontend-design/SKILL.md`；也在 Anthropic 插件目录中以 Anthropic 发布者身份上架。只有一个 Markdown 文件，没有脚本、没有远程拉取、不申请工具权限。
- **内容**：为「新建或重塑 UI」提供有个性的视觉方向——先定 4–6 个命名色、字体与版式，避免模板化的 AI 审美，克制动效，质量底线（响应式、焦点可见、减少动态、对比度）。
- **取舍**：
  - 采用：质量底线；警惕 CSS 选择器优先级互相抵消；结构元素（编号、分隔线、标签）必须承载真实信息；文案以用户为中心、错误说明怎么修；悬停动画不要每张卡片都有。
  - **不采用**：重新定配色 / 字体 / 审美方向——Libevra 已有 7 套主题 token 与排版规范，且 S18-B §8 禁止自行生成最终布局与视觉方案。
  - **建议**：做 Libevra 开发时不要同时启用它，以免它要求另定视觉方向；若启用，需在任务里写明「视觉方向已固定，只用现有 token」。

### Vercel `web-design-guidelines`

- **来源**：[`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills)（MIT），规则正文在 [`vercel-labs/web-interface-guidelines`](https://github.com/vercel-labs/web-interface-guidelines)（MIT），网页版 [vercel.com/design/guidelines](https://vercel.com/design/guidelines)。
- **内容**：SKILL.md 本身只有一段流程——**每次运行都从 `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` 拉取最新规则**，再按 `文件:行` 格式输出审查结果。
- **取舍**：
  - 采用（已改写进本 skill）：键盘全可达、`:focus-visible`、命中区 24px、不禁用缩放与粘贴、加载延迟与最短显示、乐观更新、危险操作确认或撤销、tooltip 组内跳过延迟、`overscroll-behavior`、桌面自动聚焦、没有死区、拖动中禁选文字、手势有替代、链接就是链接、IME 之外的表单规则、动效只动 transform / opacity、Windows 滚动条、`tabular-nums`、状态不只靠颜色。
  - **不采用**：「Vercel 专属」部分（标题用 Title Case、用 & 代替 and 等文案风格）；APCA 对比度（本项目按 WCAG 与颜色规范执行）。
  - **不安装原因**：规则从 `main` 分支实时拉取、没有锁定版本——上游内容变动会直接改变 agent 的行为，且无法审计每次拿到的是什么；对本项目来说，把需要的规则改写进仓库、随代码一起审阅更可控。
