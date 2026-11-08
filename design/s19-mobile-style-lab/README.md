# Libevra S19 · 移动端视觉实验（Style Lab）

独立的静态原型，不依赖构建、不连接后端，**不属于正式应用**（未接入 `apps/web`，不影响桌面端、Pad 端与生产构建）。

## 打开方式

| 方式 | 做法 |
|---|---|
| 电脑上对照 | 双击 `index.html`：四台手机并排（可只显示其中几套），或“单机切换”在一台手机里切风格并保留页面与滚动位置 |
| 手机上看 | 双击 `启动StyleLab.cmd`（或 `node serve.mjs`），手机与电脑连同一 Wi-Fi，打开窗口里显示的 `http://<电脑IP>:5190/` |
| 单独打开 | `a.html` / `b1.html` / `b2.html` / `c.html`；页面右侧的小把手可在四套之间切换（不重新加载，保留当前页面） |
| 上一轮存档 | `archive/r3/`：第二轮 A / B / C（Structured Editorial）与第三轮 B1 / B2 原样保留 |

对照页：页面（明细 / 分析 / 协作 / 编辑记录 / 我的 / 设置 / 记账偏好 / 账号与数据 / 账目详情）、状态（滚动后、搜索展开、筛选、排序、账本切换、邀请输入 / 成功 / 失败、记录详情、记一笔、删除确认、批量、空数据、加载中、加载失败）、屏幕尺寸、主题色（4 种）、深色方向、玻璃乳白度与模糊、同步操作 / 同步滚动、无模糊回退、减少动态。“设计说明”里有材质分配、改过的组件、布局调整与待办。

## 四种风格（第五轮 · 收敛）

同一骨架：顶部工具、月份、摘要、分段、列表、全宽底栏 + 居中“+”、贴底 Bottom Sheet、记一笔面板的位置与结构四套一致；差异只在材质。

- **A · Soft Spatial 柔和空间**：柔和背景空间上的独立卡片组合；明细与编辑记录是标准明细行，每一行是独立小卡片，上下边完全贴合（不用分割线）。
- **B1 · Ambient Frost 柔和环境磨砂**：背景一层淡乳白磨砂氛围；底栏、操作层是奶油感玻璃，顶栏在标题区收起后才出现；信息卡片与列表是瓷片（Satin）。
- **B2 · Layered Glass 分层透光玻璃**：与 B1 同一骨架；背景更清晰，顶底栏更轻更透（顶栏同样在收起后才出现）；信息卡片换成同一档透明磨砂玻璃；“+”与主操作仍是主题色瓷片。
- **C · Classic Refined 经典精修**：正式版布局；正文是一张圆角纸面压在主题色顶区下沿，卡片是纸面上的白色纸片。

## 结构

```
index.html              对照页 + 设计说明
a.html b1.html b2.html c.html   四套入口（同一套代码，只是默认风格不同）
b.html glass.html       跳转到新入口（旧版本在 archive/r3/）
lab/data.js             共享示例数据；编辑记录按服务器事件的原始形状保存（金额最小单位、UUID、附件对象）
lab/core.js             引擎：状态、路由、浮层、邀请状态机、编辑记录格式化、风格热切换、主题色 / 深色
lab/ui.js               四套共用页面模板 + 材质分配表（MAT）+ 布局变体（V）
lab/ui.css              共用组件与材质角色（Canvas / Content / Elevated / Satin / Frosted / Accent / Overlay），全部用语义变量
lab/theme-{a,b1,b2,c}.css   各风格的变量、背景、风格专属规则、深色方向
lab/base.css lab/icons.js lab/charts.js   骨架、图标、图表结构
serve.mjs               零依赖局域网静态服务器（只读本目录）
```

新增风格专属组件时：先在 `ui.js` 的 `MAT` 里为组件指定材质角色；只有当共用组件在该风格里确实不成立时，才在 `theme-*.css` 里加专属规则。

## 限制

记账表单、修改表单、账本空间、成员管理、已发出的邀请等子页面只给提示；深色只做了方向；数据为本地示例（“今天”固定为 2026-11-07）。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [S19-B2-初始化与返回错位排查交接-20261107.md](S19-B2-%E5%88%9D%E5%A7%8B%E5%8C%96%E4%B8%8E%E8%BF%94%E5%9B%9E%E9%94%99%E4%BD%8D%E6%8E%92%E6%9F%A5%E4%BA%A4%E6%8E%A5-20261107.md) | Libevra S19 B2 初始化与返回错位排查交接 |
| [S19-Inertia-Jitter-Notes.md](S19-Inertia-Jitter-Notes.md) | S19 · 明细顶部惯性滚动抖动：原理备忘 |
| [S19-Round7-Compact-Glass-Report.md](S19-Round7-Compact-Glass-Report.md) | S19 第七轮 · 明细顶部紧凑化与玻璃材质局部修正（简短报告） |
| [S19-Round8-TabMotion-Report.md](S19-Round8-TabMotion-Report.md) | S19 第八轮 · 顶栏清理、底栏弹性玻璃胶囊两套动效与摘要恢复（简短报告） |
| [S19-Visual-Integration-Report.md](S19-Visual-Integration-Report.md) | S19 视觉风格集成报告（Visual Integration Report） |
| [a.html](a.html) | 网页入口 |
| [b.html](b.html) | 网页入口 |
| [b1.html](b1.html) | 网页入口 |
| [b2.html](b2.html) | 网页入口 |
| [c.html](c.html) | 网页入口 |
| [glass.html](glass.html) | 网页入口 |
| [index.html](index.html) | 网页入口 |
| [serve.mjs](serve.mjs) | 实现模块；按文件名定位 serve.mjs |
| [启动StyleLab.cmd](%E5%90%AF%E5%8A%A8StyleLab.cmd) | Windows 本地启动工具 |

| 子目录 | 职责 |
|---|---|
| [archive/](archive/README.md) | 本层组织 archive 模块的直属文件；具体契约由任务索引定位。 |
| [lab/](lab/README.md) | 本层组织 lab 模块的直属文件；具体契约由任务索引定位。 |
<!-- directory-index:end -->
