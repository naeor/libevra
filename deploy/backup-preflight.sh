#!/usr/bin/env bash
# 只读检查；由实际备份用户执行，不修改属主、权限或凭据。
set +x
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"
fail() { echo "backup-preflight: $1" >&2; exit 73; }
[ -r "$SCRIPT_DIR" ] && [ -x "$SCRIPT_DIR" ] || fail "deploy directory inaccessible"
[ -d "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ] && [ -x "$BACKUP_DIR" ] || fail "backup directory not writable"
if [ ! -e "$SCRIPT_DIR/.backup.lock" ]; then
  [ -w "$SCRIPT_DIR" ] || fail "missing lock cannot be created by backup user"
fi
for name in .backup.lock backups/last-run.json backups/last-local.json backups/heartbeat-state.json; do
  path="$SCRIPT_DIR/$name"
  [ ! -L "$path" ] || fail "unsafe state or lock symlink"
  if [ -e "$path" ]; then [ -f "$path" ] && [ -w "$path" ] || fail "state or lock not writable"; fi
done
for name in .env .backup.env .backup.key .backup-heartbeat.env .backup-mail.env; do
  path="$SCRIPT_DIR/$name"
  [ ! -L "$path" ] || fail "unsafe credential symlink"
  if [ -e "$path" ]; then
    [ -f "$path" ] && [ -r "$path" ] || fail "credential not readable"
    mode="$(stat -c %a "$path")"
    (( (8#$mode & 077) == 0 )) || fail "credential permissions must exclude group and others"
  fi
done
echo "backup-preflight: access checks passed"
