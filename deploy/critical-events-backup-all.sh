#!/usr/bin/env bash
# S13-I automated checkpointed backup + independent offsite copy.
#
# This is intentionally separate from S12-C `backup-all.sh` / `.backup.lock` / daily/monthly paths.
# A failure here must not change the exit status or behavior of the original S12-C backup.
#
# Modes:
#   CRITICAL_BACKUP_OFFSITE=none  local checkpoint only (default; not disaster-safe)
#   CRITICAL_BACKUP_OFFSITE=fs    copy dump+sidecar to a mounted/remote directory (test/drill)
#   CRITICAL_BACKUP_OFFSITE=cos   GPG-encrypt dump + upload dump+sidecar with COS_UPLOAD_* identity
#
# COS destination: critical-backups/checkpoints/<YYYY>/<name>.dump.gpg
#                  critical-backups/checkpoints/<YYYY>/<name>.dump.gpg.checkpoint.json
# The restore identity is NOT used here and must stay off-server.
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "${CRITICAL_BACKUP_ENV_FILE:-}" ]; then
  # shellcheck disable=SC1090
  set -a; . "$CRITICAL_BACKUP_ENV_FILE"; set +a
elif [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
else
  echo "❌ neither CRITICAL_BACKUP_ENV_FILE nor deploy/.env is available" >&2; exit 2
fi

LOCK_FILE=".critical-events-backup.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "⚠️ 已有一个检查点备份在运行；本次退出。"
    exit 0
  fi
else
  # Git Bash/local drill fallback; production hosts have flock. mkdir is atomic too.
  LOCK_DIR="${LOCK_FILE}.d"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "⚠️ 已有一个检查点备份在运行；本次退出。"
    exit 0
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
fi

MODE="${CRITICAL_BACKUP_OFFSITE:-none}"
LABEL="${1:-auto-$(date -u +%Y%m%d-%H%M%S)}"
LOG_PREFIX="[critical-backup $(date -u +%FT%TZ)]"

echo "$LOG_PREFIX 开始检查点备份（offsite=$MODE）"
if ! ./critical-events-backup.sh "$LABEL"; then
  echo "$LOG_PREFIX ❌ 检查点本地备份失败；S12-C 原备份不受影响" >&2
  exit 1
fi

# Pick the newest plain dump; checkpoint script never writes into deploy/backups.
DUMP="$(find "${CRITICAL_BACKUP_DIR:-critical-backups}" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "$LOG_PREFIX ❌ 找不到刚生成的 dump" >&2; exit 1
fi
SIDECAR="$DUMP.checkpoint.json"
if [ ! -f "$SIDECAR" ]; then
  echo "$LOG_PREFIX ❌ 缺少 sidecar，拒绝视为可安全恢复备份" >&2; exit 1
fi

case "$MODE" in
  none)
    echo "$LOG_PREFIX ✅ 本地检查点备份完成（未异地保存；不能用于整机丢失恢复）"
    ;;
  fs)
    : "${CRITICAL_BACKUP_REMOTE_DIR:?fs mode needs CRITICAL_BACKUP_REMOTE_DIR}"
    mkdir -p "$CRITICAL_BACKUP_REMOTE_DIR"
    cp -f "$DUMP" "$SIDECAR" "$CRITICAL_BACKUP_REMOTE_DIR/"
    # Prove the remote copy is independently complete and matches the sidecar.
    cmp -s "$DUMP" "$CRITICAL_BACKUP_REMOTE_DIR/$(basename "$DUMP")"
    cmp -s "$SIDECAR" "$CRITICAL_BACKUP_REMOTE_DIR/$(basename "$SIDECAR")"
    expected="$(sed -n 's/.*"sha256": "\([0-9a-f]*\)".*/\1/p' "$SIDECAR")"
    actual="$(sha256sum "$CRITICAL_BACKUP_REMOTE_DIR/$(basename "$DUMP")" | awk '{print $1}' | tr -d '\\\r')"
    [ "$expected" = "$actual" ]
    echo "$LOG_PREFIX ✅ 检查点备份已复制到异地目录：$CRITICAL_BACKUP_REMOTE_DIR"
    ;;
  cos)
    if [ -f .backup.env ]; then
      # shellcheck disable=SC1091
      set -a; . ./.backup.env; set +a
    fi
    : "${COS_UPLOAD_ID:?}" : "${COS_UPLOAD_KEY:?}" : "${COS_BUCKET:?}"
    : "${COS_REGION:?}"
    if ! command -v rclone >/dev/null 2>&1; then
      echo "$LOG_PREFIX ❌ 当前主机缺少 rclone；检查点备份未上传" >&2; exit 1
    fi
    if ! command -v gpg >/dev/null 2>&1 || [ ! -f .backup.key ]; then
      echo "$LOG_PREFIX ❌ 缺少 gpg 或 .backup.key；检查点备份未上传" >&2; exit 1
    fi
    YEAR="$(date -u +%Y)"
    REF="critical-backups/checkpoints/${YEAR}/$(basename "$DUMP").gpg"
    SIDECAR_REF="${REF}.checkpoint.json"
    ENCRYPTED="${DUMP}.gpg"
    RCLONE_CONF="$(mktemp)"
    trap 'rm -f "$RCLONE_CONF" "$ENCRYPTED"' EXIT
    gpg --batch --yes --quiet --pinentry-mode loopback \
      --passphrase-file .backup.key --cipher-algo AES256 \
      --output "$ENCRYPTED" --symmetric "$DUMP"
    cat > "$RCLONE_CONF" <<RCLONE
[cos]
type = s3
provider = TencentCOS
access_key_id = ${COS_UPLOAD_ID}
secret_access_key = ${COS_UPLOAD_KEY}
endpoint = ${COS_ENDPOINT:-cos.ap-hongkong.myqcloud.com}
region = ${COS_REGION}
acl = private
RCLONE
    chmod 600 "$RCLONE_CONF"
    rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket --retries 3 "$ENCRYPTED" "cos:${COS_BUCKET}/${REF}"
    rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket --retries 3 "$SIDECAR" "cos:${COS_BUCKET}/${SIDECAR_REF}"
    # HEAD-equivalent metadata check: remote size must equal local bytes.
    remote_bytes="$(rclone --config "$RCLONE_CONF" lsjson --stat "cos:${COS_BUCKET}/${REF}" 2>/dev/null | sed -n 's/.*"Size": *\([0-9]*\).*/\1/p' | head -1)"
    local_bytes="$(stat -c '%s' "$ENCRYPTED")"
    [ "$remote_bytes" = "$local_bytes" ]
    echo "$LOG_PREFIX ✅ 检查点 dump+sidecar 已上传并校验大小：cos:${COS_BUCKET}/${REF}"
    ;;
  *)
    echo "$LOG_PREFIX ❌ 未知 CRITICAL_BACKUP_OFFSITE=$MODE（允许 none/fs/cos）" >&2; exit 2
    ;;
esac

echo "$LOG_PREFIX 完成"

# The offsite copy is the durable one. Keep only a short local window so daily plaintext dumps
# cannot silently fill the server disk. This never touches deploy/backups (S12-C).
KEEP_DAYS="${CRITICAL_BACKUP_LOCAL_KEEP_DAYS:-7}"
if [ "$MODE" != "none" ] && [ "$KEEP_DAYS" -gt 0 ]; then
  LOCAL_DIR="$(dirname "$DUMP")"
  find "$LOCAL_DIR" -maxdepth 1 -type f \
    \( -name '*.dump' -o -name '*.dump.checkpoint.json' \) \
    -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
fi
