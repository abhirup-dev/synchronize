from __future__ import annotations

import os
import shlex
import shutil
import base64
import json
from dataclasses import dataclass
from pathlib import Path

from .runtime import ArtifactWriter, HarnessError


@dataclass(frozen=True)
class PiPaths:
    pi_home: Path
    pi_sessions: Path
    sync_home: Path


class PiEnvironment:
    def __init__(
        self,
        *,
        repo: Path,
        paths: PiPaths,
        provider: str,
        model: str,
        thinking: str,
        auth_source: str | None,
        writer: ArtifactWriter,
    ) -> None:
        self.repo = repo
        self.paths = paths
        self.provider = provider
        self.model = model
        self.thinking = thinking
        self.auth_source = auth_source
        self.writer = writer

    def auth_source_path(self) -> Path:
        if self.auth_source:
            return Path(self.auth_source).expanduser().resolve()
        codex_auth = Path.home() / ".codex" / "auth.json"
        if codex_auth.exists():
            return codex_auth
        return Path.home() / ".pi" / "agent" / "auth.json"

    def required_worktree_paths(self) -> dict[str, Path]:
        return {
            "synchronize_mcp": self.repo / "bin" / "synchronize-mcp",
            "pi_extension": self.repo / "extensions" / "pi-synchronize" / "src" / "index.ts",
            "pi_skill": self.repo / "skills" / "synchronize-pi",
        }

    def validate(self) -> None:
        missing_paths = [f"{name}={path}" for name, path in self.required_worktree_paths().items() if not path.exists()]
        if missing_paths:
            raise HarnessError("Missing worktree integration path(s): " + ", ".join(missing_paths))
        auth_source = self.auth_source_path()
        if not auth_source.exists():
            raise HarnessError(f"Pi auth source is missing: {auth_source}")

    def provision(self) -> None:
        self.paths.pi_home.mkdir(parents=True, exist_ok=True)
        self.paths.pi_sessions.mkdir(parents=True, exist_ok=True)
        self.paths.sync_home.mkdir(parents=True, exist_ok=True)
        self.provision_auth()
        settings = {
            "defaultProvider": self.provider,
            "defaultModel": self.model,
            "defaultThinkingLevel": self.thinking,
            "packages": ["npm:pi-mcp-adapter"],
        }
        self.writer.write_json_at(self.paths.pi_home / "settings.json", settings)
        mcp_config = {
            "mcpServers": {
                "synchronize": {
                    "command": "sh",
                    "args": ["-c", self.resilient_mcp_command()],
                    "env": {
                        "SYNCHRONIZE_HOME": str(self.paths.sync_home),
                        "SYNCHRONIZE_MCP_MODE": "codex",
                        "PATH": os.environ.get("PATH", ""),
                    },
                }
            }
        }
        self.writer.write_json_at(self.paths.pi_home / "mcp.json", mcp_config)
        self.writer.write_json(
            "pi-environment.json",
            {
                "pi_home": str(self.paths.pi_home),
                "pi_sessions": str(self.paths.pi_sessions),
                "auth_source": str(self.auth_source_path()),
                "settings": settings,
                "mcp_config": mcp_config,
                "extension": str(self.required_worktree_paths()["pi_extension"]),
                "skill": str(self.required_worktree_paths()["pi_skill"]),
            },
        )

    def provision_auth(self) -> None:
        auth_source = self.auth_source_path()
        target = self.paths.pi_home / "auth.json"
        codex_auth = self.pi_auth_from_codex_auth(auth_source)
        if codex_auth is not None:
            self.writer.write_json_at(target, codex_auth)
            return
        shutil.copy2(auth_source, target)

    def pi_auth_from_codex_auth(self, auth_source: Path) -> dict[str, object] | None:
        try:
            auth = json.loads(auth_source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        tokens = auth.get("tokens")
        if not isinstance(tokens, dict):
            return None
        access = tokens.get("access_token")
        refresh = tokens.get("refresh_token")
        account_id = tokens.get("account_id")
        if not isinstance(access, str) or not isinstance(refresh, str) or not isinstance(account_id, str):
            return None
        expires = self.jwt_expiry_ms(access)
        if expires is None:
            return None
        return {
            "openai-codex": {
                "type": "oauth",
                "access": access,
                "refresh": refresh,
                "expires": expires,
                "accountId": account_id,
            }
        }

    def jwt_expiry_ms(self, token: str) -> int | None:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        try:
            decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
            claims = json.loads(decoded)
        except (ValueError, json.JSONDecodeError):
            return None
        exp = claims.get("exp")
        if not isinstance(exp, int):
            return None
        return exp * 1000

    def install_package_command(self) -> list[str]:
        return [
            "env",
            f"PI_CODING_AGENT_DIR={self.paths.pi_home}",
            "pi",
            "install",
            "npm:pi-mcp-adapter",
        ]

    def resilient_mcp_command(self) -> str:
        configured_cli = shlex.quote(str(self.repo / "bin" / "synchronize"))
        configured_mcp = shlex.quote(str(self.repo / "bin" / "synchronize-mcp"))
        return "\n".join(
            [
                f"SYNCHRONIZE_CONFIGURED_CLI={configured_cli}",
                f"SYNCHRONIZE_CONFIGURED_MCP={configured_mcp}",
                'for cli in "${SYNCHRONIZE_CLI:-}" "${SYNCHRONIZE_CONFIGURED_CLI:-}" "$(command -v synchronize 2>/dev/null)"; do',
                '  [ -n "$cli" ] || continue',
                '  [ -x "$cli" ] || continue',
                '  "$cli" status >/dev/null 2>&1 || continue',
                '  for mcp in "${SYNCHRONIZE_MCP:-}" "${SYNCHRONIZE_CONFIGURED_MCP:-}" "$(command -v synchronize-mcp 2>/dev/null)"; do',
                '    [ -n "$mcp" ] || continue',
                '    [ -x "$mcp" ] || continue',
                '    exec "$mcp"',
                "  done",
                "done",
                "exit 1",
            ]
        )

    def command_for_session(self, name: str) -> str:
        env_parts = {
            "PI_CODING_AGENT_DIR": str(self.paths.pi_home),
            "PI_CODING_AGENT_SESSION_DIR": str(self.paths.pi_sessions),
            "SYNCHRONIZE_HOME": str(self.paths.sync_home),
            "SYNCHRONIZE_CLI": str(self.repo / "bin" / "synchronize"),
            "SYNCHRONIZE_MCP": str(self.repo / "bin" / "synchronize-mcp"),
            "SYNCHRONIZE_PORT": "0",
            "SYNCHRONIZE_SESSION_NAME": name,
            "SYNCHRONIZE_PI_DEBUG": "1",
        }
        # Let a scenario shorten the Pi heartbeat (e.g. the peer-revival smoke)
        # so lease-lapse / sweep / re-register recovery happens within the test
        # window. Honored by extensions/pi-synchronize HEARTBEAT_MS.
        heartbeat_ms = os.environ.get("SYNCHRONIZE_PI_HEARTBEAT_MS")
        if heartbeat_ms:
            env_parts["SYNCHRONIZE_PI_HEARTBEAT_MS"] = heartbeat_ms
        command = ["env"]
        for key, value in env_parts.items():
            command.append(f"{key}={value}")
        command.extend(
            [
                "pi",
                "--provider",
                self.provider,
                "--model",
                self.model,
                "--thinking",
                self.thinking,
                "--mcp-config",
                str(self.paths.pi_home / "mcp.json"),
                "--extension",
                str(self.required_worktree_paths()["pi_extension"]),
                "--skill",
                str(self.required_worktree_paths()["pi_skill"]),
                "--no-context-files",
                "--no-prompt-templates",
                "--no-themes",
            ]
        )
        return shlex.join(command)

    def read_transcripts(self) -> str:
        if not self.paths.pi_sessions.exists():
            return ""
        parts: list[str] = []
        for path in sorted(self.paths.pi_sessions.rglob("*.jsonl")):
            try:
                parts.append(f"\n--- {path} ---\n{path.read_text(encoding='utf-8', errors='replace')}")
            except OSError:
                continue
        return "\n".join(parts)
