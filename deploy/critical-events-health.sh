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
HEALTH_ALERT_STATE_DIR="${CRITICAL_EVENTS_ALERT_STATE_DIR:-.critical-events-health-alert}"
mkdir -p "$HEALTH_ALERT_STATE_DIR"
trap 'rm -f "$OUT"' EXIT

# Use a one-off container, not `exec`: an intentionally stopped API must not hide protection health.
if docker compose -f docker-compose.prod.yml run --rm --no-deps -T api \
  pnpm --filter @libellum/api critical:status >"$OUT" 2>&1; then
  echo "critical-events protection healthy"
  # Recovery notification must use an alert state isolated from S12-C's backup alerts.
  if [ -x ./alert-mail.sh ]; then
    ALERT_STATE_DIR="$HEALTH_ALERT_STATE_DIR" ./alert-mail.sh --recovered || true
  fi
  exit 0
fi

REASON="$(tail -c 1200 "$OUT" | tr '\n' ' ')"
echo "critical-events protection alarm: $REASON" >&2
if [ -x ./alert-mail.sh ]; then
  ALERT_STATE_DIR="$HEALTH_ALERT_STATE_DIR" ./alert-mail.sh --stage critical-protection --error "${REASON:-critical protection alarm}" || true
fi
exit 1
