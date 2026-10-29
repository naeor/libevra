# Libevra

**免费的、开源的小账簿。**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-已上线-brightgreen.svg)](https://libevra.com)

> **当前状态：已上线 <https://libevra.com>**（自托管，**注册仅限邀请码**）。
> **不开放公开注册**——所有者给自己家用，账号是手工发的。
> **现在开发到哪的唯一权威是 [docs/STATUS.md](docs/STATUS.md)**；路线图见 [docs/01-规划.md](docs/01-规划.md)。
>
> **⚠️ 项目原名 Libellum，2026-10-14 因域名原因更名为 Libevra。**
> 哪些名称改了、哪些有意保留、还有哪些要人工操作：[docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md)。
>
> **🛠️ 要贡献代码，或者你是接手项目的 AI？** 先读 [AGENTS.md](AGENTS.md)。
> **要部署或运维它？** 读 [docs/03-运维手册.md](docs/03-运维手册.md)——怎么查**当前**状态（而不是相信文档里的数字）、什么命令绝对不能跑。

Libevra 是一个开源、可自托管的记账工具，面向个人与家庭。目标是做成那种可以放心交给家里长辈用的东西：
手机上打开就快、没有广告、不做追踪、不需要第三方账号——只有你自己的服务器和你自己的数据。

## 现在已经能用的

| 模块 | 状态 |
|---|---|
| 账号 | 用户名 + 密码、邀请码注册、**一次性恢复码**找回密码（不依赖邮件）、**一个账号可以同时登录多台设备**（每台一个会话，登出只影响当前那台） |
| 记账 | 收支都记；多层级分类、支付方式、标签、**一本账内混记多币种**、备注、精确到秒的记账时刻与时区 |
| 明细 | 按币种分列的当月支出/入账/结余、收支切换、按日分组的流水、筛选、软删除 + 5 秒撤销 |
| 分析 | 模块化分析工作台：现成分析卡片、筛选、可选的多币种折算、自定义与组合卡片、可编辑布局与预设、按账号同步布局——**图表全部手写 SVG**，不引图表库 |
| 截图识别 | 上传付款截图 → 本地 OCR 读取字段 → 核对修改 → 入账。**图片从不落盘，也从不发往第三方** |
| **离线** | **能离线记账、改、删、看历史与统计**；恢复网络自动同步（幂等，不重复）；两台设备改同一笔时**不冲突的字段自动合、冲突的字段让你选** |
| 导出 / 导入 | CSV / XLSX 导出 + CSV 导入历史账，带 `In-` / `Out-` 可追溯编号 |
| 协作 | 一个账号多本账、**所有者 / 编辑者 / 查看者**、带有效期与名额的邀请、账本留言、分享链接 |
| 外观 | 中英双语、浅色 / 深色 / 跟随系统、七套主题色 |
| 尚未开发 | 公开只读演示账号 |

## 本地运行

```bash
pnpm install
cp .env.example .env          # 再填你自己的数据库口令
pnpm db:generate && pnpm db:deploy
```

Windows 日常入口是 `start-dev-lan.cmd`：打开 `http://localhost:5173`（API 在 `127.0.0.1:3000`）。
端口、手机 HTTPS 与排错见 [docs/ops/本地开发环境与5173.md](docs/ops/本地开发环境与5173.md)；前置条件与常用命令见 [docs/04-交接.md](docs/04-交接.md) §2。

## 数据为什么是可追溯的

任何跨越账本边界的东西都带一个能看出方向的编号：

```
Out-20261010-153012-a3f9   离开这本账（导出时生成）
In-20261010-153012-b7c2    进入这本账（导入时生成）
```

每一笔流水另外记录**它来自文件里的哪个唯一值**（`source_ref`）与**是哪个导入批次带进来的**（`import_ref`）。
导出只记元数据——**不记流水内容、不记文件本体**；导入记录收到多少行、其中多少行本来就在库里。
编号的格式由**数据库 CHECK 约束**保证，而不是靠约定——**追不到的编号根本写不进去**。
详见 [docs/archive/design/S6-导出与导入-设计决定.md](docs/archive/design/S6-导出与导入-设计决定.md)。

## 技术栈

| 层次 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query |
| 后端 | Node.js + Fastify + TypeScript + Zod |
| 数据库 | PostgreSQL 17 + Prisma（迁移文件进仓库） |
| OCR | Python 常驻进程、本地推理（RapidOCR），走 stdin/stdout JSON，**不开端口** |
| 部署 | Docker Compose + Caddy（自动 HTTPS） |
| CI | GitHub Actions：类型检查 → 干净库上跑迁移 → 测试 → 构建 |

## 项目文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 贡献者与 AI 的规则：先读什么、什么必须先批准、该跑哪些检查 |
| [docs/STATUS.md](docs/STATUS.md) | **唯一的当前状态** |
| [docs/00-索引.md](docs/00-索引.md) | 全部文档的导航：哪些必读、哪些是参考或历史 |
| [docs/01-规划.md](docs/01-规划.md) | 路线图（顶部是现行路线一页纸） |
| [docs/02-技术方案.md](docs/02-技术方案.md) | 技术方案：架构、数据模型、API、安全、部署与成本 |
| [docs/04-交接.md](docs/04-交接.md) | 怎么跑、代码怎么组织、怎么和所有者协作 |
| [docs/changelog/1.17.md](docs/changelog/1.17.md) | 每一版改了什么 |
| [docs/specs/product/Libevra品牌迁移记录.md](docs/specs/product/Libevra品牌迁移记录.md) | 从 Libellum 改名：改了什么、有意保留什么、还要人工做什么 |

## 隐私

Libevra 不包含任何统计或广告 SDK，不出售数据。它保存的唯一数据就是你自己在**你自己的服务器**上录入的内容。
用于识别的付款截图在内存中解码、**从不写入磁盘**，也从不发往任何第三方服务。

## 开源协议

采用 **GNU Affero 通用公共许可证 v3.0**——见 [LICENSE](LICENSE)。

简单说：你可以自由使用、研究、修改和分发本软件；但如果你把修改版作为网络服务提供给他人使用，
你也必须公开你的修改版源码。这是刻意的选择：这个工具应当对使用者保持免费，没人能把它变成闭源服务来卖。

**改名没有改动许可证。** [LICENSE](LICENSE) 是 AGPL-3.0 官方全文，一字未动。

---

English version: [README.md](README.md)
