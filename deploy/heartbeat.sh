#!/usr/bin/env bash
#
# Libevra — **外部心跳（Dead Man's Switch）**。
#
# ⚠️ **为什么需要它**：服务器上的脚本只能报告"我失败了"。如果**服务器彻底失效**
# （断电、断网、实例被删、systemd 定时器根本没启动），那就没有脚本能报告任何东西 ——
# 而"什么都没发生"和"一切都好"看起来一模一样。
#
# 所以成功信号发到一个**服务器之外**的服务（Healthchecks.io）。它预期每天在
# 03:00 备份 + 宽限期内收到一次；收不到就**由它**给你发邮件。
#
# ⚠️ **只有整条流程成功才发成功心跳**：本地导出、隔离恢复演练、加密、上传、
# 远端元数据校验全部通过，才调用 `--ok`。任何一项失败都调用 `--fail`，
# 让外部服务**立刻**报警，而不用等到宽限期结束。
#
# 用法：
#   ./heartbeat.sh --ok        # 整条流程成功
#   ./heartbeat.sh --fail "上传失败"   # 任何阶段失败（外部会立即发邮件）
#   ./heartbeat.sh --check     # 只检查配置，不发
#
# ⚠️ 配置在 deploy/.backup-heartbeat.env（600、不进仓库）：
#   HEARTBEAT_URL=https://hc-ping.com/<uuid>
#
# ⚠️ **心跳只是一次 HTTPS GET，不带任何数据** —— 不接触数据库内容、不上传备份文件。

set +x
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKUP_DIR="$SCRIPT_DIR/backups"
STATE_FILE="$BACKUP_DIR/heartbeat-state.json"

MODE=""
REASON=""

while [ $# -gt 0 ]; do
  case "$1" in
    --ok) MODE="ok" ;;
    --fail) MODE="fail"; REASON="${2:-备份流程失败}"; shift ;;
    --check) MODE="check" ;;
    *) echo "未知心跳参数" >&2; exit 2 ;;
  esac
  shift
done

if [ -f .backup-heartbeat.env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.backup-heartbeat.env >/dev/null 2>&1; set +a
fi

if [ -z "${HEARTBEAT_URL:-}" ]; then
  echo "⚠️ 外部心跳未配置（deploy/.backup-heartbeat.env 缺 HEARTBEAT_URL）"
  echo "   这意味着**服务器彻底失效时没有人会通知你**。配置见 docs/开发过程记录/S12-C-B-实施与配置指南.md"
  exit 3
fi

if [ "$MODE" = "check" ]; then
  echo "✅ 心跳已配置（地址隐藏）"
  exit 0
fi

case "$MODE" in
  ok)   URL="$HEARTBEAT_URL" ;;
  fail) URL="${HEARTBEAT_URL%/}/fail" ;;
  *) echo "❌ 必须指定 --ok / --fail / --check" >&2; exit 2 ;;
esac

# 拒绝 curl 配置注入；地址只从 stdin 传给 curl，不出现在 argv 或日志中。
case "$URL" in https://*) ;; *) echo "heartbeat: invalid HTTPS configuration" >&2; exit 2 ;; esac
case "$URL" in *'"'*|*'\'*|*$'\n'*|*$'\r'*) echo "heartbeat: invalid URL characters" >&2; exit 2 ;; esac
HTTP_CODE=000
CURL_EXIT=0
ERROR_CLASS=none
ATTEMPTS=0
OK=false
while [ "$ATTEMPTS" -lt 3 ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if HTTP_CODE="$(printf 'url = "%s"\n' "$URL" | curl --config - -sS --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' 2>/dev/null)"; then CURL_EXIT=0; else CURL_EXIT=$?; fi
  case "$HTTP_CODE" in [0-9][0-9][0-9]) ;; *) HTTP_CODE=000 ;; esac
  RETRY=false
  if [ "$CURL_EXIT" -eq 0 ] && [[ "$HTTP_CODE" = 2?? ]]; then
    OK=true; ERROR_CLASS=none; break
  elif [ "$CURL_EXIT" -eq 28 ]; then ERROR_CLASS=timeout; RETRY=true
  elif [ "$CURL_EXIT" -eq 6 ] || [ "$CURL_EXIT" -eq 7 ]; then ERROR_CLASS=network; RETRY=true
  elif [ "$CURL_EXIT" -ne 0 ]; then ERROR_CLASS=transport; RETRY=true
  else
    ERROR_CLASS=http
    case "$HTTP_CODE" in 408|429|5??) RETRY=true ;; esac
  fi
  echo "heartbeat: attempt=$ATTEMPTS category=$ERROR_CLASS curlExit=$CURL_EXIT http=$HTTP_CODE" >&2
  [ "$RETRY" = true ] && [ "$ATTEMPTS" -lt 3 ] || break
  sleep 2
done

# 投递结果与备份结果独立。失败写入也必须返回非零，不能静默声称已记录。
mkdir -p "$BACKUP_DIR"
STATE_TMP="$(mktemp "$BACKUP_DIR/.heartbeat.XXXXXX")"
trap 'rm -f -- "$STATE_TMP"' EXIT
NOW="$(date +%s)"
PREVIOUS_SUCCESS=""
if [ -f "$STATE_FILE" ]; then
  PREVIOUS_SUCCESS="$(sed -n 's/.*"lastSuccessAt": *\([0-9][0-9]*\).*/\1/p' "$STATE_FILE" | head -1)"
fi
[ "$OK" != true ] || PREVIOUS_SUCCESS="$NOW"
{
  printf '{\n'
  printf '  "lastMode": "%s",\n' "$MODE"
  printf '  "lastHttpStatus": "%s",\n' "$HTTP_CODE"
  printf '  "lastAttemptAt": %s,\n' "$NOW"
  printf '  "ok": %s,\n' "$OK"
  printf '  "attempts": %s,\n' "$ATTEMPTS"
  printf '  "curlExit": %s,\n' "$CURL_EXIT"
  printf '  "errorCategory": "%s",\n' "$ERROR_CLASS"
  if [ -n "$PREVIOUS_SUCCESS" ]; then printf '  "lastSuccessAt": %s,\n' "$PREVIOUS_SUCCESS"; fi
  # 不存调用方的自由文本（可能含连接信息）；备份阶段详见 last-run.json。
  printf '  "updatedAt": %s\n' "$NOW"
  printf '}\n'
} > "$STATE_TMP"
mv -f -- "$STATE_TMP" "$STATE_FILE"

if [ "$OK" = true ]; then
  echo "✅ 心跳已发送（$MODE，HTTP $HTTP_CODE）"
  exit 0
fi

echo "⚠️ 心跳发送失败（$MODE，HTTP $HTTP_CODE）—— 监控服务没有收到信号" >&2
exit 1
