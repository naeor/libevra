# 页面规范 · 我的与设置

> 路由：`/me`（游客为 `GuestMePage`）、`/profile`、`/profile/avatar`、偏好 / 外观 / 安全 / 账号数据子页、`/downloads`、`/update` 及公告子页。
> 代码入口（相对 `apps/web/src/`）：`pages/` 下对应页面、`components/SettingsCard.tsx`、`components/ui/List.tsx`、`components/ThemePreview.tsx`、`components/PasswordField.tsx`、`components/TextField.tsx`、`components/LanguageSwitch.tsx`、`components/ui/ChoiceSheet.tsx`、`components/ui/InlineChoice.tsx`。

## 1. 决定状态

- 电脑端设置分类导航、轻分区及相关页面统一优化：**已批准实施**，依据 [S18-B §10.5](../../../../docs/specs/design/S18-B-跨设备自适应布局与交互-设计讨论记录-20261027.md#105-已批准实施)。视觉规则只定义于[布局间距与圆角规范 §16.2](../../../../docs/specs/design/布局间距与圆角规范.md#162-内容积木componentsuilisttsxcomponentsuirecordlisttsx)。触屏端及未确认的额外布局仍保持原样。

## 2. 电脑端要求

**设置列表**

- 可点的行：整行悬停高亮、焦点环；导航用右侧箭头，有明确动作名称时可在行尾显示动作。只读行（`FactRow`）**没有**悬停与按下态（[布局间距与圆角规范](../../../../docs/specs/design/布局间距与圆角规范.md) 已定）。
- 开关：Space 切换，点击标签同样切换；状态不只靠颜色（有文字或形状区别）。
- 单选 / 选择面板（`ChoiceSheet`、`InlineChoice`）：组合控件方向键移动，Enter / Space 选定，Esc 关闭并回到触发项。

**外观与主题**

- 主题预览卡片：悬停反馈、键盘可选、当前主题标识不只靠颜色；预览不因悬停自动切换全局主题（悬停只揭示、不承诺）。

**表单（资料、安全）**

- 每个控件有标签，点标签聚焦控件；错误贴着字段，提交时焦点移到第一个错误。
- 密码框允许粘贴，兼容密码管理器（正确的 `autocomplete`）；验证码 / 恢复码框允许粘贴整串。
- IME 组字时 Enter 不提交（昵称等可输入中文的字段）。

**危险操作（注销账号、清除数据）**

- 放在页面末尾的危险区；确认弹窗默认焦点在「取消」；需要输入确认文字时允许粘贴。
- 显示 / 可点判断不改（AGENTS §6）。

**下载与更新**

- 下载按钮是真实链接或明确的按钮，电脑端触发浏览器下载；文件名、大小、格式写清楚。
- 公告正文控制舒适行宽（[layout-density-window.md](../references/layout-density-window.md) §3），宽屏不横跨整个工作区。

**键盘快捷键一览（【候选】）**

- 如所有者确认要做快捷键，「我的 / 设置」里提供一览与单字符快捷键开关（WCAG 2.1.4），文案按平台显示 ⌘ / Ctrl。

## 3. 验证要点

- 只用键盘改一次主题、一次语言、一次偏好开关。
- 密码管理器（浏览器自带即可）能填充登录与改密码表单。
- 游客「我的」页的当前页标记问题（已登记 U10）在宽屏侧栏同样核对。
