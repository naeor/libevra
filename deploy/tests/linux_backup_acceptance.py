"""一次性 Linux 环境验收：真实 DAC/flock，备份子进程降权，外部服务全部替身。

仅在隔离 Linux 中运行：sudo python3 deploy/tests/linux_backup_acceptance.py
root 只用于本脚本创建的临时夹具属主设置；不创建用户、不操作 systemd、不联网。
"""
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import unittest

import backup_reliability_test as fixtures


class LinuxBackupAcceptance(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.BackupReliability(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.uid = 65534
        self.gid = 65534
        # 只移除当前夹具的 flock 替身。stat/chmod/mktemp/mv 也使用真正的 Linux 工具。
        for name in ("flock", "mktemp", "mv"):
            (self.fixture.bin / name).unlink()
        self.processes = []
        self.addCleanup(self.stop_children)
        self.reown_fixture()

    def reown_fixture(self):
        for parent, dirs, files in os.walk(self.root):
            os.chown(parent, self.uid, self.gid)
            for name in files:
                os.chown(Path(parent) / name, self.uid, self.gid)

    def stop_children(self):
        for proc in self.processes:
            if proc.poll() is None:
                # 只清理本测试创建的独立进程组，绝不按名称杀其它进程。
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate(timeout=5)

    def start(self, *args, **extra):
        env = self.fixture.env | {k: str(v) for k, v in extra.items()}

        def demote():
            os.setgroups([])
            os.setgid(self.gid)
            os.setuid(self.uid)

        command = [fixtures.BASH, "-c",
                   'test "$(id -u)" -ne 0 || exit 99; export PATH="$1:$PATH"; '
                   'shift; exec bash backup-all.sh "$@"', "test", str(self.fixture.bin), *args]
        proc = subprocess.Popen(command, cwd=self.root, env=env, preexec_fn=demote,
                                start_new_session=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8")
        self.processes.append(proc)
        return proc

    def finish(self, proc):
        output, _ = proc.communicate(timeout=15)
        self.assertNotIn("TEST-SECRET", output)
        self.assertNotIn("private-test-ping", output)
        return proc.returncode, output

    def run_backup(self, *args, **extra):
        return self.finish(self.start(*args, **extra))

    def events(self):
        return self.fixture.trace.read_text(encoding="utf-8").splitlines()

    def state(self):
        return json.loads((self.root / "backups/last-run.json").read_text(encoding="utf-8"))

    def clean(self):
        for pattern in (".runtime.*", ".last-run.*", ".heartbeat.*"):
            self.assertEqual(list((self.root / "backups").glob(pattern)), [])

    def block_upload(self):
        script = self.fixture.bin / "rclone"
        original = script.read_text(encoding="utf-8")
        script.write_text('''#!/usr/bin/env bash
echo upload-waiting >> "$TEST_TRACE"
while [ ! -e .release-upload ]; do /usr/bin/sleep 0.05; done
''' + original, encoding="utf-8")
        os.chown(script, self.uid, self.gid)

    def wait_upload(self):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if "upload-waiting" in self.events():
                return
            time.sleep(0.05)
        self.fail("测试子进程未到达上传屏障")

    def test_nonroot_success_real_700_600_and_cleanup(self):
        code, output = self.run_backup()
        self.assertEqual(code, 0, output)
        # rclone 替身在读取真实配置时用原生 stat 断言目录 700、文件 600。
        self.assertEqual(self.state()["result"], "full")
        self.assertEqual(self.events().count("curl:ok"), 1)
        self.assertNotIn("curl:fail", self.events())
        self.clean()

    def test_root_owned_readonly_deploy_with_writable_backups(self):
        os.chown(self.root, 0, 0)
        self.root.chmod(0o555)
        code, output = self.run_backup()
        self.assertEqual(code, 0, output)
        self.clean()

    def test_root_owned_backup_directory_rejected(self):
        directory = self.root / "backups"
        os.chown(directory, 0, 0)
        directory.chmod(0o700)
        code, output = self.run_backup()
        self.assertEqual(code, 73, output)
        self.assertIn("result=failed", output)
        self.assertNotIn("curl:ok", self.events())
        self.assertEqual(self.events().count("mail"), 1)
        self.clean()

    def test_unwritable_backup_directory_rejected(self):
        (self.root / "backups").chmod(0o500)
        code, output = self.run_backup()
        self.assertEqual(code, 73, output)
        self.assertNotIn("local", self.events())
        self.assertNotIn("curl:ok", self.events())
        self.clean()

    def test_native_flock_concurrency_does_not_overwrite_state(self):
        self.fixture.put("backups/last-run.json", '{"sentinel":"unchanged"}')
        self.reown_fixture()
        self.block_upload()
        first = self.start()
        self.wait_upload()
        state = self.root / "backups/last-run.json"
        before = state.read_bytes()
        code, output = self.run_backup()
        self.assertEqual(code, 75, output)
        self.assertIn("result=skipped", output)
        self.assertEqual(before, state.read_bytes())
        self.assertFalse(any(e.startswith("curl:") for e in self.events()))
        self.assertNotIn("mail", self.events())
        (self.root / ".release-upload").touch()
        code, output = self.finish(first)
        self.assertEqual(code, 0, output)
        self.assertEqual(self.events().count("curl:ok"), 1)
        self.clean()

    def test_upload_and_metadata_failure_preserve_original_exit(self):
        for env, code in (({"MOCK_UPLOAD_EXIT": 23}, 23), ({"MOCK_META_EXIT": 63}, 63),
                          ({"MOCK_REMOTE_SIZE": 19}, 1)):
            with self.subTest(env=env):
                self.fixture.trace.write_text("")
                actual, output = self.run_backup(**env)
                self.assertEqual(actual, code, output)
                self.assertEqual(self.state()["exitCode"], code)
                self.assertEqual(self.events().count("curl:fail"), 1)
                self.assertEqual(self.events().count("mail"), 1)
                self.assertNotIn("curl:ok", self.events())
                self.clean()

    def test_signals_after_sensitive_config_creation(self):
        self.block_upload()
        for sig, code in ((signal.SIGTERM, 143), (signal.SIGHUP, 129), (signal.SIGINT, 130)):
            with self.subTest(signal=sig):
                release = self.root / ".release-upload"
                if release.exists(): release.unlink()
                self.fixture.trace.write_text("")
                proc = self.start()
                self.wait_upload()
                proc.send_signal(sig)
                release.touch()  # bash 等待同步子命令完成后执行 trap。
                actual, output = self.finish(proc)
                self.assertEqual(actual, code, output)
                self.assertEqual(self.state()["exitCode"], code)
                self.assertEqual(self.events().count("curl:fail"), 1)
                self.assertEqual(self.events().count("mail"), 1)
                self.assertNotIn("curl:ok", self.events())
                self.clean()

    def test_maintenance_modes_never_send_daily_success(self):
        for option in ("--skip-offsite", "--no-restore-drill"):
            with self.subTest(option=option):
                code, output = self.run_backup(option)
                self.assertEqual(code, 2, output)
                self.assertEqual(self.state()["result"], "partial")
                self.assertFalse(any(e.startswith("curl:") for e in self.events()))
                self.clean()

    def test_monitor_retries_separate_from_backup_and_cleanup(self):
        code, output = self.run_backup(MOCK_CURL_EXIT=28, MOCK_HTTP="000")
        self.assertEqual(code, 0, output)
        self.assertEqual(self.state()["result"], "full")
        self.assertEqual(self.state()["heartbeat"]["delivery"], "failed")
        self.assertEqual(self.events().count("curl:ok"), 3)
        self.assertEqual(self.events().count("retry-delay"), 2)
        self.assertNotIn("curl:fail", self.events())
        self.clean()


if __name__ == "__main__":
    if sys.platform != "linux" or os.geteuid() != 0:
        sys.exit("未执行：需在一次性 Linux 环境以 root 启动；实际备份子进程始终降权运行")
    for command in ("bash", "flock", "stat", "mktemp", "mv", "id"):
        if not shutil.which(command): sys.exit("缺少 Linux 测试依赖：" + command)
    unittest.main(verbosity=2)
