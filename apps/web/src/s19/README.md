# apps/web/src/s19 · 阅读入口

> 最后修改：2026-11-09 09:27（UTC+08:00）


S19 材质与展示实现，消费现有 Token，不改变业务语义。

优先阅读[任务索引](../../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

`product.ts` 加载四套正式可选材质；开发把手仍由 `lab.ts` 门禁控制。B1 背景强度复用 material 映射，B2 继续使用既有账号级 glass 存储；正式选择器位于 pages/AppearanceStyleSection。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [B2GlassScope.tsx](B2GlassScope.tsx) | 界面模块；入口/导出：B2GlassScope |
| [B2GlassSection.tsx](B2GlassSection.tsx) | 界面模块；入口/导出：B2PresetChoices、B2GlassSection |
| [OceanMaterial.tsx](OceanMaterial.tsx) | 界面模块；入口/导出：OceanLook、resolveColors、OceanMaterial |
| [StyleLabDock.tsx](StyleLabDock.tsx) | 界面模块；入口/导出：StyleLabDock |
| [VisualStyleLabSection.tsx](VisualStyleLabSection.tsx) | 界面模块；入口/导出：VisualStyleLabSection |
| [WallpaperSection.tsx](WallpaperSection.tsx) | 界面模块；入口/导出：WallpaperChoices、WallpaperSection |
| [ambient.css](ambient.css) | 样式与变量 |
| [b2Admin.ts](b2Admin.ts) | 实现模块；入口/导出：createB2AdminEditor |
| [b2Glass.test.ts](b2Glass.test.ts) | 测试：b2Glass |
| [b2Glass.ts](b2Glass.ts) | 实现模块；入口/导出：B2GlassValues、B2_GLASS_PRESETS、B2GlassPreset、B2GlassMode、B2_CHROME_BLUR |
| [classic.css](classic.css) | 样式与变量 |
| [compact.css](compact.css) | 样式与变量 |
| [dock.css](dock.css) | 样式与变量 |
| [editor-surfaces.css](editor-surfaces.css) | 样式与变量 |
| [entry-workspace.css](entry-workspace.css) | 样式与变量 |
| [lab.ts](lab.ts) | 实现模块；入口/导出：startStyleLab |
| [labDock.test.ts](labDock.test.ts) | 测试：labDock |
| [labDock.ts](labDock.ts) | 实现模块；入口/导出：wantsStyleLabDock |
| [material-components.css](material-components.css) | 样式与变量 |
| [material-effects.css](material-effects.css) | 样式与变量 |
| [material.test.ts](material.test.ts) | 测试：material |
| [material.ts](material.ts) | 实现模块；入口/导出：MATERIAL_DEFAULTS、MaterialFinish、MaterialRole、MaterialAppearance、materialAttributes |
| [ocean-material.css](ocean-material.css) | 样式与变量 |
| [ocean-material.test.tsx](ocean-material.test.tsx) | 测试：ocean-material |
| [oceanBrand.test.ts](oceanBrand.test.ts) | 测试：oceanBrand |
| [oceanBrand.ts](oceanBrand.ts) | 实现模块；入口/导出：OceanBrandSize、OceanBrandLayers、oceanBrandPresentation |
| [oceanLayers.test.ts](oceanLayers.test.ts) | 测试：oceanLayers |
| [oceanLayers.ts](oceanLayers.ts) | 实现模块；入口/导出：LAYERS、layerRank、LAYER_MOTION、LOGO_MOTION、layerTarget |
| [oceanPainter.ts](oceanPainter.ts) | 实现模块；入口/导出：PainterLook、PainterColors、LIGHT_PERIOD、LIGHT_SWING、lightCentre |
| [oceanPhase.ts](oceanPhase.ts) | 实现模块；入口/导出：oceanPhase |
| [overlays.css](overlays.css) | 样式与变量 |
| [product.ts](product.ts) | 实现模块；入口/导出：startB2Appearance |
| [s19-lab-tokens.css](s19-lab-tokens.css) | 样式与变量 |
| [s19.css](s19.css) | 样式与变量 |
| [shared.css](shared.css) | 样式与变量 |
| [tabIndicator.ts](tabIndicator.ts) | 实现模块；入口/导出：startTabIndicator |
| [tabMotion.ts](tabMotion.ts) | 实现模块；入口/导出：TabMotion、TAB_MOTIONS、TAB_MOTION_STORAGE_KEY、TAB_MOTION_LABELS、tabMotion |
| [tabglass.css](tabglass.css) | 样式与变量 |
| [useBottomNavUnderlay.test.ts](useBottomNavUnderlay.test.ts) | 测试：useBottomNavUnderlay |
| [useBottomNavUnderlay.ts](useBottomNavUnderlay.ts) | 实现模块；入口/导出：useBottomNavUnderlay |
| [wallpaper.css](wallpaper.css) | 样式与变量 |
| [wallpaper.test.ts](wallpaper.test.ts) | 测试：wallpaper |
| [wallpaper.ts](wallpaper.ts) | 实现模块；入口/导出：WALLPAPERS、Wallpaper、DEFAULT_WALLPAPER、WALLPAPER_STORAGE_KEY、parseWallpaper |
| [wallpaperEdges.ts](wallpaperEdges.ts) | 实现模块；入口/导出：startWallpaperEdges |

| 子目录 | 职责 |
|---|---|
| [adaptation-lab/](adaptation-lab/README.md) | 业务表面适配实验。 |
| [avatar-lab/](avatar-lab/README.md) | 头像材质实验。 |
| [component-gallery/](component-gallery/README.md) | 共享组件与状态演示。 |
| [motion/](motion/README.md) | 主 Tab、对象展开、模式入口和次级导航的呈现协调；不能混淆层级。 |
| [optics-lab/](optics-lab/README.md) | 光学材质对照实验。 |
<!-- directory-index:end -->
