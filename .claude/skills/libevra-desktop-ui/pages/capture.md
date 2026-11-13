# 页面规范 · 记账与识别

> 路由：`/add`（手动）、`/paste` 与 `/paste/review`、`/record` 与 `/voice/review`、`/scan`、`/ocr/overview` 与 `/ocr/overview/:candidateId`、`/import`、`/import-ledger`。
> 代码入口（相对 `apps/web/src/`）：`pages/AddEntryPage.tsx`、`components/EntryForm.tsx`、`components/entry/`（含 `EntrySaveBar.tsx`、`keyboardInset.ts`）、`components/CategoryPicker.tsx`、`components/StickyActionBar.tsx`、`components/EntrySaved.tsx`、`components/ocr/OcrOverview.tsx`、`lib/scanHandoff.ts`。

## 1. 决定状态

- 入口：大屏侧栏「记一笔」→ 五种方式（已批准）。平板 / 桌面记账用弹层或侧边面板：**C-09【设计候选】**；快速记账面板与键盘快捷键：**C-06【设计候选】**。
- 记账语义在各设备一致（S18-B §6.2【已确认】）：电脑端不得出现手机上没有的记账规则，也不得少校验。

## 2. 电脑端要求

**手动记账表单**

- **Tab 顺序与视觉顺序一致**，覆盖分类 → 金额 → 日期 / 账户等更多选项 → 保存；「更多选项」展开后新字段按顺序进入 Tab 序列。
- **分类选择**是组合控件：一个 Tab 停靠点，方向键在网格内移动，Enter / Space 选中；鼠标悬停有反馈（现有 `CategoryPicker` 若未达到，列为改进项）。
- **快捷金额、「沿用上一笔」**：鼠标下目标 ≥24px；有触控能力时保持 44px（已登记 U08 是触控尺寸问题，不要为电脑端把它缩小）。
- **金额输入**：允许粘贴（含带货币符号或千分位的文本时按现有解析规则处理，不新增规则）；滚轮在聚焦的数字框上**不得改变数值**（`type="number"` 的默认行为要禁用或不用该类型）。
- **自动聚焦金额框**（桌面、`pointer: fine` 且无触屏时）属【候选】，可明显提高连续录入效率；确认前不做。
- **提交**：保存按钮始终可见（`StickyActionBar` / `EntrySaveBar`），且不遮挡获得焦点的字段（`scroll-padding-bottom`）。Ctrl/⌘+Enter 保存、「保存并再记一笔」连续录入属【候选】（P-05 提到的连续录入）。
- **IME**：任何自写的 Enter 处理都要有组字判断（[keyboard-and-focus.md](../references/keyboard-and-focus.md) §4）；备注框里用拼音输入时 Enter 上屏不得触发保存。
- **离开保护**：有草稿时切页沿用现有草稿保护；关闭标签页的原生提醒范围不扩大。

**粘贴记账 `/paste`**

- 文本框里 Ctrl/⌘+V 是主路径；粘贴后焦点、滚动位置合理（看到解析结果）。
- 在页面任意位置粘贴直接进入解析属【候选】（见 [selection-and-dnd.md](../references/selection-and-dnd.md) §3）。

**语音 `/record`**

- 电脑端麦克风权限被拒、没有麦克风时给出明确说明和替代（手动 / 粘贴）。
- 「按住 Space 说话」等键盘录音方式属【候选】，且不能与按钮的 Space 激活冲突。

**拍照 / 识别 `/scan`、OCR**

- 电脑上「拍照」实际是选文件：按钮文案与说明要让电脑用户知道可以选图片文件（文案改动走 i18n）。
- 从系统拖入图片、粘贴截图进入识别属【候选】，必须经 `handOverForScan` 与现有草稿保护。
- OCR 概览：整卡点击（现有 `after:absolute after:inset-0`）+ 卡片内独立控件 `relative z-10`；卡片悬停高亮；键盘可逐卡到达；右键菜单见 [context-menu.md](../references/context-menu.md) §7。
- 单笔核对页的底部确认操作（`StickyActionBar`）在宽屏不要拉满整个工作区宽度到难以找到，具体宽度属布局决定。

**导入 `/import`、`/import-ledger`**

- 文件选择按钮键盘可用；拖入文件区域属【候选】；导入属「导入导出」类，检查不得降级（AGENTS §6.1）。
- 预览表格若在宽屏展示更多列，遵循 [layout-density-window.md](../references/layout-density-window.md) §4。

**保存成功 `EntrySaved`**

- 成功信息与后续操作（再记一笔、查看、引用到留言）键盘可达；自动跳转（如有）不能抢走正在进行的键盘操作。

## 3. 验证要点

- 只用键盘完成一笔手动记账（含更多选项与分类选择）。
- Windows 微软拼音 / macOS 拼音下在备注框输入后按 Enter：不得保存。
- 1366×768 下保存栏不遮挡最后一个字段；浏览器缩放 200% 仍能保存。
- 数字框上滚动鼠标滚轮：金额不变。
