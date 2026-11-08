# apps/web/src/s19/optics-lab · 阅读入口

光学材质对照实验。

优先阅读[任务索引](../../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [OpticsDemo.tsx](OpticsDemo.tsx) | 界面模块；入口/导出：GLASS_NAMES、PATTERN_NAMES、OpticalRange、OpticsDemo |
| [PerformanceLab.tsx](PerformanceLab.tsx) | 界面模块；入口/导出：PerformanceLab |
| [benchmark.test.ts](benchmark.test.ts) | 测试：benchmark |
| [benchmark.ts](benchmark.ts) | 实现模块；入口/导出：BenchCase、BenchOptions、VISUAL_VARIANTS、VisualObservation、FrameMetrics |
| [entry.ts](entry.ts) | 实现模块；按文件名定位 entry.ts |
| [lab.css](lab.css) | 样式与变量 |
| [lab.tsx](lab.tsx) | 界面模块；按文件名定位 lab.tsx |
| [lens.ts](lens.ts) | 实现模块；入口/导出：makeLensBackground |
| [optics-model.ts](optics-model.ts) | 实现模块；入口/导出：OPTICS_LAB_VERSION、GlassKind、RenderMode、BackgroundPattern、Magnification |
| [optics-renderer.ts](optics-renderer.ts) | 实现模块；入口/导出：RendererStats、OpticsRenderer、createOpticsRenderer |
| [optics-shader.ts](optics-shader.ts) | 实现模块；入口/导出：OPTICS_VERTEX、OPTICS_FRAGMENT |
| [optics.test.ts](optics.test.ts) | 测试：optics |
| [scatter-texture.ts](scatter-texture.ts) | 实现模块；入口/导出：gaussianPairs、createScatterTexture |
| [stage.ts](stage.ts) | 实现模块；入口/导出：StageSnapshot、OpticalStage、createOpticalStage |
<!-- directory-index:end -->
