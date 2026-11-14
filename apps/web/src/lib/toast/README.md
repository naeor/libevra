# apps/web/src/lib/toast · 阅读入口

统一提示条（1.19.66）的纯逻辑，不依赖 React 与 DOM，便于单测：队列规则 `queue.ts`（一次一条、同 key 合并、错误与带操作抢占、等待位与过期、页面作用域）、停留时长 `timing.ts`、控制器 `controller.ts`（计时、暂停与恢复、可见计时、播报）、位置 `placement.ts`（底栏 / 操作栏 / 键盘之上，或顶部锚点之下）。界面在 [components/toast/](../../components/toast/README.md)。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [controller.test.ts](controller.test.ts) | 测试：controller |
| [controller.ts](controller.ts) | 实现模块；入口/导出：ToastClock、ToastController |
| [placement.test.ts](placement.test.ts) | 测试：placement |
| [placement.ts](placement.ts) | 实现模块；入口/导出：Box、BottomInput、bottomOffset、TopInput、topOffset |
| [queue.test.ts](queue.test.ts) | 测试：queue |
| [queue.ts](queue.ts) | 实现模块；入口/导出：QueueEntry、QueueState、Ended、QueueResult、EMPTY_QUEUE |
| [timing.test.ts](timing.test.ts) | 测试：timing |
| [timing.ts](timing.ts) | 实现模块；入口/导出：NORMAL_DWELL、WARNING_DWELL、DWELL_BASE_MS、DWELL_PER_UNIT_MS、ACTION_DWELL_MS |
| [types.ts](types.ts) | 实现模块；入口/导出：ToastTone、ToastScope、ToastEndReason、ToastAction、ToastOptions |
<!-- directory-index:end -->
