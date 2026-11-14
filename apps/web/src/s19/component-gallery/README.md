# apps/web/src/s19/component-gallery · 阅读入口

共享组件与状态演示；`SelectionLab.tsx` 是第 09 节“选中指示与已选条件标签”设计样板（开发用，不进正式构建，`?s19=a|b1|b2|c` 切换风格）。1.19.62 起样板直接引用正式组件 `components/ui/SelectionControls.tsx` 与正式令牌，只保留定稿（A 第三版 = A2 档、玻璃不染色、B2 标签瓷片），本页只负责示例布局、慢放与定格帧。1.19.65 起可点击样板里分类、标签等维度下是多选列表（`SelectionItem`，每行独立选中），附件下是少量互斥选项（横向会移动的选中），与明细筛选面板一致。`ToastLab.tsx` 是第 10 节“提示条”（1.19.66）：直接引用正式组件 `components/toast/`，`?shot=toast&s19=original|a|b1|b2|c`（可加 `theme=dark`、`preset=clear`）只渲染一块固定画面，供五种外观截出相同构图。`SwitchLab.tsx`（1.19.67）放在第 09 节末尾：切换类控件（`KindToggle`、与明细页 / 外观页 / 批量修改同一写法的分段）与开关按钮 `ToggleButton` 的开 / 关，`?shot=switches&s19=original|a|b1|b2|c`（可加 `theme=dark`）只渲染这一块画面——外观页要登录、批量修改要有账目，游客截图到不了，在这里核对外观。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [ChoiceLab.tsx](ChoiceLab.tsx) | 界面模块；入口/导出：ChoiceBoardOne、ChoiceBoardTwo、ChoiceBoardThree、ChoiceBoardFive、ChoiceBoardFour |
| [Gallery.tsx](Gallery.tsx) | 界面模块；按文件名定位 Gallery.tsx |
| [LayoutExamples.tsx](LayoutExamples.tsx) | 界面模块；入口/导出：HeaderPattern、ToolbarPattern、CardListPattern、FormPattern、BottomActionsPattern |
| [LayoutPatterns.tsx](LayoutPatterns.tsx) | 界面模块；入口/导出：LayoutPatterns、StandaloneBottomPattern |
| [SelectionLab.tsx](SelectionLab.tsx) | 界面模块；入口/导出：SelectionLabSection |
| [StandardStates.tsx](StandardStates.tsx) | 界面模块；入口/导出：StandardStates、StandardStatesExample |
| [SwitchLab.tsx](SwitchLab.tsx) | 界面模块；入口/导出：SwitchBoard、SwitchShot |
| [ToastLab.tsx](ToastLab.tsx) | 界面模块；入口/导出：ToastLabSection、ToastShot |
| [entry.ts](entry.ts) | 实现模块；按文件名定位 entry.ts |
| [gallery.css](gallery.css) | 样式与变量 |
| [selection-lab.css](selection-lab.css) | 样式与变量 |
| [switch-lab.css](switch-lab.css) | 样式与变量 |
| [toast-lab.css](toast-lab.css) | 样式与变量 |
<!-- directory-index:end -->
