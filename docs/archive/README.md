# archive · 历史区（只读）

> **这里的东西只用来"查过去"，不作为现状依据。**
> **AI 默认不读本目录**；需要追溯某件事的来龙去脉时，按 `docs/00-索引.md` 的索引定向查。

## 为什么存在

项目走到 1.14.20 时，`docs/` 里堆了 89 份 Markdown，其中大部分是已经完成阶段的报告、被后续版本取代的草案、一次性验收记录。它们**不能删**（是"当时发生了什么、为什么这么决定"的唯一证据），但**不该出现在默认阅读路径上**。

所以：**活跃文档在 `docs/` 根与 `specs/` `ops/` `changelog/`；这里放其余全部。**

目录与各类资料职责见文末自动清单，不另维护第二份目录表。

## 使用规则

1. **不要照着这里的结论改代码** —— 先确认它在 `specs/` 或 `ops/` 里有没有更新版本。
2. 这里的历史文档**允许保留旧值、旧路径**；`pnpm check:docs` 对 `archive/` 只做链接检查，不做"值一致性"检查。
3. 发现某份历史文档**仍然在生效**（例如某条规则还被现在的实现遵守）→ 把它**提升到 `specs/` 或 `ops/`**，不要留在 `archive/`。
4. 新增历史文件时，直接放对应子目录；**不要**再在 `archive/` 里建"第二套当前状态"。

## 相关

- 当前状态：`docs/STATUS.md`
- 文档索引与阅读顺序：`docs/00-索引.md`
- 决策理由索引：`docs/adr/README.md`

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| — | 本层通过子目录组织内容 |

| 子目录 | 职责 |
|---|---|
| [announcements/](announcements/README.md) | 历史公告存档；当前公告源在 Web updateAnnouncements.ts。 |
| [design/](design/README.md) | 已完成的设计讨论、审查、草图与实验依据。 |
| [documentation/](documentation/README.md) | 文档整理前原文、Git 基线和校验清单；不指导当前开发。 |
| [logs/](logs/README.md) | 冻结开发日志、旧版本记录与 STATUS 历史快照。 |
| [misc/](misc/README.md) | 一次性评审、交流和被取代的草稿。 |
| [releases/](releases/README.md) | 历史发布、阶段验收与恢复证据；不授权当前生产操作。 |
| [screenshots/](screenshots) | 历史截图证据；不作为当前界面规格。 |
<!-- directory-index:end -->
