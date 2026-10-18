#!/usr/bin/env bash
# S13-I emergency RAW restore: restore a local S12-C dump into the production database
# **without starting the API or the public web tier**.
#
# This path deliberately does not read S13-I tables, does not call the relay, does not require
# S13-I code/tables/keys and does not touch any COS object. It is the independent recovery channel
# required when the event ledger itself is unavailable or damaged.
#
# ⚠️ Like restore.sh, this is destructive to the database. It first writes a pre-restore safety
# copy, but that copy is NOT an automated rollback. If pg_restore fails, the database may be empty
# or half-restored; use the safety copy manually.
#
# After this script the API and web stay stopped. Reopening public traffic is a separate,
# owner-approved risk decision (see docs/开发过程记录/S13-I-灾难恢复操作手册.md §3).
set -euo pipefail

DUMP="${1:-}"
COMPOSE=(docker compose -f docker-compose.prod.yml)
CONFIRMED=0
[ "${2:-}" = "--yes" ] && CONFIRMED=1

if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "用法: ./emergency-raw-restore.sh backups/<file>.dump [--yes]" >&2
  exit 2
fi
if [ ! -f .env ]; then
  echo "❌ 缺少 deploy/.env" >&2
  exit 2
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${POSTGRES_USER:?missing POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?missing POSTGRES_PASSWORD}"
: "${POSTGRES_DB:?missing POSTGRES_DB}"

if [ "$CONFIRMED" -ne 1 ]; then
  echo "⚠️ 这会覆盖生产数据库 $POSTGRES_DB，并保持 API/web 停止。"
  echo "   输入小写 yes 继续："
  read -r answer
  [ "$answer" = "yes" ] || { echo "已取消"; exit 1; }
fi

if [ ! -s "$DUMP" ]; then
  echo "❌ 备份文件为空" >&2
  exit 2
fi

echo "→ 校验备份可列出（不写库）…"
"${COMPOSE[@]}" exec -T db pg_restore --list < "$DUMP" >/dev/null
echo "✅ 备份可读"

SAFETY="backups/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p backups
echo "→ 当前库安全副本：$SAFETY"
"${COMPOSE[@]}" exec -T db env PGPASSWORD="$POSTGRES_PASSWORD" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$SAFETY"

echo "→ 停止 API 与公网 web（保持隔离）…"
"${COMPOSE[@]}" stop api web >/dev/null || true

echo "→ 重建数据库并恢复…"
"${COMPOSE[@]}" exec -T db env PGPASSWORD="$POSTGRES_PASSWORD" \
  dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
"${COMPOSE[@]}" exec -T db env PGPASSWORD="$POSTGRES_PASSWORD" \
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
"${COMPOSE[@]}" exec -T db env PGPASSWORD="$POSTGRES_PASSWORD" \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error < "$DUMP"

echo "✅ 原始备份已恢复到 $POSTGRES_DB。"
echo "   API/web 仍处于 stopped；没有启动 S13-I 服务，也没有重放墓碑。"
echo "   安全副本：$SAFETY"
echo "   不要自动放回公网。先按 S13-I 操作手册完成人工核查与所有者批准。"
