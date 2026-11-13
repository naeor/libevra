# 页面规范 · 账本与协作

> 路由：`/start`（账本空间，游客也可见）、`/ledger`（当前账本 / 协作中心）及其子页（详情、设置、分类、成员、邀请、留言、历史）、`/ledger/more`。
> 代码入口（相对 `apps/web/src/`）：`components/BookSwitcherSheet.tsx`、`components/BookManageSheet.tsx`、`components/MemberList.tsx`、`components/MessageBoard.tsx`、`components/MessageQuote.tsx`、`components/HistoryList.tsx`、`components/CopyButton.tsx`、`components/QrCodeView.tsx`、`components/OceanBackdrop.tsx`、`workspace/GlobalRail.tsx`（侧栏账本）。

## 1. 决定状态

- 区分入口与外壳：独立电脑版 `DesktopNav` 的账本选择已经使用 `DesktopPopover`；共用详情页的 `BookSwitcherSheet` 等入口仍需逐个核对，不能统称为「电脑端尚未改底部面板」。其它入口的新形态与页面重组仍属具体布局决定。
- 平板双工作区各看一本账（已批准）；外部账本工作区的能力边界见 changelog（批量、重复检测、拍照 / 语音 / 粘贴 / 导入导出、离线下载不可用）。独立电脑版的情境辅助栏不等同于该第二工作区，见 [外壳与导航](shell-and-nav.md)。
- **保留既有设计**：账本空间海浪「展示 / 列表」的连续关系与命中区不改（附录 A.5、[海浪效果要求](../../../../docs/specs/design/海浪效果要求.md)）。

## 2. 电脑端要求

**账本切换与管理**

- 对底部面板与电脑版弹出面板分别验证：Esc 关闭、焦点进入面板并在关闭后回到触发按钮。已登记 U12 针对原底部面板的退出机制，不能直接认定电脑版弹出面板也有同一缺陷。
- **查看 / 管理目标账本与切换当前记账账本分开**：`/books/:bookId` 及其设置以 URL 中的目标为准，打开资料、成员、邀请或历史不能顺带改全局当前账本或离线作用域；新布局中的内嵌区域也必须绑定同一个目标账本。只有明确的切换操作才改变当前记账账本。
- 列表项悬停、焦点、当前账本标识齐全；当前账本不只靠颜色区分。
- 侧栏账本的右键菜单已存在（`GlobalRail.tsx`），保持；新增项走 [context-menu.md](../references/context-menu.md) §7 确认。

**成员与权限**

- 成员角色、移除等操作的**显示 / 可点判断一律不改**（AGENTS §6 硬规矩）；右键或快捷键入口只能调用现有判断。
- 危险操作（移除成员、退出账本、删除账本）放菜单末尾、危险色、确认弹窗默认焦点在「取消」。

**邀请与分享**

- 邀请码、编号用 `font-mono`，可被选中；`CopyButton` 键盘可用并有「已复制」反馈（`aria-live`）。
- 二维码在电脑上用处有限：保留，同时确保链接 / 邀请码可直接复制。

**留言板**

- 现有约定：**Enter 发送、Shift+Enter 换行**（按所有者「输入体验顺畅」的要求设计，见代码注释），电脑端保持一致，不另做一套。
- 输入法：留言框与引用留言框的 Enter 已在 1.18.10 加上组字判断（`isImeComposing`），拼音上屏不会发送（[keyboard-and-focus.md](../references/keyboard-and-focus.md) §4）；Firefox / Safari 真机实测待所有者确认。
- 引用账目（`MessageQuote`）的卡片可点击打开、键盘可达；引用内容里的金额完整显示。

**历史记录**

- 现有规则：完整内容的去处是点开；桌面端悬停看 `title`（[布局间距与圆角规范](../../../../docs/specs/design/布局间距与圆角规范.md)）。保持，但 `title` 不能是唯一获取完整信息的方式——点开详情必须可达。
- 时间右对齐、`tabular-nums`；编号是可复制的小胶囊。

**账本空间 `/start`**

- 海浪展示的交互与动效按既有要求；电脑端只补：账本卡片悬停 / 焦点状态、键盘可逐个到达、Enter 进入。

## 3. 验证要点

- Windows 微软拼音、macOS 拼音、Firefox、Safari 下在留言框输入并按 Enter 上屏：不得发送。
- 只用键盘：切换账本 → 打开成员页 → 复制邀请码 → 返回。
- 外部账本工作区里，右键 / 快捷键入口对不可用能力同样禁用并说明。
