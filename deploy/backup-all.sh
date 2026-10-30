#!/usr/bin/env bash
#
# Libevra — **一次完整的备份**：
#   本地备份与隔离恢复演练 → 加密 → 上传 COS → 远端元数据校验 → 写 backup_logs → 心跳 → 失败告警
#
# ⚠️ **五个结果分开记，绝不合并成一个"备份成功"。**
#
#   localOk     本地导出成功（文件存在、大小合理、归档可解析）
#   restoreOk   隔离恢复演练通过（逐表行数一致）
#   encryptOk   AES-256 加密成功
#   uploadOk    上传 COS 成功
#   remoteMetaOk 远端确认：对象存在且**大小与本地加密文件一致**（HeadObject，不读内容）
#   heartbeatOk 外部 Dead Man's Switch 收到成功信号
#   notifyOk    失败告警是否被服务商接受
#
# ⚠️ **`backup_logs` 只由 `backup-all.sh` 写**（经由 `backup-log.sh`）：
#   全流程成功写 `ok=true`，`fail_stage` 写 `ok=false` + 阶段，意外退出在 cleanup 里补一条。
#   **写库是 best-effort：数据库不可用/表不存在时不改变备份的退出码。**
#   `backup.sh` 单独跑只做本地备份，**不写成功**——那只是第一步。
#   ⚠️ 备份成功与心跳送达是两件事：心跳失败不会让 `ok` 变 false，`ok=true` 也不代表监控收到了信号。
#
# ⚠️ **"异地内容验证"不在这里。** 上传身份**没有读取权限**（这是有意的），
# 所以日常只能校验元数据。**内容级验证（下载→解密→隔离恢复）每月一次**，
# 用恢复身份在你自己的机器上跑：`monthly-offsite-drill.sh`。
#
# 用法：
#   ./backup-all.sh                      # 完整流程（定时任务跑这个）
#   ./backup-all.sh --skip-offsite       # 维护：只做本地，partial/退出 2，不发 Daily 心跳
#   ./backup-all.sh --no-restore-drill   # 维护：跳过恢复验证，partial/退出 2，不发 Daily 心跳
#   ./backup-all.sh --skip-heartbeat     # 不发送心跳（本地调试用）
#   ./backup-all.sh --skip-notify        # 不发告警（本地调试用）
#
# ⚠️ 秘密文件（全部 600、全部在 .gitignore 里）：
#   .backup.key        加密口令（**已存在，不得轮换/覆盖**）
#   .backup.env        上传身份：COS_UPLOAD_ID / COS_UPLOAD_KEY / COS_BUCKET / COS_REGION / COS_ENDPOINT
#   .backup-mail.env   邮件告警：MAIL_API_KEY / MAIL_TO / MAIL_FROM
#   .backup-heartbeat.env  外部心跳：HEARTBEAT_URL
#   ⚠️ **恢复身份不在这里**：`COS_RESTORE_*` 只在你自己的机器上，服务器不常驻。

set +x
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKUP_DIR="$SCRIPT_DIR/backups"

STATUS_FILE="$BACKUP_DIR/last-run.json"
LOCAL_STATUS="$BACKUP_DIR/last-local.json"
LOCK_FILE="$SCRIPT_DIR/.backup.lock"

SKIP_OFFSITE=0
SKIP_HEARTBEAT=0
SKIP_NOTIFY=0
SKIP_RESTORE=0
PASSTHROUGH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-offsite) SKIP_OFFSITE=1 ;;
    --skip-heartbeat) SKIP_HEARTBEAT=1 ;;
    --skip-notify) SKIP_NOTIFY=1 ;;
    --keep) PASSTHROUGH+=(--keep "${2:?--keep needs a number}"); shift ;;
    --no-restore-drill) SKIP_RESTORE=1; PASSTHROUGH+=(--no-restore-drill) ;;
    *) echo "未知备份参数" >&2; exit 2 ;;
  esac
  shift
done

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINAL_ERROR=""
RESULT=failed
DATA_COMPLETE=false
EXIT_CODE=0
FAILURE_HANDLED=0
HEARTBEAT_ATTEMPTED=false
HEARTBEAT_DELIVERY=not_attempted
RUNTIME_DIR=""
STATUS_TMP=""
LOCK_HELD=0
STAGE=preflight
BACKUP_RUN_ID=""

LOCAL_OK=false
RESTORE_OK=false
ENCRYPT_OK=false
UPLOAD_OK=false
REMOTE_META_OK=false
HEARTBEAT_OK=false
HEARTBEAT_CONFIGURED=false
NOTIFY_OK=false
NOTIFY_CONFIGURED=false

OFFSITE_CONFIGURED=false
OFFSITE_ERROR=""
OFFSITE_REF=""
REMOTE_SIZE=""
LOCAL_ENC_SIZE=""
# EXIT 是唯一失败通知入口；不记录原始命令或第三方 stderr，防止凭据泄漏。
cleanup() {
  local code=$?
  trap - EXIT HUP INT TERM
  set +e
  EXIT_CODE=$code
  if [ "$code" -ne 0 ] && [ "$RESULT" != partial ] && [ "$DATA_COMPLETE" != true ]; then
    RESULT=failed
    [ -n "$FINAL_ERROR" ] || FINAL_ERROR="backup stage $STAGE failed (exit $code)"
    if [ "$FAILURE_HANDLED" -eq 0 ]; then
      FAILURE_HANDLED=1
      log_backup_result --fail --stage "$STAGE" --note "$FINAL_ERROR" --started-at "$STARTED_AT" --file-ref "${DUMP:-}"
      ping_heartbeat fail "$FINAL_ERROR"
      notify_failure "$STAGE" "$FINAL_ERROR"
    fi
  fi
  # 只清理由本次 mktemp 创建的目录，不碰旧文件或其它运行的配置。
  if [ -n "$RUNTIME_DIR" ]; then
    if ! rm -f -- "$RUNTIME_DIR/rclone.conf"; then echo "backup: sensitive temporary cleanup failed" >&2; fi
    if ! rmdir -- "$RUNTIME_DIR"; then echo "backup: runtime directory cleanup failed" >&2; fi
  fi
  # 锁冲突自行撤销 trap；锁获取失败不覆盖正在运行任务的状态。
  if [ "$LOCK_HELD" -eq 1 ]; then
    write_final_status || echo "backup: final status persistence failed" >&2
  fi
  [ -z "$STATUS_TMP" ] || rm -f -- "$STATUS_TMP"
  echo "backup: result=$RESULT exitCode=$code heartbeat=$HEARTBEAT_DELIVERY"
  exit "$code"
}
trap cleanup EXIT
trap 'STAGE=signal-HUP; exit 129' HUP
trap 'STAGE=signal-INT; exit 130' INT
trap 'STAGE=signal-TERM; exit 143' TERM

write_final_status() {
  local finished_at local_json="{}"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)" || return $?
  if [ -n "$BACKUP_RUN_ID" ] && [ -f "$LOCAL_STATUS" ] && grep -Fq "\"runId\": \"$BACKUP_RUN_ID\"" "$LOCAL_STATUS"; then
    local_json="$(cat "$LOCAL_STATUS")" || return $?
  fi

  STATUS_TMP="$(mktemp "$BACKUP_DIR/.last-run.XXXXXX")" || return $?
  cat > "$STATUS_TMP" <<JSON
{
  "kind": "full",
  "schemaVersion": 2,
  "startedAt": "$STARTED_AT",
  "finishedAt": "$finished_at",
  "result": "$RESULT",
  "exitCode": $EXIT_CODE,
  "dataComplete": $DATA_COMPLETE,
  "local": $local_json,
  "encryptOk": $ENCRYPT_OK,
  "offsite": {
    "configured": $OFFSITE_CONFIGURED,
    "uploadOk": $UPLOAD_OK,
    "remoteMetaOk": $REMOTE_META_OK,
    "ref": "$OFFSITE_REF",
    "localEncryptedSize": ${LOCAL_ENC_SIZE:-0},
    "remoteSize": ${REMOTE_SIZE:-0},
    "contentVerified": false,
    "contentVerifiedNote": "内容级验证由 monthly-offsite-drill.sh 用恢复身份执行",
    "monthlyMonth": "${MONTHLY_MONTH:-}",
    "monthlyRef": "${MONTHLY_REF:-}"
  },
  "heartbeat": {
    "configured": $HEARTBEAT_CONFIGURED,
    "ok": $HEARTBEAT_OK,
    "attempted": $HEARTBEAT_ATTEMPTED,
    "delivery": "$HEARTBEAT_DELIVERY"
  },
  "notify": {
    "configured": $NOTIFY_CONFIGURED,
    "ok": $NOTIFY_OK
  },
  "error": $(if [ -n "$FINAL_ERROR" ]; then printf '"%s"' "$(printf '%s' "$FINAL_ERROR" | tr -d '"' | tr '\n' ' ')"; else printf 'null'; fi)
}
JSON
  local code=$?
  if [ "$code" -ne 0 ]; then rm -f -- "$STATUS_TMP"; STATUS_TMP=""; return "$code"; fi
  if mv -f -- "$STATUS_TMP" "$STATUS_FILE"; then :; else
    code=$?
    rm -f -- "$STATUS_TMP"
    STATUS_TMP=""
    return "$code"
  fi
  STATUS_TMP=""
}

last_success_at() {
  if [ -f "$STATUS_FILE" ]; then
    # 不把上次失败的 finishedAt 宣称为最近成功；旧 schema 不猜测。
    if grep -q '"dataComplete": true' "$STATUS_FILE"; then
      grep -o '"finishedAt": *"[^"]*"' "$STATUS_FILE" | head -1 | sed 's/.*"finishedAt": *"//; s/"$//'
    fi
  fi
}

# ⚠️ 告警与心跳**都不能影响退出码本身**：备份失败就是失败，通知是尽力而为。
notify_failure() {
  local stage="$1" message="$2"
  if [ "$SKIP_NOTIFY" -eq 1 ]; then return 0; fi
  local prev
  prev="$(last_success_at)"
  if bash "$SCRIPT_DIR/alert-mail.sh" --stage "$stage" --error "$message" --last-success "${prev:-未知}" >/dev/null 2>&1; then
    NOTIFY_OK=true
  else
    echo "backup: failure mail delivery failed" >&2
  fi
}

ping_heartbeat() {
  local mode="$1" reason="${2:-}"
  if [ "$SKIP_HEARTBEAT" -eq 1 ]; then HEARTBEAT_DELIVERY=skipped; return 0; fi
  [ "$HEARTBEAT_ATTEMPTED" = false ] || return 0
  HEARTBEAT_ATTEMPTED=true
  if [ "$mode" = "ok" ]; then
    if bash "$SCRIPT_DIR/heartbeat.sh" --ok; then HEARTBEAT_OK=true; HEARTBEAT_DELIVERY=sent; else HEARTBEAT_DELIVERY=failed; fi
  else
    if bash "$SCRIPT_DIR/heartbeat.sh" --fail "$reason"; then HEARTBEAT_OK=true; HEARTBEAT_DELIVERY=sent; else HEARTBEAT_DELIVERY=failed; fi
  fi
}

# ⚠️ **写 backup_logs 是 best-effort**：
#   `backup-log.sh` 永远退出 0，数据库不可用/表不存在时只打一行警告；
#   这里再用 `|| true` 兜一层，**任何情况下都不让它改变备份的退出码**。
#   ⚠️ 只记"备份链路的结论"，不记心跳是否送达（两件事，见文首）。
log_backup_result() {
  bash "$SCRIPT_DIR/backup-log.sh" "$@" >/dev/null 2>&1 || true
}

# 显式失败只设置阶段与原始退出码；统一由 EXIT 记录与通知。
fail_stage() {
  local stage="$1" message="$2" code="${3:-1}"
  STAGE="$stage"
  FINAL_ERROR="$message"
  echo "❌ [$stage] $message" >&2
  exit "$code"
}

# 函数与 trap 在此之前都已就绪；配置加载错误、mkdir/锁权限失败也走统一出口。
for config in .backup-heartbeat.env .backup-mail.env .backup.env; do
  if [ -f "$config" ]; then
    set -a
    . "./$config" >/dev/null 2>&1
    set +a
  fi
done
[ -n "${HEARTBEAT_URL:-}" ] && HEARTBEAT_CONFIGURED=true
if [ -n "${MAIL_API_KEY:-}" ] && [ -n "${MAIL_TO:-}" ] && [ -n "${MAIL_FROM:-}" ]; then NOTIFY_CONFIGURED=true; fi
mkdir -p "$BACKUP_DIR"
[ ! -L "$LOCK_FILE" ] || fail_stage preflight "unsafe lock symlink" 73
exec 9> "$LOCK_FILE"
set +e
flock -n 9
LOCK_EXIT=$?
set -e
if [ "$LOCK_EXIT" -eq 1 ]; then
  trap - EXIT HUP INT TERM
  echo 'backup: result=skipped exitCode=75 reason=lock-busy (no notification)'
  exit 75
elif [ "$LOCK_EXIT" -ne 0 ]; then
  fail_stage lock "lock acquisition failed" "$LOCK_EXIT"
fi
LOCK_HELD=1
bash "$SCRIPT_DIR/backup-preflight.sh"
RUNTIME_DIR="$(mktemp -d "$BACKUP_DIR/.runtime.XXXXXX")"
chmod 700 "$RUNTIME_DIR"
export BACKUP_RUN_ID="${RUNTIME_DIR##*/}"
STAGE=local

echo "=== Libevra 完整备份 $(date '+%Y-%m-%d %H:%M:%S %Z') ==="
echo

# ---------------------------------------------------------------------------
# 1. 本地备份 + 隔离恢复演练
# ---------------------------------------------------------------------------
set +e
bash "$SCRIPT_DIR/backup.sh" "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
LOCAL_EXIT=$?
set -e

if [ -f "$LOCAL_STATUS" ]; then
  LOCAL_OK="$(grep -o '"localOk": *[a-z]*' "$LOCAL_STATUS" | grep -o 'true\|false' || echo false)"
  RESTORE_OK="$(grep -o '"restoreOk": *[a-z]*' "$LOCAL_STATUS" | grep -o 'true\|false' || echo false)"
fi

if [ "$LOCAL_EXIT" -ne 0 ] || [ "$LOCAL_OK" != "true" ]; then
  [ "$LOCAL_EXIT" -ne 0 ] || LOCAL_EXIT=1
  fail_stage "local" "本地备份失败（backup.sh 退出码 $LOCAL_EXIT）" "$LOCAL_EXIT"
fi
if ! grep -Fq "\"runId\": \"$BACKUP_RUN_ID\"" "$LOCAL_STATUS"; then
  fail_stage local "local status does not belong to this execution"
fi
if [ "$RESTORE_OK" != true ] && [ "$SKIP_RESTORE" -eq 0 ]; then
  fail_stage restore "restore validation did not pass"
fi

echo
echo "✅ 本地备份通过（localOk=true，restoreOk=$RESTORE_OK）"

DUMP="$(grep -o '"dump": *"[^"]*"' "$LOCAL_STATUS" | sed 's/.*"dump": *"//; s/"$//')"
if [ -z "$DUMP" ] || [ ! -f "$BACKUP_DIR/$DUMP" ]; then
  fail_stage "local" "找不到刚生成的 dump（$DUMP）"
fi

# ---------------------------------------------------------------------------
# 2. 加密
# ---------------------------------------------------------------------------
if [ "$SKIP_OFFSITE" -eq 1 ]; then
  echo
  echo "→ 已按参数跳过异地（不加密、不上传）"
  # ⚠️ 调试运行不是"完整备份"，不写 backup_logs；否则管理台会把一次本地调试
  #   当成"备份成功（含异地）"。
  RESULT=partial
  FINAL_ERROR="maintenance run: offsite skipped"
  HEARTBEAT_DELIVERY=skipped
  log_backup_result --fail --stage partial --note "$FINAL_ERROR" --started-at "$STARTED_AT" --file-ref "$DUMP"
  echo
  echo "🎉 本地备份成功（异地未参与）。"
  exit 2
fi

if [ -z "${COS_UPLOAD_ID:-}" ] || [ -z "${COS_UPLOAD_KEY:-}" ] || [ -z "${COS_BUCKET:-}" ]; then
  echo
  echo "⚠️ **异地未配置**（deploy/.backup.env 缺 COS_UPLOAD_ID/COS_UPLOAD_KEY/COS_BUCKET）"
  echo "   本地备份有效，但它会随这台服务器一起消失。"
  fail_stage offsite "异地未配置（本地备份与恢复演练通过）"
fi
OFFSITE_CONFIGURED=true

if [ ! -f .backup.key ]; then
  fail_stage "encrypt" "缺少加密口令文件 deploy/.backup.key"
fi

# ⚠️ **对象名唯一**：时间戳 + 6 位随机。
# 时间戳到秒会撞（同一秒重跑），而 CAM 无法表达"禁止覆盖同名对象"——
# 唯一命名 + 版本控制是唯一可靠的两道保险。
RAND="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-6)"
YEAR_MONTH="$(date -u +%Y/%m)"
BASE_NAME="${DUMP%.dump}-${RAND}"
ENCRYPTED="$BACKUP_DIR/${BASE_NAME}.dump.gpg"
REF="daily/${YEAR_MONTH}/${BASE_NAME}.dump.gpg"
OFFSITE_REF="$REF"

echo
echo "→ 加密（AES-256 + MDC 完整性校验，口令来自 .backup.key）…"
STAGE=encrypt
rm -f "$ENCRYPTED"
if gpg --batch --yes --quiet --pinentry-mode loopback \
      --passphrase-file .backup.key \
      --symmetric --cipher-algo AES256 \
      --output "$ENCRYPTED" "$BACKUP_DIR/$DUMP" 2>/dev/null; then :; else
  fail_stage "encrypt" "gpg 加密失败" "$?"
fi

LOCAL_ENC_SIZE="$(stat -c%s "$ENCRYPTED" 2>/dev/null || echo 0)"
if [ "$LOCAL_ENC_SIZE" -lt 1024 ]; then
  fail_stage "encrypt" "加密文件只有 ${LOCAL_ENC_SIZE} 字节，异常"
fi
ENCRYPT_OK=true
echo "✅ 已加密：$(du -h "$ENCRYPTED" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. 上传（上传身份：只有写权限）
# ---------------------------------------------------------------------------
STAGE=upload-config
RCLONE_CONF="$RUNTIME_DIR/rclone.conf"
umask 077
cat > "$RCLONE_CONF" <<RCLONE
[cos]
type = s3
provider = Other
access_key_id = ${COS_UPLOAD_ID}
secret_access_key = ${COS_UPLOAD_KEY}
endpoint = ${COS_ENDPOINT:-cos.ap-hongkong.myqcloud.com}
region = ${COS_REGION:-ap-hongkong}
acl = private
no_check_bucket = true
force_path_style = false
RCLONE
chmod 600 "$RCLONE_CONF"

echo
echo "→ 上传到 COS：${REF}"
STAGE=upload
if rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket --retries 2 \
      "$ENCRYPTED" "cos:${COS_BUCKET}/${REF}" >/dev/null 2>&1; then :; else
  UPLOAD_EXIT=$?
  OFFSITE_ERROR="上传 COS 失败"
  rm -f "$RCLONE_CONF"
  fail_stage "upload" "$OFFSITE_ERROR" "$UPLOAD_EXIT"
fi
UPLOAD_OK=true
echo "✅ 已上传"

# ---------------------------------------------------------------------------
# 4. 远端元数据校验（HeadObject；**不下载内容**，因为上传身份没有读权限）
# ---------------------------------------------------------------------------
echo "→ 远端校验（对象存在 + 大小一致）…"
STAGE=remote-meta
if REMOTE_JSON="$(rclone --config "$RCLONE_CONF" lsjson --stat "cos:${COS_BUCKET}/${REF}" 2>/dev/null)"; then :; else
  META_EXIT=$?
  fail_stage remote-meta "远端元数据读取失败" "$META_EXIT"
fi
REMOTE_SIZE="$(printf '%s' "$REMOTE_JSON" | sed -n 's/.*"Size"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
[ -z "$REMOTE_SIZE" ] && REMOTE_SIZE=0

if [ "${REMOTE_SIZE:-0}" != "$LOCAL_ENC_SIZE" ]; then
  rm -f "$RCLONE_CONF"
  OFFSITE_ERROR="远端大小不一致（本地 ${LOCAL_ENC_SIZE} / 远端 ${REMOTE_SIZE:-0}）"
  fail_stage "remote-meta" "$OFFSITE_ERROR"
fi
REMOTE_META_OK=true
echo "✅ 远端一致（${REMOTE_SIZE} 字节）"

# ---------------------------------------------------------------------------
# 5. **月度长期备份**（每月一份，独立前缀、独立更长保留期）
# ---------------------------------------------------------------------------
# ⚠️ **为什么必须有它**：`daily/` 的实际生命周期是"70 天后删除"（控制台规则），这是**按时间**算的，
# 与"备份是否成功"无关。如果连续 70 天备份都失败，`daily/` 会被全部清空 ——
# 而那 70 天里没有任何新备份可替换它们。**月度长期备份就是"没有新备份时仍然存在的那一份"。**
#
# 规则（简单、可验证）：
#   · **每月 1 日（香港时间）**那次成功备份，额外传一份到 `monthly/YYYY-MM/`；
#     若 1 日那次失败，则在**当月后续第一次成功运行**时补做（仍只留一份/月）；
#   · 名称仍带时间戳+随机，绝不覆盖；
#   · 生命周期：`monthly/` 保留 **365 天**（独立规则，不受 daily/ 影响）；
#   · 失败不会删除它；只有时间会（所以永远有一份一年内的月度长期）。
HKT_MONTH="$(TZ=Asia/Hong_Kong date '+%Y-%m')"
PREV_MONTHLY_MONTH="$(grep -o '"monthlyMonth"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATUS_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
MONTHLY_MONTH="${PREV_MONTHLY_MONTH:-}"
MONTHLY_REF=""

if [ "$PREV_MONTHLY_MONTH" != "$HKT_MONTH" ]; then
  MONTHLY_REF="monthly/${HKT_MONTH}/${BASE_NAME}.dump.gpg"
  echo "→ 本月尚无月度长期备份，额外上传一份：${MONTHLY_REF}"
  if rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket --retries 2 \
        "$ENCRYPTED" "cos:${COS_BUCKET}/${MONTHLY_REF}" >/dev/null 2>&1; then
    BASE_JSON="$(rclone --config "$RCLONE_CONF" lsjson --stat "cos:${COS_BUCKET}/${MONTHLY_REF}" 2>/dev/null || true)"
    BASE_SIZE="$(printf '%s' "$BASE_JSON" | sed -n 's/.*"Size"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)"
    if [ "${BASE_SIZE:-0}" = "$LOCAL_ENC_SIZE" ]; then
      MONTHLY_MONTH="$HKT_MONTH"
      echo "✅ 月度长期备份已上传并校验（${BASE_SIZE} 字节，保留 365 天）"
    else
      # ⚠️ 月度长期备份失败**不让整次备份失败**：daily/ 那份已经成功了。
      # 但必须留下痕迹 —— 否则"以为有月度长期"比"知道没有月度长期"更危险。
      MONTHLY_REF=""
      echo "⚠️ 月度长期备份上传后大小不符，本次记为未完成月度长期备份" >&2
    fi
  else
    MONTHLY_REF=""
    echo "⚠️ 月度长期备份上传失败（daily 那份已成功，不影响本次结论）" >&2
  fi
  rm -f "$RCLONE_CONF"
else
  rm -f "$RCLONE_CONF"
  MONTHLY_REF="$(grep -o '"monthlyRef"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATUS_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  echo "→ 本月已有月度长期备份（${HKT_MONTH}），不重复上传"
fi

# ---------------------------------------------------------------------------
# 6. 写 backup_logs（**只有完整链路成功才写 ok=true**；best-effort，不改退出码）
# ---------------------------------------------------------------------------
# ⚠️ 位置在"心跳"之前：**成功状态描述的是备份数据链路的结论，不是监控是否收到信号。**
#   心跳发送失败时退出码仍然是 0、这里仍然是 true——这正是要分开记录的原因。
if [ "$RESTORE_OK" != true ]; then
  RESULT=partial
  FINAL_ERROR="maintenance run: restore validation skipped"
  HEARTBEAT_DELIVERY=skipped
  log_backup_result --fail --stage partial --note "$FINAL_ERROR" --started-at "$STARTED_AT" --file-ref "$DUMP"
  exit 2
fi
STAGE=record
rm -f -- "$RUNTIME_DIR/rclone.conf"
rmdir -- "$RUNTIME_DIR"
RUNTIME_DIR=""
RESULT=full
DATA_COMPLETE=true
# 正式成功心跳之前，必须原子落盘完整结果。数据库审计仍为 best-effort。
if write_final_status; then :; else
  RECORD_EXIT=$?
  DATA_COMPLETE=false
  RESULT=failed
  fail_stage record "final backup status persistence failed" "$RECORD_EXIT"
fi
log_backup_result --ok --started-at "$STARTED_AT" --file-ref "${DUMP:-}" \
  --note "local+restore+encrypt+upload+remote-meta ok; monthly=${MONTHLY_MONTH:-not-done}"

# ---------------------------------------------------------------------------
# 7. 成功心跳（只有整条流程成功才发）
# ---------------------------------------------------------------------------
echo
STAGE=heartbeat
ping_heartbeat ok

echo
echo "🎉 完整备份成功："
echo "   本地 ✅  恢复演练 $([ "$RESTORE_OK" = true ] && echo ✅ || echo '⚠️跳过')  加密 ✅  上传 ✅  远端校验 ✅"
[ "$HEARTBEAT_CONFIGURED" = true ] && echo "   心跳：$([ "$HEARTBEAT_OK" = true ] && echo ✅ || echo '⚠️ 发送失败')" || echo "   心跳：⚠️ 未配置"
echo "   ⚠️ 异地**内容**验证未做 —— 每月由 monthly-offsite-drill.sh 用恢复身份执行。"
echo "   对象：cos:${COS_BUCKET}/${REF}"
[ -n "$MONTHLY_REF" ] && echo "   月度长期备份：cos:${COS_BUCKET}/${MONTHLY_REF}（保留 365 天）"
exit 0
