# Libevra 实际数据流向与隐私事实调查 V0.1

> 最后修改：2026-11-15 02:25（UTC+08:00）
> 状态：V0.1 只读调查（2026-11-15）。依据是仓库代码与部署配置，不是隐私承诺；未在服务器上核对的内容标「待核实」。不含任何密钥、令牌或真实用户数据。

## 怎么读这份文档

- 与 [法律文件设计要点说明 V0.1](Libevra-法律文件设计要点说明-V0.1.md) 的关系：本文提供「实际发生了什么」的事实，那份提供「政策怎么起草」的原则；本文不是政策正文，也不含法律判断。
- 结论分四种口径：**线上运行**（生产为标签 `v1.19.56`，代码依据可直接引用）、**仅本机未部署**（1.19.57–1.19.82 的 Web 客户端改动）、**尚未实现（只有设计）**、**待核实**（代码无法回答，需到服务器、云控制台、浏览器或所有者处确认）。
- 依据写作 `文件:行`，路径相对仓库根；为节省篇幅，`api/` = `apps/api/src/`，`web/` = `apps/web/src/`，`schema` = `prisma/schema.prisma`。「成员」指账本中 `leftAt` 为空的现任成员；角色为 owner / editor / recorder / viewer。
- 第 8 节汇总全部待核实项，第 9 节是风险表，第 10 节对照起草要点第八节逐条回答。

## 1. 调查范围与依据

**三个方向**：A 服务器与数据库（`apps/api`、`prisma`）；B 附件、识别、部署、备份、日志与第三方服务（`deploy`、`apps/ocr`、`apps/voice`）；C 浏览器与设备本地数据、游客模式、客户端外发请求（`apps/web`）。

**版本口径（负责人已核实）**：

| 项 | 事实 |
|---|---|
| 生产版本 | 标签 `v1.19.56`（源码 `ff6617d5`） |
| 本机开发版本 | 1.19.82 |
| 服务器端是否与线上一致 | 自 `v1.19.56` 以来 `apps/api`、`apps/ocr`、`apps/voice`、`deploy`、`packages/shared/src` 除版本号外没有改动，所以读当前工作区的这些目录即读线上代码 |
| Web 客户端 | 1.19.57–1.19.82 有改动，**仅本机，未部署**（见第 7 节）；C 方向用 `git diff v1.19.56..HEAD` 核对过这一区间 |
| 未核对的部署事实 | 服务器上的实际配置（`.env`、systemd 定时器、COS 生命周期、Docker 日志轮转等）未在服务器上核对，全部见第 8 节 |

**读过的主要文件**：

- 数据库与路由：`prisma/schema.prisma`（全部模型）、`apps/api/src/app.ts`、`server.ts`、`routes/*`、`auth/*`、`consent/*`、`collab/*`、`lifecycle/*`、`ledger/*`、`critical/*`、`fx/*`、`import/*`、`ocr/client.ts`、`voice/client.ts`、`scripts/*`。
- 识别与附件：`apps/ocr/service.py`、`apps/voice/service.py`、`apps/ocr/requirements.txt`、`deploy/Dockerfile.api`、`routes/attachments.ts`、`routes/attachmentExport.ts`、`routes/recognize.ts`、`routes/voice.ts`。
- 部署与备份：`deploy/docker-compose.prod.yml`、`docker-compose.release-1.19.56.yml`、`critical-events-relay.compose.yml`、`Caddyfile`、`backup*.sh`、`alert-mail.sh`、`heartbeat.sh`、`critical-events-*.sh`、`deploy/systemd/*`；环境变量只看示例文件中的变量名。
- 浏览器端：`apps/web/src` 下的 `lib/offline/*`、`lib/guest/*`、`auth/AuthProvider.tsx`、`lib/api.ts`、`lib/attachments.ts`、`lib/consent.ts`、`lib/ocr/*`、`public/sw.js`、`index.html`、`vite.config.ts`，以及全站对 `localStorage|sessionStorage|indexedDB|caches.|fetch(` 的检索。
- 作线索的文档（与代码冲突时以代码为准）：`docs/specs/product/S17-A-安全与隐私能力事实清单-20261025.md`、`docs/公开文案与隐私审查报告-20261029.md`、S13-G / S13-H 设计决定、`deploy/README.md`、运维手册、1.19.56 / 1.18.02 发布记录、`docs/changelog/1.19.md`。

**没做的事**：

- 没有连接生产服务器，没有运行迁移或任何写库命令，没有读 `.env`、`.backup*.env`、私钥或 `docs/恢复码.docx`。
- 没有在浏览器里实测 IndexedDB / localStorage 的实际键与大小，没有联网，没有读真实用户数据；浏览器端结论由代码推断。
- 没有核对腾讯云 / COS / Resend / Healthchecks 的控制台；备份保留期、云服务地区等引用的是仓库文档。
- 没有对法律适用做判断。

**三份调查之间的核对（已核对源码，以代码为准）**：

| 冲突 / 差异 | 核对结果 |
|---|---|
| API 日志级别所在行，A 写 `server.ts:25`，B 写 `server.ts:21` | 已核对 `apps/api/src/server.ts:25`：`logger: { level: env.nodeEnv === "production" ? "info" : "debug" }`，以 A 为准 |
| `UPLOAD_DIR` 在 compose 中的行，A 写 `:104-105`，B 写 `:108` | 已核对 `deploy/docker-compose.prod.yml:108`（`UPLOAD_DIR`）与 `:107`（`SESSION_SECRET`），以 B 为准 |
| 关键事件类型数量，A 写「约 36 种实际写入」，B 写「39 类」 | 已核对 `apps/api/src/critical/types.ts:4-50`：定义 39 类；A 的 36 是按调用点统计的实际写入类型，两者不矛盾，本文写「定义 39 类，实际写入约 36 类」 |
| `backup_logs` 写入方，A 标「待核实」，B 找到 `backup-log.sh` | 已核对 `deploy/backup-log.sh:97`（`insert into backup_logs`），确认由备份脚本写入 |
| 注销是否处理 `entry_attachments.uploader_name` 等冻结昵称，A 称未回写，B 标待核实 | 已核对 `apps/api/src/lifecycle/account.ts`：对 `attachment`、`uploaderName`、`actorName` 无任何命中，确认注销流程未处理这些副本 |
| A 把 Python 子进程写成「不联网」，B 发现语音模型首次使用会向 huggingface.co 下载 | 不矛盾：A 说的是 API 侧代码无网络调用；B 查的是 Python 依赖本身。本文以 B 为准补入第 5 节 |
| `account.created` 关键事件是否含用户名 | 已核对 `apps/api/src/routes/auth.ts:435-439`：`afterState` 含 `accountNumber`、`username`、`isAdmin`；B 称事件注释声明「不传账目内容」，与此不冲突 |

## 2. 数据类别和处理目的

「处理目的」只写代码里看得出的用途；看不出的写「待核实」。

| 数据类别 | 具体内容 | 处理目的（代码可见） |
|---|---|---|
| 账号与身份 | 用户名、昵称、8 位账号编号、头像、默认币种、时区、是否演示 / 管理员、最近账本、邀请关系；密码与恢复码只存 argon2id 哈希；无邮箱、手机号、真实姓名、证件号字段 | 登录与识别账号；成员列表与按用户名 / 账号编号查找他人以邀请；管理员核验账号；邀请关系用于邀请码额度与提醒 |
| 会话与设备 | 会话（令牌 SHA-256 哈希、30 天有效期、`ip_address`、`user_agent`）；请求头里的设备 UUID（`x-libellum-device`）、时区（`x-libellum-time-zone`）、语言（`accept-language`）、当前账本；登录失败计数（仅内存） | 保持登录；时区用于账目本地日期与时区限定头像判定；设备 UUID 用于离线修改冲突时区分设备；IP / UA 的具体用途待核实（代码中只见写入，管理员只看到「有效会话数」） |
| 账本、账目及其修改记录 | 账本名与编号、成员与角色；账目金额、币种、收支、时间、分类、支付方式、备注、标签、记录人；`value_history`（最近 20 个旧值）；`transaction_events`（谁何时改了什么、前后值、完整快照、`source_ip`）；账本操作日志；冲突记录；导入去重记忆 | 记账与查看；多成员协作与改动可追溯；离线同步冲突处理；导入去重 |
| 分类 / 支付方式 / 标签 | 名称、图标、颜色、排序、归档标记；账目与标签关联 | 账目归类与统计 |
| 附件 | 文件名、媒体类型、大小、sha256、上传者及冻结昵称；文件内容（PostgreSQL `bytea`）；与账目的关联 | 给账目挂凭证文件，成员预览 / 下载 |
| 拍照识别图片 | 用户选的截图 / 照片（最多 5 张，每张 ≤10 MB） | 在服务器本机 OCR 出金额等候选，生成记账草稿；服务端不保存图片与识别结果 |
| 音频与转写 | 录音（≤2 MB、≤30 秒）；转写文本与金额 / 分类猜测 | 在服务器本机转写并生成记账草稿；服务端不保存音频与转写结果 |
| 账单导入文件 | CSV / 微信 / 支付宝 / 银行账单、PDF 等（≤10 MB）；导入记录只存指纹与行数；游客账本导入的来源快照暂存于任务表 | 解析成预览并写入账目；导入去重与撤销 |
| 协作 | 成员、角色、邀请与通知（≤200 字）、分享链接（令牌哈希、角色、天数、次数）、留言板（≤500 字，含引用快照）、账目修改提醒 | 多人共用账本；邀请加入；成员间沟通；被改动提醒 |
| 同意与公告阅读记录 | 协议同意（文档 id、版本、内容哈希、时间）；重大公告确认 / 查看 / 关闭记录 | 记录用户对哪一版协议或公告作过动作；生产当前不产生协议同意记录（见 7.1） |
| 奖励 / 头像 | 头像解锁、奖励事件、补发记录、时区变更记录 | 按账户时区判定限定头像，登录时解锁 |
| 汇率（公共数据） | 日期、汇率表、来源；不含用户或金额 | 外币折算；由服务器按需向公共汇率源取回并缓存 |
| 导出记录 | 导出人、时间、格式、行数、筛选条件（月份、类型、分类等） | 让成员看到谁导出过账本 |
| 关键事件 | 账号 / 账本生命周期、成员与权限、凭据变更、邀请 / 分享、同意等（定义 39 类，实际写入约 36 类）；含执行者 id 与账号编号、前后状态快照、哈希链 | 防篡改审计与灾难恢复后补删（墓碑重放）；其他用途待核实 |
| 运行日志 | 请求日志（方法、完整 URL、客户端 IP、状态码、耗时）；错误日志；语音 / OCR 计时 | 运维排错；是否另有用途待核实 |
| 备份 | 整库 `pg_dump`（含全部上述服务器数据与附件内容）；关键事件检查点备份 | 灾难恢复；删除后补删依赖备份期限 |
| 浏览器本地数据 | 账目副本、查询缓存、未同步改动、设备 UUID、诊断日志、待上传附件原件、偏好、游客账本（详见 3、4 节） | 离线可读 / 可写、自动同步、游客本机记账、界面偏好 |

## 3. 数据流向表

存储缩写：LS = localStorage；SS = sessionStorage；IDB = IndexedDB；CS = Cache Storage；DB = 服务器 PostgreSQL；内存 = 进程或页面内存。口径：除标注「仅本机」外均为线上运行。

| 数据 | 产生位置 | 是否上传服务器 | 处理位置 | 保存位置 | 可访问的角色或服务 | 删除条件 | 依据 |
|---|---|---|---|---|---|---|---|
| 账号资料与密码 / 恢复码哈希 | 注册 / 改资料 | 是 | 服务器 | DB `users` | 本人；成员见用户名、昵称、账号编号、头像；任何登录用户可凭精确用户名或账号编号查到对方这四项；管理员可按精确用户名或账号编号查询 | 注销时匿名化（用户名改写为 `closed_<id>`、昵称改写、密码换随机哈希、恢复码清空），行不删；账号编号、头像、币种、时区、注册时间保留 | `api/routes/auth.ts:304-306`；`api/lifecycle/account.ts:715-733`；`api/routes/directory.ts:64-130`；`api/routes/admin.ts:397-445` |
| 登录会话 | 登录 / 注册 | 是（Cookie 随请求） | 服务器 | DB `sessions`（含 IP、UA）；浏览器 Cookie `libellum_session` | 服务器；DB 层；管理员仅见有效会话数 | 登出删当前行；改密 / 重置 / 停用删全部；注销只置 `revoked_at` 不删行；自然过期的行无清理 | `api/routes/auth.ts:106-118,540,625,683`；`api/lifecycle/account.ts:691-694`；`api/auth/guard.ts:31-52` |
| 登录失败计数、全站请求限流 | 登录 / 每个请求 | 是（请求本身） | 服务器 | 内存（15 分钟窗口；限流存储为插件默认，待核实） | 无 | 窗口结束或进程重启 | `api/auth/login-throttle.ts:15-56`；`api/app.ts:143-146` |
| 设备 UUID / 时区 / 语言 / 账本 id 请求头 | 浏览器每个请求（含游客的 `/auth/me`） | 是 | 服务器 | 设备 UUID 在服务端仅存入 `transactions.value_history`、`transaction_conflicts` 与一行日志；时区存 `users.time_zone`；浏览器侧设备 UUID 在 IDB `device-id` | 成员（冲突界面是否展示待核实） | 浏览器侧：仅「清本机」整库删除或清站点数据；服务端随账目 | `web/lib/api.ts:109-122`；`web/lib/offline/device.ts:17-44`；`api/routes/transactions.ts:169-173,971-972` |
| 账目 | 记账 / 导入 / 识别确认 | 是（离线时先存本机再同步） | 服务器 | DB `transactions`；浏览器 IDB `ledger-months`、`query-cache` | 成员（含只读）可读；记账角色只能改 / 删自己的，编辑全部可改全部 | 软删除（`deleted_at`），可无限期恢复、无自动清除；账本永久清理时物理删除 | `api/routes/transactions.ts:1090-1197`；`api/ledger/access.ts:79-102`；`api/lifecycle/book.ts:800` |
| 账目修改历史 / 快照 / `value_history` / `source_ip` | 每次增改删恢复 | 是 | 服务器 | DB `transaction_events`、`transactions.value_history` | 成员可读前后值与昵称；`source_ip` 无任何读取路径，仅 DB 层可见 | 随账本级联删除；无单独保留期；账目被软删不影响 | `api/ledger/events.ts:68-92`；`api/ledger/history.ts:56-65`；`api/ledger/auditContext.ts:12-22` |
| 本机未同步改动与冲突记录 | 离线或在线修改 | 同步时上传账目，标记本身不上传 | 浏览器 | IDB `ledger-marks:<账号>:<账本>`；`offline-log` | 本机浏览器使用者 | 同步成功逐条清除；「清本机」整库删；退出登录不清 | `web/lib/offline/localLedger.ts:380-470`；`web/lib/offline/sync.ts:225-290` |
| 本机账目副本与查询缓存 | 服务器响应缓存 | 否（来自服务器） | 浏览器 | IDB `ledger-months:*`、`query-cache:*`，明文、不过期 | 本机浏览器使用者 | 注销、归档 / 退出 / 删除该账本、「清本机」；**退出登录不清** | `web/lib/offline/cache.ts:42-45,215,399`；`web/auth/AuthProvider.tsx:133-144` |
| 分类 / 支付方式 / 标签 | 用户录入 / 默认预设 | 是 | 服务器 | DB；浏览器缓存同上 | 成员 | 用户单独删除（需编辑全部）；随账本级联删除 | `api/routes/classification.ts:280,499,670` |
| 附件元数据与内容 | 用户选文件 | 是（先存本机 IDB `pending`，分块上传） | 服务器 | DB `entry_attachments`、`entry_attachment_chunks.data`（bytea，无应用层加密）；备份 | 现任成员（含只读）可列出 / 下载；上传者或（上传者已离开时）编辑全部可删 / 恢复 / 永久清理 | 软删除后不自动清除，需人工「永久清理」；账本永久清理时级联删除；未完成上传 1 小时后自动清 | `api/routes/attachments.ts:84-91,94,238-323`；`schema:2120-2160` |
| 待上传附件原件 | 用户在附件区选文件 | 关联账目后每 30 秒重试上传；未关联的草稿附件不上传 | 浏览器 | IDB 库 `libevra-attachments-v1`（`pending`，含完整 Blob） | 本机浏览器使用者 | 上传成功、用户取消；**没有任何清理入口**（退出、注销、清本机均不涉及该库） | `web/lib/attachments.ts:34-100`；`web/components/Attachments.tsx:30-60` |
| 拍照识别图片 | 用户选图 | 是（`POST /recognize`，登录后） | 服务器 api 容器内 Python 子进程（RapidOCR，模型随包本地提供，不联网） | 不落盘、不入库（仅内存与 stdin / base64）；浏览器仅内存与预览 URL | 服务器进程 | 请求结束即释放；无临时文件 | `api/routes/recognize.ts:68-147`；`api/ocr/client.ts:219-353`；`apps/ocr/service.py:128` |
| 识别结果（含原文 `rawText`、账户字段） | 识别响应 | 否（响应返回浏览器） | 浏览器 | SS `libellum:ocr-review-batch`；确认后按普通账目写入 DB | 当前标签页使用者 | 确认导入、取消、关闭标签页；退出 / 注销不专门清 | `web/lib/ocr/types.ts:12-37`；`web/lib/ocr/batchStore.ts:1-110` |
| 语音录音与转写 | 浏览器录音 | 是（`POST /voice/transcribe`） | 服务器 api 容器内 Python 子进程（whisper.cpp） | 不落盘；浏览器仅内存 | 服务器进程 | 请求结束即释放 | `api/routes/voice.ts:36-233`；`api/voice/client.ts:10-23`；`apps/voice/service.py:213` |
| 文字 / 粘贴识别 | 用户粘贴文字 | 否（浏览器内解析，无网络） | 浏览器 | 仅内存草稿 | 当前页面 | 刷新或离开即丢 | `web/pages/PastePage.tsx:8,56`；`web/lib/captureTextDraft.ts:5-15` |
| 账单导入文件与预览 | 用户上传 | 是 | 服务器内存解析（PDF 等起 Python 子进程，无网络调用代码） | 预览仅内存（容量 25、TTL 30 分钟）；确认后写账目；导入记录存指纹与行数 | 发起人 | 30 分钟过期、提交或进程重启；`import_logs` 随账本级联删除 | `api/import/cache.ts:39-60`；`api/import/service.ts:842-855`；`api/import/extractor.ts:162` |
| 游客账本导入的来源快照 | 用户在导入页选择 | 是（整份游客快照随请求上传） | 服务器 | DB `ledger_import_jobs.payload`（完成 / 取消 / 超期后清空）；浏览器 LS `libellum-ledger-import-task:*` | 发起人 | 任务完成或放弃后清除；`ledger_*` 六张表无外键，账本清理后仍保留 | `api/ledger/importJob.ts:1616-1670`；`web/lib/ledgerImport/journal.ts:10-45` |
| 游客账本 | 游客记账 | 否（正常使用不上传） | 浏览器 | IDB 库 `libellum-guest`；LS `libellum-guest-identity` | 本机浏览器使用者 | 「清除游客数据」「清除此设备全部本地数据」；浏览器清站点数据 | `web/lib/guest/storage.ts:20,175-184`；`web/lib/guest/cleanup.ts:27-80` |
| 邀请码 / 通知 / 分享链接 | 管理员或用户生成 | 是 | 服务器 | DB `registration_invites`（码明文）、`notifications`、`book_share_links`（令牌哈希） | 发件人、收件人、账本管理员；持链接的登录用户可预览账本名与邀请人昵称 | 撤回删通知；链接过期 / 撤销只置状态；通知无到期清理；注销时撤销未用邀请码与链接、删本人通知 | `api/collab/share.ts`；`api/routes/share.ts:121-250`；`api/lifecycle/account.ts:695-709` |
| 留言板 | 成员发言 | 是 | 服务器 | DB `book_messages`（含冻结昵称与引用快照） | 全体成员 | 无编辑 / 删除接口；账本清理时级联删除 | `api/routes/share.ts:379-529` |
| 协议同意 / 公告阅读记录 | 注册 / 弹窗操作 | 是 | 服务器 | DB `agreement_acceptances`、`major_announcement_acknowledgements`；仅本机版新增 LS `libevra.consent-status:<账号>` | 本人；DB 层 | 用户行级联；注销不删；生产当前不产生协议同意记录 | `api/routes/consent.ts:126-213`；`packages/shared/src/consent.ts:253-264` |
| 汇率请求 | 登录用户选日期 | 是（只发日期） | 服务器按需向 `api.frankfurter.dev` 取回 | DB `fx_snapshots`、`fx_resolutions`；浏览器 IDB `fx-public-rates-v1` | 已登录用户 | 无删除逻辑；不含用户数据 | `api/fx/provider.ts:14-15`；`api/fx/routes.ts:11-30`；`web/lib/fxView.ts:33-37` |
| 导出记录与导出文件 | 成员导出 | 导出即从服务器下载 | 服务器生成 CSV / XLSX | DB `export_logs`；文件由浏览器下载，服务端不落库 | 全体成员可见导出人昵称与用户名 | 随账本级联删除 | `api/routes/export.ts:171-362` |
| 关键事件 | 账号 / 账本 / 成员 / 凭据等变更 | 是（事务内入库） | 服务器；relay 进程加密后上传腾讯 COS | DB `critical_events`（只追加）；COS 加密对象（禁止覆盖） | 管理员见保护状态；DB 层 | 代码中无任何删除路径 | `api/critical/store.ts`；`api/critical/remote-cos.ts:79-96`；`api/critical/remote.ts:215-228` |
| 管理员审计 / 备份日志 / 墓碑 / 恢复申请 | 管理操作 / 备份脚本 / 注销与清理 | 是 | 服务器 | DB `admin_audit_logs`、`backup_logs`、`account_tombstones`、`book_tombstones`、`book_lifecycle_events`、`book_recovery_requests` | 管理员 / DB 层 | 无删除逻辑；墓碑永久保留 | `schema:1714-1893`；`api/lifecycle/account.ts:742-755`；`deploy/backup-log.sh:97` |
| 请求日志与错误日志 | 每个 API 请求 | 是（请求本身） | 服务器 Fastify / pino | 容器标准输出，由 Docker 日志驱动保存 | 能读服务器 / 容器日志的运维 | 取决于 Docker 日志轮转，未配置，待核实 | `api/server.ts:25`；`fastify@5.12.5/lib/logger-pino.js:46-56`；`deploy/docker-compose.prod.yml`（无 `logging:`） |
| 数据库整库备份 | 每日备份脚本 | 服务器内部流转 | 服务器；rclone 上传腾讯 COS | 本机明文 `.dump`、本机 `.dump.gpg`、COS `.dump.gpg`（gpg AES256） | 能读服务器的运维；COS 侧仅见密文 | 本机 `.dump` 默认 7 天且保留最新 3 份；本机 `.dump.gpg` 无清理；COS 依文档称 70 天 / 365 天（未核实） | `deploy/backup.sh:47-50,139-143,263-276`；`deploy/backup-all.sh:341-437` |
| 应用外壳静态文件 | 浏览器请求静态资源 | 否 | 浏览器 Service Worker | CS `libellum-v1-shell`（仅同源非 `/api/` 的 GET） | 本机 | 新版 SW 激活或「清本机」；`/api/*` 一律不缓存 | `web/public/sw.js:33-190`；`web/lib/offline/reset.ts:31-62` |
| 界面偏好、筛选、工作台布局等 | 用户设置 | 工作台配置会同步到服务器 `/workbench`，其余不上传 | 浏览器 | LS `libevra.*`、`libellum*`；工作台同步到 DB `workbench_configurations` | 本机；本人 | 注销清一部分、「清全部」清 `libevra.` 前缀键；漏清项见 4.1 | `web/lib/offline/localCleanup.ts:49-91`；`api/routes/workbench.ts:18-60` |

## 4. 存储位置及保存期限

### 4.1 浏览器 / 设备本地

全部明文，无应用层加密；除标注外**不自动过期**。以下为代码推断，未在浏览器里实测。

| 位置与键 | 内容 | 保存期限 | 清除方式 |
|---|---|---|---|
| IDB `libellum` / `query-cache:<账号>:<账本>` | 全部非 volatile 查询响应（账目列表、账本、分类、成员、通知、附件元数据、`/auth/me` 等） | 不过期（`gcTime = Infinity`，`CACHE_MAX_AGE_MS = Infinity`，`web/lib/offline/cache.ts:42`） | 见 6.8 |
| IDB `libellum` / `ledger-months:*` | 本机账目副本（默认回溯 60 个月，分页 100 条） | 不过期 | 同上 |
| IDB `libellum` / `ledger-marks:*` | 未同步改动、逐字段中间值、冲突的本机与服务器版本 | 同步成功逐条清；否则不过期 | 同上 |
| IDB `libellum` / `auth-user`、`current-book`、`offline-scope` | 最近登录用户资料、当前账本、作用域 | 至退出登录 | 退出登录清 |
| IDB `libellum` / `device-id` | 随机设备 UUID | 代码中未见期限 / 清理；退出、注销都不清 | 仅「清本机」整库删除或清站点数据 |
| IDB `libellum` / `offline-log` | 诊断日志，最多 200 条滚动（含金额分值、账目 id 前 8 位、设备 id） | 滚动 200 条 | 用户点「清空日志」；退出 / 注销不清 |
| IDB `libellum` / 其它 | `offline-never-months`、`fx-public-rates-v1`（公共汇率，最多 512 条）、覆盖进度与隔离标记 | 不过期 | 「清本机」 |
| IDB `libevra-attachments-v1` / `pending` | 待上传附件原件 Blob | **代码中未见期限 / 清理**：无最长保留、无最大重试次数；任何清理入口都不涉及该库 | 上传成功、用户取消 / 移除；清站点数据 |
| IDB `libellum-guest` | 游客账本（全部账目、分类、标签） | 不过期；无云端备份 | 游客页两个清除按钮；清站点数据 |
| LS 身份与导入 | `libellum-guest-identity`；`libellum-ledger-import-task:*`（完整导入请求，游客来源时含整份游客账本快照） | 导入任务至用户完成 / 放弃；其余不过期 | 游客清除；「清全部」 |
| LS 账号级偏好 | `libevra.fx-mode`、`libellum.duplicate-detection.v1.*`、`libevra.stats-workbench*`、`libevra.ledger-filter:*`、`libellum-messages-seen:<账本>`、`libellum-presentation-seen:<账号>`、`libellum:shared-ledger:<账本>`、`libevra.offline-recorder-refresh:*` | 不过期 | 注销与账本清理清一部分；注销**漏清** `libevra.desktop.dashboard:v1:user:*`、`libevra.detail-cards.v2.user:*`、`libevra.s19-b2-glass:*`（`web/lib/offline/localCleanup.ts:81-91`） |
| LS 设备级偏好 | `libevra.theme`、`libevra.language`、`libevra.wallpaper`、视觉风格、外壳形态、侧栏宽度等 | 不过期 | 「清全部」（`libevra.` 前缀） |
| SS 识别批次 | `libellum:ocr-review-batch`（含识别原文、账户字段，不含图片）、`libellum.ocr.import-session.v1` | 至确认 / 取消 / 关闭标签页 | 确认或取消；退出 / 注销不专门清 |
| SS 工作区与页面状态 | `libevra.workspace.v1`（导航路径与查询串）、桌面端月份 / 滚动位置、`libevra.tide-resume`（Canvas 转场帧，不含账目） | 关闭标签页；转场帧 ≤15 秒 | 关闭标签页 |
| CS `libellum-v1-shell` | 应用外壳与同源静态文件；`/api/*` 不缓存，附件内容响应带 `Cache-Control: private, no-store` | 至新版 SW 激活 | 「清本机」 |
| 内存 | 文字记账草稿、留言草稿、录音 Blob、截图 `File`、离线库镜像 | 刷新即丢 | — |
| Cookie `libellum_session` | 会话令牌，服务器设置；`HttpOnly`、`SameSite=Lax`、`Path=/`、30 天；生产 `Secure`（取决于线上 `NODE_ENV`，待核实）；前端代码不读写 Cookie | 30 天 | 退出登录由服务器清；「清本机」与游客清理刻意不动 |

### 4.2 服务器数据库

| 数据 | 保存期限 |
|---|---|
| 账目 | 软删除后无限期可恢复，**代码中未见自动物理清除**；仅账本永久清理、导入撤销、灾难恢复、墓碑重放会物理删除 |
| 修改历史、`value_history`、冲突记录 | 随账本；**代码中未见期限 / 清理**；账目被软删后仍保留 |
| 附件（软删后） | **代码中未见期限 / 清理**，需人工「永久清理」；未完成上传 1 小时后由每 60 秒的定时任务清 |
| 会话 | 有效期 30 天；**过期会话不清理**，行与 IP / UA 一直保留；注销只置 `revoked_at`；`last_seen_at` 只在建表时写入，不更新（`api/auth/guard.ts:31-33`） |
| 通知 | **代码中未见到期清理**；发件人撤回才删；注销时删本人为收件人的通知 |
| 分享链接 | 有效 1–7 天、使用 1–10 次；过期 / 撤销只置状态，行保留 |
| 留言板 | 无编辑 / 删除接口；至账本永久清理 |
| 导出记录、管理员审计、关键事件 | **代码中未见删除路径**（关键事件为防篡改只追加链） |
| 账号（注销后） | `users` 行匿名化后保留（账号编号、头像、币种、时区、注册时间）；`sessions`、同意 / 公告 / 头像 / 时区变更记录保留；账号墓碑永久保留 |
| 归档账本 | 60 天内可自助恢复；60–365 天可提交人工恢复申请；365 天后由每日 03:30 定时脚本永久清理（该定时器是否在线上安装待核实） |
| 账本永久清理后 | `ledger_imports`、`ledger_import_jobs`、`ledger_import_source_states`、`ledger_import_undo_batches`、`ledger_import_job_events`、`ledger_write_locks` 无外键，行保留；`critical_events`、`book_lifecycle_events`、`book_recovery_requests`、`book_tombstones` 永久保留 |
| 导入任务来源快照 | 暂停 / 失败超过 7 天（`IMPORT_JOB_TTL_DAYS`）后清空快照与操作列表，行与已导入账目保留 |
| 汇率缓存 | 无删除逻辑；不含用户数据 |

### 4.3 备份（本机与异地）

| 位置 | 内容 | 期限 | 加密 | 依据 |
|---|---|---|---|---|
| 服务器 `deploy/backups/*.dump` | 整库 `pg_dump`（含账号、会话、账目、附件内容、审计、关键事件 outbox；仅排除 `ledger_write_locks` 的数据） | 默认超过 7 天删除，且保留最新 3 份 | **明文落盘** | `deploy/backup.sh:47,50,139-143,263-276` |
| 服务器 `deploy/backups/*.dump.gpg` | 上述 dump 的 gpg 副本 | **代码中未见清理逻辑**（轮转只匹配 `*.dump`） | AES256，口令在服务器 `deploy/.backup.key` | `deploy/backup.sh:275`；`deploy/backup-all.sh:345-353` |
| 腾讯 COS 香港 `daily/` | `.dump.gpg` | 文档称桶生命周期 70 天，未在控制台核实 | gpg AES256；`acl = private` | `deploy/backup-all.sh:341,376`；`deploy/README.md` |
| 腾讯 COS `monthly/` | 每月 1 日一份 | 文档称 365 天，未核实 | 同上 | `deploy/backup-all.sh:423-437` |
| 检查点备份（本机 `critical-backups/`） | 另一份 `pg_dump` 与检查点 JSON | 本机明文 7 天（仅当异地不是 `none`） | 本机明文 | `deploy/critical-events-backup-all.sh:10-13,95-138` |
| 检查点备份（COS `critical-backups/checkpoints/`） | 加密 dump | 保留期待核实 | gpg AES256 | 同上 |
| COS 关键事件桶（前缀 `critical-events/v1`） | 逐事件加密对象 | 保留期待核实；写入带 `x-cos-forbid-overwrite` | AES-256-GCM；加密密钥在服务器 `deploy/.critical-events-key.env`，API 进程不加载 | `api/critical/remote-cos.ts:79-96`；`api/critical/remote.ts:215-228`；`api/critical/runtime-config.ts:20-32` |

备份未覆盖（或未确认覆盖）：Caddy 证书卷、语音模型卷、`.env` 与各密钥文件，是否另有备份待核实。腾讯云轻量实例的快照 / 云盘备份是否开启，仓库内无记载，待核实。

### 4.4 日志

| 日志 | 内容 | 期限 |
|---|---|---|
| API 请求日志（info 级，标准输出） | `incoming request`：方法、**完整 URL（含路径与查询串）**、host、客户端 IP（`trustProxy: true` 下由 `X-Forwarded-For` 解析）、端口；`request completed`：状态码、耗时。**不记录**请求体、请求头（含 Cookie）、响应体；`app.ts` 与 `server.ts` 无 `redact` | 取决于 Docker 日志驱动与轮转：`deploy/docker-compose.prod.yml` 未配置 `logging:`，**代码中未见期限 / 清理**，实际待核实 |
| 应用主动日志 | 请求被拒（错误码、状态码）、`unhandled error`（含堆栈）、跨源写请求被拒（`origin`、`host`、`path`）、`conflict-write-confirmed`（账目 id、设备 id、字段名列表）、`voice transcription timing`（音频秒数与耗时）、语音容器无法识别时的客户端声明文件名与字节数、OCR / 语音失败、存储对账结果 | 同上；`unhandled error` 是否会带入备注 / 金额，无法仅凭读代码排除（待核实） |
| OCR 子进程 stderr | `console.warn("[ocr]", …)`；无法解析的输出行最多记 200 字符 | 同上 |
| Caddy | 只在 ERROR 级别写 stderr，站点块无 `log` 指令，不输出逐请求访问日志；错误日志是否带远端 IP / URI 待核实 | 同上 |
| 不会写入日志 | 登录失败的用户名 / 密码、恢复码（路由中无日志语句）；账目金额与备注不会因默认请求日志进入日志 | — |
| 数据库内的 IP | `sessions.ip_address`、`transaction_events.source_ip`（只有直连对端命中 `AUDIT_TRUSTED_PROXY_IPS` 才取 `X-Forwarded-For`，示例配置中无该变量，线上多半是代理内网 IP，待核实） | 同对应表 |

依据：`api/server.ts:25`；`api/app.ts:119-120,189-193`；`api/lib/errors.ts:84,113,131,144`；`api/routes/voice.ts:85,93-103`；`api/routes/transactions.ts:971-972`；`api/ocr/client.ts:246-302`；`deploy/Caddyfile:54-57`；`api/ledger/auditContext.ts:12-22`。

### 4.5 临时文件与内存

| 内容 | 位置 | 期限 |
|---|---|---|
| 拍照识别图片、语音音频 | API 进程内存（base64 传给子进程，子进程用内存缓冲解码）；代码中无 `writeFile` / `tempfile` | 请求结束即释放 |
| 账单导入预览 | API 进程内存 `PreviewCache`（容量 25） | TTL 30 分钟 / 提交 / 重启 |
| 登录失败计数、全站请求限流 | API 进程内存 | 15 分钟窗口 / 每分钟窗口 / 重启 |
| 附件分块上传的临时记录 | DB 中 `state=uploading` 的行与分块 | 1 小时过期，每 60 秒清理 |
| `UPLOAD_DIR=/data/uploads` | `deploy/docker-compose.prod.yml:108` 声明、`deploy/Dockerfile.api:195` 建目录，全仓库无任何代码读取，**当前未使用** | — |
| 语音模型 | `api-data` 卷（`/data`）；首次使用时从 huggingface.co 下载 | 持久；不含用户数据 |
| 浏览器内存草稿 | 见 4.1 | 刷新即丢 |

## 5. 第三方服务和数据接触情况

**浏览器端没有第三方请求**：全站对 `fetch(`、XHR、WebSocket、EventSource、`sendBeacon`、`new Image` 的检索只命中同源 `/api/v1/*`（`web/lib/api.ts`、`web/lib/attachments.ts:79`、`web/lib/consent.ts:55`）与 `web/public/sw.js` 的同源静态资源；无字体 CDN（系统字体栈，`web/src/index.css:733`）、无统计 / 广告 / 错误上报 / 地图；`apps/web/package.json:15-26` 依赖只有 react、react-router、react-query、i18next、pdfjs-dist，PDF 预览资源由构建复制到站内 `/pdfjs-assets/`；站点 CSP 为 `default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data: blob:`（`deploy/Caddyfile:91-110`），即使代码想请求第三方也会被浏览器拦下。用户点击才发生的外链有两处（欧洲央行汇率来源页、关于页的 GitHub 链接），不会自动请求。该结论以本机源码为据，线上 `v1.19.56` 的相关目录在区间内无变化（`git diff` 核对）。

下表分两类：「会接触用户数据」与「只接触元数据 / 不接触用户数据」。

### 5.1 会接触用户数据

| 服务 | 用途 | 可能接触的数据 | 依据 | 线上是否确认使用 |
|---|---|---|---|---|
| 腾讯云轻量应用服务器（Lighthouse，中国香港，Ubuntu 24.04） | 承载全部容器与数据库 | **全部明文业务数据**（数据库卷、本机备份、日志） | `docs/ops/运维-01-生产手册.md:131-145`；`docs/ops/中国大陆互联网备案与发行准备.md:34`（文档线索） | 运维记录确认；服务商与地区以文档为准，控制台未核对 |
| 腾讯云 COS `ap-hongkong`，备份桶 | 存每日 / 每月加密整库备份与检查点备份 | gpg AES256 加密后的整库（含账号、账目、附件）；对象名、大小、时间、上传 IP | `deploy/backup-all.sh:341,366-386,423-437`；`deploy/critical-events-backup-all.sh:95-121` | 是（1.19.56 与 1.18.02 发布记录证明每日异地备份在跑）；桶名与生命周期在控制台，未核实 |
| 腾讯云 COS，关键事件桶 | 存加密的关键事件对象 | AES-256-GCM 加密的事件（用户 id、账号编号、账本 id、成员 / 权限 / 凭据变更、`account.created` 含用户名等） | `api/critical/remote-cos.ts:91-148`；`api/critical/remote-config.ts`；`apps/api` 事件快照见 `api/routes/auth.ts:435-439` | relay 容器在线（`docs/STATUS.md:14`）；其目标是否为 COS 实桶、保留期待核实 |
| Resend（`api.resend.com`） | 运维告警邮件（备份失败、健康检查异常），由 `deploy/alert-mail.sh` 用 curl 发送，不是应用发送 | 所有者收件邮箱与告警正文（阶段、时间、≤300 字符错误摘要，可能含内部任务 id / 账本 id）；按代码不含账目金额、备注、账号名 | `deploy/alert-mail.sh:169-234`；`deploy/import-health.sh:61-75` | 发布 / S13-I 文档称测试邮件已被接受；线上 `.backup-mail.env` 是否配置待核实 |


### 5.2 只接触元数据 / 不接触用户数据

| 服务 | 用途 | 可能接触的数据 | 依据 | 线上是否确认使用 |
|---|---|---|---|---|
| Frankfurter（`api.frankfurter.dev`，转发 ECB 汇率） | 服务器按需查历史汇率 | 查询串只有日期区间、`base=EUR`、币种列表；**无账号、金额、账本**；对方可见服务器出口 IP 与被查日期；5 秒超时；结果缓存入库 | `api/fx/provider.ts:14-15`；`api/fx/routes.ts:11-30`；`api/server.ts:13` | 代码在生产启动路径上，1.16.21 已发布汇率折算；实际发过请求待核实 |
| Hugging Face（`huggingface.co/ggerganov/whisper.cpp`） | 首次使用语音时下载 whisper 模型 | 无用户数据；对方可见服务器出口 IP 与模型名；模型已在 `api-data` 卷或设置了 `LIBELLUM_WHISPER_MODEL_PATH` 时不发生 | `deploy/Dockerfile.api:206-210`；`pywhispercpp` 包内 `constants.py`、`utils.py`（本机 venv）；`docs/ops/运维-01-生产手册.md:224` | 生产是否已下载、生产镜像中依赖版本是否与本机一致，待核实 |
| Healthchecks.io（`HEARTBEAT_URL`，示例 `hc-ping.com`） | 备份成功 / 失败「死人开关」心跳 | 仅 ping 时间、成败、服务器出口 IP；不带内容、不带失败原因 | `deploy/heartbeat.sh:21-22,64-81` | 是（1.18.02 发布记录：当日成功心跳 HTTP 200） |
| Let's Encrypt（或 Caddy 默认的 ACME CA） | 自动签发 / 续期 HTTPS 证书 | 域名 `libevra.com`、服务器 IP、可选 `ACME_EMAIL` | `deploy/Caddyfile`；`deploy/web-entrypoint.sh:40-72` | 是（站点以 HTTPS 提供）；实际 CA 待核实 |
| 域名注册商 / DNS 服务商 | 解析域名 | 域名解析请求（IP 级） | `deploy/web-entrypoint.sh:56-72` | 服务商名称在仓库中未确认，待核实 |
| 腾讯云安全组 | 入口端口过滤（22 / 80 / 443） | 网络元数据（IP、端口） | `docs/ops/运维-01-生产手册.md:137-139` | 文档确认 |
| GitHub | 公开源码、CI；所有者电脑推送 | 源码与虚构测试数据；服务器不持有 GitHub 凭据 | 1.19.56 发布记录；`deploy/README.md` | 是，不接触生产用户数据 |
| Docker Hub / npm / PyPI / Debian apt | 服务器上构建镜像时拉取基础镜像与依赖 | 无用户数据；构建机出口 IP | `deploy/Dockerfile.api:97-135`；`deploy/docker-compose.prod.yml:35` | 是（服务器上构建） |

### 5.3 未发现的外部调用与对旧文档的纠正

- **未发现**：邮件 / 短信发送（应用本身不发邮件，忘记密码走一次性恢复码）、对象存储存附件（附件存在 PostgreSQL）、监控 / 崩溃上报、百度 / 腾讯 / OpenAI / Whisper API 等外部识别服务、统计 / 广告 / 字体 CDN。对 `apps/api/src` 检索 `fetch(`、`https?://`、`http.request`、`axios`、`nodemailer`、`smtp`、`S3Client`、`sentry` 只命中汇率与 COS 两处；`apps/api` 依赖里没有 Resend SDK、nodemailer、AWS SDK，COS 用自写 HMAC 签名客户端。
- **识别输入不外发**：OCR 与语音都在 api 容器内 Python 子进程中运行，OCR 模型随 pip 包提供，无外部识别 API（`apps/ocr/requirements.txt`、`api/ocr/client.ts`、`api/voice/client.ts`）。
- **纠正 S17-A**：`docs/specs/product/S17-A-安全与隐私能力事实清单-20261025.md:198` 的「模型与 Python 侧无外网请求」，以及据此建议的措辞「识别模型随应用一起部署，运行时不联网」，**对识别输入成立，对后端整体不成立**：后端会向 `api.frankfurter.dev` 取汇率，语音模型首次使用时会向 `huggingface.co` 下载（两处都不携带用户数据，但会暴露服务器出口 IP）。已核对 `api/fx/provider.ts:14-15` 与 B 方向对 `pywhispercpp` 源码的核实。
- **纠正 S17-A（退出登录）**：同一文档第 184 行「默认退出登录会清掉整份离线缓存 ✅」以及第 484 行建议文案「退出登录会清掉」，与代码不符，见 6.8 与第 9 节 H1。
- **纠正 S17-A（角色）**：文档把账本角色写成 editor / viewer，代码为 owner / editor / recorder / viewer 四档（`schema:918-927`；`api/ledger/access.ts:79-102`）。
- **注意**：Python 子进程以 `env: { ...process.env }` 启动，继承 API 容器全部环境变量（`api/ocr/client.ts:222-224`；`api/voice/client.ts:309`；`api/import/extractor.ts:164`）；这不是对外发送，是凭据暴露面。

## 6. 删除、导出与注销机制

### 6.1 删除账目

- 线上：`DELETE /api/v1/transactions/:id` 只置 `deleted_at` 并 `version+1`，同时写 `transaction_events`（`kind=deleted`，含完整快照）；`POST …/restore` 无时间限制（`api/routes/transactions.ts:1090-1197`）。
- 权限：记账角色只能删 / 恢复自己记的，编辑全部可删 / 恢复全部（`api/ledger/access.ts:88-96`）。
- 删除后仍保留：修改历史、事件快照、`value_history`（≤20 个旧值）、冲突记录、关联附件（变为「可恢复」，不自动删）（`api/ledger/events.ts:68-92`）。
- 代码中没有定时任务或路由对已软删账目做物理清除；物理删除只出现在账本永久清理、导入撤销、灾难恢复与墓碑重放（`api/lifecycle/book.ts:800`；`api/ledger/importUndo.ts:192`；`api/critical/apply.ts:224`；`api/scripts/replay-tombstones.ts:37`）。
- 账本导出与列表过滤已软删账目，**账号数据导出会带上软删账目**（`api/ledger/export-query.ts:100`；`api/routes/consent.ts:292`）。

### 6.2 删除 / 归档账本

- **归档**：仅限单人账本；进入 60 天自助恢复期，之后至 365 天可提交人工恢复申请（7 天处理期限），365 天后由每日 03:30（Asia/Hong_Kong）的 `lifecycle:purge` 脚本永久清理（`api/lifecycle/constants.ts:7-9`；`api/lifecycle/book.ts:127-170,313-490,936-1003`；`deploy/systemd/libevra-lifecycle.timer`）。该定时器在线上是否已安装是手动步骤（`deploy/README.md:74-81`），待核实。
- **永久删除**：单人且未归档的账本可直接永久删除，**无缓冲期**；共享账本任何人都不能删除，只能先退到只剩一人（`api/lifecycle/book.ts:164`；`api/routes/lifecycle.ts:176-210`）。清理动作先写 `book_tombstones`，再显式删除账目与冲突归档，再 `books.delete`，其余表按外键级联删除（成员、分类、标签、事件、操作日志、留言、通知、分享链接、导出 / 导入记录、附件及分块），最后写 `book_lifecycle_events` 与关键事件 `book.deleted`（`api/lifecycle/book.ts:752-835`）。
- **不随账本删除的**：`ledger_imports`、`ledger_import_jobs`、`ledger_import_source_states`、`ledger_import_undo_batches`、`ledger_import_job_events`、`ledger_write_locks`（无外键）；`critical_events`、`book_lifecycle_events`、`book_recovery_requests`、`book_tombstones`（`prisma/migrations` 中无 `REFERENCES`）。
- **「弃置」**：`POST /books/:bookId/dispose` 只隐藏账本（`disposed_at`），可恢复，**无任何清理任务**（`api/routes/books.ts:262-377`）。
- 浏览器侧：账本归档 / 退出 / 删除时调用 `clearBookLocalData`，清键以 `:<账号>:<账本>` 结尾的 IDB 项和 `libellum-messages-seen:<账本>`、`libellum:shared-ledger:<账本>`；不清该账本的筛选键、待上传附件、诊断日志（`web/pages/BookSettingsPage.tsx:238-241`；`web/lib/offline/localCleanup.ts:49-79`）。

### 6.3 成员退出或被移除

- 自己退出（`POST /books/:bookId/leave` 或生命周期接口）与被管理员移除（`DELETE /books/members/:memberId`）都**只置 `book_members.left_at`**，行不删；管理者退出时先移交给最早加入的编辑者；最后一位成员不能「退出」，只能归档 / 删除（`api/lifecycle/book.ts:218-310`；`api/routes/lifecycle.ts:150-170`；`api/routes/share.ts:330-376`）。
- 其已录入的账目、事件、留言、附件**全部保留**在账本中，之后其读不了该账本；曾退出者可通过新分享链接重新加入，原行 `left_at` 被清空（`api/collab/share.ts`）。
- 上传者退出后，编辑全部成员可代为删除 / 清理其附件（`api/routes/attachments.ts:24-34`）。
- 历史里仍显示其退出前的昵称：`transaction_events.actor_name`、`book_messages.sender_name`、`entry_attachments.uploader_name` 是冻结副本。

### 6.4 账号注销（已实现并接入路由）

两条独立路径，均需本人密码与手打确认短语，并受限流（`api/routes/lifecycle.ts:237-348`；`api/lifecycle/account.ts:264-755`）：

**A. 注销账号 `POST /api/v1/account/close`**（确认短语「注销账号」），一个事务内完成：

| 步骤 | 内容 |
|---|---|
| 逐本账本处理 | 每本必须选一种处置，缺失则整体失败。共享账本只能「退出」，若自己是管理者且无其他编辑 / owner 可接手则整体被阻止；单人账本可「归档」或「立即永久删除」；已归档账本可「保留归档」或「删除」（有待处理恢复申请或正在清理则阻止） |
| 会话 | `sessions` 置 `revoked_at`，**不删行**，IP 与 UA 保留 |
| 删除 | 本人为收件人的全部通知、本人发出且 pending 的通知、通知额度、工作台配置、管理员授予 / 白名单行 |
| 撤销 | 本人未撤销的分享链接、未使用的邀请码（置 `revoked_at`，行保留）；被他人邀请的 `referred_by_user_id` 置空 |
| 匿名化 | `users` 行改写：用户名 `closed_<id>`、昵称「已注销账号」、密码换随机哈希、恢复码清空、停用标记、管理员标记清除、最近账本清空 |
| 记录 | 写 `account_tombstones`（账号编号、原注册时间、处置结果摘要、恢复凭证 SHA-256）；写关键事件 `account.closed`、`auth.sessions_revoked` |
| 恢复凭证 | 有归档账本时返回一次性「恢复凭证」，可日后经公开接口 `POST /api/v1/account-recovery/request` 凭账号编号 + 凭证 + 账本号提交恢复申请，由管理员核验 |

**保留（代码实际行为）**：`users` 行中的账号编号、头像、默认币种、时区、注册时间；`sessions` 行（含 IP、UA）；`agreement_acceptances`、`major_announcement_acknowledgements`、`avatar_*`、`user_time_zone_changes`；在**共享账本**里已录入的全部账目、事件、留言、附件、导出记录；各处冻结的旧昵称（注销流程没有回写，已核对 `api/lifecycle/account.ts`）；关键事件链（含 `account.created` 里的用户名）及其 COS 加密副本；账号墓碑；备份中的全部历史副本。保留期限：账号 / 墓碑 / 关键事件代码中未见期限；备份见 4.3。

**对共享账本其他成员的影响**：该用户退出（`left_at` 置位），管理权按需移交，其记录的账目与留言保留，成员列表不再显示他，历史里仍显示其注销前的昵称。

**B. 只删服务器数据 `POST /api/v1/account/delete-data`**（确认短语「删除服务器数据」）：账号、密码、会话、恢复码均不动；共享账本退出，单人 / 最后一人 / 已归档账本直接永久清理；`all=true` 时同时删除工作台配置。

**浏览器侧**：注销后调用 `clearAccountLocalData(user.id, bookIds)` 再退出，清键含 `:<账号>:` 的 IDB 项及部分偏好；**不清**待上传附件库、设备 UUID、诊断日志、导入任务日志，以及 `libevra.desktop.dashboard`、`libevra.detail-cards.v2`、`libevra.s19-b2-glass` 三类账号级偏好（`web/pages/AccountDataPage.tsx:251-262`；`web/lib/offline/localCleanup.ts:81-91`）。

### 6.5 附件删除

| 操作 | 谁 | 效果 | 依据 |
|---|---|---|---|
| 删除 | 上传者；上传者已离开账本时「编辑全部」成员 | 只置 `deleted_at`，内容仍在库里、占用额度、可恢复 | `api/routes/attachments.ts:26-34,238-256` |
| 恢复 | 同上 | 清掉 `deleted_at` | `api/routes/attachments.ts:257-275` |
| 永久清理 | 同上，需先软删或其关联账目都已删 | 删除 `entry_attachments`，分块与链接级联删除；写一条只含附件 id / 名称的关键变更事件 | `api/routes/attachments.ts:277-294` |
| 账本永久清理 | 每日清理任务 | 附件对 `books` 是 `ON DELETE CASCADE`，随之删除 | `api/lifecycle/book.ts:800-802` |
| 未完成上传 | 进程内每 60 秒 | 1 小时过期后自动删 | `api/routes/attachments.ts:84-91` |

补充：单个附件内容读取只检查 `state === "ready"`，不检查 `deleted_at`，已软删的附件，现任成员知道附件 id 时仍可下载（`api/routes/attachments.ts:299-300`）。注销时 `uploader_name` 不处理（见 6.4）。

### 6.6 识别临时文件

- 拍照与语音：图片 / 音频读入内存，base64 经 stdin 交给 Python 子进程，子进程用内存缓冲解码；Python 侧无 `open(` / `tempfile`，API 侧无 `writeFile`；**无临时文件，无需清理**；服务端不保存识别结果，写入账目发生在用户在前端确认并走正常记账接口之后（`api/routes/recognize.ts:83-147`；`api/ocr/client.ts:25-27,351-353`；`api/voice/client.ts:10-23`；`apps/ocr/service.py:17-20,128`）。
- 用户可把原文件另外作为「附件」挂到账目上，这时才进入 6.5 的存储。
- 账单导入预览仅在进程内存，TTL 30 分钟（`api/import/cache.ts:39-60`）。
- 例外是失败日志：语音容器无法识别时会记录客户端声明的文件名与字节数，OCR 无法解析的输出行最多 200 字符会进日志（`api/routes/voice.ts:85`；`api/ocr/client.ts:299-302`）。

### 6.7 本机数据清除

| 动作 | 清掉 | 不清 |
|---|---|---|
| 退出登录 | IDB `auth-user`、`current-book`；`offline-scope` 置空；**无作用域的旧键 `query-cache`**；服务器清会话 Cookie | **`query-cache:<账号>:<账本>`、`ledger-months:*`、`ledger-marks:*`、覆盖与隔离标记**；`device-id`、`offline-log`；全部 LS；`libevra-attachments-v1`；SS |
| 会话被服务器判失效、账号被停用 | 同退出；`account_closed` 时另调 `clearAccountLocalData` | 同退出 |
| 切换账号登录 | 同退出；不清上一账号的作用域数据，靠键名隔离 | 上一账号的账本副本仍在 IDB |
| 归档 / 退出 / 删除账本；服务器上「删除账本数据」 | 见 6.2 | 见 6.2 |
| 注销账号 | 见 6.4 | 见 6.4 |
| 「清除本应用的全部本地数据」（下载与离线页） | CS 全部、IDB `libellum` 整库（含 `device-id`、全部账号副本、**未同步改动**、日志）、`current-book`、注销 Service Worker | 会话 Cookie；**全部 LS**；SS；`libellum-guest`；`libevra-attachments-v1`；界面文案只说「服务器上的账目不会被删除」，不提示会连未同步改动一起删（`web/pages/DownloadMorePage.tsx:313`；`web/lib/offline/reset.ts:31-62`） |
| 游客「清除游客数据」 | 游客身份、游客重复检测设置、`libellum-guest` 库 | 游客的 `libevra.stats-workbench*:v1:guest:*`、`libevra.ledger-filter:*:guest:*`、`libevra.detail-cards.v2.guest:*` 等偏好残留 |
| 游客「清除此设备全部 Libevra 本地数据」 | 游客身份与库、`resetEverything`、全部以 `libellum`、`libevra.` 开头的 LS 键与 `current-book` | 会话 Cookie；SS；`libevra-attachments-v1`（`web/lib/guest/cleanup.ts:54-80`） |
| 同意门禁里「退出登录」 | 同退出，但连旧键 `query-cache` 也不清（`preserveOfflineData`，所有者要求拒绝新协议不得抹掉本机历史） | 同退出 |
| 浏览器清站点数据 / 卸载 | 全部 | — |

### 6.8 退出登录不清本机账目副本（线上存在，负责人已核实）

- 事实：查询缓存写在按账号 / 账本区分的键下（`apps/web/src/lib/offline/cache.ts:215`，`scopedKey(CACHE_KEY)`）；退出登录时 `clearQueryCache` 删除的是**不带区分的键**（`apps/web/src/lib/offline/cache.ts:399`，调用处 `apps/web/src/auth/AuthProvider.tsx:142`），因此该账号的离线账目副本仍留在浏览器 IndexedDB 里。这两处自 `v1.19.56` 未改动，线上同样如此。已核对 `cache.ts:395-400` 与 `AuthProvider.tsx:140-144`。
- 实际范围：不仅是 `query-cache`，`ledger-months:*`、`ledger-marks:*`（`web/lib/offline/localLedger.ts:367,394`）同样不被清。
- 与代码注释和文档矛盾：`AuthProvider.tsx:128-131`、`web/lib/offline/cache.ts:17-19` 的注释都写「退出即抹掉」；整库删除只被「清本机」调用。
- 退出确认文案为「退出后需重新登录。账目数据不会删除。」（`web/i18n zh-CN/account.ts:20`），没有说本机副本是否保留。
- 影响：退出后本机 IDB 里仍有明文的账目、备注、分类名、成员显示名、附件文件名、未同步改动与冲突记录，直到注销、删除 / 归档该账本，或手动「清除本应用的全部本地数据」；同账号再次登录直接复用，换账号时因作用域隔离看不到，但数据仍在磁盘上。

### 6.9 服务端备份与缓存清理

- 备份：本机 `.dump` 7 天 + 最新 3 份；本机 `.dump.gpg` 无清理逻辑；COS `daily/` 文档称 70 天、`monthly/` 365 天（均未核实）；用户删除 / 注销后的数据在这些期限内仍存在于加密备份中；备份中的删除墓碑重放依赖真实的备份保留期（`deploy/README.md`；`deploy/backup.sh:263-276`）。
- 服务端缓存：公共汇率缓存无删除逻辑；账单预览缓存 30 分钟；导入任务来源快照 7 天后清空；其余为进程内存，重启即清。
- 浏览器缓存：Service Worker 只缓存同源非 `/api/` 的静态 GET，`/api/*` 不缓存；除附件内容外，没有在 API 或 Caddy 里找到显式 `Cache-Control`，浏览器 HTTP 缓存是否保存 JSON 响应待核实。
- 定时清理任务总览：归档到期清理（每日 03:30，脚本）、附件未完成上传清理（每 60 秒）、存储用量对账（每 24 小时）、导入任务维护（每 5 秒，过期扫描每 60 秒）；**不存在**对过期会话、过期通知、软删账目、软删附件、管理员审计、关键事件、导出记录、留言的清理（`api/lifecycle/book.ts:936-1003`；`api/routes/attachments.ts:84-91`；`api/ledger/storageReconcile.ts:54-58`；`api/ledger/importJob.ts:1616-1670`）。

### 6.10 数据导出

| 导出 | 谁能导出 | 内容 | 格式 / 限制 | 依据 |
|---|---|---|---|---|
| 账本导出 `GET /api/v1/export` | 账本任何成员，**含只读成员**（所有者 2026-11-10 决定：导出权限等同查看权限） | 每笔账目的序号、本地日期时间、时区、收支、金额、币种、分类、支付方式、**备注**、标签、创建时间、账目 id、`sourceRef`；**不含已软删账目**；可按月份 / 日期 / 类型 / 分类 / 支付方式 / 标签 / 币种筛选 | CSV（UTF-8 BOM）或 XLSX；单次上限 20000 行 | `api/routes/export.ts:171-291`；`api/app.ts:406-407` |
| 导出记录 | 全体成员可见 | 导出人昵称与用户名、时间、格式、行数、筛选条件 | 每次导出写一条 `export_logs` | `api/routes/export.ts:218-231,327-362` |
| 账号数据导出 `GET /api/v1/account/export` | 本人（仅需会话，不经协议门禁） | 账号资料（`id`、用户名、昵称、账号编号、注册时间、默认币种）、工作台配置（含上一版）、本人全部在册账本的账本信息、本人角色与加入时间、分类全字段、**账本内全部账目（含其他成员记录的与已软删的，含 `userId`、备注、`deletedAt`）**；**不含**标签、支付方式详情、事件历史、留言、成员名单、附件 | JSON；账目总数 >50000 拒绝；不写导出日志 | `api/routes/consent.ts:217-305` |
| 附件导出 `GET /api/v1/account/attachments-export` | 本人（需仍是成员） | 所有 `state=ready` 的附件原文件（含已删除可恢复的）、元数据 JSON（含 `uploaderName`、文件名）、`manifest.json`（含账号 id、账本 id） | tar（流式） | `api/routes/attachmentExport.ts:78-114` |
| 导入模板 | 同账本导出 | 仅表头 | CSV | `api/routes/export.ts:176-189` |

## 7. 线上与本机的差异

### 7.1 线上运行的行为（`v1.19.56`）

- 服务器：上文第 2–6 节中除第 7.2 至 7.4 节所列之外，全部为线上行为（服务器端代码自 `v1.19.56` 未变）。
- 同意机制：生产 `NODE_ENV=production` 时 `activeLegalDocuments` 返回空数组（唯一协议文档 `local-test-terms` 为 `testOnly`），**注册不要求勾选，不写任何 `agreement_acceptances` / `agreement.accepted`，服务端没有生效的协议门禁，`GET /api/v1/legal/documents` 返回空列表**；重大公告（1.14.18、1.15.00、1.17.11 三条正式公告）是生效的，只对注册时间早于公告发布时间的账号提示并记录（`packages/shared/src/consent.ts:253-264`；`api/consent/policy.ts:41-43`；`api/app.ts:149-150`；`api/consent/guard.ts`；`deploy/docker-compose.prod.yml:100`）。
- Web 客户端：线上门禁在状态取回之前或取回失败时一律放行；账本设置里的普通归档会清本机副本；退出登录不清本机账目副本（6.8）；同意门禁里「退出登录」保留本机离线数据在 `v1.19.56` 已存在（`web/components/ConsentGate.tsx:157`）。
- 游客：数据只在本机，正常使用没有账目上传；但启动时 `AuthProvider` 无条件请求 `GET /api/v1/auth/me`（游客得 401），该请求带设备 UUID、时区、语言（`web/auth/AuthProvider.tsx` 的 `reload`；`web/App.tsx:239`）。
- 分享链接令牌会进入请求日志（见第 9 节 M1，负责人已核实）。

### 7.2 仅本机未部署（1.19.57–1.19.82，Web 客户端）

C 方向对 `v1.19.56..HEAD` 的所有 `libevra*` / `libellum*` 字符串做过对比：整个区间只新增了 1 个存储键；`auth/`、`lib/offline/sync*.ts`、`storage.ts`、`cache.ts`、`reset.ts`、`lib/guest/*`、`public/sw.js`、`index.html`、`vite.config.ts` 在该区间没有变化。

| 版本 | 改动 | 线上情况 | 依据 |
|---|---|---|---|
| 1.19.81 | **新增 LS 键 `libevra.consent-status:<账号ID>`**：保存该账号最近一次协议同意状态（必需协议列表与缺哪几份，不存公告）；同意门禁打开应用时据此立即挡住，离线 / 请求失败也不放行。注销与「清全部」清它，退出登录与「清本机」不清 | 线上没有该键；线上门禁在状态取回之前或失败时放行 | `web/lib/consent.ts:75-114`；`web/lib/deviceStorageKeys.ts:23-28`；`web/components/ConsentGate.tsx:71-90`；`web/lib/offline/localCleanup.ts:74-79` |
| 1.19.81 | 账目详情「返回来源页」用路由 `location.state` 带来路（内存 / 历史状态），不写存储 | 线上只认明细、协作、分析、账本页 | `web/lib/entryReturn.ts` |
| 1.19.63（含 1.19.57 / 1.19.60–61 的重载流程） | **账本导入页「归档来源账本」成功后同样清掉该来源账本的本机离线数据**（`clearBookLocalData`），目标账本永不清；失败则流程停在原地 | 线上归档来源账本不清本机副本（账本设置里的普通归档线上就会清） | `web/lib/ledgerImport/sourceArchive.ts:1-50`；`docs/changelog/1.19.md` 1.19.63 |
| 1.19.60–61、1.19.57 | 退出 / 归档 / 删除当前账本、导入后归档或打开目标账本时，整页重载盖海浪转场（SS `libevra.tide-resume` 交接帧；`tide-resume.js` 线上已有） | 线上直接 `window.location.assign("/")`；清理内容与顺序不变 | `web/pages/BookSettingsPage.tsx`；`web/lib/ledgerSwitchFlow.ts`（新） |
| 1.19.82 | **内存中的面板记忆**（上限 32 条）与**滚动位置记忆**（上限 64 条）：记在历史记录项上，不写任何存储，离开屏幕超 30 分钟或换账号重置，刷新即丢 | 线上没有（手机端滚动记忆线上已有，也在内存） | `web/lib/panelMemory.ts`；`web/workspace/scrollMemory.ts`；`web/lib/continuity.ts` |
| 1.19.82 | 离开所有记账方式前统一询问「放弃？」；资料编辑改用应用自己的对话框；**不保存草稿** | 线上无这些询问（线上资料编辑用 `window.confirm`） | `web/lib/profileDraft.ts`；`web/lib/closeGuard.ts`；`docs/changelog/1.19.md` 1.19.82 |
| 1.19.57–1.19.82 | Toast 队列、弹出面板动效、转场、控件迁移、Component Gallery 实验页 | 纯界面；区间内 `fetch`、`apiFetch`、`indexedDB`、`caches.`、`document.cookie` 无新增调用 | `git diff v1.19.56..HEAD` 新增行过滤 |

### 7.3 尚未实现（只有设计）

- 正式《用户协议》《隐私政策》：生产当前没有生效的法律文档（见 7.1）；代码里只有测试文档与重大公告机制。
- 离线弹同意书：线上与本机均没有；1.19.81 仅本机引入「最近一次同意状态」本地缓存，不等于离线首次弹出同意书。
- 账号 / 账本生命周期之外的政策类机制，如 365 天不活跃规则、永久停服时的导出与过渡能力：本次调查在代码中未发现实施，见第 10 节。
- `docs/specs/features/S13-G-重大公告与协议确认-设计决定.md`、S13-H 描述的部分行为以代码为准；本文没有逐条比对「设计 vs 实现」，仅就隐私相关事实以代码为准。

### 7.4 无法从现有证据确认的部分

- 服务器上实际生效的 `.env`、systemd 定时器、Docker 日志轮转、COS 生命周期、relay 目标桶、服务器快照 / 云盘备份（见第 8 节）。
- 浏览器里实际落地的键与大小、退出后副本实际可读（未实测）。
- 生产镜像里 `pywhispercpp` 的实际版本与模型下载状态。

## 8. 尚未确认的事实

合并三份调查，去重后共 **27 条**；括号内为需要去哪里确认。

**服务器 / 云控制台**

1. 服务器 `.env` 的变量集合（只需变量名）：`NODE_ENV` 实际值（决定会话 Cookie 的 `Secure`）、`AUDIT_TRUSTED_PROXY_IPS`、`LIBELLUM_WHISPER_MODEL` / `LIBELLUM_WHISPER_MODEL_PATH`（镜像默认 `base`，运维手册写 `small`）、`FX_*`、`CRITICAL_EVENTS_MODE`、`ACME_EMAIL`、`DEMO_*`（是否启用演示账号）（服务器）。
2. Docker 日志驱动与轮转配置（`/etc/docker/daemon.json`），现存容器日志里 IP / URL 的实际样例与保留时长，Caddy ERROR 日志是否带远端 IP / URI（服务器 `docker logs`）。
3. `libevra-backup`、`libevra-lifecycle`、`libevra-critical-backup`、`libevra-critical-health`、`libevra-import-health` 定时器是否都已安装启用；有无仓库之外的 crontab（服务器 `systemctl list-timers`）。
4. `critical-relay` 的 `CRITICAL_EVENT_REMOTE` 是 `cos` 还是 `fs`、桶 / 前缀 / 区域；`CRITICAL_BACKUP_OFFSITE` 实际值；S13-I 阶段桶里的测试对象是否已清理（服务器、云控制台）。
5. COS 各桶 / 前缀的生命周期规则：`daily/` 70 天、`monthly/` 365 天（仅 `deploy/README.md` 陈述）、检查点前缀、关键事件桶的保留期，以及对象是否真的无法删除（云控制台）。
6. 本机 `deploy/backups/*.dump.gpg` 副本数量与磁盘占用，明文 `.dump` 的文件与目录权限，`/srv/libevra` 下状态文件与密钥文件的权限和属主（服务器）。
7. `.backup-mail.env`、`.backup-heartbeat.env` 是否都已配置（告警邮件当前是否真会送达）（服务器）。
8. 是否做过月度异地恢复演练（`monthly-offsite-drill.sh`），`.backup.key` 在服务器之外是否确有副本，Caddy 卷 / `.env` / 密钥文件是否另有备份（所有者、服务器）。
9. Caddy 实际签发 CA；`trustProxy: true` 下 `request.ip` 是否可被客户端伪造，Caddy 对 `X-Forwarded-For` 的实际处理（服务器、证书）。
10. 生产镜像里 `pywhispercpp` 的实际版本、语音模型是否已下载到 `api-data`（服务器）。
11. 生产对 `api.frankfurter.dev` 是否实际发过请求（数据库 `fx_snapshots` 与 API 日志）。
12. 服务器上历史 S13-I 测试容器 / 测试卷是否仍存在，是否含真实数据（服务器）。
13. 腾讯云轻量实例是否开启快照 / 云盘备份；域名注册商 / DNS 服务商名称；服务商与地区以控制台为准（云控制台、所有者）。

**代码 / 数据库只读抽查**

14. `unhandled error` 的错误对象是否会带入备注 / 金额（Prisma 错误消息）：需日志样本或受控复现（服务器日志、测试环境）。
15. `@fastify/rate-limit` 的存储是否确为进程内存（读依赖或测试）。
16. `ledger_imports.result`、`ledger_import_jobs.result`、`ledger_import_source_states` 是否含备注 / 金额等内容（数据库只读抽查或读写入代码）。
17. 邀请提醒通知（`referral_*`）里展示给邀请人的字段，是否含被邀请人昵称（读 `api/collab/referral.ts:205` 附近）。
18. 冲突界面是否把 `deviceId` 暴露给其他成员（读 `api/routes/transactions.ts:1047-1085`）。
19. 关键事件 `beforeState` / `afterState` 在各调用点实际包含哪些字段（已知 `account.created` 含用户名；其余未逐一审计）（读各调用点）。
20. 工作台配置（`statsWorkbench`、`/workbench`）是否含筛选条件、金额范围或账本 id（读 `packages/shared/src/workbench/configuration.ts` 的 schema）。
21. 备份 dump 中除上述外是否有字段级排除（已知仅排除 `ledger_write_locks` 数据）；`backup_logs` 备份范围说明（读 `deploy/backup.sh`，已部分确认）。

**浏览器实测**

22. 在测试账号上实测：登录、下载历史、退出，再看 IDB `libellum/kv` 是否仍有 `ledger-months:*`、`query-cache:*`；以及 `query-cache` 内实际含哪些查询（管理员页、附件列表、通知是否确实被持久化）（浏览器开发者工具）。
23. 游客身份走一遍全站，看网络面板是否有 `/auth/me` 之外的请求（浏览器网络面板）。
24. 账本导入任务日志 `libellum-ledger-import-task:*` 是否真的保存整份游客快照，以及成功回执后的自动清除条件（浏览器实测）。
25. 「清除本应用的全部本地数据」入口前是否有「还有 N 条未同步」检查（读 `DownloadMorePage` 全文，浏览器实测）。
26. 开发实验 HTML 页（`adaptation-lab.html`、`avatar-lab.html`、`component-gallery.html`、`material-lab.html`、`motion-lab.html`）是否随生产包发布；Service Worker 是否可能缓存服务器上其它返回个性化内容的非 `/api/` 路径；`/api` 响应（附件内容以外）的 `Cache-Control` 实际值；`navigator.storage.persist()` 的授权结果（读 `vite.config.ts`、`dist` 目录、服务器路由、实测）。

**所有者 / 文案**

27. 公告 1.17.11「布局按账号保存在本机」与服务端已有的 `workbench_configurations` 云端同步是否一致；以及 S17-A、公开文案中已知与代码不符的几处（见第 5.3 节）如何处置（所有者、公开文案核对）。

## 9. 可能需要优先处理的实际风险

合并三份调查，去重后按高 / 中 / 低排序。「线上是否存在」：是 = 在 `v1.19.56` 线上代码中；仅本机 = 1.19.57–1.19.82 引入；待核实 = 取决于未核对的部署事实。建议的下一步只是建议，不是已决定。三份调查均未发现需要立即处置的「正在发生的安全事故」。

| 级别 | 编号 | 风险 | 影响 | 线上是否存在 | 依据 | 建议的下一步 |
|---|---|---|---|---|---|---|
| 高 | H1 | **退出登录不清本机账目副本**：`clearQueryCache` 删的是不带区分的旧键，带账号 / 账本作用域的 `query-cache:*`、`ledger-months:*`、`ledger-marks:*` 留在明文 IndexedDB | 共用设备上，下一位使用者或能开开发者工具的人可读到上一位已下载的账目、备注、成员名、附件文件名、未同步改动；S17-A 与代码注释所说「退出会清掉」不成立，政策不能照写 | 是 | `apps/web/src/lib/offline/cache.ts:215,399`；`apps/web/src/auth/AuthProvider.tsx:142`；`S17-A:184,484` | 先在测试账号上实测确认；评估把退出时的清理改为按当前账号作用域清，或把真实行为如实写入政策与退出确认文案 |
| 高 | H2 | **生产没有任何生效的协议门禁，也不产生同意记录**（`NODE_ENV=production` 时必需协议列表为空） | 注册时没有勾选，`agreement_acceptances` 不会有数据；政策不能写「用户注册时已同意」 | 是 | `packages/shared/src/consent.ts:253-255`；`api/consent/policy.ts:41-43`；`api/app.ts:149-150` | 起草政策前先决定上线协议文档的方式与时间，再如实写同意事实 |
| 高 | H3 | **注销并不抹去个人信息**：`users` 的账号编号 / 头像 / 币种 / 时区 / 注册时间、`sessions`（IP、UA）、同意 / 公告 / 头像 / 时区变更记录、共享账本里的账目与留言附件、各处冻结旧昵称、关键事件链（含 `account.created` 里的用户名）及其 COS 加密副本、账号墓碑、备份 | 「匿名化」只覆盖用户名、昵称、密码、恢复码；政策需要列出保留清单与期限，不能写「注销后删除全部个人信息」 | 是 | `api/lifecycle/account.ts:691-755`；`api/routes/auth.ts:435-439` | 决定哪些保留项需要缩减或改写（如冻结昵称是否回写），并在政策里列出保留清单 |
| 高 | H4 | **「删除」基本是软删除，且删除后仍存在于备份**：账目、附件软删后永不自动清除；旧备注 / 金额留在事件快照与 `value_history`；留言无法编辑 / 删除；账本清理后数据在 COS 加密备份中保留至到期（文档称 70 天 / 365 天） | 不能表述为「删除即彻底消失 / 立即从所有系统移除」 | 是（备份期限待核实） | `api/routes/transactions.ts:1090-1197`；`api/routes/attachments.ts:238-256`；`deploy/README.md` | 政策中分别写「应用内删除」「永久清理」「备份到期」三层；核实第 8 节 5 |
| 高 | H5 | **业务库与本机备份为明文，附件内容明文存在数据库**（`entry_attachment_chunks.data`，无应用层加密）；仅异地副本 gpg 加密 | 有服务器权限或云盘快照访问权的人可读全部账目与附件；政策不能写「我们无法读取你的数据」 | 是 | `deploy/backup.sh:47-50,139-143`；`schema:2120-2160` | 政策如实写明运维可访问范围；评估是否需要附件加密或访问审计（决策归所有者） |
| 高 | H6 | **过期会话没有清理任务**，每行带 IP 与 UA 累积；注销账号时会话只标记撤销、行保留（有意保留以便返回“账号已注销”）；其它撤销后的会话只在再次被出示时删除；`last_seen_at` 从不更新 | 个人信息（IP、UA）无期限保留；注销后仍保留 | 是 | `api/auth/guard.ts:31-52`（已核对：撤销行在 `:50` 出示时删除，注销账号的行在 `:40-48` 有意保留）；`api/lifecycle/account.ts:691-694` | 评估增加过期会话清理与注销时清除 IP / UA 的策略 |
| 高 | H7 | **待上传附件原件没有任何清理入口**：IDB `libevra-attachments-v1/pending` 在退出、注销、切换账号、账本归档 / 删除、「清本机」「清全部」下都保留，未关联账目的草稿附件永不上传、永不过期 | 注销后同一浏览器仍可能留着该账号的照片 / PDF / 音频原件 | 是 | `apps/web/src/lib/attachments.ts:34-65`；`apps/web/src/components/Attachments.tsx:30-60` | 在清理链路中补上该库，或在界面与政策中说明 |
| 中 | M1 | **分享链接令牌进入请求日志**：`GET /api/v1/share/:token` 把令牌放在路径，Fastify 默认请求日志记录完整 URL；令牌最长 7 天、最多 10 次、需登录才能使用 | 能读日志的人可取得有效链接并以已登录身份加入账本，风险受限但真实 | 是（日志去向与保留待核实） | `apps/api/src/routes/share.ts:231,242`；`fastify@5.12.5/lib/log-controller.js:50` | 评估对请求 URL 做日志脱敏，或把令牌移出路径；同时核实日志保留 |
| 中 | M2 | **请求日志含客户端 IP 与完整 URL（含查询串）**，如 `directory/lookup?username=`、`admin/users?q=`、`export?筛选`；保存期限无上限的可能 | 日志里有 IP 与被查用户名 / 账号编号；Docker 未配置轮转 | 是；保留期待核实 | `api/server.ts:25`；`deploy/docker-compose.prod.yml`（无 `logging:`） | 核实 Docker 日志驱动，评估配置轮转与 URL 脱敏；政策如实写日志内容与期限 |
| 中 | M3 | **账本清理后遗留的元数据与孤儿行**：`ledger_*` 六张表无外键，`critical_events`、`book_lifecycle_events`、`book_recovery_requests`、`book_tombstones` 永久保留 | 「永久清理」后仍有关联元数据；其中 `ledger_*.result` 是否含内容待核实 | 是 | `api/lifecycle/book.ts:752-835`；迁移中无 `REFERENCES` | 抽查 `result` 字段内容，决定是否补清理 |
| 中 | M4 | **共享账本信息暴露面较宽**：任一成员（含只读）可导出全部账目与备注、可列出 / 下载全部附件（软删附件知道 id 仍可下载）、看到全部成员的用户名 + 账号编号、看到修改历史前后值与导出人昵称 / 用户名；账号导出含他人记录的账目 | 与「仅上传者可见」「只读只能看」等直觉可能不一致 | 是 | `api/routes/export.ts:171-291`；`api/routes/attachments.ts:94,296-323`；`api/routes/consent.ts:217-305` | 政策与邀请界面如实说明成员可见范围；评估软删附件内容读取是否要加 `deletedAt` 检查 |
| 中 | M5 | **用户枚举**：任一登录用户凭账号编号或精确用户名可查到对方昵称、用户名、账号编号，仅受全局每分钟 100 次限流约束 | 可被批量探测 | 是 | `api/routes/directory.ts:64-130` | 评估对该接口单独限流 |
| 中 | M6 | **登录 / 恢复码失败限流只在进程内存**，重启清零，多实例不共享 | 暴力破解防护可被重启绕过 | 是 | `api/auth/login-throttle.ts:15-56` | 评估持久化限流（实现属后续决定） |
| 中 | M7 | **注销时本机清理有遗漏**：`libevra.desktop.dashboard:v1:user:*`、`libevra.detail-cards.v2.user:*`、`libevra.s19-b2-glass:*`，以及导入任务日志 `libellum-ledger-import-task:*`（含完整导入请求，游客来源时含整份游客账本快照） | 偏好类不含金额但键名含账号 ID；导入任务日志含账目内容 | 是 | `apps/web/src/lib/offline/localCleanup.ts:81-91`；`apps/web/src/lib/ledgerImport/journal.ts:10-45` | 补全清单 |
| 中 | M8 | **设备 UUID 常驻并随每个请求外发**：登录前、游客也生成，退出 / 注销 / 清游客都不清，只有整库删除才变；服务端存入 `value_history`、冲突记录与日志 | 稳定的设备标识，政策需如实说明用途 | 是 | `apps/web/src/lib/offline/device.ts:17-44`；`apps/web/src/lib/api.ts:109-122` | 政策如实说明；评估注销 / 退出时是否轮换 |
| 中 | M9 | **识别结果（含识别原文、账户字段）存 sessionStorage，退出不清** | 退出后同一标签页内下一位使用者可能看到 | 是 | `apps/web/src/lib/ocr/types.ts:12-37`；`apps/web/src/lib/ocr/batchStore.ts` | 退出时清该键 |
| 中 | M10 | **「清除本应用的全部本地数据」范围与名称不符**：不清 LS、SS、游客库、待上传附件，且会连未同步改动一起删，文案未提示 | 用户可能误以为清干净，或意外丢未同步数据 | 是 | `apps/web/src/pages/DownloadMorePage.tsx:313`；`apps/web/src/lib/offline/reset.ts:31-62` | 评估改名或在文案中说明范围 |
| 中 | M11 | **诊断日志含金额分值、账目 id 前缀、设备 id，退出 / 注销不清**；用户「复制报告」分享时会带出 | 本机敏感信息经分享外流的可能 | 是 | `apps/web/src/lib/offline/sync.ts:229-232,692-694`；`apps/web/src/lib/runtimeInfo.ts:5` | 复制报告前提示或脱敏 |
| 中 | M12 | **S17-A 等旧文档与代码不符**：「后端无外网请求」（实际有 Frankfurter 汇率与 Hugging Face 模型下载）、「退出会清掉缓存」、角色只写 editor / viewer | 若据此写政策会写错 | 是 | `S17-A:198,184,484`；`api/fx/provider.ts:14-15`；`schema:918-927` | 在 S17-A 或后续文档里更正（本文不改其他文档） |
| 中 | M13 | **整份 `.env` 注入 API 与 relay 容器，并被 OCR / 语音 / 账单解析子进程继承** | 最小权限问题；无证据显示被滥用 | 是 | `deploy/docker-compose.prod.yml:94-96`；`api/ocr/client.ts:222-224` | 评估只传必要变量给子进程 |
| 中 | M14 | **本机 `.dump.gpg` 副本无清理逻辑**，随天数增长；本机明文 `.dump` 7 天 + 最新 3 份 | 磁盘占用与数据最小化 | 是（实际数量待核实） | `deploy/backup.sh:263-276` | 核实数量后决定补清理 |
| 低 | L1 | 邀请码明文存库（`registration_invites.code`），管理员界面只显示掩码；会话令牌、分享令牌、恢复凭证存哈希 | 低 | 是 | `schema:419-` | — |
| 低 | L2 | `transaction_events.source_ip` 很可能只是代理内网 IP，且无读取路径；政策不应写「记录操作来源 IP」而不加限定 | 低 | 待核实 | `api/ledger/auditContext.ts:12-22` | 核实 `AUDIT_TRUSTED_PROXY_IPS` |
| 低 | L3 | `UPLOAD_DIR`、`SESSION_SECRET` 出现在 compose 中，但源码无引用（仅 `s17-fx-combined-api.ts` 命中）；政策不要写「上传暂存目录」 | 配置与实现不一致 | 是 | `deploy/docker-compose.prod.yml:107-108` | 供部署核对 |
| 低 | L4 | 告警邮件经 Resend 发送，正文可能含内部任务 id / 账本 id（不含金额、备注、账号名） | 低 | 待核实 | `deploy/alert-mail.sh:169-202` | — |
| 低 | L5 | 语音失败日志记录客户端声明的文件名；OCR 异常 / 无法解析行最多 200 字符进日志 | 低 | 是 | `api/routes/voice.ts:85`；`api/ocr/client.ts:299-302` | — |
| 低 | L6 | `Permissions-Policy` 没有 `microphone=()`，而语音用 `getUserMedia`（`camera=()` 已禁） | 仅说明站点允许使用麦克风 | 是 | `deploy/Caddyfile:85` | — |
| 低 | L7 | 密钥与口令文件（`.backup.key`、COS 上传身份）与应用同机；服务器被入侵时可读本机明文备份 | 设计取舍 | 是（服务器权限待核实） | `deploy/README.md` | — |
| 低 | L8 | 游客「清除游客数据」后 `libevra.stats-workbench*:v1:guest:*` 等偏好残留 | 低，不含账目 | 是 | `apps/web/src/lib/guest/cleanup.ts:27-45` | — |
| 低 | L9 | 本机明文存储且不过期是有意设计；1.19.81 的同意状态本机缓存在退出 / 「清本机」时不清 | 政策需如实写「不加密、不自动过期」 | 前者线上有，后者仅本机 | `apps/web/src/lib/offline/cache.ts:42`；`apps/web/src/lib/consent.ts:88-114` | — |

**正面事实（不是风险，但需要写明）**：会话 Cookie 为 HttpOnly + SameSite=Lax，前端不保存令牌或密码；会话令牌、分享令牌、恢复凭证只存哈希，密码与恢复码存 argon2id 哈希；CSP 为 `default-src 'self'`，无第三方脚本 / 字体 / 统计 / 地图 / 错误上报；Service Worker 不缓存 `/api/`；识别输入不外发、不落盘；游客账本正常使用不上传。

## 10. 后续起草隐私政策需要核实的问题

### 10.1 对照《法律文件设计要点说明》第八节逐条

| 起草要点第八节 | 本次调查已查清 | 还缺什么 |
|---|---|---|
| 1. 正式运营主体与联系方式 | 代码与部署文档中未涉及运营主体；`ACME_EMAIL` 可选，告警邮件收件人是运维配置 | 全部缺：需所有者提供 |
| 2. 目标服务地区及适用法律 | 服务器在腾讯云香港（文档线索）；`docs/ops/中国大陆互联网备案与发行准备.md` 有备案相关记载 | 适用法律需另行审查；服务地区以云控制台与所有者为准 |
| 3. 云服务器所在地及全部第三方服务 | 第 5 节已列全：腾讯云轻量、COS（备份 + 关键事件两个桶）、Resend、Healthchecks.io、Frankfurter、Hugging Face、ACME CA、DNS、GitHub 与构建期依赖；浏览器端没有第三方请求 | 第 8 节 4、5、7、9、10、11、13 条待服务器或控制台确认 |
| 4. 真实的数据存储、保留、删除、同步与备份行为 | 第 3、4、6 节：浏览器本地、数据库、备份、日志、临时数据的位置、期限与删除行为；同步为联网时自动上传账目，附件分块上传，识别图片 / 音频不落盘 | 日志实际保留期、COS 实际生命周期、备份加密口令的异地副本、各定时器是否启用（第 8 节 2、3、5、8） |
| 5. 账号注销和数据导出能力 | 注销与「只删服务器数据」两条路径、保留清单（6.4）；四种导出及内容（6.10）；账号导出含他人记录账目与软删账目 | 保留期限（账号 / 墓碑 / 关键事件代码中无期限）、冻结昵称是否回写由所有者决定；导出是否满足可携带要求需法律审查 |
| 6. 多人账本权限及数据归属规则 | 四档角色与权限、成员退出 / 被移除后记录保留、共享账本不可删除、管理者移交（6.3）；成员可见范围与导出范围（M4） | 「数据归属」是法律与产品决定，代码只表现为「记录留在账本」 |
| 7. 365 天不活跃规则的适用对象、通知方式及实施程序 | 代码中没有账号不活跃清理逻辑；365 天只出现在**归档账本**的永久清理期（`api/lifecycle/constants.ts:9`）；过期会话也不清理 | 该规则若要适用，属尚未实现的设计；需所有者确定对象、通知与实施程序 |
| 8. 永久停服时可以提供的实际导出及过渡能力 | 现有导出能力见 6.10 | 停服流程、期限、通知方式代码中没有，属尚未实现 |
| 9. 隐私同意、单独同意与版本记录实现 | 机制存在（`agreement_acceptances` 记文档 id、版本、内容哈希、时间；不存 IP / UA / 正文）与重大公告记录；**生产当前没有生效的协议文档，不产生同意记录**；单独同意（如附件、识别）在代码中没有独立记录；1.19.81 同意状态缓存仅本机 | 起草时需决定上线方式与版本记录；是否需要单独同意属法律判断 |
| 10. 未成年人是否允许注册及对应措施 | 代码中没有年龄字段，注册只需用户名、昵称、密码（+ 邀请码） | 未成年人政策与措施需所有者决定，代码无相关实现 |

### 10.2 本次调查新发现、起草时必须处理的问题

1. **删除与备份的关系**：应用内删除与永久清理之后，数据仍会在加密备份中保留到期（文档称每日 70 天、每月 365 天，未在控制台核实）；政策要如实写「删除后仍在加密备份中保留到期」，并在写具体天数前先核实第 8 节 5。
2. **注销后保留的数据清单**：用户名改写为 `closed_<id>`、昵称改写后，仍保留账号编号、头像、币种、时区、注册时间、会话 IP / UA、同意 / 公告 / 头像 / 时区记录、共享账本中的账目与留言附件、冻结昵称、关键事件（含 `account.created` 用户名）及其 COS 加密副本、账号墓碑；需在政策里如实列出，并决定每项的保留期限（代码中大多没有期限）。
3. **共享账本里的数据归属与可见范围**：只读成员可导出全部账目与备注、下载全部附件；退出者记录留在账本；任何登录用户可凭精确用户名或账号编号查到昵称与账号编号。
4. **本机副本**：浏览器本地保存明文、不过期、不加密的账目副本；**退出登录不清除**（线上），待上传附件原件无清理入口；游客数据无云端备份；政策与界面文案要写清楚用户如何清除，并避免沿用 S17-A「退出会清掉」的说法。
5. **设备标识与 IP**：设备 UUID 随每个请求外发（含游客）；会话行与请求日志含 IP，会话行含 UA；`transaction_events.source_ip` 很可能只是代理内网 IP，不应写成「记录用户真实 IP」，除非核实第 8 节 1。
6. **同意事实**：生产当前不产生协议同意记录；已有的重大公告记录只对注册时间早于公告的账号产生；政策不能写「注册即视为已同意」。
7. **日志**：日志含客户端 IP 与完整 URL（含分享令牌路径、被查询的用户名），保留期未知，政策应在核实后写。
8. **识别与第三方**：识别图片、音频只在服务器本机处理且不落盘，可以这样写；但不能写「后端从不联网」——后端会向 Frankfurter 取汇率、向 Hugging Face 下载语音模型（不含用户数据，暴露服务器 IP）；备份与关键事件上传 COS 的是加密数据。
9. **附件存储**：附件内容明文存于 PostgreSQL，随整库备份，无应用层加密；软删附件不自动清除。
10. **未创建账号时的数据**：游客账本在本机，只有用户主动导入账号时才整份上传；游客启动时仍会向服务器发 `/auth/me` 请求并携带设备 UUID、时区、语言。
11. **口径纪律**：政策表述应以「线上运行」口径为准；1.19.57–1.19.82 的仅本机改动（同意状态缓存、导入后归档清本机副本、内存滚动与面板记忆、放弃确认）在部署前不得写成已提供的功能。
