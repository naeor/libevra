# apps/web/src/components/entry · 阅读入口

记账入口与编辑组件。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [AmountField.test.tsx](AmountField.test.tsx) | 测试：AmountField |
| [AmountField.tsx](AmountField.tsx) | 界面模块；入口/导出：AmountField |
| [BatchAddSheet.render.test.tsx](BatchAddSheet.render.test.tsx) | 测试：BatchAddSheet.render |
| [BatchAddSheet.test.ts](BatchAddSheet.test.ts) | 测试：BatchAddSheet |
| [BatchAddSheet.tsx](BatchAddSheet.tsx) | 界面模块；入口/导出：BatchEntryDraft、initialBatchDraft、emptyBatchDraft、hasBatchContent、batchCardAmount |
| [CaptureAttachments.tsx](CaptureAttachments.tsx) | 界面模块；入口/导出：useCaptureAttachments、CaptureLayout、CaptureMobileAttachments |
| [CurrencySheet.tsx](CurrencySheet.tsx) | 界面模块；入口/导出：CurrencySheet |
| [EntryMoreOptions.tsx](EntryMoreOptions.tsx) | 界面模块；入口/导出：EntryMoreOptions、MoreOptionsSummaryPart、moreOptionsSummary |
| [EntryQuickActions.tsx](EntryQuickActions.tsx) | 界面模块；入口/导出：EntryQuickActions |
| [EntrySaveBar.tsx](EntrySaveBar.tsx) | 界面模块；入口/导出：EntrySaveBar |
| [capture.css](capture.css) | 样式与变量 |
| [inheritLast.ts](inheritLast.ts) | 实现模块；入口/导出：InheritedFields、InheritRefusal、InheritOutcome、inheritFromLastEntry |
| [keyboardInset.ts](keyboardInset.ts) | 实现模块；入口/导出：KEYBOARD_GAP、keyboardOffset、useKeyboardInset |
<!-- directory-index:end -->
