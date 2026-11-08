# S19 · 移动端次级页面 Push / Pop 转场适配性审查

> 审查日期：2026-11-07。依据为本机工作区实际源码，包含未提交内容；不是只审查 HEAD。项目版本及阶段仍以 [STATUS](../../STATUS.md) 为唯一出处。
> 本文是所有者要求的审查与候选方案，**未实施转场，未修改产品代码、样式、路由、配置或依赖**。底部 Tab 实验动效仍由原开发任务负责。
> 证据分为「代码确认」「静态推演」「待动态验证」。本轮未运行浏览器、iOS 真机或生产环境；不能把可行性判断当成体验验收。

**结论：适合建立按导航关系启用的移动端转场层，不适合给所有路由统一加侧滑。** 普通阅读与设置子页是优先候选；主导航、页内状态、浮层、已有专属交互分别保留。建议首期只试点本文 §6 的三条路径。最大的接入风险是返回语义与滚动恢复，其次是透明材质和连续操作，并非滑动曲线本身。

## 1. 当前导航和动画架构

### 1.1 路由、工作区与响应式分支

代码确认：

- [App.tsx](../../../apps/web/src/App.tsx) 的 `AppRoutes`（260 行起）使用声明式 `<Routes>/<Route>`；本次提取到 79 个路由声明，包含兼容跳转、通配兜底和条件启用的图表实验页。没有使用 `createBrowserRouter` / `RouterProvider` 数据路由。
- 手机、Pad 走 `WorkspaceShell`。每个工作区由 [PaneRouter.tsx](../../../apps/web/src/workspace/PaneRouter.tsx) 的 `PaneRouter` 提供独立 `<Router>`，通过 `startTransition(setSnapshot)` 接收 [paneHistory.ts](../../../apps/web/src/workspace/paneHistory.ts) 的 `PaneHistory`。这里的 React `startTransition` 是更新调度，**目前并不产生页面动画**。
- `PaneHistory` 主区绑定浏览器 `{ usr, key, idx }`；辅助区维护内存历史。`go`、`adopt`、`handlePop`、`takeOver` 处理刷新、浏览器返回、工作区晋升；`linked` 区分是否能真实后退浏览器历史。其 `serialize` 只保存路径和 key，**不保存页面 state、组件状态或 DOM**。
- `WorkspaceShell` 内外都有 `PaneRouter`：外层供全局外壳使用，内层供具体实例使用（1018、1147 行）。未来只能在一个选定的手机路由提交位置协调动画，不能每个 Router 都启动一次。
- 桌面走 [DesktopShell.tsx](../../../apps/web/src/desktop/DesktopShell.tsx) 的 `BrowserRouter`、`DesktopRoutes`、`DesktopSection`；总览 `/dashboard`、明细和分析有专门实现，其余复用业务页面。`/dashboard` 不是手机主导航页。
- [shellKind.ts](../../../apps/web/src/desktop/shellKind.ts) 的 `shellKindFor` 根据输入能力、宽高、迟滞及用户覆盖选桌面外壳；[geometry.ts](../../../apps/web/src/workspace/geometry.ts) 的 `shellModeFor` 用 700×520 CSS px 下限选 `phone/wide`。这些是外壳条件，不是按型号识别手机。Pad 的窄辅助区仍是 `wide`，不能仅凭内容区宽度启用手机动画。
- `WorkspaceShell` 会把受支持的详情入口送入跟随辅助区，保留主区；桌面也可能将账目或分析详情作为右侧面板。**同一个详情 URL 不能代表固定的全屏层级。**

手机启用条件应沿用实际外壳：非桌面、`pane.shell === "phone"`、主区、底部导航模式、当前实例可见。旋转或窗口变化退出条件时立即结束视觉动画，不迁移业务历史。Pad 单区与双区、桌面宽窗与窄窗均不在首期范围。

### 1.2 页面容器及滚动并不统一

| 容器 | 已确认的实现 | 对统一转场的约束 |
|---|---|---|
| `TabPage` / `MobileTabPage` | [Layouts.tsx](../../../apps/web/src/components/Layouts.tsx) 175–250 行：`h-dvh`、中部独立滚动、底部导航为 flex 同级；编辑分析时可换为卡片抽屉 | Tab 之间不侧滑；进入子页时，来源页的底栏可以作为来源画面的一部分被覆盖 |
| `InnerPage` / `MobileInnerPage` | 同文件 305–396 行：`min-h-full`，`PageNavBar` sticky，正文自然增长；手机外层没有统一内滚动容器 | 不能把所有页面都当作 `scrollTop` 在同一个 div 上；手机普通子页须考虑文档滚动 |
| 明细 `/` | [DetailPage.tsx](../../../apps/web/src/pages/DetailPage.tsx) 自建框架，`useDetailTransition` 绑定专用 scroller | `--p`、摘要高度、日期位置、补偿区与滚动恢复互相关联，不能被新包装层改变 |
| 展示卡片编辑器 | [DetailCardEditor.tsx](../../../apps/web/src/components/ledger/DetailCardEditor.tsx) 与 [detail-card-editor.css](../../../apps/web/src/components/ledger/detail-card-editor.css)：上部导航、预览固定，仅目录滚动 | 不是普通 `InnerPage`；不能只滑动目录或只滑动预览 |
| 全屏留言 | [MessageBoard.tsx](../../../apps/web/src/components/MessageBoard.tsx) 的 `MessageBoardFull`（624、661 行起）：顶栏、消息 scroller、底部输入区 | 键盘、跟随末尾滚动和引用聚焦是单独契约 |
| 工作区盒子 | [workspace.css](../../../apps/web/src/workspace/workspace.css) 18–22 行：手机 `.lv-shell/.lv-area/.lv-pane/.lv-pane-scroll` 为 `display: contents`；Pad 盒子有 containment、isolation 和独立滚动 | **不能直接给手机 `.lv-pane-scroll` 加 transform，或假定它能被命名捕获为一个完整矩形** |

普通页面更换会卸载原路由页面；没有全站页面保活栈，也没有全站 `ScrollRestoration` 接入。TanStack Query 的数据缓存不等于表单草稿、展开状态或滚动位置的恢复。

### 1.3 已有状态保存

- 明细：[detailTransition.ts](../../../apps/web/src/lib/detailTransition.ts) 的 `sessions/readSession/writeSession/useDetailTransition` 按工作区实例保存月份、收支、搜索、展示参数、`progress`、`scrollTop` 等；保存在模块内存中，刷新不保留。`DetailPage` 133–230、588 行接线，卸载时再记录滚动。这个缓存不是按每个 history key 建立的页面栈。
- 分析：[StatsPage.tsx](../../../apps/web/src/pages/StatsPage.tsx) 的 `openCard`（809 行）把筛选参数传到详情，并记 `returnPoint`；285 行 effect + rAF 恢复滚动和卡片焦点。`returnPoint` 是一份模块变量，按 `accountScope` 检查，**不是逐工作区、逐历史条目的通用恢复仓库**。
- 草稿各自管理：资料/头像使用 `useDraftExit`，账目详情编辑登记 `usePaneDirty`；展示卡片编辑器自管 dirty、确认框与 `beforeunload`；分析编辑、导入、识别有各自状态。不能用“多留一份旧页面”替代这些规则。

### 1.4 本机依赖与审查边界

[apps/web/package.json](../../../apps/web/package.json)、[pnpm-lock.yaml](../../../pnpm-lock.yaml) 与本机安装包核对：React **19.3.0**、React DOM **19.3.0**、React Router **8.4.0**；本机 React 确实导出 `ViewTransition`。项目没有引入专门的页面动效库，现有视觉效果以 CSS、rAF、原生滚动及少量 WAAPI 为主。

旧导航规格仅用于了解约束；其路由数量、旧入口描述不作为本轮事实来源。这里不顺手修历史性注释或重审业务模块。

## 2. 页面转场适配清单

### 2.1 表格读法

以下每一项同时考察入口与用途，不能据此建立“URL 越长层级越深”的算法。

- **H(兜底)**：默认 `useGoBack`。有字符串 `state.from` 时 `navigate(from)`，否则 key 非 `default` 时 `navigate(-1)`，否则 `replace(兜底)`；还含连续返回保底。
- **P(兜底)**：`useGoBack(..., "parent")`。忽略 `state.from`，key 非 `default` 时后退，否则 replace 兜底。名称叫 parent，但**没有校验上一条是否真是父页**。
- **ER**：账目专用 `useEntryReturn/entryBackTarget`，规则详见 §4。
- **无页动效**：没有发现整页进入/退出动画；不表示按钮、标题、加载态和浮层毫无动画。
- **共用**：手机与 Pad 复用页面；桌面可换框架、情境栏目或面板，不采用本报告的全屏侧滑。特殊情况另写。
- **A 候选**：语义适合 Push/Pop，但必须满足来源与恢复条件；不等于本轮批准实施。A、B、C、D、E 对应用户提出的五类。

### 2.2 主入口、工作区及页内状态

| 页面名称 | 路由 / 状态 | 实际入口 | 职责 | 现有返回 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 明细 | `/` | 底部明细、保存完成、进入账本 | 主列表/查看 | 主入口无层级返回 | 摘要收起、搜索展开、卡片退场 | 手机/Pad 共用；桌面专用明细 | E：即时主切换，保留 B/C | `DetailPage`；本身是工作区根 |
| 分析 | `/stats` | 底部分析 | 主工作台 | 主入口无层级返回 | 页内筛选、抽屉、轮播、网格交互 | 桌面专用承载，Pad 容器排布 | E：即时主切换 | `StatsPage`；编辑态不是新一级路由 |
| 记账入口 | 中央 `+` 的 open 状态 | 五入口中央按钮 | 选择记账方式 | 再点/到达其他页面收起 | 保留挂载的菜单位移/透明度、加号旋转、留位高度 | Pad/桌面是侧栏入口 | C/D：局部菜单 | [BottomNav.tsx](../../../apps/web/src/components/BottomNav.tsx) 136–141、227–253、539–588 行；按钮本身不导航 |
| 手动记账 | `/add` | 菜单手动、复制账目、识别页改手动 | 创建/连续录入 | `TabPage` 无左上角返回；保存结果可到 `/` | 录入局部交互、成功状态、选择浮层 | 共用，桌面捕获区布局不同 | E/任务：保持原样 | [AddEntryPage.tsx](../../../apps/web/src/pages/AddEntryPage.tsx) 600、655 行；不能因 `/add` 是新 URL 就强加 Pop |
| 账本/协作 | `/ledger` | 登录用户底部第四项 | 当前账本协作中心 | 主入口无层级返回 | `Section` 短入场、标题收缩、浮层 | 桌面协作栏目/分栏 | E：即时主切换 | [LedgerPage.tsx](../../../apps/web/src/pages/LedgerPage.tsx)；不是所有 `/ledger/*` 的同一业务父级 |
| 我的 | `/me` | 底部第五项 | 个人中心 | 主入口无层级返回 | 标题收缩、通知展开 | 共用；游客 `GuestMePage` | E：即时主切换 | [MePage.tsx](../../../apps/web/src/pages/MePage.tsx) 31、67–92 行 |
| 账本空间 | `/start`，展示态/列表态 | 我的账本无目标兜底、账本页“空间”、游客第四项、切换/管理入口 | 选择/进入账本 | 自身展示/列表状态转换；进入账本到 `/` | 海浪与 `useSpaceTransition` 弹簧、`--p` | Pad/桌面账本管理不同；游客此处是主入口 | B/E：保留 | [LedgerSpacePage.tsx](../../../apps/web/src/pages/LedgerSpacePage.tsx)、[spaceTransition.ts](../../../apps/web/src/lib/spaceTransition.ts)；不是普通设置子页 |
| 辅助区起始页 | `/workspace/start` | Pad 辅助区；手机深链可匹配 | 工作区导航起点 | 选择主目的地 | 无页动效 | 手机没有常规入口 | 保持原样 | [WorkspaceStartPage.tsx](../../../apps/web/src/pages/WorkspaceStartPage.tsx)；不纳入手机默认层级 |
| 分析卡片详情 | `/stats/cards/:objectId` + 筛选 query | 分析 `openCard` | 查看指标解释/来源账目 | H(`/stats` + 同 query) | 无整页专属动效 | Pad 跟随详情；桌面直接面板 | A 候选，后续 | [StatsCardDetailPage.tsx](../../../apps/web/src/pages/StatsCardDetailPage.tsx) 46–64 行；先验证 `returnPoint` 与数据加载 |
| 分析编辑、卡片配置、布局预设 | `/stats` 内 session/editor/presetsOpen | 工作台编辑、抽屉项目 | 配置/选择 | 取消/保存/面板内返回，不一定导航 | 抽屉高度、局部滑页、网格拖动 | 共用逻辑，桌面面板不同 | C/D/B：保留 | `StatsPage` 237、871、1114、1155 行；[CardEditor.tsx](../../../apps/web/src/statsWorkbench/CardEditor.tsx)、[PresetSheet.tsx](../../../apps/web/src/statsWorkbench/PresetSheet.tsx) |

### 2.3 我的、设置、更新及下载

| 页面名称 | 路由 / 状态 | 实际入口 | 职责 | 现有返回 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 设置首页 | `/settings` | 我的设置 | 分类导航 | H(`/me`) | 无页动效 | 共用；桌面分类导航 | A：Push/Pop | [SettingsPage.tsx](../../../apps/web/src/pages/SettingsPage.tsx) 54–55 行；明确深入一层 |
| 记账偏好 | `/settings/preferences` | 设置首页 | 偏好配置 | H(`/settings`) | 开关/选择器局部 | 共用 | A；控件 C/D | [SettingsSubPages.tsx](../../../apps/web/src/pages/SettingsSubPages.tsx) `PreferencesPage` |
| 外观分类兼容页 | `/settings/appearance` | 保留路由/深链；首页已直接列主题、语言 | 分类导航 | H(`/settings`) | 无页动效 | 共用 | A 条件候选 | `AppearancePage` 98–120 行；不能把它写成当前设置必经页 |
| 外观与主题 | `/settings/appearance/theme` | 设置首页；兼容外观分类页 | 主题配置 | H(`/settings`) | 主题选项即时变化 | 共用；实验风格只影响手机浅色 | A；切主题 C | [ThemeAppearancePage.tsx](../../../apps/web/src/pages/ThemeAppearancePage.tsx) 128 行；进入页与修改主题是两种事件 |
| 语言 | `/settings/appearance/language` | 设置首页；兼容外观分类；游客我的 | 语言选择 | H(`/settings`)，有历史会回真实来源 | 选择即时生效 | 共用；游客可入 | A：入口分别识别 | [LanguagePage.tsx](../../../apps/web/src/pages/LanguagePage.tsx) 86 行、[GuestMePage.tsx](../../../apps/web/src/pages/GuestMePage.tsx) 144 行；游客深链兜底需另验 |
| 账号安全 | `/settings/security` | 设置首页 | 安全功能导航 | H(`/settings`) | 无页动效 | 共用 | A 候选，首期排除子链 | `SettingsSubPages.SecurityPage` 向子页写 `from`，有 §4 风险 |
| 更改密码 | `/settings/password` | 账号安全 | 账号操作 | H(`/settings`)，正常入口的 `from` 为安全页 | 无页动效 | 共用 | A 语义，暂缓 | [ChangePasswordPage.tsx](../../../apps/web/src/pages/ChangePasswordPage.tsx) 54 行；先解决或隔离已有返回风险 |
| 恢复码 | `/settings/recovery-code` | 账号安全；个人资料 | 生成/展示恢复码 | H(`/settings`)；结果“继续”直接 navigate 设置 | 无页动效 | 共用 | A 语义，暂缓 | [RegenerateRecoveryCodePage.tsx](../../../apps/web/src/pages/RegenerateRecoveryCodePage.tsx) 51–62 行；来源与完成目标不同 |
| 账号邀请码 | `/settings/referral-codes` | 账号安全 | 邀请额度/生成 | H(`/settings`)，`from` 可覆盖 | 无页动效 | 共用 | A 语义，暂缓 | [ReferralCodePage.tsx](../../../apps/web/src/pages/ReferralCodePage.tsx) 29 行；不是账本邀请页 |
| 账号与数据 | `/settings/account-data` | 设置首页 | 账号/数据生命周期任务 | H(`/settings`)；操作后也可能 replace `/` 或本页 | 确认框、任务状态 | 共用 | A 外层候选；任务 D/即时 | [AccountDataPage.tsx](../../../apps/web/src/pages/AccountDataPage.tsx) 280–293 行；首期不碰生命周期流程 |
| 个人资料 | `/profile` | 我的个人资料 | 查看/局部编辑 | 非编辑态 **push `/me`**；编辑态先 `finish()` 退出编辑 | 局部字段展开、账号面板 | 共用 | A 外层候选，暂缓 | [ProfilePage.tsx](../../../apps/web/src/pages/ProfilePage.tsx) 59–88 行；点击返回不一定离页 |
| 资料编辑状态 | `/profile?edit=1` | 资料“编辑” | 就地编辑 | `setParams({}, { replace:true })`，可能先确认丢弃 | 局部字段展开 | 共用 | C：局部 | 同文件 `finish/openField`；query 改变不代表 Push |
| 头像选择 | `/profile/avatar` | 编辑资料的头像 | 独立选择/保存 | `leave()` **replace `/profile?edit=1`**；dirty 先确认 | 预览/备注局部，无页动效 | 共用 | A 条件候选，后续 | [AvatarPickerPage.tsx](../../../apps/web/src/pages/AvatarPickerPage.tsx) 69、83–90 行 |
| 下载管理 | `/downloads` | 我的 | 查看离线下载 | H(`/me`) | 进度与选择局部 | 共用；当前账本限制 | A：Push/Pop | [DownloadManagerPage.tsx](../../../apps/web/src/pages/DownloadManagerPage.tsx) 125、241 行 |
| 月份下载 | `/downloads/:month` | 下载管理月份行 | 单月管理 | H(`/downloads`)；另有按钮 navigate 下载首页 | 无页动效 | 共用 | A 候选 | [MonthDownloadPage.tsx](../../../apps/web/src/pages/MonthDownloadPage.tsx) 110、268 行；返回按钮与完成按钮分开处理 |
| 下载更多 | `/downloads/more` | 下载管理更多 | 缓存/设备维护 | 自定义 **replace `/downloads`** | 确认框 | 共用 | A 外形，后续 | [DownloadMorePage.tsx](../../../apps/web/src/pages/DownloadMorePage.tsx) 241–250 行；replace 不等于向下进入 |
| 软件更新 | `/update` | 我的；关于中的更新链接 | 查看更新/公告入口 | H(`/me`) | 内容/更多浮层 | 共用 | A：入口分别识别 | [SoftwareUpdatePage.tsx](../../../apps/web/src/pages/SoftwareUpdatePage.tsx) 97、145–175 行 |
| 公告列表 | `/update/announcements` | 软件更新“全部” | 查看列表 | H(`/update`) | 无页动效 | 共用 | A：Push/Pop | [UpdateAnnouncementsPage.tsx](../../../apps/web/src/pages/UpdateAnnouncementsPage.tsx) 38、53 行 |
| 公告详情 | `/update/announcements/:version` | 公告列表；更新首页最新/历史摘要；详情前后篇 | 查看 | H(`/update/announcements`)；另有列表 Link | 无页动效 | Pad 可跟随打开；桌面复用 | 列表/摘要→详情 A；前后篇即时同级 | [UpdateAnnouncementDetailPage.tsx](../../../apps/web/src/pages/UpdateAnnouncementDetailPage.tsx) 72、120–134 行；同一组件不一定是更深一层 |
| 运行环境 | `/update/runtime` | 更新更多浮层 | 诊断查看 | H(`/update`) | 无页动效 | 共用 | A 候选 | [UpdateRuntimePage.tsx](../../../apps/web/src/pages/UpdateRuntimePage.tsx) 63 行；浮层先关闭，不能两套动画叠加 |
| 关于 | `/about` | 设置首页；开始页页脚 | 说明 | H(`from ?? /settings`)；开始页写 `from=/start` | 无页动效 | 共用 | A 语义，暂缓跨入口 | [AboutPage.tsx](../../../apps/web/src/pages/AboutPage.tsx) 34 行、`LedgerSpacePage` 731 行；来源 push 风险 |
| 隐私 / 服务条款兼容页 | `/legal/privacy`、`/legal/terms` | 关于；开始页页脚 | 阅读 | H(`from ?? /settings`) | 无页动效 | 共用 | A 条件候选 | [LegalPage.tsx](../../../apps/web/src/pages/LegalPage.tsx) 54 行；从关于进入未写 `from`，与页脚入口不同 |

### 2.4 账本与协作

| 页面名称 | 路由 / 状态 | 实际入口 | 职责 | 现有返回 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 账本详情 | `/books/:bookId` | 我的账本、协作账本卡、账本管理面板 | 查看指定账本 | H(`/start`)；有历史回实际入口 | 无页动效 | Pad 跟随；桌面账本主/辅栏 | A：按实际入口 | [BookDetailPage.tsx](../../../apps/web/src/pages/BookDetailPage.tsx) 56 行；不是自动进入/切换当前账本 |
| 账本详情切换目标 | 同页替换 `bookId` | 页头账本选择器 | 更换查看对象 | replace 同类 URL，保留原历史前驱 | 选择 Sheet | 共用 | D 后即时同级切换 | 同文件 169–178 行；不加一层、不静默改当前账本 |
| 全部附件 | `/books/:bookId/attachments` | 账本详情附件摘要 | 列表/预览 | H(`/books/:bookId`) | 预览浮层/面板 | 手机弹层、桌面侧预览 | A 外层；预览 D | [AttachmentsPage.tsx](../../../apps/web/src/pages/AttachmentsPage.tsx) 25、45 行；附件→账目另见 §2.5 |
| 账本设置 | `/books/:bookId/settings` | 账本详情；协作齿轮；空间管理；账号数据入口 | 指定账本配置 | P(`/books/:bookId`) | 无页动效；改名/生命周期确认局部 | 共用；桌面栏目 | A 候选 | [BookSettingsPage.tsx](../../../apps/web/src/pages/BookSettingsPage.tsx) 248 行；真实上一页不总是账本详情 |
| 账本设置换目标/改名 | `bookId` replace；`?rename=1` 或局部编辑 | 设置选择器、空间管理重命名 | 切目标/编辑字段 | 留在设置；操作完成按业务规则 | Sheet/输入区 | 共用 | C/D/即时 | `BookSettingsPage` 195 行；query/目标变化不侧滑 |
| 分类管理 | `/books/:bookId/settings/categories` | 账本设置；游客我的；旧地址跳转 | 查看/维护分类 | H(`/books/:bookId/settings`) | 层级展开、确认浮层 | 共用；游客分支 | A 外层；树与编辑 C/D | [ManagePages.tsx](../../../apps/web/src/pages/ManagePages.tsx) `CategoriesPage` / 352、420 行 |
| 标签管理 | `/books/:bookId/settings/tags` | 账本设置；游客我的；旧地址 | 查看/维护标签 | H(`/books/:bookId/settings`) | 局部编辑/确认 | 共用 | A 外层，C/D 操作 | `ManagePages` 896、944 行 |
| 支付方式 | `/books/:bookId/settings/payment-methods` | 账本设置；游客我的；旧地址 | 查看/维护支付方式 | H(`/books/:bookId/settings`) | 局部编辑/确认 | 共用 | A 外层，C/D 操作 | `ManagePages` 635、692 行 |
| 全账本重复检查 | `/books/:bookId/settings/duplicates` | 账本设置 | 扫描/查看候选 | H(`/books/:bookId/settings`) | 进度、结果局部 | 共用 | A 语义，暂缓任务页 | [DuplicateReviewPage.tsx](../../../apps/web/src/pages/DuplicateReviewPage.tsx) 116、233 行；任务状态与账目链接要另验 |
| 当前账本成员 | `/ledger/members` | 协作成员区 | 查看/管理成员 | H(`/ledger`) | 成员操作/确认 | 共用；桌面栏目 | A：Push/Pop | [LedgerSubPages.tsx](../../../apps/web/src/pages/LedgerSubPages.tsx) 87、109 行；没有独立 `/members/:id` 页面 |
| 当前账本邀请 | `/ledger/invite` | 协作快速邀请；成员页 | 邀请任务 | 顶栏 H(`/ledger`)；页底 Link 固定到 `/ledger` | 表单/结果局部 | 共用 | A：区分两种入口与两种退出 | [LedgerInvitePage.tsx](../../../apps/web/src/pages/LedgerInvitePage.tsx) 125、282 行；从成员进入顶栏回成员，页底链接是业务捷径 |
| 编辑历史 | `/ledger/history` | 协作“全部记录”；账目已删除状态入口等 | 事件阅读 | H(`/ledger`) | 无页动效；事件筛选局部 | 桌面可分栏 | A 外层候选；账目跳转暂缓 | [LedgerHistoryPage.tsx](../../../apps/web/src/pages/LedgerHistoryPage.tsx) 28 行、[HistoryList.tsx](../../../apps/web/src/components/HistoryList.tsx) 148 行 |
| 完整留言 | `/ledger/messages`，可带 quote | 协作留言展开；账目/事件引用入口 | 阅读/发送 | `MessageBoardFull` 用 H(`/ledger`)；加载错误是普通 `<a>` | 自管消息滚动/键盘 | 桌面分栏，Pad 自己的工作区 | A 语义，首期排除 | 全屏是已确认要求，不改成 Sheet；草稿和聚焦先验 |
| 指定账本成员 | `/start/book/:bookId/members` | 账本空间管理面板 | 管理指定账本 | H(`/start`) | 局部成员操作 | 共用 | A 外层候选，邀请跳转暂缓 | [StartBookPages.tsx](../../../apps/web/src/pages/StartBookPages.tsx) 78、103–107 行：邀请链接是 `<a href="/ledger/invite">`，没有目标 bookId |
| 指定账本分享 | `/start/book/:bookId/share` | 账本空间管理面板 | 分享配置 | H(`/start`) | 分享控件局部 | 共用 | A 外层候选 | `StartBookSharePage` 137 行；不能由前缀推断它是账本详情的子层 |
| 接受分享邀请 | `/join/:token` | 外部分享链接、登录后 next | 加入任务 | H(`/`)；加入/已有成员操作可进入 `/start` | 任务状态 | 共用；允许登录后回原链接 | 保持原样 | [JoinPage.tsx](../../../apps/web/src/pages/JoinPage.tsx)；外部入口不是应用内 Push 父子关系 |

### 2.5 账目详情：同页不同来源

以下均为 `/transactions/:id`，不得合并成一个固定“返回明细”的导航关系。独立详情中的“编辑”也是**本页状态**，不是新的编辑路由。

| 页面/入口情形 | 路由 / 状态 | 实际入口 | 职责 | 现有返回 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 明细→账目 | `/transactions/:id` | 明细行 `onActivate` | 查看/编辑 | ER，匹配 key+完整路径后 pop 来源 | 路由本身未找到共享元素动画 | Pad 可拦截到辅助；桌面 panel | 首期保留；之后按入口互斥选择 | `DetailPage` 1072–1101 行；带 `entryReturnState(location)` |
| 搜索结果→账目 | 同上 | 明细搜索结果中的同一行组件 | 查看搜索命中 | ER 回原明细；搜索由会话缓存恢复 | 搜索有专属展开/收起，非独立搜索页 | 手机/Pad 共用搜索；桌面不同 | 首期保留 | `DetailPage` 145–208 行；不得把来源简化成裸 `/` |
| 分析→账目 | 同上 | 分析卡片详情的 `SourceEntries` | 下钻到事实 | ER 回带筛选的卡片详情；之后再回分析 | 路由无页动效 | Pad/桌面可面板 | 首期保留；以后可 A 条件适配 | [SourceEntries.tsx](../../../apps/web/src/statsWorkbench/SourceEntries.tsx) 64 行；`entryOrigin` 白名单允许 `/stats/cards/:id` |
| 编辑记录→账目 | 同上 | `HistoryList` 行 | 查看事件对应账目 | ER 回 `/ledger/history`；嵌在协作时来源为 `/ledger` | 路由无页动效 | 共用历史组件/不同承载 | 首期保留；以后可 A 条件适配 | `HistoryList` 148 行真实记录当前 location，并非固定历史页 |
| 账本提醒→账目 | `/transactions/:id?book=...` | 账本铃铛对话框 | 查看被修改账目 | **没有 entryOrigin，ER 兜底 `/`** | 原入口是原生 dialog | Pad/桌面显示目标账本 | 保持原样，先验来源 | [BookNotificationBell.tsx](../../../apps/web/src/components/BookNotificationBell.tsx) 58 行；关闭提醒后 Link，不得声称返回提醒 |
| 附件关联→账目 | `/transactions/:id?book=...` | 全部附件中的关联账目 Link | 关联查看 | **没有 entryOrigin，ER 兜底 `/`** | 附件预览另有浮层 | 共用/桌面侧预览 | 保持原样，先验来源 | `AttachmentsPage` 45 行 |
| 重复候选→账目 | `/transactions/:id` | 全账本重复检查结果 | 核对 | **没有 entryOrigin，ER 兜底 `/`** | 结果局部 | 共用 | 保持原样 | `DuplicateReviewPage` 233 行；不能假定回检查结果 |
| 账目→其他账目 | `/transactions/:otherId` | 详情即时重复检测结果 | 横向查看 | 新 navigate 没有来源，ER 兜底 `/` | 同组件数据切换 | 共用 | 即时同级；不做层层 Push | [EntryDetailPage.tsx](../../../apps/web/src/pages/EntryDetailPage.tsx) 788 行；白名单刻意拒绝账目互为来源 |
| 深链/新标签/刷新 | `/transactions/:id`，可带 book | 地址栏/新标签/浏览器恢复 | 直接查看 | 无有效来源 replace `/`；刷新保留且匹配来源时才后退 | 不存在可保证的旧页面画面 | 手机/Pad/桌面条件不同 | 初次进入即时 | ER 有刷新浏览器 index 校验；不凭空生成父页快照 |
| 详情编辑状态 | `editing=true` | 详情“修改” | 修改 | 顶栏先 `setEditing(false)`；保存/删除成功 **navigate(`/`)** | 表单/确认局部 | 桌面操作位置不同；Pad dirty 登记 | C/D；完成即时或业务指定视觉 | `EntryDetailPage` 372、392、465 行；保存/删除不是 ER 返回 |

### 2.6 记账任务、导入导出

| 页面名称 | 路由 / 状态 | 实际入口 | 职责 | 现有返回 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 明细更多 | `/ledger/more` | **明细**工具按钮 | 展示卡片/导出/维护入口 | H(`/`) | 无页动效 | 共用；当前账本限制 | A 候选 | [LedgerMorePage.tsx](../../../apps/web/src/pages/LedgerMorePage.tsx)；尽管 `/ledger` 前缀，父语义是明细 |
| 编辑展示卡片 | `/ledger/cards` | 明细摘要编辑；明细更多 | 独立配置任务 | P(`/ledger/more`)；dirty 先确认；保存 replace `/` | 固定预览和局部选卡；未发现整页展开动画 | 手机/Pad 共用自定义框架 | 首期保留；后续 A 条件适配 | `DetailCardEditor` 43–55 行；两种进入，一种明确保存目标 |
| 拍照/照片识别 | `/scan` | 记账菜单、明细选图后直达 | 识别任务 | H(`/`)；保存/完成到 `/`，批次到概览 | 识别进度、预览、选择浮层 | 桌面文案/捕获区不同；当前账本限制 | 保持任务行为 | [ScanPage.tsx](../../../apps/web/src/pages/ScanPage.tsx) 302、352、518 行 |
| 录音 | `/record` | 记账菜单 | 采集语音 | H(`/`)；识别到 `/voice/review` | `VoiceRipples` 连续动效 | 共用，设备能力不同 | 保留 B/任务 | [RecordPage.tsx](../../../apps/web/src/pages/RecordPage.tsx) 102、244 行；不得快照后保活第二套录音实例 |
| 文本识别 | `/paste` | 记账菜单 | 输入/识别文字 | H(`/`)；到 `/paste/review` | 输入/状态局部 | 共用 | 保持任务行为 | [PastePage.tsx](../../../apps/web/src/pages/PastePage.tsx) 120、202 行 |
| 语音核对 | `/voice/review` | 录音成功 | 核对/写入 | H(origin=`/record`)；完成 `/` 或再次录音 | 结果/成功状态 | 共用 | 暂缓；内部 C/D | [VoiceReviewPage.tsx](../../../apps/web/src/pages/VoiceReviewPage.tsx) 286–327 行；临时草稿不是通用导航状态 |
| 文本核对 | `/paste/review` | 文本识别成功 | 核对/写入 | H(origin=`/paste`)；完成 `/` 或再次识别 | 同上 | 共用同一组件 | 暂缓；内部 C/D | 同上；不得按共享组件误判两个来源相同 |
| OCR 概览 | `/ocr/overview` | 批量识别完成 | 批次核对/确认 | H(`/scan`)；完成 `/`；重试 `/scan` | 批次结果/完成状态 | 共用 | 暂缓任务页 | [OcrOverviewPage.tsx](../../../apps/web/src/pages/OcrOverviewPage.tsx) 284–316、456 行 |
| OCR 单笔核对 | `/ocr/overview/:candidateId` | 概览单笔 | 编辑临时候选 | H(`/ocr/overview`)；保存/取消按钮 navigate 概览 | 表单局部 | 共用 | A 语义，暂缓 | [OcrReviewDetailPage.tsx](../../../apps/web/src/pages/OcrReviewDetailPage.tsx) 231、269、507 行；刷新可能缺批次，完成导航要另验 |
| 快捷导出 | `/export` | 明细更多；快捷导入互链 | 数据导出 | H(`/`) | 选择控件 | 共用；当前账本限制 | A 外层候选，首期排除 | [ExportPage.tsx](../../../apps/web/src/pages/ExportPage.tsx) 110、256、462 行；数据操作不由动画调度 |
| 账本导出 | `/books/:bookId/settings/export` | 账本设置；同账本导入互链 | 指定账本导出 | H(`/books/:bookId/settings`) | 选择控件 | 共用 | A 外层候选，暂缓互链 | 同文件 138 行；导入/导出互开是任务横移，不是继续深入 |
| 快捷账单导入 | `/import`，可带 `?from=nav` | 记账菜单；快捷导出 | 解析/核对/写入 | H(`/`) 若 from=nav，否则 H(`/export`)；完成 `doneTo` | 阶段/确认浮层 | 共用；当前账本限制 | 保持任务行为 | [ImportPage.tsx](../../../apps/web/src/pages/ImportPage.tsx) 111–125、395、635 行 |
| 指定账本账单导入 | `/books/:bookId/settings/import` | 账本设置；同账本导出 | 同上 | H(`/books/:bookId/settings`) | 同上 | 共用 | 暂缓 | 同文件 157 行；不要与下一行账本导入混为一条流程 |
| 账本导入向导 | `/import-ledger?target=...&step=...` | 账本设置、空间相关导入入口 | 多阶段合并/导入任务 | 页面 `onBack` 先退 step；到初始步才 P(目标设置或 `/start`) | 步骤局部；切 step `window.scrollTo(0)` | 共用；当前账本限制 | C/任务，首期排除 | [LedgerImportPage.tsx](../../../apps/web/src/pages/LedgerImportPage.tsx) 362、462、590–616 行；步骤使用 replace，不能制造假历史 |

### 2.7 身份、法律、管理与兼容地址

| 页面名称 | 路由 / 状态 | 实际入口 | 职责 | 现有返回/完成 | 当前动画 | 工作区差异 | 推荐转场 | 理由 / 代码依据 |
|---|---|---|---|---|---|---|---|---|
| 登录 | `/login` | 未登录门禁、游客切正式账号 | 身份任务 | 成功 replace next 或 `/` | `AuthLayout` 260ms 短入场 | 独立身份框架 | B：保留 | [LoginPage.tsx](../../../apps/web/src/pages/LoginPage.tsx)、[AuthLayout.tsx](../../../apps/web/src/components/AuthLayout.tsx) |
| 注册 | `/register` | 登录/游客入口 | 注册与恢复码交付 | 成功流程后 replace `/`；链接登录 | 同身份入场 | 同上 | B/任务：保留 | [RegisterPage.tsx](../../../apps/web/src/pages/RegisterPage.tsx) |
| 恢复账号 | `/recover` | 登录忘记密码 | 恢复任务 | 完成 replace 登录；另有登录 Link | 同身份入场 | 同上 | 保留 | [RecoverPage.tsx](../../../apps/web/src/pages/RecoverPage.tsx) |
| 归档恢复 | `/recover-archive` | 登录归档恢复 | 恢复任务 | 登录链接/任务状态 | 同身份框架 | 同上 | 保留 | [ArchiveRecoveryPage.tsx](../../../apps/web/src/pages/ArchiveRecoveryPage.tsx) |
| 版本化法律文档 | `/legal/:documentId` | 协议/同意书入口、公开深链 | 阅读指定文档 | H(`/`) | 无页动效 | 共用；可未登录 | 保持原样 | [LegalDocumentPage.tsx](../../../apps/web/src/pages/LegalDocumentPage.tsx)；同意书门禁优先，未必有可恢复父页 |
| 管理总览 | `/admin` | 设置管理员入口 | 管理中心 | H(`/settings`)；无权 replace `/me` | 无页动效 | 共用业务，桌面框架 | A 语义，低频后续 | [AdminPages.tsx](../../../apps/web/src/pages/AdminPages.tsx) `Shell/useAdminGate/AdminOverviewPage` |
| 邀请码管理 | `/admin/invites` | 管理总览 | 管理操作 | H(`/admin`) | 表单/确认局部 | 共用 | A 语义，首期排除 | `AdminInvitesPage`；不改权限判断 |
| 管理员列表 | `/admin/admins` | 管理总览 | 查看 | H(`/admin`) | 无页动效 | 共用 | A 语义，后续 | `AdminAdminsPage` |
| 用户管理 | `/admin/users` | 管理总览 | 查询/操作用户 | H(`/admin`) | 选择/展开/确认 | 共用 | A 外层，内部 C/D | `AdminUsersPage`；未发现单独用户详情路由 |
| 审计记录 | `/admin/audit` | 管理总览/审计入口 | 查看 | H(`/admin`) | 筛选局部 | 共用 | A 语义，后续 | `AdminAuditPage` |
| 生命周期管理 | `/admin/lifecycle` | 管理总览 | 生命周期任务 | H(`/admin`) | 操作确认 | 共用 | 暂缓 | [AdminLifecyclePage.tsx](../../../apps/web/src/pages/AdminLifecyclePage.tsx) 91 行 |
| 图表实验 | `/lab/charts` | 开发/测试直达，条件路由 | 实验 | 不作为产品层级 | 图表自身效果 | 实验用途 | 排除 | `AppRoutes` 条件 `ChartLabPage` + Suspense |
| 游客兼容入口 | `/guest` | 旧书签 | 身份跳转 | `GuestRedirect` | 不需要动画 | 共用 | 即时 replace/跳转 | `App.tsx`；不是可 Push 的页面 |
| 旧分类地址 | `/categories`、`/payment-methods`、`/tags` | 旧链接 | 规范化地址 | `CurrentBookRedirect` 到对应 bookId 设置子页 | 无 | 共用 | 跳转本身不动画 | [BookRedirects.tsx](../../../apps/web/src/pages/BookRedirects.tsx)；最后有效页面再判断 |
| 旧账本空间 | `/books` | 旧链接 | 规范化地址 | replace `/start` | 无 | 共用 | 即时 | `AppRoutes` |
| 旧当前账本详情 | `/ledger/info` | 旧链接 | 解析当前账本 | `CurrentBookRedirect` replace `/books/:bookId` | 无 | 共用 | 即时 | 不增加可见导航深度 |
| 旧指定账本详情 | `/start/book/:bookId` | 旧链接 | 规范化详情/改名 | `StartBookRedirect`；保留 `?rename=1` 到设置 | 无 | 共用 | 即时 | `BookRedirects` 82–87 行 |
| 未知地址 | `*` | 无匹配深链 | 兜底 | replace `/` | 无 | 手机/桌面各有外层匹配 | 即时 | 不能播放一次假的 Pop |

## 3. 不建议使用侧滑的页面

### 3.1 账目详情与“卡片展开”必须先区分

**本次没有在 `LedgerEntryRow → DetailPage.onActivate → EntryDetailPage` 这条实际路由链找到矩形测量、共享元素、退出等待、旧 DOM 副本或独立页面展开动画。** `LedgerEntryRow` 点击调用导航，`EntryDetailPage` 直接渲染 `InnerPage`；加载/已删除/编辑状态也未发现专属整页过渡。

代码明确确认的是**明细页自身**展示态到列表态的精细变化：摘要主卡左退、两张小卡退出、月份/日期上移、搜索展开与滚动吸附。它们不是 `/transactions/:id` 的共享元素路由动画。展示卡片编辑器也没有发现整页进入/退出的专属动画，而有独立固定预览、滚动目录和草稿退出约束。

这不构成替换任何已验收体验的理由。**账目详情首期全部排除**；用户所指展开/退出的具体路径及可能并行开发中的实现需动态确认。以后逐入口选择 `专属动效 / 普通 Push / 无动画`，一段导航只能有一个所有者；存在专属动效时优先专属，绝不叠加全屏侧滑。没有专属动画的分析/历史等入口，只有在来源、加载和恢复验证通过后才可单独加入 A 类。

### 3.2 现有动画及冲突清单

| 动画 / 操作 | 真实实现与挂载特征 | 测量、滚动、固定定位 | 与统一转场的关系 | 处置 |
|---|---|---|---|---|
| 明细展示态↔列表态 | `useDetailTransition`、`bindNativeHeaderScroll` 写 `--p`；既有 DOM 随进度变化 | scroller、ResizeObserver、补偿区；`.detail-hero` sticky/实验材质分支 | 同一来源视口；改祖先 transform/overflow 会改变定位和裁剪 | B/C 保留，不因滚动触发页面转场 |
| 主摘要卡退出、余下内容补位 | `detail-motion.css` `.detail-main-card` 使用 height、opacity、translate；`detail-overview.css` `.detail-overview-small` 左退及透明度 | 高度布局与滚动进度相连；已有 overflow 裁剪 | 不能同时让这组卡承担全屏 transform | 保留；不是逐账目删除后的 FLIP 列表动画 |
| 月份/日期变化 | `DetailPage` 的 `month`、筛选参数与 `MonthPicker/EntryFilterPanel`；月份上移由 `--p-month` 控制 | 日期控件位置受吸顶/搜索影响 | 未发现“每次换月份都横向切页”的独立机制 | C：值更新；选择器 D；保留位置变化 |
| 搜索展开/取消 | `DetailPage.openSearch/closeSearch`；`detail-overview.css` 约 200ms；`lockSearch` rAF | offset 测量、焦点同步、`flushSync`、搜索前 scrollTop | 与整页捕获竞争焦点/几何；不能把 searchOpen 当路由 | C/B 原样；导航时避免补播搜索进入动画 |
| 全部/支出/收入 | `DetailPage` 的 kind 与分段按钮 | 同页 scroller，按钮 CSS transition | 无新父子关系；最多更新内容和选中态 | C：局部 |
| 排序/筛选 | `EntrySortControls/EntryFilterPanel`；手机 Portal + BottomSheet，大屏可锚定浮层 | Portal 到所属 `[data-instance]` 或 body；fixed/z-index/内部滚动 | Portal 不一定在页面节点下；全局动画可能漏捕获或叠加 Sheet | D 保留；浮层还开着时不启动普通页面滑动 |
| 通用 Bottom Sheet | [BottomSheet.tsx](../../../apps/web/src/components/BottomSheet.tsx) 56–60 行；入场 CSS 260ms，退出 200ms 后 onClose 才卸载 | fixed、键盘 inset、焦点管理 | 现有退场延迟属于 Sheet，不应复制成页面导航锁 | D 保留；不要一边下滑 Sheet 一边侧滑整个视口 |
| 账本管理/选择 | [BookManageSheet.tsx](../../../apps/web/src/components/BookManageSheet.tsx)、[BookSwitcherSheet.tsx](../../../apps/web/src/components/BookSwitcherSheet.tsx)；`sheet-in` + dragY | fixed/拖动；目标页跳转或本页 replace | `go()` 先 onClose 再 navigate，不是通用旧页保活 | D；面板选择之后单独判断目标页面 |
| 账号编号面板 | [ProfileAccountNumberSheet.tsx](../../../apps/web/src/components/ProfileAccountNumberSheet.tsx) WAAPI，读当前 transform/opacity 退出 | 原生 dialog/top layer，session 防迟到 close | root 快照与 top layer 重叠需排除；不能移动其祖先冒充同一个面板 | D/B 保留 |
| 确认、冲突、通知、附件预览 | `ConfirmDialog`、`ChoiceDialog`、`BookNotificationBell`、`Attachments` 等各自状态 | 部分 fixed、部分原生 dialog；并非全部 Portal | 导航确认尚未批准时不能提前执行/截图目标页 | D 原样；先业务确认，再允许可选转场 |
| 记账菜单 | `BottomNav` 保持元素挂载，通过高度/透明度/transform 变化；`PaneShell` 到新 pathname 收起 | 来源页底栏和浮起菜单，safe area | 不能把菜单展开归类为 Push；路线进入时避免旧菜单二次移动 | C/D 原样 |
| 底部 Tab 玻璃指示器 | [s19/tabIndicator.ts](../../../apps/web/src/s19/tabIndicator.ts) `move/cancel/visual/startTabIndicator`；WAAPI + MutationObserver | 测量 nav/槽位；跟踪 `aria-current` 与样式变化；可能跨重挂载接续 | 若再包主 Tab 全屏滑动，会出现两套方向叙事 | E 独立动效；本轮不改、不包裹、不复用其取消函数 |
| 普通区块入场 | `Section.tsx` `.section-in`，220ms | 挂载时短 translateY + opacity | 若未来整页也滑动，可形成局部入场叠加 | 已验收部分保留；首期选择无此主动画的子页，捕获后不得重播一轮 |
| 登录/注册入场 | `AuthLayout` `.auth-enter` 260ms，部分延迟 | 挂载入场、表单聚焦 | 整页滑动会叠加 | B 保留，身份转换排除 |
| 分析筛选/轮播/编辑抽屉 | `statsWorkbench.css`：筛选 grid rows 220ms、轮播 transform 280ms、抽屉 height 280ms；拖动预览等 | 自己的滚动、fixed 拖动影像/Toast | 主工作台内部同时有几何动画，不能把 session/query 变化当 Push | B/C/D 保留 |
| 账本空间海浪 | `spaceTransition.ts` + `OceanBackdrop` + `index.css` | rAF、手势、视口高度、列表滚动和 inert | 不是普通全屏页面的替代切换 | B 保留，不改海浪规格 |
| 顶栏标题凝缩 | `Layouts.PageNavBar/useTitleScrolledAway`、`TabPageHeader` | sticky、IntersectionObserver/原生滚动、safe area | 只滑正文会留下不动的标题；改滚动祖先会影响观察器 | 与页面一起作为视觉整体，继续保留原逻辑 |

**C 与 D 的边界**：筛选条件应用、选中项、设置开关、目标账本替换、资料编辑状态是 C；承载选择的 Sheet/Modal 是 D。同一次操作可以先关闭 D 再发生 C，不需要产生路由层级。

## 4. 返回逻辑风险

### 4.1 两套来源机制不能混用

账目来源 [entryReturn.ts](../../../apps/web/src/lib/entryReturn.ts) 的 `entryReturnState` 只复制 pathname/search/hash/key 及可匹配的浏览器 index，不复制来源页的整个 state。`entryBackTarget` 只接受 `/`、`/ledger`、`/ledger/history`、`/stats`、`/stats/cards/:id`、`/books/:id` 这些阅读来源。

正常返回先核对前一条 key 与完整路径；刷新后允许匹配来源的浏览器 index；不匹配则 replace 合法来源，并清空 state；无有效来源 replace `/`。辅助区可优先后退自己的历史，不能把主区来源复制成自己的父页。[entryReturn.test.ts](../../../apps/web/src/lib/entryReturn.test.ts) 已有对应场景，但本轮只读测试，未将其算作重新运行通过。

普通 `useGoBack` 在 [connectivity.ts](../../../apps/web/src/lib/connectivity.ts) 84 行起。它对 `from` 仅检查为字符串，并以 push 方式使用；`parentBackAction` 仅看 key。**实际函数比一些“固定父级”“消耗记录”的旧注释更重要**；浏览器 back 是移动历史游标，仍保留 forward，并非永久删除历史记录。

### 4.2 必须纳入接入门槛的风险

| 风险 | 代码事实 / 可构造路径 | 判断与接入约束 |
|---|---|---|
| 来源 push 构成返回环 | `SecurityPage.open` 写 `from=/settings/security`；密码页返回 push 安全页；安全页返回走 -1 可回密码；密码再返回又 push 安全页 | **静态可构造，未动态复现**。不在本轮重写；安全子链不做首期试点。动画不能掩盖或修复这个环 |
| `default` 不能始终等价于栈底 | 直达语言页 key=default，H replace 设置；`PaneHistory.replace` 生成新 key，但 index 仍为 0。再次返回时 H 按非 default 请求 -1；无 browserBehind 时 `go` 可不移动 | **静态风险**。深链多层退回必须动态验证；若失败，将其作为独立导航修复，不能靠动画多压一个父页“修复” |
| “parent 模式”没有验证真父级 | 账本设置也从协作齿轮、空间菜单、账号数据直接打开，不只从账本详情 | 不得在动画层根据 P 模式写死返回画面；使用实际最终目的地 |
| 阅读退出与保存/删除不同 | `EntryDetailPage` 的普通返回走 ER；保存和删除直接 `navigate("/")`；复制到 `/add`；编辑返回只取消编辑 | 动画不调用 ER 代替这些动作；保存、删除、复制分别是业务完成/新任务 |
| 同页多入口来源覆盖不足 | 附件、账本通知、全账本重复结果未传 `entryOrigin` | 明确兜底事实；后续如需恢复入口是业务导航扩展，单独批准范围，不混入动画接线 |
| 浏览器返回不等于用户点应用返回 | `handlePop` 统一接收后退与前进；`go(-1)` 在已绑定主区也最终通过 popstate 提交 | 不能把所有 POP 都解释为向右退出；应用返回需一次性意图关联，浏览器未知方向保守即时 |
| 历史 index 可能失去可比性 | `adopt` 刷新仅保留地址栏条目；`handlePop` 遇未知 key 重建栈；`takeOver` 晋升改当前浏览器条目 | 不用 `PaneSnapshot.index` 单独判断跨刷新方向；只比较已知同一历史域的条目 |
| 连点造成重复入栈/旧回调覆盖 | `push` 每次生成新 key；没有通用相同目标去重；浏览器 `go` 回执异步 | 首期入口需要防同一已接受点击重复提交；新转场覆盖旧视觉，但不能让旧动画结束回调再导航 |
| 连续返回保底本身会跨层 | [backFallback.ts](../../../apps/web/src/lib/backFallback.ts) 是 **10 秒内 4 次**，第四次 replace `/`；普通 pointerdown 重置 | 保留既有行为，别照旧注释写成 5 次。保底跳转即时，不假装只是上一层；也不为了跑 4 次动画削弱保底 |
| 标记返回早于真正离页 | `MobileInnerPage.handleBack` 先 `markBack`，自定义 onBack 可能只关编辑或弹确认 | 既有 `markBack` 服务 Pad 跟随模式，不能直接当成动画授权；只有业务接受且 location 真变后才有页面动画 |
| 组件 dirty 不等于完整浏览器离开保护 | 展示卡片编辑器有按钮确认和 beforeunload，但其文件未挂 SPA popstate 拦截；其他页面各有机制 | 浏览器返回、刷新、辅助区替换分别验证；不宣称全站草稿安全已经统一解决 |
| 刷新/丢失临时数据 | 录音、文本、OCR 批次、导入步骤可能需要原临时会话 | loading/empty/error 都是合法目标状态；不能由快照伪造“数据仍在”，不能延迟导航等网络完成 |
| 普通子页没有统一滚动恢复 | H 只导航；普通 InnerPage 没有按 location key 存滚动；Stats returnPoint 又在 effect+rAF 恢复 | 快照只解决 200ms 视觉，不解决返回后真实页面的位置；这是试点必须补足/验证的条件 |
| 链接可能硬导航 | 指定账本成员的邀请 `<a>`、留言失败的返回 `<a>` 等 | 不用 SPA 动画拦截这些链接；指定账本→当前账本的邀请语义也须另查，首期排除该链 |

应用返回、浏览器返回与系统返回手势可以到同一个 URL，但可拥有不同的动画策略。**不得阻止原生 popstate、造假 history 条目或重放浏览器手势，只为了表现 Pop。**

### 4.3 与现有逻辑兼容的转场状态设计（候选）

分为三个独立责任：业务/路由决定目的地；恢复层还原真实页面；视觉层只消费结果。

| 候选记录 | 内容 | 不承担的职责 |
|---|---|---|
| 导航观察记录 | instance、fromKey、toKey、最终完整 path、实际 action、账号/账本上下文 | 不存第二份业务历史，不推导返回 URL |
| 一次性意图 | `drill-in / app-back / sibling / task-complete / redirect`，关联发起 key；在确认放行后记录 | 不是沿 state 递归传递的 from 链；被拒绝/取消/无导航时立即丢弃 |
| 视觉决策 | `push / pop / none / dedicated`；命中明确入口关系白名单；最多一份活动 token | 不将 Router PUSH 直接映射成视觉 push，也不将 POP 直接映射成视觉 pop |
| 恢复点 | 按账号+账本+instance+entryKey 保存滚动目标、位置和可恢复焦点标识 | 不复制财务数据、密码、录音、File 或活跃表单树 |
| 运行态 | idle → preparing → running → finished；任何阶段可被下一次有效导航取消 | finished 只清理动画资源，绝不 navigate / push / pop |

关键规则：

1. **按边而不是按页授权。** 例如设置→语言是进入；语言中的 locale 更新是局部；外观兼容页→语言是另一条边；游客我的→语言又是一条。未知入口先 `none`。
2. 应用返回时，保留 H/P/ER/自定义 onBack 原行为。只有实际目标与本次已接受意图匹配，才选择 Pop；若原行为触发保底、权限跳转、任务完成或没有 location 变化，立即/局部处理。
3. `entryOrigin` 不扩展、不包进新的 state 来源链；`markBack` 不改职责。新意图建议保存在该实例的短期内存中，用 key/token 配对，不持久化为业务状态。
4. 浏览器 forward 若能确认是白名单父→子关系可后续考虑 Push；未知 POP、刷新恢复、外部页面返回、工作区晋升一律 `none`。首期浏览器原生 back/forward 可保持即时，系统手势由浏览器展示。
5. 同 entryKey 对同目标的重复激活，在一次导航尚未确认时合并，不能按 200ms 动画时长全局禁用按钮；新 key 已提交后的下一次返回立即可用。历史回执未到时不反复调用旧页面的 `go(-1)`。跨多层的明确新导航不排队等旧动画。
6. “同目标”必须含语义相关 query、hash、账本与 state，不是只比 pathname。筛选 replace、前后篇、账本切换可不动画，但不能被误吞。
7. 已有 dirty 确认先完成，取消不移动历史、不捕获目标、不残留 back 标记。原有返回保底仍由原函数负责，视觉层不私自改计数。

## 5. 技术方案

### 5.1 实际依赖下的比较

| 方案 | 本项目适配点 | 状态/滚动与连续导航 | 主要代价 | 建议 |
|---|---|---|---|---|
| 原生同文档 View Transition API + CSS/WAAPI | 能捕获完整旧/新视觉，不必保留两个活跃 React 路由；可与现有 PaneRouter 提交做薄适配 | 可主动 `skipTransition`；仍需真实恢复点和 React 提交回执 | iOS 支持边界、捕获时机、overlay 交互与旧回调竞态必须验证 | **首期推荐的视觉后端候选**，仅手机白名单 |
| React 19.3 `<ViewTransition>` + `addTransitionType` | 本机已具备稳定 API，现有 PaneRouter 本来就 startTransition；可按原因定类 | 默认会在前一视觉转场结束后处理后续合并转场；legacy popstate 导航会跳过动画；不会自动保活状态 | 当前 app-back 经 `history.go`→popstate，不能保证期望的 Pop；需处理非导航状态误触发 | 有价值的备选，不是“React 19 尚无稳定能力”；首期不与原生后端叠加 |
| Router `viewTransition` / `useViewTransitionState` | 安装版 8.4 有 API | 依赖 Data/Framework 路由的协调实现；本项目自定义 Navigator 的 `_opts` 未使用 | 只给 Link 加属性不能接好现有 PaneHistory；迁移数据路由会扩大范围 | 不为动画迁移路由架构 |
| CSS / WAAPI 移动真实页面 | 已有 WAAPI 实例，可取消动画，旧 Safari 可用 | 若旧页卸载，只能滑新页；要露出旧页须另保留旧内容 | transform 改 fixed containing block；双活页面有 effect、查询、录音、表单副作用 | 可做后续有限退化实验，不把“双活 Routes”作为首期基础 |
| 手工 DOM 副本/图片快照 | 可在不支持 VT 的浏览器表现两层 | 副本必须 inert、去交互，保存内滚动；仍不保存真实状态 | Canvas、dialog、视频、继承样式、ID、裁剪和玻璃很难等价；快照库增加体积 | 首期不做全站 clone/截图引擎；不支持时即时切换 |

React 19.3 的稳定性依据为 [React 19.3 发布说明](https://react.dev/blog/2026/09/09/react-19-3)；连续调度与 popstate 限制见 [ViewTransition 官方参考](https://react.dev/reference/react/ViewTransition)。原因分类可用 [addTransitionType](https://react.dev/reference/react/addTransitionType)，但它不会替业务决定父页面。

本机 Router 8.4 的 `lib/dom/lib.js` 标注旧 viewTransition API 的 Data/Framework 范围，`lib/components.js` 的 RouterProvider 才执行浏览器捕获。在线 [Router 转场指南](https://reactrouter.com/how-to/view-transitions) 已建议使用 React 方案；[8.5 变更记录](https://reactrouter.com/changelog) 才正式标记旧 API 弃用。**不要把在线最新版的弃用标记倒写为本机 8.4 已迁移，也无需升级依赖。**

### 5.2 iOS Safari 能力分层

| 环境/能力 | 公开资料确认 | 项目策略 |
|---|---|---|
| Safari 18.0 / iOS 18 起的基础同文档 VT | WebKit 发布说明明确加入 Level 1、`document.startViewTransition` | 可作为能力检测后的候选基础；不等于本项目玻璃/滚动已实测 |
| Safari 18.2 的 classes/types 与跨文档 VT | WebKit 单独在 18.2 宣布这些扩展 | 首期基础 CSS 不强依赖 classes/types；本项目是 SPA，不以跨文档动画解决普通路由 |
| 不具备 API、减少动态效果、能力异常 | 不应阻塞页面进入或返回 | 即时提交真实页面；不下载大型 polyfill |
| 系统返回手势、PWA、键盘与动态工具栏 | API 支持不保证与这些组合的视觉结果 | 真机验收门槛；首期原生返回不附加第二段滑出 |

依据：[Safari 18.0 的 WebKit 功能说明](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/)、[Safari 18.2 的 WebKit 功能说明](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/)。不推测所有者设备系统版本；上线前必须记录实际测试机型/系统/PWA 模式。也不把新的 scoped-element VT 当成全体 iOS 基线。

### 5.3 推荐的最小接入形态

**候选：一个手机导航观察/恢复协调器，加一个可撤销的原生同文档快照后端。** 保留一棵实际路由树；所有非白名单动作原样提交。没有独立转场库、没有第二份 React 应用、没有逐帧 setState。

首期可优先验证**完整手机视口的 root 快照**，把背景、顶栏、正文、来源页底栏和安全区一起捕获。其理由是现有手机外壳 `display: contents`，普通子页与 Tab 页滚动容器不同；给这些节点统一加 transform 并不是小改。root 捕获是视觉合成，不要求重建 React 根。该后端只能在手机单区启用，不能用于 Pad/桌面全 document 动画。

root 捕获也有约束：未关闭的 dialog、全局确认/协议门禁、附件预览、键盘输入及实验控制面板等可能被一起拍入。首期遇这些状态直接跳过；不能靠提高 z-index 覆盖 top layer。以后若改成命名局部 surface，需要先验证实体盒子、背景归属和滚动契约，不能直接命名 `display: contents` 节点。

推荐提交时序：

1. 入口执行业务检查/确认；导航由现有 API 接受并产生最终目标。记录一次性语义，保存离开页滚动。不要为视觉效果等待数据请求。
2. 在手机路由视图更新前捕获旧画面。只选一个 `PaneRouter` 订阅接入点，不在内外两层重复启动。
3. 更新同一棵路由树，等待**本次目标 key 的 DOM 提交回执**，恢复目标页可恢复的滚动和焦点，再让浏览器捕获新画面。现有声明式 navigate 不承诺“await 后 DOM 已就绪”，不能写 `await navigate()` 就当作回执。
4. 新页面若只有骨架/错误/空状态，就展示该真实状态，不等待网络、图片或全量数据。若原布局无法形成稳定画面，跳过动画；加载完成不能再触发一次整页侧滑。
5. 使用 180–220ms 候选缓动，无弹跳。Push：新画面从 +100% 到 0，旧画面最多轻退约 -15%～-20%；Pop：旧画面 0 到 +100%，下层回到 0。Push 新图在上，Pop 旧图在上；旧页轻退是可关闭的增强。
6. 取消默认 crossfade/混色，要求完整覆盖时 opacity=1、正常混合，不能出现旧页文字透过新页。过渡结束仅清理视觉；不再触发业务导航。

**可中断与输入是硬门槛：** 新有效导航立即结束旧视觉；无需等 `finished`。保存活动 token，旧回调只允许清理自己；旧 updateCallback 即使迟到也不能把路由恢复成过期目标。捕获等待必须有短时兜底，失败后仍提交最新真实页面。`skipTransition()` 不会阻止 updateCallback，因此“取消了动画”不等于“取消了旧更新”。依据：[CSS View Transitions Level 1](https://www.w3.org/TR/css-view-transitions-1/)。

VT overlay 默认会影响交互，不能只声称动画期间按钮可点。应验证快照层 `pointer-events` 策略，收到新的 pointer/键盘操作时先终止视觉，及时暴露真实目标页，再让原操作走正常事件路径；不要手工重放可能提交数据的 click，也不能让用户误点到视觉位置与真实位置不一致的控件。若目标浏览器无法满足，降级即时。参考：[Chrome 的 View Transition 交互说明](https://developer.chrome.com/docs/modern-web-guidance/guides/ui-behaviors/group-element-transitions?hl=en)。

`prefers-reduced-motion: reduce` 应在启动前检测，直接 `none`；动画中切换偏好也立即结束视觉。不要只将 CSS duration 设零却仍等待一段 JS 定时器。

### 5.4 状态恢复的最小范围

- 为试点普通页记录实际 scroller：文档 scrollingElement 与页内 scroller 分开。返回按 entryKey 恢复，首次 Push 默认起始位置，不能从另一次同 URL 访问拿位置。
- 已有明细 sessions、分析 returnPoint 保持原责任；首期不接入这些复杂页面。以后必须确定恢复先后，避免新旧恢复器互相覆盖。尤其分析的 effect+rAF 可能晚于快照，不能把“快照正确”当作“恢复已正确”。
- 滚动恢复依赖足够内容高度；数据不足时不要一直拉回用户滚动的位置。可先显示骨架/即时页面，待已知内容可恢复时进行一次受控恢复；用户已主动滚动就取消迟到恢复。
- 焦点应恢复到原入口或合适标题，不能重启软键盘、重放点击或滚到另一个工作区。快照不是可聚焦 DOM。
- 真实表单、OCR 临时批次、导入任务不放进通用快照仓库。换账号、切账本、工作区角色变化时废弃不匹配的恢复点和视觉缓存。
- 不为首期引入全站 Activity/KeepAlive；捕获前的旧页正常存在，捕获后正常卸载，避免重复业务副作用。

### 5.5 四种风格与完整覆盖

四风格通过 `data-visual-style` 共用业务；[visualStyle.ts](../../../apps/web/src/lib/visualStyle.ts)、[s19.css](../../../apps/web/src/s19/s19.css) 确认其限定在手机外壳浅色实验环境，Original、深色、Pad、桌面不能据此改造。

| 风格 | 源码事实 | 风险与统一处理 |
|---|---|---|
| A · Soft Spatial | `s19-lab-tokens.css` 的实色卡片/柔和阴影；摘要有既有 overflow 收起裁剪 | 不把快照裁成单张卡或正文窄列；完整视口边界统一处理阴影。不能给卡片再加全屏 transform |
| B1 · Ambient Frost | Satin 卡片是渐变实体面；栏/工具使用乳白透明与 backdrop-filter | 捕获已合成画面，保持背景纹理坐标；避免滑动层又对下面旧页进行一次动态 blur |
| B2 · Layered Glass | 卡片约 .6/.5 透明底，栏更透明；背景由 body 固定伪元素提供 | **优先完整、不透明的合成快照**。只捕获透明卡片/正文会透出旧文字；把两份活页面相叠会改变模糊与亮度。禁止默认 crossfade/plus-lighter 造成两页混亮 |
| C · Classic Refined | 主题色顶部与纸面正文，`classic.css` 的纸面过渡 | 顶栏、正文及背景作为同一视觉平面移动；不能顶栏固定而正文从右入，或出现不连续纸面边缘 |

背景实际位于 [shared.css](../../../apps/web/src/s19/shared.css) 4–13 行的 body、`::before/::after`，不是每个路由组件自己的背景；材质由 [s19-lab-tokens.css](../../../apps/web/src/s19/s19-lab-tokens.css)、[ambient.css](../../../apps/web/src/s19/ambient.css)、[classic.css](../../../apps/web/src/s19/classic.css) 提供。**`isolation: isolate` 本身不能把透明页面变不透明。**

完整 root 合成快照可减少 body 背景遗漏风险；但浏览器对玻璃、sticky、固定伪元素的截图结果仍需真机逐风格验证。如果将来采用局部 surface，必须在捕获中包含同坐标背景与纹理，且静止最终帧与现有视觉完全一致，不能为了遮旧页把 B2 设计改成不透明白卡。

窗口 resize、旋转、visualViewport 高度突变、软键盘起落时直接结束当前视觉。`env(safe-area-inset-*)` 沿用既有布局，不新增固定像素安全区，不在每个风格里各写导航引擎。

## 6. 第一阶段试点

建议只选以下 **3 条实际存在的导航链**。所有试点都以导航目标、返回结果和输入不中断为先；视觉不达标时可即时降级，不能阻断功能。这里尚未授权实施。

| 试点 | 真实路径 | 选择理由 | 专项验收 |
|---|---|---|---|
| 1. 我的→设置→语言 | `/me → /settings → /settings/appearance/language → 设置 → 我的` | 高频、结构短、无专属整页动画；语言已是首页直达项 | 原语言选择即时生效；不多走 appearance 中间页；从游客我的进入要回游客我的，不能凭路径送入账号设置；正常链/刷新/深链分别验证 |
| 2. 更新→公告→详情 | `/me → /update → /update/announcements → /update/announcements/:version`，逐级返回 | 读操作、多层连续进入、长文滚动、无需写业务数据 | 列表滚到中间进入后能恢复；从更新摘要直接进详情要回更新；前后篇是同级，避免叠层；达到第 4 次连续返回时按既有保底处理 |
| 3. 协作→成员→邀请 | `/ledger → /ledger/members → /ledger/invite → 成员 → 协作` | 覆盖当前账本与权限可见入口、多层往返 | 只验证已有权限允许的入口，不改任何权限判断；顶栏回成员，直接从协作进入则回协作；页底“回协作”仍是明确业务导航；不发送真实邀请来验证动画 |

前三条也不能跳过 §4 的深链风险：若动态复现已有返回问题，应先单独提出/修复该路径的导航缺陷，再验动画；不能把问题以“动画试点通过”掩盖。

共同验收条件：

1. 手机布局至少覆盖 320/390/430 CSS px；iOS Safari 与已安装 PWA 实机，记录系统版本；不支持 API 的环境能正常即时切换。Pad 主/辅区和桌面应完全不启用本引擎。
2. 常规点击、应用返回、浏览器后退/前进、地址栏直达、刷新子页均到正确目的地；不添加伪历史、不把前进播成 Pop、不形成两页往返环。
3. 动画未结束再次进入/返回/切主导航能够立即响应；100ms 内双击同一入口不留重复子页；旧 token 的结束/失败不能覆盖新页面；未知或跨层跳转即时处理。
4. 180/200/220ms 分别试感受，轻退可关闭；不要求用户等待、无夸张回弹。性能记录关注帧时间、长任务、内存/图层释放；本轮未测得任何帧率数字。
5. 长文回原滚动、导航栏 sticky、底部安全区、工具栏高度变化不闪白；loading/error 不阻塞返回；离线时可访问页面保持原可用性。
6. Original 和 A/B1/B2/C 分别检查新页完整覆盖；B2 不透旧文字、不重复 blur、不在结束帧跳亮；C 顶栏正文一体。深色按既有材质验证，不擅自套实验主题。
7. 减少动态效果时无滑动、无隐形等待；焦点与读屏只面对真实当前页，无重复可点击旧按钮；操作位置与视觉一致。
8. 主 Tab 切换仍由底部指示器表现；进入子页不触发第二套 Tab 位移；未修改 Claude 的指示器实现。启动实验前重新核对并行改动。

**第一阶段明确排除**：所有账目详情入口、展示卡片编辑器、分析布局/配置编辑、资料/头像 dirty 流程、安全子链、导入导出与 OCR/录音任务、账本空间海浪、管理员/账号生命周期、跨工作区、系统交互式边缘返回。账本详情→设置→分类/标签可作为后续扩围，不从第一轮同时展开。

## 7. 未来接入步骤

1. **确认范围**：由所有者选定 §6 路径，确认原生浏览器返回首期保留即时/系统行为；先辨认所指账目展开动画的具体入口。本轮到报告交付为止。
2. **建立导航基线**：只动态走选定链及 §4 对应风险，区分已有缺陷与动画新增问题。需要修返回语义时另列具体改动，保留来源校验、权限与保底规则。
3. **验证最小后端**：不升级依赖，试完整手机视口捕获、一次 route commit 回执、正确 Push/Pop 层叠、skip 与即时降级。先通过连续输入、scroll 和 B2 画面门槛再接整条链。
4. **连接白名单和恢复点**：从第一条路径开始；不按 URL 前缀自动扩展，不强行统一所有页面 scroller，不移动现有专属动画。
5. **针对性验证并交付**：未来产品代码改动按 AGENTS 更新版本/changelog/STATUS，并按实际范围做构建、相关导航与恢复测试、真实交互检查；不借此重跑无关模块。触及敏感范围则按项目交付检查升级。
6. **通过后扩围**：逐条加入其他 A 类边；B/C/D/E 保持原责任。任何新入口都要说明来源、完成出口、刷新兜底、恢复方式和专属动效互斥规则。

## 8. 暂不处理的问题

- 不重写 `useGoBack`、`PaneHistory`、ER、权限门禁；本文列出的静态风险不是已实施修复。
- 不实现自定义 iOS 边缘拖拽返回或预测返回；不拦截原生手势，不迁移 Navigation API 或 Data Router。
- 不建立全站页面保活、多层截图栈、DOM clone 引擎、跨文档动画或后台预渲染全部路由。
- 不改明细摘要/搜索/月份/列表的成熟交互；不把未发现的账目共享元素动画写成已确认存在或已被删除。
- 不调整 Pad 跟随/独立、工作区晋升/隐藏/拖动、桌面辅助栏；未来单独评估其局部转场。
- 不修改四风格设计、底部 Tab 弹性玻璃指示器、实验开关、主题系统与海浪。
- 不处理本轮范围以外的导入锁、数据同步、金额计算、管理员权限或生产问题。

本轮验证范围：读取真实路由、导航入口、返回函数、页面容器、状态恢复、CSS/WAAPI/rAF 实现、相关既有测试，以及官方浏览器/React/Router 文档；只运行文档检查，不运行无关构建或全量测试。**尚未验证**真机玻璃合成、连续输入、滚动快照时序和静态推演风险的实际复现；这些都列入试点前置条件，而非现有通过结论。
