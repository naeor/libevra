# 键盘、焦点与快捷键

> 上位：[SKILL.md](../SKILL.md) 规则 4、5。依据：WAI-ARIA APG「Developing a Keyboard Interface」、WCAG 2.2（2.1.1、2.1.4、2.4.3、2.4.7、2.4.11）、Microsoft Keyboard accelerators、Apple HIG Keyboards（见 [sources.md](sources.md)）。

## 1. 键盘可达【规范默认】

- **所有功能都能只用键盘完成**（WCAG 2.1.1）。鼠标能做的，键盘至少有一条路径（不一定是快捷键，可以是 Tab + Enter）。
- **Tab 顺序 = 视觉阅读顺序**：全局侧栏 → 主工作区 → 辅助工作区；区域内从上到下、从左到右。不用正数 `tabindex`。
- **组合控件只占一个 Tab 停靠点**，内部用方向键移动（roving tabindex 或 `aria-activedescendant`）：菜单、标签页、分段控件、工具栏、月份选择、分类网格、卡片网格、单选组。进入时的落点：已选中项（标签页、单选、列表），否则第一项（菜单、工具栏）；网格回到上次位置。
- **鼠标点击要同步键盘状态**：点了某项后，roving tabindex / `aria-activedescendant` 也要指向它，否则切回键盘时位置错乱。
- **区域跳转**：用地标（`<nav>`、`<main>`、带 `aria-label` 的 `<aside>` / `region`）和「跳到主要内容」链接。**不要用 F6**（Windows 原生应用用它切窗格，但浏览器用它把焦点移到地址栏）。双工作区之间的切换快捷键属于【候选】。

## 2. 焦点管理【规范默认】

- **焦点可见**（WCAG 2.4.7）：用 `:focus-visible`，鼠标点击不出焦点环；颜色用 `focus-ring` token（浅色主题的对比债务见 [input-and-hover.md](input-and-hover.md) §2）。
- **焦点不被遮挡**（WCAG 2.4.11）：粘性页头、`StickyActionBar`、底部栏、撤销条不能盖住获得焦点的元素 → 给滚动容器设 `scroll-padding-top` / `scroll-padding-bottom`，或给目标设 `scroll-margin`。
- **浮层**（对话框、面板、弹出菜单）：
  - 打开 → 焦点移入（第一个有意义的控件，或对话框标题）；
  - 模态 → 焦点圈在浮层内，背景 `inert`；
  - 关闭 → 焦点**回到触发它的元素**（已登记问题 U04：通用弹层缺统一焦点圈定与恢复）。
- **Esc 逐层**：每次只关闭最上面一层（子菜单 → 菜单 → 面板 → 退出选择模式），不要一次清空全部。
- **删除 / 移走当前项后**：焦点移到下一项（没有则上一项、再没有则列表容器），**绝不能掉到 `<body>`**。
- **页面切换**：路由变化后焦点移到新页面标题或 `<main>`；在辅助工作区里导航时，焦点留在辅助工作区。
- **自动聚焦**：桌面上页面只有一个主要输入时可以自动聚焦（如记账金额框）；手机上基本不要（会弹键盘）。具体页面是否这样做属于【候选】，见各 `pages/*.md`。

## 3. 标准按键语义【规范默认】

| 按键 | 含义 | 注意 |
|---|---|---|
| Enter | 激活按钮 / 链接；单输入框表单提交；列表里打开当前项 | 多字段表单不要让任意输入框里的 Enter 都提交；IME 见 §4 |
| Space | 按下按钮、切换复选框 / 开关；选择模式下切换当前行 | 不要拿 Space 做全局快捷键 |
| Esc | 关闭最上层浮层 / 取消拖动 / 退出编辑或选择模式 | 有未保存内容时先确认 |
| Tab / Shift+Tab | 在组件之间移动 | 不劫持 |
| ↑↓←→ / Home / End / PageUp / PageDown | 组合控件内部移动 | 在可滚动区域外不吞掉方向键 |
| Delete / Backspace | 删除选中对象（走确认或撤销） | **焦点在输入框时绝不触发** |
| Ctrl/⌘+A | 选中当前列表范围内全部（范围用文字说清） | 焦点在输入框时保持文字全选的原生行为 |
| Ctrl/⌘+C / X / V | 原生复制剪切粘贴必须一直可用 | 「复制所选账目」属于【候选】 |
| Ctrl/⌘+Z / Ctrl+Y 或 ⇧⌘Z | 撤销 / 重做 | 只在有应用级撤销的范围内接管（如工作台布局编辑），**输入框里保持原生** |
| Ctrl/⌘+F | 浏览器页内查找 | **不覆盖**；要做应用内搜索用别的组合 |
| 多行文本框 Enter / Ctrl(⌘)+Enter | Enter 换行，Ctrl/⌘+Enter 提交 | 例外：聊天式留言框沿用现有「Enter 发送、Shift+Enter 换行」，但必须加 §4 的输入法判断 |

## 4. 中文输入法（IME）【规范默认，必须】

Libevra 的主要用户用中文输入法。组字（拼音还没上屏）时按 Enter 是「把字母 / 候选上屏」，**不是提交**。

- 所有自写的 `keydown` 处理在判断 Enter（以及其它快捷键）之前先排除组字，统一用 `lib/desktopInput.ts`：
  ```ts
  if (event.key === "Enter" && !isImeComposing(event.nativeEvent)) submit(); // React 合成事件传 nativeEvent
  ```
  它同时看 `isComposing` 与 `keyCode === 229`；后者用于覆盖 Safari：它在上屏的那次 Enter 上报 `isComposing === false`。
- 单键或 Shift 组合快捷键在焦点位于 `input`、`textarea`、`select`、`[contenteditable]` 时一律不触发。
- **不要占用**：单独的 Shift（中文输入法中英切换）、Ctrl+Space / ⌃Space（切换输入法）、Ctrl+Shift（Windows 切换键盘布局）、Win+Space。
- 原生 `<form>` 的隐式提交在组字时不会触发，问题主要出在自写的 `onKeyDown`。1.18.10 已把当时仓库里全部 7 处（留言、引用留言、账本改名 / 新建、邀请查询、管理员搜索）改为上面的写法；新增处理照此办理。

## 5. 快捷键设计原则【规范默认】

- **少**：只给最常用的操作；快捷键是补充，不能替代正常导航（APG）。
- **可发现**：图标按钮的 tooltip 写成「删除（Delete）」；菜单项右侧显示；可选的「键盘快捷键」一览（入口位置属【候选】）。
- **作用域**：区域快捷键（如列表里 Delete 删除所选、编辑器里 Ctrl/⌘+Z）只在焦点位于该区域时生效；全局快捷键越少越好。Escape 等通用键由最内层先处理并阻止冒泡。
- **单字符快捷键**（字母、数字、标点，含 `?`）：WCAG 2.1.4 要求能关闭或重映射，或只在对应组件聚焦时生效。Libevra 默认**不做全局单字符快捷键**；若要做，必须同时提供设置开关（开关位置属【候选】）。
- **平台修饰键**：
  - macOS 用 ⌘ 为主、⇧ 为辅、⌥ 少用，避免 ⌃；显示顺序 ⌃ ⌥ ⇧ ⌘（如 `⇧⌘K`）。
  - Windows / Linux 用 Ctrl，显示为 `Ctrl+Shift+K`。避免 **Ctrl+Alt+字母**（在部分键盘布局里等于 AltGr，会打出字符）。
  - 平台判断只用于**显示和按键映射**：`navigator.userAgentData?.platform ?? navigator.platform`，不用于布局。
- **按键匹配**：助记型快捷键（S = Save）用 `event.key`（大小写归一）；位置型或带 ⌥ 的组合用 `event.code`（macOS 上 ⌥+字母会产生特殊字符，`event.key` 不可靠）。
- **自动重复**：按住不放会重复触发；对删除、提交等操作要防抖或忽略 `event.repeat`。
- **本地化**：快捷键显示文字走 i18n 资源；修饰键符号按平台、不按语言。

## 6. 保留键（不得占用）

| 来源 | 不要占用 |
|---|---|
| 浏览器（多数网页拦不住，或用户强依赖） | Ctrl/⌘+T、W、N、⇧T、⇧N、⇧W、Tab、⇧Tab、L、D、H、J、R、P、F、G、0、+、−、1–9；F1、F3、F5、F6、F7、F11、F12；Alt+←/→、⌘+[ / ]；Ctrl/⌘+⇧+I / J / C / Delete；Ctrl+滚轮 |
| 操作系统 | Win+任意键、Alt+Tab、Alt+F4、Ctrl+Alt+Del；⌘Space、⌘Tab、⌘Q、⌘H、⌘M、⌘\`、⌃F1–F7；任何修饰键 + Tab / Enter / Space / Esc |
| 输入法 | 单独 Shift、Ctrl+Space / ⌃Space、Ctrl+Shift、Win+Space |
| 读屏与辅助技术 | Insert+任意键、CapsLock+任意键、⌃⌥+任意键（VoiceOver） |

「有意覆盖」浏览器快捷键只在三者同时成立时考虑：功能与浏览器功能相近且常用；用户很少需要浏览器那个功能；浏览器功能另有便捷路径（APG）。例如很多网页应用把 Ctrl/⌘+K 用作搜索 / 命令面板，浏览器允许页面拦截——但 Libevra 目前没有命令面板，这本身是新功能决定。

## 7. 候选快捷键【候选 C-06，待所有者确认后才实现】

确认前**不实现任何全局快捷键**；下列区域内的标准按键（§3）可以直接按规范默认实现。

| 操作 | 建议 | 说明 / 需要核查 |
|---|---|---|
| 记一笔（打开五种记账方式） | 侧栏「记一笔」按钮可聚焦 + 一个全局组合（待选） | 不建议 Ctrl/⌘+N（浏览器新窗口，标签页里拦不住）；候选组合需在 Chrome / Edge / Firefox / Safari、标签页与 PWA 窗口、中文输入法开启时逐一核查 |
| 搜索 / 命令面板 | Ctrl/⌘+K | 前提是先决定要不要做命令面板（新功能） |
| 列表内导航 | ↑↓ 移动、Enter 打开、Space 选择、Ctrl/⌘+A 全选、Esc 清空、Delete 删除所选 | 需要把明细列表改为组合控件（roving tabindex），见 [pages/entries.md](../pages/entries.md) |
| 布局编辑器撤销 / 重做 | Ctrl/⌘+Z、Ctrl+Y / ⇧⌘Z | 编辑器已有撤销历史（`editOrigins.ts`），只在编辑态生效 |
| 表单保存 | Ctrl/⌘+Enter | 记账表单、交易编辑；见 [pages/capture.md](../pages/capture.md) |
| 快捷键一览 | `?`（需设置开关）或放在「我的 / 设置」 | 受 WCAG 2.1.4 约束 |
