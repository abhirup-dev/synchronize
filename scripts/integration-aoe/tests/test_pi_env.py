from __future__ import annotations

import json
import os
import base64
import subprocess
import tempfile
import unittest
from pathlib import Path

from sync_itest_aoe.pi_env import PiEnvironment, PiPaths
from sync_itest_aoe.runtime import ArtifactWriter


REPO = Path(__file__).resolve().parents[3]


def fake_jwt(exp: int) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').decode("ascii").rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode("utf-8")).decode("ascii").rstrip("=")
    return f"{header}.{payload}.sig"


class PiEnvironmentTest(unittest.TestCase):
    def test_provision_writes_isolated_resilient_mcp_runtime(self) -> None:
        with tempfile.TemporaryDirectory(prefix="synchronize-pi-env-") as tmp:
            root = Path(tmp)
            auth = root / "auth.json"
            auth.write_text("{}", encoding="utf-8")
            paths = PiPaths(
                pi_home=root / "pi-agent",
                pi_sessions=root / "pi-sessions",
                sync_home=root / "synchronize-home",
            )
            env = PiEnvironment(
                repo=REPO,
                paths=paths,
                provider="openai-codex",
                model="gpt-test",
                thinking="low",
                auth_source=str(auth),
                writer=ArtifactWriter(root / "artifacts"),
            )

            env.validate()
            env.provision()

            self.assertEqual(json.loads((paths.pi_home / "auth.json").read_text(encoding="utf-8")), {})
            mcp_config = json.loads((paths.pi_home / "mcp.json").read_text(encoding="utf-8"))
            synchronize = mcp_config["mcpServers"]["synchronize"]
            self.assertEqual(synchronize["command"], "sh")
            self.assertEqual(synchronize["env"]["SYNCHRONIZE_HOME"], str(paths.sync_home))
            self.assertEqual(synchronize["env"]["SYNCHRONIZE_MCP_MODE"], "codex")
            self.assertIn("SYNCHRONIZE_CONFIGURED_CLI=", synchronize["args"][1])
            self.assertIn("SYNCHRONIZE_CONFIGURED_MCP=", synchronize["args"][1])
            self.assertIn('"$cli" status', synchronize["args"][1])
            self.assertIn('exec "$mcp"', synchronize["args"][1])

            command = env.command_for_session("pi-one")
            self.assertIn(f"SYNCHRONIZE_HOME={paths.sync_home}", command)
            self.assertIn(f"SYNCHRONIZE_CLI={REPO / 'bin' / 'synchronize'}", command)
            self.assertIn(f"SYNCHRONIZE_MCP={REPO / 'bin' / 'synchronize-mcp'}", command)
            self.assertIn(f"PI_CODING_AGENT_DIR={paths.pi_home}", command)
            self.assertIn(f"PI_CODING_AGENT_SESSION_DIR={paths.pi_sessions}", command)

            fake_cli = root / "fake-synchronize"
            fake_mcp = root / "fake-synchronize-mcp"
            calls = root / "calls.log"
            fake_cli.write_text(
                "#!/bin/sh\n"
                'printf "cli:%s:%s\\n" "$SYNCHRONIZE_HOME" "$*" >> "$SYNC_LOG"\n'
                '[ "$1" = "status" ] && exit 0\n'
                "exit 9\n",
                encoding="utf-8",
            )
            fake_cli.chmod(0o755)
            fake_mcp.write_text(
                "#!/bin/sh\n"
                'printf "mcp:%s:%s\\n" "$SYNCHRONIZE_HOME" "$SYNCHRONIZE_MCP_MODE" >> "$SYNC_LOG"\n'
                "exit 0\n",
                encoding="utf-8",
            )
            fake_mcp.chmod(0o755)

            result = subprocess.run(
                ["sh", "-c", synchronize["args"][1]],
                check=False,
                capture_output=True,
                text=True,
                env={
                    **os.environ,
                    **synchronize["env"],
                    "SYNCHRONIZE_CLI": str(fake_cli),
                    "SYNCHRONIZE_MCP": str(fake_mcp),
                    "SYNC_LOG": str(calls),
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                calls.read_text(encoding="utf-8"),
                f"cli:{paths.sync_home}:status\nmcp:{paths.sync_home}:codex\n",
            )

    def test_provision_converts_codex_auth_json_to_pi_openai_codex_auth(self) -> None:
        with tempfile.TemporaryDirectory(prefix="synchronize-pi-env-") as tmp:
            root = Path(tmp)
            auth = root / "codex-auth.json"
            auth.write_text(
                json.dumps(
                    {
                        "auth_mode": "chatgpt",
                        "tokens": {
                            "access_token": fake_jwt(12345),
                            "refresh_token": "refresh-token",
                            "account_id": "account-id",
                        },
                    }
                ),
                encoding="utf-8",
            )
            paths = PiPaths(
                pi_home=root / "pi-agent",
                pi_sessions=root / "pi-sessions",
                sync_home=root / "synchronize-home",
            )
            env = PiEnvironment(
                repo=REPO,
                paths=paths,
                provider="openai-codex",
                model="gpt-test",
                thinking="low",
                auth_source=str(auth),
                writer=ArtifactWriter(root / "artifacts"),
            )

            env.validate()
            env.provision()

            self.assertEqual(
                json.loads((paths.pi_home / "auth.json").read_text(encoding="utf-8")),
                {
                    "openai-codex": {
                        "type": "oauth",
                        "access": fake_jwt(12345),
                        "refresh": "refresh-token",
                        "expires": 12345000,
                        "accountId": "account-id",
                    }
                },
            )


if __name__ == "__main__":
    unittest.main()
