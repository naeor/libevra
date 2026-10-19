# S13-I 腾讯云 CAM 隔离测试指南（仅准备，尚未执行）

> **当前授权范围：只准备策略和步骤，不创建 CAM 用户/策略，不上传 COS，不启动测试容器。**
> 真实桶：`libevra-backup-1505362843`（APPID `1505362843`，地域 `ap-hongkong`，以控制台实际为准）。
> 测试前缀：`critical-events-test/v1/`、`critical-backups-test/checkpoints/`。
> 若所有者希望进一步降低风险，优先新建**独立测试桶**，把策略里的桶名替换为测试桶；这样测试身份在生产桶上完全没有资源可触达。

## 0. 必须遵守的边界

- 只使用**新建测试子账号**，不要用根账号、生产 S12-C 上传身份或生产恢复身份。
- 测试身份只授予测试前缀；生产 `daily/`、`monthly/`、`critical-events/v1/`、`critical-backups/` 必须无权限。
- 测试写身份**不得**拥有 Get/List/Delete；测试读身份**不得**拥有 Put/Delete。
- 任何 SecretId/SecretKey/事件密钥只能进入本机 `600` 文件或密码管理器，**不能写 Git、聊天记录、日志、命令行历史**。
- 若 CAM 控制台拒绝 `cos:prefix` 条件或显式 deny，**停止并汇报**；不得为了“先跑通”扩大为整桶权限。

## 1. 创建测试子用户（编程访问）

对每个身份重复：

1. 打开腾讯云控制台 → **访问管理 CAM** → **用户** → **用户列表** → **新建用户**。
2. 选择 **自定义创建**。
3. 用户名称：
   - `s13i-test-write`
   - `s13i-test-read`
4. 访问方式：**只勾选“编程访问”**（不要勾选控制台登录）。
5. 用户组：不加入任何现有组。
6. 创建后立即把 SecretId/SecretKey 保存到本机测试保险箱：
   - 目录 `~/.config/libevra-s13i-test/`，权限 700；
   - 文件 `write.env` / `read.env`，权限 600；
   - **不要**保存到项目目录、不要 shell history。
7. 记录用户 UIN（如 `1000xxxx`）和创建时间，交给演练记录，不要发在公开渠道。

## 2. 创建两个自定义策略

1. CAM → **策略** → **新建自定义策略**。
2. 选择 **按策略语法创建**。
3. 策略名称：
   - `s13i-test-write-policy`
   - `s13i-test-read-policy`
4. 把对应 JSON 全文粘贴进去：
   - [写策略](./s13i-test-write-policy.json)
   - [读策略](./s13i-test-read-policy.json)
5. 保存后在策略列表点“查看策略语法”，确认：
   - `action` 只有预期动作；
   - `resource` 只有测试前缀；
   - 生产前缀出现在 **deny** 中，不出现在 allow 中；
   - 没有 `"resource": ["*"]` 或 `cos:*` allow。
6. 把策略关联到对应用户（用户 → 关联策略 → 选择刚建策略）。

## 3. 策略中的变量/实际桶替换

文件和真实资源都已按生产桶填写：

- APPID：`1505362843`
- 桶：`libevra-backup-1505362843`
- 地域：`ap-hongkong`

如果控制台显示的 APPID/地域不同，先停止，按“桶概览 → 基本信息”的真实值修改两个 JSON 的所有 resource，再重新审查。**不要直接在生产桶根授权。**

若使用独立测试桶：
- 把两个 JSON 中的桶名替换为测试桶；
- 测试前缀仍使用 `critical-events-test/v1/` 和 `critical-backups-test/checkpoints/`；
- 生产桶 deny 语句可以保留（无害），也可以按测试桶调整。

## 4. 关键权限边界与“不能假装最小权限”的说明

### 写身份

- allow：`cos:PutObject`、`cos:HeadObject`，仅两个测试前缀。未预先给 HeadBucket；若 rclone 探测桶存在性时报 403，再评估是否单独添加 `HeadBucket`（不能借此扩大对象权限）。
- 不带 `GetBucket/GetObject/DeleteObject`，所以不能列举、读取、删除，也不能覆盖生产对象。
- **`PutObject` 同名覆盖**：COS 普通 PUT 默认会覆盖同名对象；本系统上传时带 `x-cos-forbid-overwrite`，但**必须实测**服务端确实拒绝第二次同名 PUT。若该头部在测试桶/地域不生效，不能把“对象不可覆盖”视为已实现，需开启版本控制/对象锁或改方案。
- 如果测试文件采用分块上传，还需要 `InitiateMultipartUpload/UploadPart/CompleteMultipartUpload/AbortMultipartUpload/ListParts`；当前事件/小备份 <5GB，计划使用单次 PUT，不预先授予分块权限。

### 读身份

- allow：`cos:GetObject`、`cos:HeadObject`，仅测试对象前缀。
- `cos:GetBucket/HeadBucket` 需要**桶级** resource；已尝试用 `cos:prefix` 条件限制到两个测试前缀。
- **`cos:prefix` 条件必须实测**：
  1. 用读身份列 `critical-events-test/v1/` → 成功；
  2. 列桶根（不带测试 prefix）→ 必须失败；
  3. 列 `daily/`、`monthly/`、`critical-events/v1/` → 必须失败。
- 如果 CAM 不执行 `cos:prefix` 条件、控制台拒绝该策略、或列桶根仍成功，则**不要给读身份 GetBucket**；改为通过已知对象清单取回，并在演练报告中记录“读身份只能按已知 key GET，不能安全 List”。
- `GetBucket` 的桶级 resource 和 prefix 条件语法在不同 CAM 版本可能不同；以控制台校验和上述实测为准，不凭文档假设。

### 两个身份共同

- 显式 deny 将生产 `daily/`、`monthly/`、`critical-events/v1/`、`critical-backups/` 全部动作拒绝（防御性；不能替代 allow 的最小范围）。
- 仍需用真实请求验证：写身份 GET/LIST/DELETE 必须 403；读身份 PUT/DELETE 必须 403；生产前缀任何读写必须 403。
- 若 policy 校验器认为 deny 的 `cos:*` + 对象资源不合法，不要删除测试边界，改为把 deny 拆成明确的动作列表；仍以实测为准。

## 5. 测试密钥生成与保管

### 事件密钥

```bash
# 只输出到本机文件，不打印到终端
mkdir -p ~/.config/libevra-s13i-test
chmod 700 ~/.config/libevra-s13i-test
node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))' \
  > ~/.config/libevra-s13i-test/event-key.base64
chmod 600 ~/.config/libevra-s13i-test/event-key.base64
```

- 作为 `CRITICAL_EVENT_KEY`；测试专用，测试结束即销毁。
- 记录 keyId：`s13i-test-v1`；本轮不做轮换演练（轮换已有单元测试）。
- 不要与生产 `CRITICAL_EVENT_KEY`、GPG `.backup.key` 复用。

### 测试备份 GPG 口令

```bash
openssl rand -base64 32 > ~/.config/libevra-s13i-test/backup-key
chmod 600 ~/.config/libevra-s13i-test/backup-key
```

- 只用于测试备份；不覆盖生产 `deploy/.backup.key`。
- 测试恢复机需要同一口令解密；演练结束销毁测试密文和口令副本。

### 写入测试环境文件（不进 Git）

`deploy/.s13i-test.env`，权限 600；`.gitignore` 已加入 `deploy/.s13i-test.env` 类别：

```
CRITICAL_EVENT_REMOTE=cos
CRITICAL_EVENT_COS_BUCKET=libevra-backup-1505362843
CRITICAL_EVENT_COS_REGION=ap-hongkong
CRITICAL_EVENT_COS_SECRET_ID=<test-write-secret-id>
CRITICAL_EVENT_COS_SECRET_KEY=<test-write-secret-key>
CRITICAL_EVENT_KEY=<from ~/.config/.../event-key.base64>
CRITICAL_EVENT_KEY_ID=s13i-test-v1
CRITICAL_EVENTS_RELAY_POLL_MS=1000
```

测试读身份放在**恢复机**，不放在生产/测试 API 容器：

```
COS_RESTORE_ID=<test-read-secret-id>
COS_RESTORE_KEY=<test-read-secret-key>
COS_BUCKET=libevra-backup-1505362843
COS_REGION=ap-hongkong
```

**不要把这些 Key 贴到终端命令中**（会进 history）；用 `set +x`、临时配置文件 600。

## 6. 控制台/终端验证顺序（只读优先）

1. 用写身份 `rclone` 对一个**不存在的测试 key**执行 PUT（小文件），应成功。
2. 相同 key 第二次 PUT 带 `x-cos-forbid-overwrite: true`，应被拒绝；原对象 hash 不变。
3. 写身份执行 GET/LIST/DELETE 同一测试 key，应全部 403。
4. 读身份 GET/HEAD 测试对象，应成功。
5. 读身份列测试前缀，应成功；列桶根/daily/monthly/生产事件前缀，应 403。
6. 读身份 PUT/DELETE，应 403。
7. 记录每一步的 HTTP 状态、RequestId、时间；失败即停止，不扩大权限。
8. 演练完成后由所有者批准清理测试对象/策略/子用户/密钥。

## 7. 成本与资源影响

- 创建 CAM 用户/策略：**不产生 COS 存储或请求费用**（CAM 本身无额外费用）。
- 测试对象很少（KB–MB 级），存储/请求费用极低，但会出现在当月 COS 账单。
- 若新建测试桶：产生少量存储/请求；删除桶需先删对象。
- **不改变生产桶现有规则/生命周期/版本控制**。
- 测试结束必须记录是否删除测试对象；未批准前不删除任何生产对象。

## 8. 需要管理员单独批准的云端操作

| 操作 | 是否创建资源 | 是否产生费用 | 是否改生产配置 | 是否删除对象 |
|---|---|---|---|---|
| 创建两个测试子用户 | 是 | 否（CAM 本身） | 否 | 否 |
| 创建两个自定义策略并关联 | 是 | 否 | 否 | 否 |
| 用测试身份上传测试前缀对象 | 是（对象） | 极小 | 否 | 否 |
| 验证不可覆盖/权限拒绝 | 否 | 极小请求费 | 否 | 否 |
| 新建独立测试桶（可选） | 是 | 极小 | 否 | 否 |
| 配置测试前缀生命周期（可选） | 是（规则） | 否 | 否（仅测试前缀） | 将来可能 |
| 演练结束删除测试对象/用户/策略/密钥 | 否 | 否 | 否 | **是（仅测试）** |
