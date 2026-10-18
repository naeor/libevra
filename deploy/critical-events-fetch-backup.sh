#!/usr/bin/env bash
# Fetch one checkpointed backup + sidecar from independent offsite storage and verify the pair.
#
# This is the recovery-side counterpart to critical-events-backup-all.sh. It never touches a
# database. The restore identity must be provided on the recovery machine (never on production):
#   COS_RESTORE_ID / COS_RESTORE_KEY / COS_BUCKET / COS_REGION
# or CRITICAL_BACKUP_REMOTE_DIR for fs drills.
#
# Usage:
#   ./critical-events-fetch-backup.sh --latest --out /tmp/recovery
#   ./critical-events-fetch-backup.sh --ref critical-backups/checkpoints/2026/<name>.dump.gpg --out /tmp/recovery
#
# Output: <out>/<name>.dump (decrypted plaintext) and <out>/<name>.dump.checkpoint.json
set -euo pipefail
cd "$(dirname "$0")"

OUT=""
REF=""
LATEST=false
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?}"; shift 2 ;;
    --ref) REF="${2:?}"; shift 2 ;;
    --latest) LATEST=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || { echo "--out is required" >&2; exit 2; }
mkdir -p "$OUT"; chmod 700 "$OUT"

MODE="${CRITICAL_BACKUP_OFFSITE:-cos}"
OFFSITE_PREFIX="${CRITICAL_BACKUP_OFFSITE_PREFIX:-critical-backups/checkpoints}"
if [ "$MODE" = "fs" ]; then
  : "${CRITICAL_BACKUP_REMOTE_DIR:?fs mode needs CRITICAL_BACKUP_REMOTE_DIR}"
  if [ "$LATEST" = true ]; then
    REF="$(find "$CRITICAL_BACKUP_REMOTE_DIR" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
  fi
  [ -n "$REF" ] || { echo "no checkpoint backup found under $CRITICAL_BACKUP_REMOTE_DIR" >&2; exit 1; }
  ENCRYPTED="$REF"
  SIDECAR="$REF.checkpoint.json"
  PLAIN="$OUT/$(basename "$REF")"
  cp -f "$ENCRYPTED" "$PLAIN"
  cp -f "$SIDECAR" "$PLAIN.checkpoint.json"
else
  set -a
  [ -f .backup-restore.env ] && . ./.backup-restore.env
  set +a
  : "${COS_RESTORE_ID:?缺少恢复身份 COS_RESTORE_ID}" "${COS_RESTORE_KEY:?}" "${COS_BUCKET:?}" "${COS_REGION:?}"
  if [ -n "${COS_UPLOAD_ID:-}" ] && [ "$COS_RESTORE_ID" = "$COS_UPLOAD_ID" ]; then
    echo "❌ 恢复身份不得与上传身份相同" >&2; exit 2
  fi
  command -v rclone >/dev/null 2>&1 || { echo "rclone required" >&2; exit 2; }
  RCLONE_CONF="$(mktemp)"; trap 'rm -f "$RCLONE_CONF"' EXIT
  cat > "$RCLONE_CONF" <<RCLONE
[cos]
type = s3
provider = TencentCOS
access_key_id = ${COS_RESTORE_ID}
secret_access_key = ${COS_RESTORE_KEY}
endpoint = ${COS_ENDPOINT:-cos.ap-hongkong.myqcloud.com}
region = ${COS_REGION}
acl = private
RCLONE
  chmod 600 "$RCLONE_CONF"
  if [ "$LATEST" = true ]; then
    REF="$(rclone --config "$RCLONE_CONF" lsf -R --files-only "cos:${COS_BUCKET}/${OFFSITE_PREFIX}/" 2>/dev/null | grep '\.dump\.gpg$' | sort -r | head -1 || true)"
    [ -n "$REF" ] || { echo "no checkpoint backup found in COS" >&2; exit 1; }
    REF="${OFFSITE_PREFIX}/${REF}"
  fi
  [ -n "$REF" ] || { echo "--ref or --latest is required" >&2; exit 2; }
  ENCRYPTED="$OUT/$(basename "$REF")"
  SIDECAR="$ENCRYPTED.checkpoint.json"
  rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket "cos:${COS_BUCKET}/${REF}" "$ENCRYPTED"
  rclone --config "$RCLONE_CONF" copyto --s3-no-check-bucket "cos:${COS_BUCKET}/${REF}.checkpoint.json" "$SIDECAR"
  command -v gpg >/dev/null 2>&1 || { echo "gpg required" >&2; exit 2; }
  PLAIN="${ENCRYPTED%.gpg}"
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file .backup.key \
    --output "$PLAIN" --decrypt "$ENCRYPTED"
  rm -f "$ENCRYPTED"
  mv "$SIDECAR" "$PLAIN.checkpoint.json"
fi

expected="$(sed -n 's/.*"sha256": "\([0-9a-f]*\)".*/\1/p' "$PLAIN.checkpoint.json")"
actual="$(sha256sum "$PLAIN" | awk '{print $1}' | tr -d '\\\r')"
[ "$expected" = "$actual" ] || { echo "❌ dump SHA-256 与 sidecar 不一致" >&2; exit 1; }
echo "✅ 已取回并校验：$PLAIN"
echo "   sidecar: $PLAIN.checkpoint.json"
echo "   下一步：恢复到隔离库，然后在隔离库上运行 critical:preview/critical:apply-safe。"
