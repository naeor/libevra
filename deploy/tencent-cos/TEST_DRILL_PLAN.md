# S13-I 真实 COS + Docker 隔离演练执行计划（待批准，尚未执行）

> 本文是操作计划，不是执行记录。未经所有者逐项批准：
> 不创建 CAM、不上传 COS、不启动生产服务器测试容器、不迁移生产库、不部署、不 push。

## 1. 目标与不变量

验证真实腾讯 COS 与隔离 Docker 栈下的 S13-I；**不改变用户业务路径**，不触碰生产数据库/卷/备份/域名。最高不变量：

1. S12-C 的 `daily/`、`monthly/`、`deploy/backups`、`deploy/.backup.lock`、生产 `db-data` 不得被测试污染或删除。
2. 测试只能使用测试前缀和测试身份；测试读身份不允许读生产前缀。
3. 业务成功不等待 COS ack；relay/COS 故障不影响业务。
4. 恢复数据库与开放公网永远是两件事；演练不开放真实域名。
5. 任何清理/删除测试对象需单独批准。

## 2. 环境选择

### 首选：独立非生产机器
- 一台本地/临时机器，Docker 可达测试 COS；不连接生产数据库/卷；无正式域名。
- 上传测试 dump（只含合成测试数据或从现有测试 fixtures 生成，**不含生产客户数据**）。

### 备选：生产服务器上隔离 compose（风险更高，需额外批准）
只读检查结果：2 vCPU、7.5GiB RAM（当前可用约 6.4GiB）、52GiB 可用磁盘；生产 API 镜像 2.5GB，另有 build cache。资源**理论上够小规模测试**，但共享 CPU/内存/磁盘，必须：

- 工作目录 `/srv/s13i-test`，**不是** `/srv/libevra`；只读复制/构建测试配置，不修改生产文件。
- 使用仓库内准备的 [`docker-compose.s13i-test.yml`](../docker-compose.s13i-test.yml)，compose project 名 `s13i-test`，volume 名 `s13i-test_db-data` 等；**绝不挂载 `deploy_db-data`**。
- 独立 bridge 网络；**不发布 80/443 等端口**，不加入生产 web 网络；Caddy 不参与。
- 资源限制：API 2GiB、DB 1GiB、relay 512MiB；总内存上限约 3.5GiB；CPU 限制 1.5。
- 测试时间避开 S12-C 03:00–05:00（香港时间）和备份验证窗口。
- 如果 `docker stats`/`free` 显示压力或 OOM，立即停止并按回退清理；**不允许影响生产容器**。
- 测试镜像/构建使用独立 tag，构建缓存可能再占数 GB；磁盘低于 20GiB 可用时停止。

准备命令（**只创建测试配置，不启动**）：

```bash
cd deploy
cp .s13i-test.db.env.example .s13i-test.db.env
cp .s13i-test.api.env.example .s13i-test.api.env
cp .s13i-test.relay.env.example .s13i-test.relay.env
chmod 600 .s13i-test.*.env
set -a; . ./.s13i-test.db.env; set +a
# 审查 compose（不启动）：
docker compose -p s13i-test -f docker-compose.s13i-test.yml config
```

启动/停止必须单独得到批准；`down -v` 也在清理审批范围内。

### 不建议
在生产 compose 项目/同一 volume/同一端口上直接 `docker compose run` 测试。隔离不明确，不得执行。

## 3. 前置批准与资源清单

| # | 操作 | 创建资源 | 成本 | 改生产配置 | 删除对象 | 需批准 |
|---|---|---|---|---|---|---|
| 1 | 创建测试写/读 CAM 子用户 | 是 | 否 | 否 | 否 | 是 |
| 2 | 创建两个测试策略并关联 | 是 | 否 | 否 | 否 | 是 |
| 3 | 测试前缀首次写入测试对象 | 对象 | 极小 | 否 | 否 | 是 |
| 4 | 可选：新建独立测试桶 | 桶 | 极小 | 否 | 否 | 是 |
| 5 | 可选：测试前缀生命周期 | 规则 | 否 | 否（仅测试） | 将来 | 是 |
| 6 | 启动测试 Docker 容器 | 容器/卷/网络 | 服务器资源 | 否（隔离） | 否 | 是 |
| 7 | 恢复演练（隔离 DB） | 临时 DB | 无 | 否 | 否 | 是 |
| 8 | 清理测试对象/用户/策略/密钥/容器 | 否 | 否 | 否 | **测试对象** | 是，单独 |

## 4. 演练步骤

### 阶段 A：身份/权限（真实 COS）
1. 按 `CAM_CONSOLE_SETUP.md` 创建测试用户/策略（等批准）。
2. 写身份对测试前缀 PUT 一个小对象；记录 RequestId、HTTP 状态。
3. 同 key 再 PUT（带 `x-cos-forbid-overwrite: true`），必须被拒绝且原字节不变。
4. 写身份 GET、LIST、DELETE 测试对象，必须 403。
5. 读身份 GET/HEAD 测试对象成功。
6. 读身份列测试前缀成功；列桶根、`daily/`、`monthly/`、`critical-events/v1/`、`critical-backups/` 必须 403。
7. 读身份 PUT/DELETE 必须 403。
8. **若 5/6 无法同时满足，记录“List 不能安全按前缀限制”，停止读身份 List 的授权，按已知 key 取回或改桶策略**。

### 阶段 B：事件立即上传（隔离 Docker + 测试 DB）
1. 启动隔离 PostgreSQL（测试库，执行仓库 migrations）；不导入生产数据。
2. 启动隔离 API + relay（测试 `.s13i-test.env`，写身份、测试 COS 前缀）。
3. 创建合成账号/账本，执行永久删除、账号注销、成员移除/角色变更；分别记录 API 响应时间。
4. 查询事件 pending/acked 时间和 relay 日志；验证对象在测试 COS 前缀出现，API 响应不等待。
5. 用读身份 GET 对象、`critical:verify` 验证链/加密对象。
6. 检查 `operationId` 回执：业务 completed 与 protection 分离；receipt header；24h 过期测试（可用短 TTL 单元/隔离配置）。

### 阶段 C：故障与补传
1. 停 relay（不是停业务）→ 执行业务 P0，必须成功；事件 pending。
2. 重启 relay → 积压自动补传；验证链序、无重复对象、无重复业务。
3. 让测试写身份临时失效（不给权限/停网络）→ 模拟 5xx/超时/429（可用代理或替换测试 endpoint），观察 nextAttemptAt 指数退避；恢复身份后自动续传。
4. 观察 health alarm：relay stale、积压、连续失败；单次瞬时失败不应误报（本地已测，生产配置复查）。
5. 检查 S12-C 定时器/备份目录/生产卷完全未变（只读校验 hash、mtime、数量）。

### 阶段 D：检查点备份 + 加密上传
1. 隔离 DB 上运行 `critical-events-backup.sh`（Docker db 容器内 psql/pg_dump），生成 dump+sidecar。
2. 在 pg_dump 运行/慢速期间删除合成账本、注销合成账号、撤销合成成员权限。
3. `critical-events-backup-all.sh` 用测试 GPG 口令加密并上传 `critical-backups-test/checkpoints/`；验证读身份可下载、解密、sidecar SHA/检查点行匹配。
4. 用测试读身份取回；用 `critical-events-fetch-backup.sh` 验证。

### 阶段 E：隔离恢复
1. 把检查点 dump `pg_restore` 到**第二个隔离数据库**（不是生产库，不启动公网）。
2. 在恢复库上运行 `critical:preview`，检查事件组、自动/人工/缺失目标/倒退风险；确认不改库。
3. 运行 `critical:apply-safe`，检查删除/注销/成员权限/会话最终状态；确认未创建虚假账号/账本。
4. 检查 **preview 前后**目标库未被修改；apply 后业务预期与实际一致。
5. 原始直恢复路径：独立恢复同一 dump（不依赖事件/relay/key），验证仍可用；不启动生产 API。

### 阶段 F：告警与清理
1. 触发 protection alarm（停 relay/阈值），验证 `critical-events-health.sh` 调用现有邮件告警（测试收件人）。
2. 记录告警时间、恢复通知、是否影响业务。
3. 由所有者批准后：停/删测试容器、测试卷、测试对象、测试 CAM/策略/密钥；保留演练报告。
4. **不删除任何生产对象、不删除生产备份、不删除生产容器/卷/配置。**

## 5. 验收标准

- 写身份只能 Put/Head 测试前缀；GET/LIST/DELETE 403。
- 读身份只能 Get/List 测试前缀；写/删和生产前缀 403。
- 同 key 第二次 PUT 被拒绝，原对象字节/hash 不变。
- 业务请求在 relay/COS 故障时仍按原语义成功；事件保护状态为 pending/告警，不返回 503。
- relay 恢复后积压按 seq 补传；无重复对象、无重复业务、链验证通过。
- 测试检查点 dump 可从测试 COS 前缀独立取回、解密、sidecar/检查点匹配。
- `critical:preview` 不改库；`critical:apply-safe` 后删除/注销/权限符合预期；无虚假对象。
- 原始直恢复独立可用。
- 演练前后 S12-C 的 `deploy/backups`、`.backup.lock`、生产卷、生产 compose、域名均无变化。
- 全程无生产数据破坏、无生产备份删除、无正式域名变更。

## 6. 执行中止与清理

- 任一步出现生产卷挂载、端口冲突、权限越界、COS 生产前缀对象、内存/磁盘压力、业务不可用迹象：**立即停止**，保留日志。
- 清理必须由所有者批准，只删除带 `s13i-test` 名称的容器/卷/网络/COS 测试对象/CAM 测试身份；**禁止通配符删除**，逐项核对名称和路径。
- 出现异常时按“停 relay → 停测试容器 → 保存日志 → 报告”的顺序，不运行任何生产恢复。

## 7. 预计时间/人员

- 身份/COS 权限：30–60 分钟（控制台 + 验证）。
- 隔离 Docker 环境准备：1–2 小时（构建/内存观察）。
- 事件/故障/备份/恢复演练：2–4 小时。
- 报告与清理：1 小时。
- 需要一名能审批 CAM/对象删除的所有者；Docker 操作与数据库恢复建议两人复核。
