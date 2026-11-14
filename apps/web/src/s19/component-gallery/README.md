# apps/web/src/s19/component-gallery · 阅读入口

共享组件与状态演示；`SelectionLab.tsx` 是第 09 节“选中指示与已选条件标签”设计样板（开发用，不进正式构建，`?s19=a|b1|b2|c` 切换风格）。1.19.62 起样板直接引用正式组件 `components/ui/SelectionControls.tsx` 与正式令牌，只保留定稿（A 第三版 = A2 档、玻璃不染色、B2 标签瓷片），本页只负责示例布局、慢放与定格帧。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [Gallery.tsx](Gallery.tsx) | 界面模块；按文件名定位 Gallery.tsx |
| [LayoutExamples.tsx](LayoutExamples.tsx) | 界面模块；入口/导出：HeaderPattern、ToolbarPattern、CardListPattern、FormPattern、BottomActionsPattern |
| [LayoutPatterns.tsx](LayoutPatterns.tsx) | 界面模块；入口/导出：LayoutPatterns、StandaloneBottomPattern |
| [SelectionLab.tsx](SelectionLab.tsx) | 界面模块；入口/导出：SelectionLabSection |
| [StandardStates.tsx](StandardStates.tsx) | 界面模块；入口/导出：StandardStates、StandardStatesExample |
| [entry.ts](entry.ts) | 实现模块；按文件名定位 entry.ts |
| [gallery.css](gallery.css) | 样式与变量 |
| [selection-lab.css](selection-lab.css) | 样式与变量 |
<!-- directory-index:end -->
