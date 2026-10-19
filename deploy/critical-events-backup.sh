#!/usr/bin/env bash
# S13-I exact checkpointed backup (opt-in; does NOT replace S12-C backup.sh).
#
# Production/default mode uses the db container (PostgreSQL 17 psql/pg_dump):
#   ./critical-events-backup.sh [label]
#
# Isolated/local validation mode (no Docker required; still the same script/algorithm):
#   CRITICAL_BACKUP_MODE=local PSQL_BIN=... PG_DUMP_BIN=... \
#   CRITICAL_BACKUP_ENV_FILE=/tmp/test.env ./critical-events-backup.sh [label]
#
# The exclusive checkpoint advisory lock and the exported snapshot are held only while the
# checkpoint is created; event writers use the matching shared transaction lock. pg_dump then uses
# the exported snapshot, so the dump contains exactly the chain head recorded by the checkpoint row
# inside the dump.
#
# Outputs:
#   critical-backups/<name>.dump
#   critical-backups/<name>.dump.checkpoint.json
#
# This path is intentionally separated from deploy/backups, .backup.lock and daily/monthly COS
# objects. It does not modify S12-C's files.
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
: "${POSTGRES_USER:?}" : "${POSTGRES_PASSWORD:?}" : "${POSTGRES_DB:?}"

MODE="${CRITICAL_BACKUP_MODE:-docker}"
OUT_DIR="${CRITICAL_BACKUP_DIR:-critical-backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

if [ "$MODE" = "local" ]; then
  : "${PSQL_BIN:?local mode needs PSQL_BIN}" "${PG_DUMP_BIN:?local mode needs PG_DUMP_BIN}"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-5432}"
else
  COMPOSE=(docker compose -f "${CRITICAL_COMPOSE_FILE:-docker-compose.prod.yml}")
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BASE="critical-backup-${STAMP}"
LABEL="${1:-$BASE}"
DUMP_HOST="$OUT_DIR/$BASE.dump"
SIDECAR="$DUMP_HOST.checkpoint.json"
STAGE="/tmp/${BASE}.dump"
if [ "$MODE" = "local" ]; then
  STAGE="$DUMP_HOST"
fi
EXPORTER_PID=""
TMP_OUT="$(mktemp)"

run_psql_stdin() {
  local app="$1"; shift
  if [ "$MODE" = "local" ]; then
    PGPASSWORD="$POSTGRES_PASSWORD" PGAPPNAME="$app" \
      "$PSQL_BIN" -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
  else
    "${COMPOSE[@]}" exec -T -e "PGAPPNAME=$app" db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
  fi
}

run_psql() {
  run_psql_stdin "psql" "$@"
}

run_pg_dump() {
  local snapshot="$1"
  if [ "$MODE" = "local" ]; then
    local target="$STAGE"
    if command -v cygpath >/dev/null 2>&1; then target="$(cygpath -w "$target")"; fi
    PGPASSWORD="$POSTGRES_PASSWORD" "$PG_DUMP_BIN" \
      -h "$PGHOST" -p "$PGPORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --snapshot="$snapshot" -Fc -f "$target"
  else
    "${COMPOSE[@]}" exec -T db env PGPASSWORD="$POSTGRES_PASSWORD" \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --snapshot="$snapshot" -Fc -f "$STAGE"
  fi
}

copy_stage_out() {
  if [ "$MODE" = "local" ]; then
    return 0
  fi
  "${COMPOSE[@]}" cp "db:$STAGE" "$DUMP_HOST"
  "${COMPOSE[@]}" exec -T db rm -f "$STAGE" >/dev/null 2>&1 || true
}

terminate_exporter() {
  run_psql_stdin "cleanup" -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'libevra_checkpoint_exporter'" \
    >/dev/null 2>&1 || true
}

trap 'rm -f "$TMP_OUT"; if [ -n "$EXPORTER_PID" ]; then terminate_exporter; fi' EXIT

# Generate a UUID-shaped id without requiring uuidgen.
HEX="$(openssl rand -hex 16)"
ID="${HEX:0:8}-${HEX:8:4}-${HEX:12:4}-${HEX:16:4}-${HEX:20:12}"

echo "→ 创建一致性检查点 $ID（排他锁）"
# The background psql holds the exported snapshot open until pg_dump has started.
(
  cat <<SQL | run_psql_stdin libevra_checkpoint_exporter -v ON_ERROR_STOP=1 -v id="$ID" -v label="$LABEL" -At
BEGIN;
SELECT pg_advisory_lock(hashtext('libevra_critical_backup_checkpoint'));
INSERT INTO critical_backup_checkpoints (id, backup_label, chain_seq, chain_hash, database_name)
SELECT :'id'::uuid, :'label', last_seq, last_hash, current_database()
FROM critical_chain WHERE id = 'global';
COMMIT;
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT 'SNAPSHOT=' || pg_export_snapshot();
SELECT 'HEAD=' || last_seq || '|' || coalesce(last_hash, '') FROM critical_chain WHERE id = 'global';
SELECT pg_advisory_unlock(hashtext('libevra_critical_backup_checkpoint'));
SELECT pg_sleep(600);
COMMIT;
SQL
) > "$TMP_OUT" 2>&1 &
EXPORTER_PID=$!

SNAP=""; HEAD=""
for _ in $(seq 1 100); do
  SNAP="$(sed -n 's/^SNAPSHOT=//p' "$TMP_OUT" | head -1)"
  HEAD="$(sed -n 's/^HEAD=//p' "$TMP_OUT" | head -1)"
  [ -n "$SNAP" ] && [ -n "$HEAD" ] && break
  if ! kill -0 "$EXPORTER_PID" 2>/dev/null; then
    echo "❌ 检查点会话提前退出" >&2; cat "$TMP_OUT" >&2; exit 1
  fi
  sleep 0.1
done
if [ -z "$SNAP" ] || [ -z "$HEAD" ]; then
  echo "❌ 未取得导出的 PostgreSQL 快照" >&2; cat "$TMP_OUT" >&2; exit 1
fi
echo "→ 快照已固定；开始 pg_dump（事件写入可继续，快照不变）"

run_pg_dump "$SNAP"
copy_stage_out

# Kill the exporter session; the checkpoint row remains committed and the snapshot is no longer
# needed once pg_dump has finished.
terminate_exporter
wait "$EXPORTER_PID" 2>/dev/null || true
EXPORTER_PID=""

SHA="$(sha256sum "$DUMP_HOST" | awk '{print $1}' | tr -d '\\\r')"
BYTES="$(stat -c '%s' "$DUMP_HOST" | tr -d '\r')"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# No HMAC is written here: the HMAC-protected sidecar is produced by the Node tool, which has the
# event key. This sidecar is still bound to the actual dump by SHA-256 and to the checkpoint by
# its ID/sequence/hash; the restore tool compares it with the checkpoint row inside the restored
# database, so a wrong/older sidecar cannot be accepted.
cat > "$SIDECAR" <<JSON
{
  "version": 1,
  "checkpointId": "$ID",
  "backupFile": "$BASE.dump",
  "backupLabel": "$LABEL",
  "sha256": "$SHA",
  "bytes": $BYTES,
  "databaseName": "$POSTGRES_DB",
  "chainSeq": ${HEAD%%|*},
  "chainHash": "${HEAD#*|}",
  "createdAt": "$CREATED"
}
JSON
chmod 600 "$SIDECAR"

echo "✅ 检查点备份完成"
echo "   dump:     $DUMP_HOST"
echo "   sidecar:  $SIDECAR"
echo "   chain:    $HEAD"
echo "   请将 dump 与 sidecar 一起复制到灾备介质；sidecar 缺失时安全恢复必须人工核验。"
