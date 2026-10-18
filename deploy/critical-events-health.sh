#!/usr/bin/env bash
# S13-I protection health check for systemd/cron/monitoring.
#
# IMPORTANT: a failure here means the **backup-enhancement layer** is degraded. It must NOT stop
# normal API traffic or the S12-C backup. It calls the existing alert-mail.sh stage mechanism.
#
# Usage:
#   ./critical-events-health.sh
# Exit: 0 healthy; 1 protection alarm / status command failed.
set -uo pipefail
cd "$(dirname "$0")"

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

if docker compose -f docker-compose.prod.yml exec -T api \
  pnpm --filter @libellum/api critical:status >"$OUT" 2>&1; then
  echo "critical-events protection healthy"
  exit 0
fi

REASON="$(tail -c 1200 "$OUT" | tr '\n' ' ')"
echo "critical-events protection alarm: $REASON" >&2
if [ -x ./alert-mail.sh ]; then
  ./alert-mail.sh --stage critical-protection --error "${REASON:-critical protection alarm}" || true
fi
exit 1
