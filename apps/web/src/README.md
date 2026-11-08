# apps/web/src · 阅读入口

源码入口和子模块。

优先阅读[任务索引](../../../docs/00-%E7%B4%A2%E5%BC%95.md)定位权威规则，再按下表进入实现或子目录。目录清单不证明功能已验收。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [App.tsx](App.tsx) | 界面模块；按文件名定位 App.tsx |
| [book-card.css](book-card.css) | 样式与变量 |
| [consent.css](consent.css) | 样式与变量 |
| [detail-motion.css](detail-motion.css) | 样式与变量 |
| [index.css](index.css) | 样式与变量 |
| [main.tsx](main.tsx) | 界面模块；按文件名定位 main.tsx |
| [tab-header.css](tab-header.css) | 样式与变量 |
| [theme-prepaint.ts](theme-prepaint.ts) | 实现模块；按文件名定位 theme-prepaint.ts |
| [vite-env.d.ts](vite-env.d.ts) | 实现模块；按文件名定位 vite-env.d.ts |

| 子目录 | 职责 |
|---|---|
| [analysis/](analysis/README.md) | 分析查询与展示适配；计算契约位于 shared。 |
| [assets/](assets/README.md) | 静态资源。 |
| [auth/](auth/README.md) | 身份认证。 |
| [components/](components/README.md) | 跨页面共享组件；复用前查 UI 子目录和 Component Gallery。 |
| [desktop/](desktop/README.md) | 电脑端外壳与键鼠交互；遵循 desktop-ui skill。 |
| [i18n/](i18n/README.md) | 语言控制器、资源和本地化内容。 |
| [lib/](lib/README.md) | 基础逻辑与公共工具。 |
| [pages/](pages/README.md) | 业务页面；新增行为先定位产品规格与路由契约。 |
| [s19/](s19/README.md) | S19 材质与展示实现，消费现有 Token，不改变业务语义。 |
| [statsWorkbench/](statsWorkbench/README.md) | 分析工作台配置、编辑器、布局与卡片接线。 |
| [workspace/](workspace/README.md) | 工作区、面板路由、返回栈与布局。 |
<!-- directory-index:end -->
