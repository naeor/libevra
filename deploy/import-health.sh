#!/usr/bin/env bash
# S14 phase-4 import health / undo_failed watchdog.
#
# Read-only database check. It never retries, confirms, unlocks or mutates anything. A non-zero
# exit means a human must inspect the import job/lock per the release Runbook. Run it from the
# production deploy directory, where docker-compose.prod.yml and .env live.
#
# Usage:
#   ./import-health.sh
#   IMPORT_HEALTH_NO_ALERT=1 ./import-health.sh   # read-only check without email
#
# Exit: 0 healthy/not migrated; 1 alarm; 2 check failed.

set -uo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.prod.yml)
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

db_query() {
  "${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qAt'
}

# The S14 tables do not exist before 45->51. The watchdog is safe to install before migration.
TABLE_EXISTS="$(db_query <<'SQL' 2>/dev/null || true
select coalesce(to_regclass('public.ledger_import_jobs')::text, '');
SQL
)"
if [ "${TABLE_EXISTS}" = "" ]; then
  echo "$STAMP import-health: S14 tables not present (pre-45->51); nothing to check"
  exit 0
fi

if ! RESULT="$(db_query <<'SQL'
select 'undo_failed_old='||count(*) from ledger_import_jobs
  where status = 'undo_failed' and updated_at < now() - interval '2 minutes';
select 'undoing_old='||count(*) from ledger_import_jobs
  where status = 'undoing' and updated_at < now() - interval '2 minutes';
select 'confirming_old='||count(*) from ledger_import_jobs
  where status = 'confirming' and updated_at < now() - interval '5 minutes';
select 'active_locks_old='||count(*) from ledger_write_locks
  where released_at is null and created_at < now() - interval '15 minutes';
select 'failing_jobs='||coalesce(string_agg(id::text, ','), '') from ledger_import_jobs
  where status in ('undoing','undo_failed') and updated_at < now() - interval '2 minutes';
select 'old_lock_books='||coalesce(string_agg(book_id::text, ','), '') from ledger_write_locks
  where released_at is null and created_at < now() - interval '15 minutes';
SQL
)"; then
  echo "$STAMP import-health: DATABASE CHECK FAILED" >&2
  if [ "${IMPORT_HEALTH_NO_ALERT:-0}" != "1" ] && [ -x ./alert-mail.sh ]; then
    ALERT_STATE_DIR="${IMPORT_HEALTH_ALERT_STATE_DIR:-.import-health-alert}" \
      ./alert-mail.sh --stage import-health --error "import health database check failed" || true
  fi
  exit 2
fi
# The final query intentionally produces an empty-looking value; keep all output for the operator.
printf '%s\n' "$RESULT"

FAILURES="$(printf '%s\n' "$RESULT" | awk -F= '
  /^undo_failed_old=/ {v += $2}
  /^undoing_old=/ {v += $2}
  /^confirming_old=/ {v += $2}
  /^active_locks_old=/ {v += $2}
  END {print v + 0}')"
if [ "${FAILURES}" -eq 0 ]; then
  echo "$STAMP import-health: healthy"
  exit 0
fi

DETAIL="$(printf '%s\n' "$RESULT" | tr '\n' ' ')"
echo "$STAMP import-health: ALARM ${DETAIL}" >&2
if [ "${IMPORT_HEALTH_NO_ALERT:-0}" != "1" ] && [ -x ./alert-mail.sh ]; then
  ALERT_STATE_DIR="${IMPORT_HEALTH_ALERT_STATE_DIR:-.import-health-alert}" \
    ./alert-mail.sh --stage import-health --error "${DETAIL}" || true
fi
exit 1
