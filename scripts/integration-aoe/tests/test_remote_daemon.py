from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sync_itest_aoe.runtime import RemoteDaemonConfig, synchronize_env, synchronize_shell_env
from sync_itest_aoe.sync_rest import SyncRestClient


class RemoteDaemonRuntimeTest(unittest.TestCase):
    def test_synchronize_env_defaults_to_isolated_local_daemon(self) -> None:
        with tempfile.TemporaryDirectory(prefix="synchronize-remote-env-") as tmp:
            sync_home = Path(tmp)
            with patch.dict(
                os.environ,
                {"SYNCHRONIZE_REMOTE_URL": "http://stale.example", "SYNCHRONIZE_TOKEN": "stale"},
                clear=False,
            ):
                env = synchronize_env(sync_home)

            self.assertEqual(env["SYNCHRONIZE_HOME"], str(sync_home))
            self.assertEqual(env["SYNCHRONIZE_PORT"], "0")
            self.assertNotIn("SYNCHRONIZE_REMOTE_URL", env)
            self.assertNotIn("SYNCHRONIZE_TOKEN", env)

    def test_synchronize_env_remote_mode_targets_existing_daemon(self) -> None:
        with tempfile.TemporaryDirectory(prefix="synchronize-remote-env-") as tmp:
            sync_home = Path(tmp)
            remote = RemoteDaemonConfig(url="http://100.126.163.80:58412", token="secret")

            env = synchronize_env(sync_home, remote=remote)
            shell_env = synchronize_shell_env(remote, sync_home)

            self.assertEqual(env["SYNCHRONIZE_HOME"], str(sync_home))
            self.assertEqual(env["SYNCHRONIZE_REMOTE_URL"], "http://100.126.163.80:58412")
            self.assertEqual(env["SYNCHRONIZE_TOKEN"], "secret")
            self.assertEqual(env["SYNCHRONIZE_HEALTH_TIMEOUT_MS"], "5000")
            self.assertNotIn("SYNCHRONIZE_PORT", env)
            self.assertIn(f"SYNCHRONIZE_HOME={sync_home}", shell_env)
            self.assertIn("SYNCHRONIZE_REMOTE_URL=http://100.126.163.80:58412", shell_env)
            self.assertIn("SYNCHRONIZE_TOKEN=secret", shell_env)
            self.assertIn("SYNCHRONIZE_HEALTH_TIMEOUT_MS=5000", shell_env)

    def test_sync_rest_client_uses_remote_base_url_and_bearer_auth(self) -> None:
        requests = []

        class FakeResponse:
            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self) -> bytes:
                return b'{"ok":true}'

        def fake_urlopen(request, timeout):  # type: ignore[no-untyped-def]
            requests.append((request, timeout))
            return FakeResponse()

        with patch("urllib.request.urlopen", fake_urlopen):
            client = SyncRestClient(Path("/no/discovery"), base_url="http://mac.test:58412/", token="secret")
            self.assertEqual(client.status(), {"ok": True})

        self.assertEqual(len(requests), 1)
        request, timeout = requests[0]
        self.assertEqual(timeout, 5)
        self.assertEqual(request.full_url, "http://mac.test:58412/status")
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")

    def test_sync_rest_client_keeps_local_discovery_path(self) -> None:
        with tempfile.TemporaryDirectory(prefix="synchronize-local-rest-") as tmp:
            sync_home = Path(tmp)
            (sync_home / "daemon.json").write_text(json.dumps({"baseUrl": "http://127.0.0.1:12345"}), encoding="utf-8")
            self.assertEqual(SyncRestClient(sync_home).base_url(), "http://127.0.0.1:12345")


if __name__ == "__main__":
    unittest.main()
