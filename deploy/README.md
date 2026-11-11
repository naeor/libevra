# 部署配置与脚本契约

本目录包含运行配置、迁移/备份/恢复脚本和 systemd 单元。**操作流程权威在 [03 运维手册](../docs/03-运维手册.md)**；实际部署版本与未完成验收只看 [STATUS](../docs/STATUS.md)。本文不重复发布步骤，不代表生产已安装仓库中的每项补丁。

## 架构与使用边界

Web/Caddy 是公网入口；API、PostgreSQL和迁移容器按 `docker-compose.prod.yml` 连接，relay 使用 `critical-events-relay.compose.yml`。OCR/语音由 API 容器内 sidecar 调用，准确镜像内容以 Dockerfile 为准。服务器采用 `git archive` 上传源码，不要求服务器 clone 或持有 GitHub 凭据。

修改配置先核对依赖、环境变量和当前安装状态；生产上传、部署、密钥与数据恢复需当次授权。应用回滚不撤销数据库迁移。数据库不兼容时不能默认恢复整库；停写、数据时间点、丢失影响和恢复验证按运维手册执行。

## 发布脚本边界

`deploy.sh` 执行备份、构建（除非 `--no-build`）、启动与健康检查；失败保留状态供人工判断。仅有 Git 元数据时检查工作区，归档部署来源须在本地与安装环节验证。脚本的旧 Git 回滚提示待单独修正，操作以运维手册 §4–§5 为准。

## 备份脚本契约

### 运行结果与权限门禁

`last-run.json` 保留 schemaVersion 2，增量记录 `result`、`exitCode`、`dataComplete`、`heartbeat.attempted/delivery`。完整成功必须包含当次导出、归档验证、隔离恢复、加密、上传、远端校验及原子状态落盘；之后才尝试成功心跳。数据库 `backup_logs` 仍为 best-effort 审计，不替代状态文件。

| 情况 | 退出码 / 结果 | Daily Backup 心跳 |
|---|---|---|
| 完整数据链路与必要状态记录成功 | `0` / `full`、`dataComplete=true` | 尝试一次成功投递；收到 2xx 即停止重试 |
| `--skip-offsite` 或 `--no-restore-drill` | `2` / `partial` | 不发成功或失败 Ping；数据库审计为 `ok=false`、`[partial]` |
| 锁忙 | `75` / `skipped`（journal 明确记录） | 不投递、不覆盖持锁任务状态、不重复告警 |
| 必要步骤失败／意外退出 | 原始非零码 / `failed` | EXIT 统一尝试失败投递与邮件，不覆盖原始码 |
| 数据完整、心跳投递失败 | 仍 `0` / `full`，`heartbeat.delivery=failed` | 投递错误单独记录，不能误记为数据备份失败 |

`--skip-heartbeat` / `--skip-notify` 继续作为显式维护选项。异地未配置是失败，不返回 0。信号 HUP/INT/TERM 分别保留 129/130/143；SIGKILL、断电等无法 trap，仍靠外部失联监控发现。

敏感 rclone 配置仅放在 `backups/.runtime.XXXXXX/rclone.conf`（目录 700、文件 600），由本次运行创建、退出时清理；不再写固定 `.rclone.conf.tmp`。`deploy/` 只需可读／可遍历，`backups/` 与现有状态／锁须允许备份用户写入；凭据须可读且不向组／其他用户开放。不要递归 chmod/chown 整个部署目录。

源码解包仍需由操作者保留必要属主；最初改变属主的操作未被证实，`deploy.sh` 没有解包或 chown 路径。脚本内发布前检查不能替代手工解包前后的检查。每次解包前后、应用切换前均运行：`sudo -n -u ubuntu -- bash /srv/libevra/deploy/backup-preflight.sh`。门禁只读，不触发备份或网络请求。新增 helper 须与编排、心跳和本地备份脚本一起安装；systemd unit/timer 未改，不需要 daemon-reload 或重启。

私有暂存目录可保持 700，但源码文件须保留可信 `git archive` 的原始模式：在严格 `umask` 下解包使用 `tar --same-permissions --no-same-owner`，再以容器实际非 root 用户检查根清单、Prisma 配置与 schema 可读。源码权限与生产凭据权限分开处理；只同步归档包含的源码，不递归 chmod/chown 运行目录，不包含 `.env`、密钥或备份。

心跳最多 3 次，每次连接超时 5 秒、整体请求超时 15 秒，重试间隔 2 秒（请求预算最多约 49 秒）。只对临时 HTTP/传输错误重试，永久 HTTP 错误直接停止；仅记录 HTTP 状态、curl 返回码与错误类别，不输出 URL 或请求配置。网络丢失响应时无法保证服务端恰好接收一次，不能将有界重试称为网络层 exactly-once。

本地验证：`bash deploy/tests/run.sh`，包含 Python 隔离行为测试，全部外部命令使用替身；Windows 可设置 `PYTHON` 与 `BACKUP_TEST_BASH`，`BACKUP_TEST_SIGNALS=1` 可启用 Git Bash 信号检查。NTFS 下 Unix mode 读取使用替身，真实 DAC/flock 语义仍需 Linux 隔离环境验收。

生产是否已安装、Linux/systemd 是否完成验收以 STATUS 和当次发布证据为准；下面是配置与操作接口，不继承任何历史批准。

### 秘密文件（**不进仓库**，权限 `600`）

| 文件 | 内容 |
|---|---|
| `deploy/.backup.key` | 加密口令（`openssl rand -base64 32`）。**丢了 = 异地备份全废**，必须有服务器之外的副本 |
| `deploy/.backup.env` | **上传身份**：`COS_UPLOAD_ID` / `COS_UPLOAD_KEY` / `COS_BUCKET` / `COS_REGION` / `COS_ENDPOINT` |
| `deploy/.backup-mail.env` | `MAIL_API_KEY` / `MAIL_TO` / `MAIL_FROM`（Resend） |
| `deploy/.backup-heartbeat.env` | `HEARTBEAT_URL`（Healthchecks.io） |
| `deploy/.backup-restore.env` | **恢复身份**（`COS_RESTORE_*`）——**不放在生产服务器** |

**⚠️ 上传身份只给"写 + HeadObject"；恢复身份（只读）不放在服务器上。权限清单与实测依据见 `docs/开发过程记录/S12-C-B-实施与配置指南.md` §1。**
实际 COS 生命周期（控制台维护，2026-10-17 所有者确认）：`daily/` 保留 **70 天**（历史版本 42 天、未完成分片 14 天），`monthly/` 保留 **365 天**（历史版本 63 天、未完成分片 21 天）。由**桶的生命周期规则**在服务端执行——即使服务器被入侵，历史备份也删不掉；仓库中不存在 `baseline/` 前缀的额外保留。S13-H 的删除墓碑重放依赖此真实期限，文档不得再写 30/35 天。

### 安装定时任务（**先手动跑通，再 `enable`**）

```bash
sudo cp deploy/systemd/libevra-backup.service /etc/systemd/system/
sudo cp deploy/systemd/libevra-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload

# ⚠️ 先手动跑一次，确认三项状态都是 true 再启用
cd /srv/libevra/deploy && ./backup-all.sh

# 启用（每天 03:00 香港时间；Persistent=true 会补跑关机错过的）
sudo systemctl enable --now libevra-backup.timer
systemctl list-timers libevra-backup.timer --no-pager
```

### 归档清理任务（S13-H）

```bash
sudo cp deploy/systemd/libevra-lifecycle.service /etc/systemd/system/
sudo cp deploy/systemd/libevra-lifecycle.timer   /etc/systemd/system/
sudo systemctl daemon-reload
# 先手动跑一次；脚本内部有 advisory lock，重复运行不会重复清理
docker compose -f deploy/docker-compose.prod.yml run --rm api \
  pnpm --filter @libellum/api lifecycle:purge
sudo systemctl enable --now libevra-lifecycle.timer
systemctl list-timers libevra-lifecycle.timer --no-pager
```

**每天 03:30 香港时间执行；清理的是到期归档账本，不是交易软删除。** 用户界面展示的是
“预计自动清理日”，实际可在到期后 24 小时内完成；失败会留在 `purge_last_error` 并让 unit 失败，
下一次 timer 重试，不会静默无限保留。

### S13-I 关键状态登记簿（已通过隔离验收，生产启用需所有者批准）

**精确检查点备份（安全恢复的唯一合法输入）**：使用 db 容器自带 PostgreSQL 工具，生成
`critical-backups/<name>.dump` + `.checkpoint.json`；它不会修改 S12-C 的 `backup.sh`/COS 生命周期。

```bash
# 事件密钥只在本机安全终端生成一次；不要打印、不要进 shell 历史/日志。
# 64 hex（32 字节）或 base64 32 字节均可；初始 keyId 用 v1。
umask 077
openssl rand -hex 32 > /tmp/libevra-event-key.v1
# 由所有者把值写入 deploy/.critical-events-key.env 的 CRITICAL_EVENT_KEY（600），
# 然后删除临时文件。该文件只被 relay 与 checkpoint timer 加载，API 不加载。

# 首次空链 checkpoint（API 必须尚未启动；先加载事件密钥文件）：
set -a; . ./.critical-events-key.env; set +a
CRITICAL_BACKUP_OFFSITE=cos ./critical-events-backup-all.sh "initial-empty-seq0"
# 自动调度：timer 服务显式设置 CRITICAL_BACKUP_OFFSITE=cos，并加载 key env。
# 恢复机从异地取回并校验（需只读 COS_RESTORE_*）：
./critical-events-fetch-backup.sh --latest --out /tmp/recovery
# 安装 timer（仓库副本；先手动跑一次验收）：
sudo cp systemd/libevra-critical-backup.service systemd/libevra-critical-backup.timer \
  systemd/libevra-critical-health.service systemd/libevra-critical-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now libevra-critical-backup.timer libevra-critical-health.timer
```

`critical-events-backup-all.sh` 使用独立锁 `.critical-events-backup.lock`；**不要**和 S12-C
`backup-all.sh` 的 `.backup.lock` 共用。**普通 S12-C dump 不能用于安全恢复**；只有带
dump+sidecar 的检查点备份可以。`critical-events-fetch.sh` 只从正式前缀的 `events/` 和
`manifests/` 两棵子树取回，并使用 `rclone --fast-list`，避免验收/测试子目录被当作真实事件。
首个 checkpoint 必须在 API 尚未接受写入时创建；顺序不能反过来。

真实 COS + Docker 隔离验收的测试策略、CAM 控制台步骤和演练计划在
[`tencent-cos/README.md`](tencent-cos/README.md)；当前只有准备文件，**尚未创建任何云资源**。

API **不直接访问 COS**。生产启用时另起一个无端口的 relay 服务（同一 API 镜像）：

```bash
# 先按 S13-I 操作手册申请独立前缀、写身份、恢复身份与生命周期；不要改 daily/monthly。
cp deploy/.critical-events-relay.env.example deploy/.critical-events-relay.env  # 再填真实值
chmod 600 deploy/.critical-events-relay.env
docker compose -f docker-compose.prod.yml -f critical-events-relay.compose.yml up -d critical-relay
```

- API 使用 `CRITICAL_EVENTS_MODE=relay`；**业务事务成功后立即返回**，独立 relay 异步上传并在失败时重试/告警；COS/relay 故障不会让已完成的业务返回 503；
- relay 只有 `critical-events/v1/` 的 PutObject/HeadObject，没有 Get/List/Delete；
- 恢复只读身份放在离线介质，用 `deploy/critical-events-fetch.sh` 取回；
- 原始备份直恢复仍独立：见 `deploy/emergency-raw-restore.sh` 与 S13-I 操作手册；
- **未批准前不要设置真实 COS 凭据、不要建前缀、不要启用 relay。**

### 查看与暂停

```bash
journalctl -u libevra-backup -n 100 --no-pager     # 最近一次的输出
cat /srv/libevra/deploy/backups/last-run.json      # 三项状态（本地/演练/异地）
sudo systemctl stop libevra-backup.timer           # 暂停（备份不再自动跑）
sudo systemctl start libevra-backup.timer          # 恢复
```


## 历史依据

重要原始讨论、试验、否决理由与当时状态完整保存在[整理前原文](../docs/archive/documentation/20261108/deploy/README.md)。历史快照不指导当前开发；现行规则直接更新本文件。

<!-- directory-index:start -->
## 直属目录清单

本区块由 `pnpm docs:index` 维护；文件用途用于定位，行为以权威规格与实现为准。

| 文件 | 用途 / 入口 |
|---|---|
| [.critical-events-key.env.example](.critical-events-key.env.example) | 配置或资料：.critical-events-key.env.example |
| [.critical-events-relay.env.example](.critical-events-relay.env.example) | 配置或资料：.critical-events-relay.env.example |
| [.critical-events-restore.env.example](.critical-events-restore.env.example) | 配置或资料：.critical-events-restore.env.example |
| [.env.production.example](.env.production.example) | 配置或资料：.env.production.example |
| [.s13i-test.api.env.example](.s13i-test.api.env.example) | 配置或资料：.s13i-test.api.env.example |
| [.s13i-test.db.env.example](.s13i-test.db.env.example) | 配置或资料：.s13i-test.db.env.example |
| [.s13i-test.relay.env.example](.s13i-test.relay.env.example) | 配置或资料：.s13i-test.relay.env.example |
| [Caddyfile](Caddyfile) | 配置或资料：Caddyfile |
| [Dockerfile.api](Dockerfile.api) | 配置或资料：Dockerfile.api |
| [Dockerfile.web](Dockerfile.web) | 配置或资料：Dockerfile.web |
| [alert-mail.sh](alert-mail.sh) | 运维/开发脚本；执行前确认范围 |
| [backup-all.sh](backup-all.sh) | 运维/开发脚本；执行前确认范围 |
| [backup-log.sh](backup-log.sh) | 运维/开发脚本；执行前确认范围 |
| [backup-preflight.sh](backup-preflight.sh) | 运维/开发脚本；执行前确认范围 |
| [backup.sh](backup.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-backup-all.sh](critical-events-backup-all.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-backup.sh](critical-events-backup.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-fetch-backup.sh](critical-events-fetch-backup.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-fetch.sh](critical-events-fetch.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-health.sh](critical-events-health.sh) | 运维/开发脚本；执行前确认范围 |
| [critical-events-relay.compose.yml](critical-events-relay.compose.yml) | 配置 |
| [deploy.sh](deploy.sh) | 运维/开发脚本；执行前确认范围 |
| [docker-compose.prod.yml](docker-compose.prod.yml) | 配置 |
| [docker-compose.release-1.16.08.yml](docker-compose.release-1.16.08.yml) | 配置 |
| [docker-compose.release-1.16.09.yml](docker-compose.release-1.16.09.yml) | 配置 |
| [docker-compose.release-1.16.15.yml](docker-compose.release-1.16.15.yml) | 配置 |
| [docker-compose.release-1.16.16.yml](docker-compose.release-1.16.16.yml) | 配置 |
| [docker-compose.release-1.16.18.yml](docker-compose.release-1.16.18.yml) | 配置 |
| [docker-compose.release-1.16.19.yml](docker-compose.release-1.16.19.yml) | 配置 |
| [docker-compose.release-1.16.21.yml](docker-compose.release-1.16.21.yml) | 配置 |
| [docker-compose.release-1.16.22.yml](docker-compose.release-1.16.22.yml) | 配置 |
| [docker-compose.release-1.16.23.yml](docker-compose.release-1.16.23.yml) | 配置 |
| [docker-compose.release-1.17.11.yml](docker-compose.release-1.17.11.yml) | 配置 |
| [docker-compose.release-1.17.15.yml](docker-compose.release-1.17.15.yml) | 配置 |
| [docker-compose.release-1.18.02.yml](docker-compose.release-1.18.02.yml) | 配置 |
| [docker-compose.release-1.18.06.yml](docker-compose.release-1.18.06.yml) | 配置 |
| [docker-compose.release-1.18.08.yml](docker-compose.release-1.18.08.yml) | 配置 |
| [docker-compose.release-1.18.15.yml](docker-compose.release-1.18.15.yml) | 配置 |
| [docker-compose.release-1.18.32.yml](docker-compose.release-1.18.32.yml) | 配置 |
| [docker-compose.release-1.19.49.yml](docker-compose.release-1.19.49.yml) | 配置 |
| [docker-compose.release-1.19.53.yml](docker-compose.release-1.19.53.yml) | 配置 |
| [docker-compose.release-1.19.56.yml](docker-compose.release-1.19.56.yml) | 配置 |
| [docker-compose.s13i-test.yml](docker-compose.s13i-test.yml) | 配置 |
| [emergency-raw-restore.sh](emergency-raw-restore.sh) | 运维/开发脚本；执行前确认范围 |
| [heartbeat.sh](heartbeat.sh) | 运维/开发脚本；执行前确认范围 |
| [import-health.sh](import-health.sh) | 运维/开发脚本；执行前确认范围 |
| [monthly-offsite-drill.sh](monthly-offsite-drill.sh) | 运维/开发脚本；执行前确认范围 |
| [offsite-fetch.sh](offsite-fetch.sh) | 运维/开发脚本；执行前确认范围 |
| [restore.sh](restore.sh) | 运维/开发脚本；执行前确认范围 |
| [verify-dump.sh](verify-dump.sh) | 运维/开发脚本；执行前确认范围 |
| [web-entrypoint.sh](web-entrypoint.sh) | 运维/开发脚本；执行前确认范围 |

| 子目录 | 职责 |
|---|---|
| [systemd/](systemd/README.md) | 定时任务与服务单元。 |
| [tencent-cos/](tencent-cos/README.md) | 本层组织 tencent-cos 模块的直属文件；具体契约由任务索引定位。 |
| [tests/](tests/README.md) | 专项测试。 |
<!-- directory-index:end -->
