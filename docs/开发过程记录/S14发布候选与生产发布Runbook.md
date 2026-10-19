# S14 Release Candidate 与生产发布 Runbook（1.13.15 → 1.14.18）

> 候选源码：commit `5dc2d54` / tag `s14-rc-1.14.18` / `APP_VERSION = 1.14.18`
> 生产现状：`1.13.15` / commit `cc14725` / 45 个 migration
> 候选：51 个 migration
> 本文档是发布计划，不是已执行的生产发布记录。
> **本轮未 push、未部署、未执行生产 migration、未修改生产服务/COS/CAM/密钥。**

---

## 0. 当前 RC 状态与容器环境阻断

### 0.1 已固定的源码基线

| 项目 | 值 |
|---|---|
| 候选 commit | `5dc2d54dbc1d95b64c9069254ce2fedef87bdb1e` |
| 候选 tag | `s14-rc-1.14.18`（另保留 `s14-d5-prod-drill-1.14.18`） |
| 版本 | `1.14.18` |
| 工作区 | 干净 |
| 生产基线 | `cc14725` / 1.13.15 / 45 migrations |
| 候选 migration | 51 |
| 源码归档 SHA-256（本地 `git archive` 验证，不含密钥） | `a195cc9e146e9e52629b091f1152526730602e87c18aeff0bd0fb020a287dc1d` |

### 0.2 已完成的候选验证

- Shared：167 / 167
- API：457 / 457（44 文件）
- Web：518 / 518（59 文件）
- `pnpm typecheck` ✅
- `pnpm check:build` ✅
- `pnpm check:docs` ✅
- `pnpm check:db` ✅（51/51）
- 1.14.18 源码进程实际启动：`/api/v1/health` 返回 `version=1.14.18`、`database=up`
- 生产备份副本隔离升级演练已完成（见 [`S14-D5生产备份隔离升级演练`](S14-D5生产备份隔离升级演练.md)）

### 0.3 ⚠️ 当前阻断：本机没有 Docker/容器运行时

本执行环境没有 `docker`、`docker compose`、Podman、nerdctl 或 WSL 发行版；因此本轮**无法实际构建 API/Web/Migration/Relay 镜像，也无法执行隔离 Docker Compose 的 `restore.sh`**。

未擅自安装 Docker、WSL 或修改系统。**不得用伪造的 tag/digest 代替实际构建结果。**

需要在具备 Docker Engine 的隔离机器/CI 上完成：

1. 按 §1 构建候选镜像并记录 Image ID、平台、归档 SHA、source commit、build 时间；本地无 registry 时 RepoDigest 可空；
2. 按 §2 在完全隔离的 Compose 项目执行 `restore.sh` 的四个场景；
3. 把实际 tag/digest/archive 和执行结果补入本文件后，才能签发生产发布 Go。

### 0.4 可用 Docker 环境只读核查（2026-10-19 15:02）

本机没有 Docker；仅能访问既有腾讯云生产服务器，**没有独立临时 Docker 主机**。对生产服务器只做了以下只读检查，未构建、未启动测试容器、未执行 restore：

| 项目 | 当前值 |
|---|---|
| Docker / Compose | Docker 29.9.1 / Compose v5.6.0 |
| CPU | 2 vCPU |
| 内存 | 7.5 GiB total，约 5.5 GiB available |
| 磁盘 | 79G total，46G available |
| 现有 Compose 项目 | `deploy`（4 个服务，含 relay）、`s13i-test`（3）、`s13i-recovery`（1） |
| 现有运行容器 | 9 个 |
| 生产版本/数据点 | 1.13.15；45 migrations；users=4、books=5、members=7、transactions=164；critical_events=0、chain seq=0、checkpoints=3；relay last_seen 07:04 UTC |
| 最新生产备份 | 2026-10-19 03:56（Asia/Shanghai），local/restore/encrypt/upload/remoteMeta 均 true；发布时必须重新备份 |

**结论**：现有生产服务器具备 Docker 和一定资源余量，但 2 vCPU/5.5 GiB 可用内存需要与生产服务共享；在其上构建镜像并运行隔离 Compose **属于占用生产服务器资源**，按要求必须先报告方案并经所有者确认，不能自行执行。

建议方案（等待确认）：

- 在 `/tmp/libevra-rc-1.14.18-eval` 建立临时目录，独立 Compose project `libevra-rc-1.14.18-eval`，独立 network/volumes；
- 构建 API/Web/Relay 候选镜像（约 2.6GB API + 100MB Web + build cache），测试 runtime 加一个临时 Postgres；预计 **磁盘 4–6GB、内存峰值 2–4GiB、CPU 2 核共享**；
- 测试容器不发布公网端口（仅 127.0.0.1 临时端口）；使用合成测试数据库/dump，不挂载生产 volume、不读取生产 `.env`、不连接生产网络；
- 测试完成后删除临时 project/volumes/images 和 build cache；全程不影响 `deploy` 项目；
- 建议在低峰时段执行，预计 30–60 分钟；如果构建/测试造成生产延迟或内存压力，立即停止并清理。

替代方案：所有者提供独立临时 Docker 主机/CI Runner，或新建临时云实例（需另行批准费用/资源）。

## 1. 候选镜像构建规格（待 Docker 环境执行）

### 1.1 构建来源

- 只使用 commit `5dc2d54` 的 `git archive` 内容；工作区必须干净；
- 不把 `.env`、`.backup.key`、`.critical-events-*.env`、备份 dump 打入镜像；
- 使用 `pnpm-lock.yaml` 和 Dockerfile 自带的固定 pnpm 版本。

### 1.2 构建命令

在仓库根目录：

```bash
# API + migrate 共用 deploy/Dockerfile.api
docker build -f deploy/Dockerfile.api -t libevra-api:1.14.18 .
docker tag libevra-api:1.14.18 libevra-migrate:1.14.18
docker tag libevra-api:1.14.18 libevra-relay:1.14.18

# Web + Caddy
docker build -f deploy/Dockerfile.web -t libevra-web:1.14.18 .
```

记录 **Image ID、平台/架构、构建时间、源码 commit、镜像归档 SHA-256**；不要求本地构建产生 RepoDigest：

```bash
# Image ID / platform / created
for image in libevra-api:1.14.18 libevra-web:1.14.18 libevra-migrate:1.14.18 libevra-relay:1.14.18; do
  docker image inspect "$image" \
    --format '{{.Id}} {{.Os}}/{{.Architecture}} {{.Created}} {{index .RepoTags 0}} {{index .RepoDigests 0}}'
done
# 镜像归档（不包含 .env/密钥/备份）
docker save libevra-api:1.14.18 > /tmp/libevra-api-1.14.18.tar
sha256sum /tmp/libevra-api-1.14.18.tar
# 服务器部署前：docker load -i，确认 Image ID 与本地记录完全一致
```

如果构建环境没有 registry/RepoDigest，记录 `RepoDigests=[]`，以 **Image ID + 归档 SHA-256 + source commit** 作为可验证身份；生产部署必须加载同一归档或同一 Image ID 的镜像，**不得在发布时重新构建出未经验证的镜像**。

### 1.3 需填写的镜像记录

| 组件 | tag | Image ID | 平台/架构 | 构建时间 | 归档 SHA-256 | RepoDigest | 对应 commit | 版本 |
|---|---|---|---|---|---|---|---|---|
| API | `libevra-api:1.14.18` | **未生成（Docker 环境缺失）** | linux/amd64 | — | **未生成** | 可空 | `5dc2d54` | 1.14.18 |
| Web/Caddy | `libevra-web:1.14.18` | **未生成** | linux/amd64 | — | **未生成** | 可空 | `5dc2d54` | 1.14.18 |
| Migration | `libevra-migrate:1.14.18` | **未生成** | linux/amd64 | — | **未生成** | 可空 | `5dc2d54` | 1.14.18 |
| Relay | `libevra-relay:1.14.18` | **未生成** | linux/amd64 | — | **未生成** | 可空 | `5dc2d54` | 1.14.18 |
| PostgreSQL | `postgres:17`（建议 pin digest） | 待记录 | linux/amd64 | — | — | 待记录 | 基础镜像 | — |

> 生产 Compose 的服务镜像由 compose build 生成；上表是本地验证用约定 tag。正式发布必须使用**同一镜像 ID/digest**，不能在服务器上重新 resolve 依赖。

### 1.4 镜像冒烟（Docker 环境执行）

- 启动 API 容器，连接一次性 51 迁移数据库；
- `/api/v1/health` 返回 `version=1.14.18`、`database=up`；
- 执行 CSV 原子性、phase-4 锁、导入确认、撤销 smoke（可用 API 测试账号/测试账本；不得用生产账本）；
- Web 容器 `/healthz` 200，页面显示 1.14.18。

---

## 2. 隔离 Docker Compose `restore.sh` 验证（待执行）

### 2.1 隔离要求

- 独立的 Compose project name，如 `libevra-rc-restore`；
- 独立网络、独立 named volume；
- 不映射生产 80/443；不连接生产数据库；
- 不加载生产 `.env`，只使用临时测试环境变量；
- 不启动生产 relay/checkpoint；如需模拟外部服务使用本地替身；
- 恢复目标只能是临时 Compose 的 `db` 容器，不能使用生产 Docker 容器。

### 2.2 执行方式

`restore.sh` 的完整逻辑必须在临时目录执行：复制候选 `deploy/`，用**测试版 `docker-compose.prod.yml`**（同一文件中定义 `db`、`api` 服务，project name 唯一），由于脚本硬编码该文件名，不能直接在生产目录执行。临时目录中的 `restore.sh` 应与候选源码逐字节一致。

**数据库目标选择审计**：`restore.sh` 使用当前目录的 `.env` 中的 `POSTGRES_USER/POSTGRES_DB`，并通过 `docker compose -f docker-compose.prod.yml` 的**当前 Compose project** 执行 `dropdb/createdb`。脚本本身不接收数据库 host 参数，所以隔离性完全取决于 **运行目录 + `COMPOSE_PROJECT_NAME` + compose 文件**。

隔离执行必须：

```bash
TMP="$(mktemp -d /tmp/libevra-rc-restore.XXXXXX)"
cp -a deploy/. "$TMP/"          # 候选脚本 + 测试 compose 文件
cd "$TMP"
export COMPOSE_PROJECT_NAME="libevra-rc-restore-20261019"
export POSTGRES_DB="libevra_rc_restore"   # 测试库，不是 libevra_prod
# 测试用 .env 只包含临时 POSTGRES_USER/PASSWORD/DB；不得复制生产 .env
docker compose ls | grep "$COMPOSE_PROJECT_NAME"
docker compose -p "$COMPOSE_PROJECT_NAME" ps
# 执行前再次打印并人工确认 POSTGRES_DB 是隔离测试库
./restore.sh <test-backup.dump> --yes
```

**禁止**在 `/srv/libevra/deploy`、生产项目名 `deploy` 或生产 `.env` 下执行本测试；`restore.sh` 的 `dropdb` 是不可逆动作，不能靠脚本外的“以为选对了”。

### 2.3 必测场景

| 场景 | 通过条件 |
|---|---|
| A. S13 1.13.15 旧格式备份 | 恢复成功；45 migrations；users/books/members/transactions 计数与备份一致 |
| B. S14 带活动锁旧格式备份 | 过滤 `TABLE DATA public ledger_write_locks`；恢复成功；51 migrations；业务数据完整；锁表 0 行 |
| C. 恢复后锁协调 | 启动新版 API；活动任务/缺失锁/孤儿锁按 `reconcileLedgerLocks` 安全处理；不自动确认任务；不强解无法安全恢复的锁 |
| D. 失败退出 | 不存在文件/损坏 dump/错误参数：非零退出；不得先 drop 生产目标库；错误信息明确；恢复失败后使用 `pre-restore-*.dump` 安全副本人工处置，脚本不会自动覆盖回退 |
| E. S13-I 兼容 | critical_events/critical_chain/checkpoint 表行数与摘要可恢复；不重置/重写链；restore 不绕过 critical 保护 |

### 2.4 当前状态

**未执行**：本机无 Docker/WSL，无法建立隔离 Compose。此前已在本地 PostgreSQL 上完成等价 `pg_restore -L` 演练和 45→51 恢复演练，但这**不能替代**本轮 Docker 环境验证。

---

## 3. 生产发布 Runbook（1.13.15 → 1.14.18）

### 3.0 总原则

- **旧 1.13.15 不可未经兼容验证直接连接 51 migration 数据库。**
- **不得用 down migration、`migrate reset`、`down -v` 或旧备份自动覆盖生产库作为自动回滚策略。**
- 发布前必须有新鲜、已验证可恢复的 S12-C 备份；失败时先停止写入、保留数据，人工决策。
- Critical Chain 只可追加，不可重置；不修改生产 COS/CAM/密钥/Relay 配置。
- 发布过程中 API 未启动前不允许 Web 新版本对外服务。

### 3.1 T-1：发布前检查

```bash
cd /srv/libevra/deploy
DC="sudo docker compose -f docker-compose.prod.yml --env-file .env"

$DC ps
cat /srv/libevra/.deployed-commit
curl -fsS https://libevra.com/api/v1/health
./critical-events-health.sh || true   # 只读；异常必须先判断，不可重置链
```

记录：

- 当前生产版本/commit（应 `1.13.15` / `cc14725`）；
- `_prisma_migrations` 应为 45；
- users、books、book_members、transactions、categories、payment_methods、tags、
  notifications、critical_events、critical_chain、critical_backup_checkpoints 等**当前**数量；
- 备份磁盘空间、数据库大小、磁盘余量；
- 最近一次成功备份时间、S12-C `last-local.json`/`last-run.json`；
- **不要查询 `ledger_write_locks`、`ledger_import_jobs`、`ledger_imports`、`ledger_import_source_states`、`ledger_import_undo_batches`、`ledger_import_job_events`：1.13.15/45 库尚不存在这些 S14 表。** 这些表只能在 45→51 迁移成功后检查（§3.8）。发布前的锁/任务检查以“45 库没有 S14 表”为事实，不要用不存在的表做门禁。

> 不要用旧演练的 4 用户/5 账本/164 交易当作发布时数字。

### 3.2 冻结新业务写入与处理 PWA 队列

1. 提前公告维护窗口；要求两台设备打开 Libevra，确认离线队列已清空（页面上没有待同步/待重试记录）。
2. 停止新入口：先停 Web，再停 API，优雅等待在途请求：

```bash
$DC stop -t 30 web
$DC stop -t 30 api
```

3. 确认没有新的业务写入；若 S13 relay 正在上传，先看 `critical-events-health.sh`/relay backlog，等本地事件持久化后停止 relay（按实际 compose）。
4. 45 库没有 S14 锁/任务表，**不做**这些表的发布前查询。1.13.15 不存在 phase-4 任务；迁移成功后才检查 S14 表（§3.8）。旧版 1.13.15 导入任务使用旧表/旧路径，发布前按旧流程确认没有未完成导入。

> PWA 队列存在浏览器本地。维护窗口内用户打开旧缓存页面仍可能写入本地队列；停 Web/API 后服务端不会接收；新 API 上线后客户端恢复网络再同步。发布前要明确告知用户维护期间不要记账。

### 3.3 发布前最新备份（必须重新做）

在 API/Web 停止、DB 只读/空闲状态下：

```bash
cd /srv/libevra/deploy
./backup-all.sh
```

必须确认：

- 本地 dump 生成且 `localOk=true`；
- 隔离恢复演练 `restoreOk=true`；
- AES-256 加密、COS 上传成功、远端大小/元数据校验成功；
- 记录 `backups/last-local.json`、`last-run.json` 的时间、对象标识、SHA-256；
- 使用 `verify-dump.sh` 或独立隔离库再次检查行数（脚本默认已做）。

发布前备份必须**早于** 45→51 migration，并保存在可用位置。**不得清理/覆盖正式备份。**

### 3.4 S13-I Critical Chain / Relay / Checkpoint

发布前只读检查：

```bash
./critical-events-health.sh
$DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select last_seq,last_hash,updated_at from critical_chain where id='global';"
$DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select count(*) from critical_events; select count(*) from critical_backup_checkpoints;"
```

如果 `last_seq > 0`：

- 用恢复只读身份验证对应最新事件/manifest 的完整性（`critical-events-fetch.sh`/`critical-events-verify --dir`，不写 COS，不修改数据库）；
- 对比 `critical_chain.last_hash` 与远端最新 manifest 的 `lastHash`；
- 记录 chain seq/hash、relay backlog/status、checkpoint 数量；
- **不重置链、不初始化新链、不手工改 seq/hash**；
- 如需发布前 checkpoint，由所有者按 S13-I 操作手册执行；API 停止后再创建，确保 checkpoint 是数据库快照。

迁移只新增 S14 表/列/触发器，不修改 critical 表；迁移后必须确认 chain 行 seq/hash 不变。

### 3.5 更新源码、镜像与 Compose

1. 把 commit `5dc2d54` 的源码发布包（`git archive`，SHA-256 已记录）放到服务器 `/srv/libevra`，不要覆盖 `.env`、备份、关键事件密钥；
2. 保留当前 deploy 配置副本/记录当前镜像 ID，便于回退；
3. 构建候选镜像并记录实际 **Image ID/归档 SHA/平台**（见 §1）；服务器构建必须使用同一 commit；
4. **Compose 组合必须按实际生产项目核对**：
   - 基础文件：`docker-compose.prod.yml`
   - 生产当前还有 relay overlay：`critical-events-relay.compose.yml`
   - 生产项目 `deploy` 的配置是 **两个文件组合**；`deploy.sh`、`backup.sh`、`restore.sh` 内部只引用基础文件，不能假设 relay 已被自动重建/停止/启动；
   - 构建/启动/停止/健康检查涉及 relay 时必须显式加 `-f critical-events-relay.compose.yml`；只用基础文件执行 `up --remove-orphans` 有移除 relay 的风险；
   - `docker-compose.s13i-test.yml` 是 S13 测试项目，不是生产组合；
   - `deploy/.env` 自动读取；relay 额外读取 `.critical-events-key.env`/`.critical-events-relay.env`；恢复只读身份不放在服务器；
   - 任何命令前先打印 `docker compose ls` 项目名和 `docker compose ... config --services`（不打印 secret），确认目标是 `deploy` 项目。
4. 确认 `deploy/.env` 变更：
   - 1.14.18 没有新增必需密钥；
   - 新增 `REGISTRATION_MODE` 是可选变量，默认 `invite`；发布时建议显式写 `REGISTRATION_MODE=invite`，**不要意外开放注册**；
   - 不修改 COS/CAM、critical event key、relay 配置；
5. Compose 配置改动需先 `docker compose config` 校验；不得改变数据库卷。

### 3.6 受控执行 45→51 migration

API 仍停止；只启动数据库（若未运行）：

```bash
$DC up -d db
# 等待 healthy
$DC run --rm migrate
```

要求：

- 迁移服务退出码 0；
- 记录完整输出；
- 验证 `_prisma_migrations=51`；
- 验证 6 张 S14 表、`transactions.source_namespace`、唯一索引、59 个触发器；
- 迁移后再检查新表，绝不能在 45 库提前查：
  ```bash
  $DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "select count(*) from ledger_write_locks where released_at is null;"
  $DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "select id,status from ledger_import_jobs where status not in ('confirmed','undone','completed','cancelled','expired') limit 20;"
  ```
- 不得用 `migrate dev`/`migrate reset`；
- 迁移失败：停止，不启动 API，不执行 down/旧库覆盖；保留现场，按 §3.10 处理。

### 3.7 启动顺序

推荐顺序：

1. API（新镜像）：
   ```bash
   $DC up -d api
   # 轮询 /api/v1/health 直到 database=up 且 version=1.14.18
   ```
2. S13 relay（若生产启用）：
   - 确认 API 事件已可写；
   - 用 **基础 + relay overlay** 构建/启动，确保 relay 使用同一候选 API 镜像；
   - 检查 relay health/backlog，不修改 COS 前缀/身份；
   - 若基础 compose 的 `up --remove-orphans` 已移除 relay，用 overlay 重新启动，不能让它缺失。
3. Web（新镜像/Caddy）：
   ```bash
   $DC up -d web
   # /healthz 200
   ```
4. 确认旧 Web/API 容器已被新镜像替换；确认 API 先于 Web 可用。

### 3.8 发布后验证与开放条件

必须全部通过才开放：

```bash
$DC ps
$DC exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>r.json()).then(j=>{console.log(j);process.exit(j.ok&&j.database==='up'?0:1)})"
$DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select count(*) from _prisma_migrations where finished_at is not null;"
./critical-events-health.sh
```

再检查：

- 生产版本显示 1.14.18；
- users/books/members/transactions 等发布前后计数差异仅来自预定的测试/业务操作，迁移本身不改历史数据；
- critical_chain `last_hash` 在迁移前后不变（之后新业务事件可以正常追加）；
- 新 Web 可登录、记一笔、编辑、删除/恢复测试数据；
- PWA 两台设备可同步，离线队列清零；
- CSV/XLSX 导入：锁定期返回 409、失败无标签/交易残留；UI 不承诺撤销；
- phase-4 导入（测试账本）：锁定、确认、撤销、超时自动撤销至少各执行一次；
- 旧 PWA/旧接口：直接调用旧 `/api/v1/ledger-imports` 返回 409，不产生写入；
- other ledgers unaffected by locks.

### 3.9 开放后 24 小时观察

- `/health` 与 Web `/healthz` 每 5 分钟；
- API 5xx、数据库连接、磁盘/卷空间；
- `ledger_write_locks` active 数、非终态 import jobs；
- `ledger_locked` 409 是否异常增多；
- Critical relay backlog/status、chain gap、checkpoint；
- S12-C 定时备份是否成功、`last-local/last-run` 状态；
- PWA 同步失败/冲突/离线队列；
- 任何 critical/lifecycle 异常立即停止写入并升级处理，不自动重置链。

### 3.10 故障处置与回滚限制

**第一原则：停止写入、保留数据、保留日志、人工决策。**

- 不执行 down migration、不执行 `migrate reset`、不执行 `docker compose down -v`；
- 不自动用旧备份覆盖生产库；
- 不把旧 1.13.15 API 直接接到 51 migration 数据库；旧版兼容未经本轮验证，属于禁止动作；
- 迁移前失败：保留 45 库，修复后重试 `migrate deploy`；
- 迁移后 API 失败：
  - 保持 API 停止/不开放 Web；
  - 记录 migration 状态和错误；
  - 如果需要回退，只能在所有者确认数据丢失窗口后，用发布前最新备份做**整库恢复**；恢复前先保存当前库安全副本，按 `restore.sh` 和 S13-I 流程执行；**恢复前停止 API、relay、web 等所有数据库写入方**（restore.sh 只负责停 API，不能假设 relay 已停）；恢复后必须重放墓碑、验证 critical chain；
  - 应用代码问题优先 forward-fix，不以旧 schema 回滚。
- Critical Chain 不一致：立即停止，保留本地链/DB/COS 对象，不做 reset/重建；按 S13-I 灾难恢复手册处理。
- 锁泄漏：不强制解锁；保留 `undo_failed`/锁，使用恢复/人工流程。

### 3.11 关键兼容与回滚矩阵

| 项目 | 结论 |
|---|---|
| 1.13.15 API → 51 数据库 | **未验证，禁止直接连接**；新增表/列/触发器 + 旧代码无 phase4 认识 |
| 1.14.18 API → 51 数据库 | 本候选设计目标；隔离/本地验证通过 |
| 应用回滚到旧镜像、数据库保持 51 | 不作为自动方案；需单独兼容验证 |
| down migration / 旧备份自动覆盖 | 禁止 |
| 整库恢复 | 仅所有者确认后，从发布前最新备份人工执行；先保留当前现场 |
| Critical Chain | 只追加，不 reset；发布前后核对 seq/hash/manifest |
| 旧 PWA 直接导入 | 409 安全拒绝；历史回执只读 replay；正常记账兼容 |

### 3.12 发布门禁清单

- [ ] 候选源码工作区干净、commit 固定；
- [ ] 实际 Docker 镜像已构建并记录 Image ID、平台、归档 SHA-256（有 registry 时再记 RepoDigest）；
- [ ] 隔离 Docker `restore.sh` 四个场景通过（含失败退出）；
- [ ] 最新生产备份 + COS 上传 + 独立恢复验证通过；
- [ ] 当日生产数据/S13-I 数量与链状态已记录；
- [ ] 发布窗口、回滚备份、负责人明确；
- [ ] 旧版本兼容限制已确认，不执行自动降级；
- [ ] Go 由所有者明确批准。

---

## 3.13 10 分钟自动撤销失败：告警、重试与人工恢复

当前实现（需在发布前确认生产监控仍有效）：

- worker 每 5 秒清扫 `awaiting_confirmation`/`paused`，超过 deadline 自动 `undoing`；
- `undoing`/`undo_failed` 在 30 秒后会自动重试，但 `undoAttempts` 达到 3 后**停止自动重试**；
- `undo_failed` **保留业务锁**，直到人工修复后重试；不会自动确认、不会强删锁；
- 当前没有面向 `undo_failed` 的独立外部告警通道；必须在发布 Runbook 的 24 小时监控中主动查询，或由所有者接受人工巡检。

发布期间/上线后必须监控：

```bash
$DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select id,user_id,target_book_id,status,undo_attempts,last_error_code,updated_at from ledger_import_jobs where status in ('undoing','undo_failed') and updated_at < now()-interval '2 minutes';"
$DC exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select book_id,owner_id,created_at from ledger_write_locks where released_at is null and created_at < now()-interval '15 minutes';"
```

人工恢复步骤：

1. 先停止对该账本的进一步用户操作/导入，保留锁和现场；
2. 查 `last_error_code`/`last_error_message`、job events、undo batches；
3. 修复可解释原因（来源/目标引用、数据库约束、代码 bug）；**不手工删锁、不直接改账目**；
4. 再次调用撤销接口（允许 `undo_failed` 重试）；
5. 若连续失败/原因不明，保留数据库和相关日志，升级到代码修复；在隔离副本复核后再动生产。

如果连续活动锁超过 10 分钟并影响正常记账，应视为发布后事故信号，执行停止写入/保留现场流程，而不是强制解锁。

---

## 4. 风险核对（针对发布候选）

1. **触发器与后台任务**：新触发器只对受影响账本的业务表在 active lock 时拒绝写；检查/释放逻辑由锁行和 API worker 负责。S13 critical/relay/checkpoint 表不在业务锁触发器范围；S12-C 备份/恢复通过过滤锁表数据和启动协调器处理。**S13-I checkpoint 备份如果包含活动锁行，恢复时也必须采用同类过滤；建议 checkpoint 前确认 active lock=0**。生产启用前需在隔离 Docker 中验证 backup/restore/relay/checkpoint 兼容。
2. **10 分钟超时与业务锁**：锁定只影响导入目标/来源两本账，其他账本正常；worker 每 5 秒清扫，超时自动撤销；`undo_failed` 可能保留锁到重试/人工处理，是已知风险；当前无独立外部告警，发布后必须监控/巡检（§3.13）。正常用户可显式确认/撤销。
3. **旧 PWA / API 顺序**：先停旧 Web/API，迁移后先启动新 API，再启动新 Web；旧 PWA 缓存请求只能安全拒绝旧导入，不应绕过锁；离线队列在新 API 恢复后同步。不要在迁移前让旧 API 连 51。
4. **Critical Chain seq>0**：发布前记录 `last_seq/last_hash` 和 checkpoint；用只读恢复身份核对远端 manifest；不 reset/重建/改链；迁移不改 critical 表；发布后验证迁移前后 hash 不变，新事件只追加。
5. **非破坏性故障处置**：禁止 down migration、旧库覆盖自动回滚；采用冻结写入、保留现场、发布前备份和整库人工恢复（所有者批准）或 forward-fix。
6. **配置/权限遗漏**：1.14.18 无新增必需密钥；`REGISTRATION_MODE` 可选且默认 invite，发布时显式维持 invite；数据库用户/卷/COS/CAM/relay 配置不变；备份/恢复脚本更新已包含锁过滤和启动协调器；Compose 服务结构未改变。

---

## 5. 当前结论

- **源码候选：Go**（工作区干净，commit/tag/版本固定，测试/构建/文档/DB 检查通过，源码实际 health smoke 通过）。
- **镜像候选：No-Go**（本机无 Docker；未生成真实 Image ID、镜像归档或 digest，不得伪造）。
- **隔离 Docker restore：No-Go**（无法启动隔离 Compose；此前本地等价恢复已通过但不能替代）。
- **生产发布：No-Go**，直到上述两项在经批准的 Docker 环境补做、记录实际 Image ID/归档 SHA、完成发布前最新备份与所有者审批。

### 等待所有者决定的环境方案

1. **优先**：提供独立临时 Docker 主机/CI Runner（不占用生产服务器）。
2. **次选**：授权在现有腾讯云生产服务器上按 §0.4 方案执行低峰期隔离构建/测试：预计磁盘 4–6GB、内存峰值 2–4GiB、2 vCPU 共享，30–60 分钟；仅临时 project/network/volumes，不碰生产项目；有生产延迟/资源风险。
3. 新建临时云实例（需另行批准费用）。

本轮未 push、未部署、未生产 migration、未修改生产服务/COS/CAM/密钥。
