"""隔离执行真实 bash 编排与心跳；外部命令全部替身，不读生产配置、不联网。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parents[1]
BASH = os.environ.get("BACKUP_TEST_BASH") or shutil.which("bash")


class BackupReliability(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="libevra-backup-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.root / "backups").mkdir()
        self.put(".backup.lock", "")
        for name in ("backup-all.sh", "heartbeat.sh", "backup-preflight.sh"):
            shutil.copyfile(DEPLOY / name, self.root / name)
        self.put(".backup-heartbeat.env", "HEARTBEAT_URL=https://example.invalid/private-test-ping\n")
        self.put(".backup.env", "COS_UPLOAD_ID=fake-id\nCOS_UPLOAD_KEY=TEST-SECRET\nCOS_BUCKET=fake-bucket\n")
        self.put(".backup.key", "TEST-SECRET\n")
        self.script("backup.sh", r'''
echo local >> "$TEST_TRACE"
if [ "${MOCK_SIGNAL:-}" != "" ]; then kill -"$MOCK_SIGNAL" "$PPID"; exit 0; fi
if [ "${MOCK_LOCAL_EXIT:-0}" != 0 ]; then exit "$MOCK_LOCAL_EXIT"; fi
[ "${MOCK_STALE:-0}" != 1 ] || exit 0
head -c 8192 /dev/zero > backups/test.dump
restore=true
for arg in "$@"; do [ "$arg" != --no-restore-drill ] || restore=false; done
[ "${MOCK_RESTORE_FALSE:-0}" != 1 ] || restore=false
cat > backups/last-local.json <<JSON
{"localOk": true, "restoreOk": $restore, "runId": "$BACKUP_RUN_ID", "dump": "test.dump"}
JSON
''')
        self.script("backup-log.sh", 'echo "db:$1" >> "$TEST_TRACE"\nexit 0\n')
        self.script("alert-mail.sh", 'echo mail >> "$TEST_TRACE"\nexit "${MOCK_MAIL_EXIT:-0}"\n')
        self.mock("flock", 'exit "${MOCK_LOCK_EXIT:-0}"\n')
        self.mock("gpg", r'''
if [ "${MOCK_GPG_EXIT:-0}" != 0 ]; then echo TEST-SECRET >&2; exit "$MOCK_GPG_EXIT"; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then head -c 8192 /dev/zero > "$2"; break; fi
  shift
done
''')
        self.mock("rclone", r'''
conf="$2"
[ -f "$conf" ] || exit 71
[ "$(stat -c %a "$conf")" = 600 ] || exit 72
[ "$(stat -c %a "${conf%/*}")" = 700 ] || exit 72
echo rclone >> "$TEST_TRACE"
if [[ " $* " = *' copyto '* ]]; then
  [ "${MOCK_UPLOAD_EXIT:-0}" = 0 ] || { echo TEST-SECRET >&2; exit "$MOCK_UPLOAD_EXIT"; }
else
  [ "${MOCK_META_EXIT:-0}" = 0 ] || exit "$MOCK_META_EXIT"
  printf '{"Size": %s}\n' "${MOCK_REMOTE_SIZE:-8192}"
fi
''')
        self.mock("curl", r'''
config="$(cat)"
url="$(printf '%s' "$config" | sed -n 's/^url = "\(.*\)"$/\1/p')"
case "$url" in */fail) mode=fail ;; *) mode=ok ;; esac
echo "curl:$mode" >> "$TEST_TRACE"
echo "$*" >> "$TEST_CURL_ARGS"
if [ "$mode" = ok ]; then
  grep -q '"dataComplete": true' backups/last-run.json || echo premature >> "$TEST_TRACE"
fi
calls=$(grep -c '^curl:' "$TEST_TRACE")
if [ "${MOCK_RECOVER_AFTER:-0}" != 0 ] && [ "$calls" -gt "$MOCK_RECOVER_AFTER" ]; then printf 200; exit 0; fi
printf '%s' "${MOCK_HTTP:-200}"
exit "${MOCK_CURL_EXIT:-0}"
''')
        self.mock("sleep", 'echo retry-delay >> "$TEST_TRACE"\n')
        self.mock("mktemp", r'''
if [[ "$*" = *'.runtime.'* ]] && [ "${MOCK_TEMP_DENIED:-0}" = 1 ]; then exit 13; fi
/usr/bin/mktemp "$@"
''')
        self.mock("mv", r'''
if [[ "$*" = *'last-run.json'* ]] && [ "${MOCK_STATE_FAIL:-0}" = 1 ]; then exit 17; fi
/usr/bin/mv "$@"
''')
        # NTFS chmod 不能模拟 Unix DAC；仅替换模式读取，拒绝路径由 mktemp 替身实测。
        if os.name == "nt":
            self.mock("stat", '''if [ "$1" = -c ] && [ "$2" = %a ]; then
case "$3" in *.backup.key) echo "${MOCK_KEY_MODE:-600}" ;; *.runtime.??????) echo 700 ;; *) echo 600 ;; esac
else /usr/bin/stat "$@"; fi
''')
        self.trace = self.root / "trace"
        self.trace.touch()
        self.env = os.environ.copy()
        for key in list(self.env):
            if key.startswith(("COS_", "HEARTBEAT_", "MAIL_", "MOCK_", "BACKUP_RUN_ID")):
                del self.env[key]
        self.env.update(TEST_TRACE=self.posix(self.trace), TEST_CURL_ARGS=self.posix(self.root / "curl-args"))

    def posix(self, path):
        text = str(path).replace("\\", "/")
        if os.name == "nt":
            text = "/" + text[0].lower() + text[2:]
        return text

    def put(self, name, text):
        p = self.root / name
        p.write_text(text, encoding="utf-8", newline="\n")
        p.chmod(0o600)

    def script(self, name, text):
        p = self.root / name
        p.write_text("#!/usr/bin/env bash\n" + text, encoding="utf-8", newline="\n")
        p.chmod(0o700)

    def mock(self, name, text):
        self.script("bin/" + name, text)

    def run_backup(self, *args, **env):
        config = self.env | {k: str(v) for k, v in env.items()}
        # PATH 在 bash 内设置，避免 MSYS 将 Windows PATH 错解；不启动真实 docker/curl。
        p = subprocess.run([BASH, "-c", 'export PATH="$1:$PATH"; shift; exec bash backup-all.sh "$@"',
                            "test", self.posix(self.bin), *args], cwd=self.root, env=config,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8", timeout=60)
        self.output = p.stdout
        self.events = self.trace.read_text(encoding="utf-8").splitlines()
        self.assertNotIn("TEST-SECRET", self.output)
        self.assertNotIn("private-test-ping", self.output)
        self.assertEqual(list((self.root / "backups").glob(".runtime.*")), [])
        self.assertEqual(list((self.root / "backups").glob(".last-run.*")), [])
        return p.returncode

    def state(self):
        return json.loads((self.root / "backups/last-run.json").read_text(encoding="utf-8"))

    def assert_failure(self, code, **env):
        self.assertEqual(self.run_backup(**env), code, self.output)
        self.assertEqual(self.state()["result"], "failed")
        self.assertEqual(self.state()["exitCode"], code)
        self.assertEqual(self.events.count("curl:fail"), 1)
        self.assertNotIn("curl:ok", self.events)
        self.assertEqual(self.events.count("mail"), 1)

    def test_complete_once_and_persist_before_ping(self):
        self.assertEqual(self.run_backup(), 0, self.output)
        self.assertEqual(self.events.count("curl:ok"), 1)
        self.assertNotIn("curl:fail", self.events)
        self.assertNotIn("mail", self.events)
        self.assertNotIn("premature", self.events)
        self.assertEqual(self.state()["result"], "full")
        self.assertTrue(self.state()["dataComplete"])

    def test_runtime_permission_failure_before_export(self):
        self.assert_failure(13, MOCK_TEMP_DENIED=1)
        self.assertNotIn("local", self.events)

    def test_upload_failure_preserves_exit(self):
        self.assert_failure(23, MOCK_UPLOAD_EXIT=23)

    def test_remote_validation_failure(self):
        self.assert_failure(1, MOCK_REMOTE_SIZE=19)

    def test_remote_head_error_preserves_exit(self):
        self.assert_failure(63, MOCK_META_EXIT=63)

    def test_local_failure_and_stale_previous_status(self):
        self.put("backups/last-local.json", '{"localOk":true,"restoreOk":true,"dump":"old.dump"}')
        self.assert_failure(41, MOCK_LOCAL_EXIT=41)

    def test_missing_current_run_marker(self):
        self.put("backups/last-local.json", '{"localOk": true,"restoreOk": true,"dump":"old.dump"}')
        self.assert_failure(1, MOCK_STALE=1)

    def test_restore_must_actually_pass(self):
        self.assert_failure(1, MOCK_RESTORE_FALSE=1)

    def test_encrypt_failure(self):
        self.assert_failure(29, MOCK_GPG_EXIT=29)

    def test_skip_offsite_is_partial_without_ping(self):
        self.assertEqual(self.run_backup("--skip-offsite"), 2, self.output)
        self.assertEqual(self.state()["result"], "partial")
        self.assertFalse(self.state()["dataComplete"])
        self.assertFalse(any(e.startswith("curl:") for e in self.events))

    def test_skip_restore_is_partial_without_ping(self):
        self.assertEqual(self.run_backup("--no-restore-drill"), 2, self.output)
        self.assertEqual(self.state()["result"], "partial")
        self.assertFalse(any(e.startswith("curl:") for e in self.events))

    def test_offsite_unconfigured(self):
        self.put(".backup.env", "")
        self.assert_failure(1)

    def test_lock_skip_does_not_overwrite_active_state_or_notify(self):
        self.put("backups/last-run.json", '{"result":"active-sentinel"}')
        self.assertEqual(self.run_backup(MOCK_LOCK_EXIT=1), 75, self.output)
        self.assertEqual(self.state()["result"], "active-sentinel")
        self.assertEqual(self.events, [])
        self.assertIn("result=skipped", self.output)

    def test_lock_command_failure_is_failure(self):
        self.assertEqual(self.run_backup(MOCK_LOCK_EXIT=69), 69, self.output)
        self.assertIn("curl:fail", self.events)

    def test_state_persistence_failure_blocks_success_ping(self):
        self.assertEqual(self.run_backup(MOCK_STATE_FAIL=1), 17, self.output)
        self.assertNotIn("curl:ok", self.events)
        self.assertEqual(self.events.count("curl:fail"), 1)

    def test_monitor_timeout_does_not_reclassify_backup(self):
        self.assertEqual(self.run_backup(MOCK_CURL_EXIT=28, MOCK_HTTP="000"), 0, self.output)
        self.assertEqual(self.events.count("curl:ok"), 3)
        self.assertNotIn("curl:fail", self.events)
        self.assertNotIn("mail", self.events)
        self.assertEqual(self.state()["result"], "full")
        self.assertEqual(self.state()["heartbeat"]["delivery"], "failed")
        hb = json.loads((self.root / "backups/heartbeat-state.json").read_text(encoding="utf-8"))
        self.assertEqual((hb["attempts"], hb["errorCategory"]), (3, "timeout"))
        args = (self.root / "curl-args").read_text(encoding="utf-8")
        self.assertIn("--connect-timeout 5 --max-time 15", args)
        self.assertNotIn("private-test-ping", args)

    def test_notification_failure_preserves_backup_error(self):
        self.assertEqual(self.run_backup(MOCK_UPLOAD_EXIT=23, MOCK_CURL_EXIT=7,
                                         MOCK_HTTP="000", MOCK_MAIL_EXIT=92), 23, self.output)
        self.assertEqual(self.state()["exitCode"], 23)
        self.assertEqual(self.events.count("curl:fail"), 3)
        self.assertEqual(self.events.count("mail"), 1)

    def test_http_retry_stops_on_first_success(self):
        self.assertEqual(self.run_backup(MOCK_HTTP=503, MOCK_RECOVER_AFTER=1), 0, self.output)
        self.assertEqual(self.events.count("curl:ok"), 2)
        self.assertEqual(self.state()["heartbeat"]["delivery"], "sent")

    def test_http_permanent_error_no_retry(self):
        self.assertEqual(self.run_backup(MOCK_HTTP=403), 0, self.output)
        self.assertEqual(self.events.count("curl:ok"), 1)
        hb = json.loads((self.root / "backups/heartbeat-state.json").read_text(encoding="utf-8"))
        self.assertEqual(hb["errorCategory"], "http")

    def test_signals_preserve_code_and_notify_once(self):
        # Windows 默认不提供完整 POSIX 信号语义；可在 Git Bash 上单独验证 trap。
        if os.name == "nt" and not os.environ.get("BACKUP_TEST_SIGNALS"):
            self.skipTest("POSIX signals require Linux")
        for signal, code in (("TERM", 143), ("HUP", 129), ("INT", 130)):
            with self.subTest(signal=signal):
                self.trace.write_text("")
                self.assert_failure(code, MOCK_SIGNAL=signal)

    def test_preflight_rejects_unsafe_secret_permissions(self):
        (self.root / ".backup.key").chmod(0o644)
        self.assert_failure(73, MOCK_KEY_MODE=644)
        self.assertNotIn("local", self.events)

    def test_maintenance_notification_opt_out(self):
        self.assertEqual(self.run_backup("--skip-heartbeat", "--skip-notify"), 0, self.output)
        self.assertEqual(self.state()["heartbeat"]["delivery"], "skipped")
        self.assertFalse(any(e.startswith("curl:") for e in self.events))


if __name__ == "__main__":
    unittest.main(verbosity=2)
