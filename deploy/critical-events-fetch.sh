#!/usr/bin/env bash
# S13-I read-only fetch of the encrypted critical-event prefix.
#
# ⚠️ This is the disaster-recovery READ side. It uses a restore-only COS identity and never writes
# to the bucket. It deliberately does not use `deploy/backups/`, `.backup.lock` or any `.dump`
# naming, so it cannot participate in the S12-C rotation/lock rules.
#
# Required: deploy/.critical-events-restore.env (mode 600) with
#   CRITICAL_EVENT_COS_RESTORE_ID / _KEY / BUCKET / REGION / ENDPOINT (optional)
# The restore identity must have GetObject/ListBucket on the dedicated prefix only, and no write.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".critical-events-restore.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 缺少 $ENV_FILE（恢复身份，不常驻服务器）" >&2
  exit 2
fi
set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

: "${CRITICAL_EVENT_COS_RESTORE_ID:?missing restore id}"
: "${CRITICAL_EVENT_COS_RESTORE_KEY:?missing restore key}"
: "${CRITICAL_EVENT_COS_BUCKET:?missing bucket}"
: "${CRITICAL_EVENT_COS_REGION:?missing region}"

PREFIX="${CRITICAL_EVENT_PREFIX:-critical-events/v1}"
PREFIX="${PREFIX%/}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DEST="${1:-critical-events-fetched/$STAMP}"
mkdir -p "$DEST"
chmod 700 "$DEST"

TMP_CONF="$(mktemp)"
trap 'rm -f "$TMP_CONF"' EXIT
umask 077
cat > "$TMP_CONF" <<EOF
[cos-restore]
type = s3
provider = Other
access_key_id = ${CRITICAL_EVENT_COS_RESTORE_ID}
secret_access_key = ${CRITICAL_EVENT_COS_RESTORE_KEY}
acl = private
no_check_bucket = true
force_path_style = false
endpoint = ${CRITICAL_EVENT_COS_ENDPOINT:-cos.${CRITICAL_EVENT_COS_REGION}.myqcloud.com}
region = ${CRITICAL_EVENT_COS_REGION}
EOF

# Download only the two real data subtrees. `--fast-list` makes rclone issue one ListObjects
# request per subtree instead of probing every discovered child prefix. This is required when the
# Reader policy allows listing only critical-events/v1/, /events/ and /manifests/.
#
# Trade-off: --fast-list keeps all object metadata for one subtree in memory. Event objects are
# tiny and the current event rate is low; at very large histories (hundreds of thousands of
# objects) this memory could become material and should be revisited with pagination outside
# rclone. The alternative (no --fast-list) would make recovery fail on any unapproved extra
# child prefix, including test/acceptance directories.
for SUB in events manifests; do
  TARGET="$DEST/${PREFIX}/${SUB}"
  mkdir -p "$TARGET"
  echo "→ 只读取回 s3:${CRITICAL_EVENT_COS_BUCKET}/${PREFIX}/${SUB} → ${TARGET}/"
  rclone --config "$TMP_CONF" copy --fast-list \
    "cos-restore:${CRITICAL_EVENT_COS_BUCKET}/${PREFIX}/${SUB}" \
    "$TARGET" --retries 3 --checkers 4
done

echo "✅ 取回完成（events/ 与 manifests/ 两个真实子树；未下载验收/测试目录）。下一步（不在此脚本中执行）:"
echo "   CRITICAL_EVENT_KEY=... pnpm --filter @libellum/api critical:verify --dir '$DEST'"
