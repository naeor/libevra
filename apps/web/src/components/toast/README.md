# apps/web/src/components/toast · 阅读入口

统一提示条（Toast，1.19.66）：应用级队列 `ToastProvider` 与调用接口 `useToast()`、每个外壳一个显示宿主 `ToastViewport`、一条提示的外观 `ToastCard`。短暂反馈一律走这里，不要在页面里再写固定定位的 `role="status"` 提示条（守卫 `toast.guard.test.ts`）。纯逻辑（队列、时长、位置）在 [lib/toast/](../../lib/toast/README.md)，S19 四风格材质在 [s19/toast.css](../../s19/toast.css)。现行规则见 [S19 设计系统](../../../../../docs/specs/design/S19-材质组件与动效设计系统.md) §3「提示条」。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [Toast.tsx](Toast.tsx) | 界面模块；入口/导出：ToastGlyph、ToastPhase、ToastCard |
| [ToastProvider.tsx](ToastProvider.tsx) | 界面模块；入口/导出：ToastLeading、AppToastOptions、AppToastController、ToastProvider、useToastController |
| [ToastViewport.test.tsx](ToastViewport.test.tsx) | 测试：ToastViewport |
| [ToastViewport.tsx](ToastViewport.tsx) | 界面模块；入口/导出：ToastHostKind、TOAST_YIELD_SELECTOR、TOAST_OBSTACLE_SELECTOR、TOAST_TOP_ANCHOR_SELECTOR、shouldYield |
| [toast.css](toast.css) | 样式与变量 |
| [toast.guard.test.ts](toast.guard.test.ts) | 测试：toast.guard |
<!-- directory-index:end -->
