# apps/web/src/s19/motion · 阅读入口

主 Tab、对象展开、模式入口和次级导航的呈现协调；不能混淆层级。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [aTabs.css](aTabs.css) | 样式与变量 |
| [aTabs.ts](aTabs.ts) | 实现模块；入口/导出：ControlledGlide、captureATabs、syncATabs、startATabs |
| [abc.css](abc.css) | 样式与变量 |
| [abcBridge.ts](abcBridge.ts) | 实现模块；入口/导出：ABCPresentation、registerABCPresentation、A_VARIANTS、aVariant、chooseAVariant |
| [abcPresentation.ts](abcPresentation.ts) | 实现模块；入口/导出：snapshot、restoreSnapshot、ABCPagePresentation |
| [abcRuntime.ts](abcRuntime.ts) | 实现模块；入口/导出：startABCRuntime |
| [ambientLayout.ts](ambientLayout.ts) | 实现模块；入口/导出：AmbientShape、AmbientLayout、MAX_AMBIENT_SHAPES、describeLayout、layoutBackground |
| [backdrop.test.ts](backdrop.test.ts) | 测试：backdrop |
| [backdrop.ts](backdrop.ts) | 实现模块；入口/导出：Scheme、Material、Inheritance、Direction、MotionOptions |
| [engine.test.ts](engine.test.ts) | 测试：engine |
| [engine.ts](engine.ts) | 实现模块；入口/导出：MotionSample、MotionEnvironment、SNAPSHOT_BUDGET_BYTES、MotionEngine、percentile |
| [enterMode.test.ts](enterMode.test.ts) | 测试：enterMode |
| [enterMode.ts](enterMode.ts) | 实现模块；入口/导出：enterModeOptions、EnterModePresentation |
| [hybrid.css](hybrid.css) | 样式与变量 |
| [hybrid.test.ts](hybrid.test.ts) | 测试：hybrid |
| [hybrid.ts](hybrid.ts) | 实现模块；入口/导出：prepareHybrid |
| [lab-entry.ts](lab-entry.ts) | 实现模块；按文件名定位 lab-entry.ts |
| [labAmbient.test.ts](labAmbient.test.ts) | 测试：labAmbient |
| [motion.css](motion.css) | 样式与变量 |
| [navigation.css](navigation.css) | 样式与变量 |
| [navigation.test.ts](navigation.test.ts) | 测试：navigation |
| [navigation.ts](navigation.ts) | 实现模块；入口/导出：NavigationLevel、navigationLevel、isTabSwitch、hasDefaultMotion、isDefaultMotionEdge |
| [objectExpand.css](objectExpand.css) | 样式与变量 |
| [objectExpand.test.ts](objectExpand.test.ts) | 测试：objectExpand |
| [objectExpand.ts](objectExpand.ts) | 实现模块；入口/导出：ObjectSource、objectSource、findObject、setPose、ObjectExpandPresentation |
| [pilot.css](pilot.css) | 样式与变量 |
| [pilot.tsx](pilot.tsx) | 界面模块；入口/导出：PilotAdapter、MotionPilot |
| [tabExchange.css](tabExchange.css) | 样式与变量 |
| [tabExchange.test.ts](tabExchange.test.ts) | 测试：tabExchange |
| [tabExchange.ts](tabExchange.ts) | 实现模块；入口/导出：TAB_ORDER、TAB_EASING、TAB_DURATION、tabIndex、TabExchangePresentation |
<!-- directory-index:end -->
