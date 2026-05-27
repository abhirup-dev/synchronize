from __future__ import annotations

import os
import shlex
import shutil
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
        shutil.copy2(self.auth_source_path(), self.paths.pi_home / "auth.json")
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
