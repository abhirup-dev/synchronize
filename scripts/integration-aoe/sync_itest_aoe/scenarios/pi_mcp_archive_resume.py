from __future__ import annotations

import argparse
import secrets
import shutil
import sys
import time
from pathlib import Path

from .pi_mcp_dm import DEFAULT_MODEL, DEFAULT_PROVIDER, DEFAULT_THINKING, PiMcpDmScenario
from ..runtime import HarnessError
from ..tmux import AgentPane

DEFAULT_ARCHIVE_RESUME_AGENTS = 1


def aoe_profile_for_home(home: str) -> str:
    """Port of aoeProfileName (src/launch/service.ts): the AoE profile the daemon
    derives from its home (djb2 hash). The daemon's resume launch creates this
    profile, so the harness must delete it to avoid leaking dead profiles."""
    h = 5381
    for ch in home:
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    return f"synchronize-{format(h, '08x')[:8]}"


class PiMcpArchiveResumeScenario(PiMcpDmScenario):
    """Real Pi archive→resume cognition smoke.

    Proves the product's resume path restores a LIVE agent that RETAINS its
    pre-archive context — something the deterministic TypeScript harness (which
    drives the bus via API, not cognition) cannot show:

      1. Prompt the agent to memorize a codeword (real cognition; wait STORED).
      2. Archive it over REST /archive/session (reaps the tmux backend).
      3. Resume it over REST /resume/session (daemon launch-service spawns a
         fresh pane in the daemon's own AOE profile).
      4. Re-discover the resumed pane by the current binding's host_session_id
         (a global libtmux scan, since the new pane lives in another profile).
      5. Prompt the RESUMED process to recall the codeword. The 'RECALL' marker
         is novel (never in the rehydrated transcript), so a match proves the
         agent is alive AND faithfully rehydrated its pre-archive memory.
    """

    def __init__(self, args: argparse.Namespace, repo: Path) -> None:
        super().__init__(args, repo)
        if args.profile is None:
            self.profile = f"sync-pi-archive-resume-itest-{self.repo.name}-{self.run_id.lower()}"
            self.profile_cleanup_prefix = f"sync-pi-archive-resume-itest-{self.repo.name}-"
            self.aoe.profile = self.profile

    def cleanup(self) -> None:
        # The daemon's resume launch creates its OWN AoE profile (keyed on
        # sync_home), separate from the harness profile cleaned by super().
        # Delete it too so resumed sessions don't leak dead synchronize-<hash>
        # profiles. (--keep skips this via the base run()'s finally branch.)
        if shutil.which("aoe") is not None:
            daemon_profile = aoe_profile_for_home(str(self.sync_home))
            self.runner.run(
                ["aoe", "profile", "delete", daemon_profile],
                check=False,
                log_name=f"cleanup-daemon-resume-profile-{daemon_profile}",
                input_text="y\n",
            )
        super().cleanup()

    def run_mcp_dm_smoke(self) -> None:
        name = self.agent_names[0]
        peer = self.pi_peers[name]
        pane = self.agent_panes[name]
        codeword = f"CODEWORD-{self.run_id}-{secrets.token_hex(3)}"

        # 1. Store a codeword via real cognition (proves alive pre-archive).
        stored = f"STORED {self.run_id}"
        self.tmux.send_pi_prompt(
            pane,
            (
                "This is a harness memory check. Do not use any tools and do not send any messages. "
                f"Memorize this codeword exactly: {codeword}. "
                f"Once you have memorized it, reply with exactly: {stored}"
            ),
        )
        self.wait_for_pane_text(name, stored, self.args.warmup_timeout, f"archive-resume-stored-{name}")

        # Settle: let the agent fully idle and persist its transcript to disk
        # before we archive (also a window to watch the live pane).
        print(f"[archive-resume] codeword stored; waiting {self.args.pre_archive_wait}s before archiving…", flush=True)
        time.sleep(self.args.pre_archive_wait)

        # 2. Archive over the real REST surface. The agent was launched by the
        #    harness in its OWN AoE profile, so the daemon cannot reap it (that
        #    only works for sessions the daemon's launch-service owns) — it stays
        #    a live "zombie": archived in lifecycle, still running, blocked from
        #    sending until it re-registers. That is the correct contract here.
        archived = self.rest.archive_session(peer_id=peer.peer_id, reason="archive-resume-itest")
        self.writer.write_json("archive-result.json", archived)
        if archived.get("action") != "archived":
            raise HarnessError(f"archive did not report action=archived: {archived}")
        print(f"[archive-resume] archived (zombie={archived.get('zombie')}); waiting {self.args.post_archive_wait}s before resuming…", flush=True)
        time.sleep(self.args.post_archive_wait)

        # 3. Resume over REST with force=True: the live (zombie) pid means a bare
        #    resume is correctly blocked (peer_still_live); force re-verifies,
        #    terminates the old process, then the launch-service spawns a fresh
        #    pane that re-registers under the pinned peer id.
        resumed = self.rest.resume_session(peer_id=peer.peer_id, force=True)
        self.writer.write_json("resume-result.json", resumed)
        if resumed.get("mode") != "launch":
            raise HarnessError(f"resume did not report mode=launch: {resumed}")

        # 4. Wait for resurrection + find the resumed pane (new AoE session, in
        #    the daemon profile) by its current host_session_id.
        new_pane = self.rediscover_resumed_pane(name, peer.peer_id, self.args.command_timeout)
        self.agent_panes[name] = new_pane
        self.tmux.capture_all_panes("after-resume", self.agent_panes, lines=700)

        # 5. Recall on the RESUMED process. 'RECALL …' is novel text, so a match
        #    proves the agent is live AND retained the pre-archive codeword.
        recall = f"RECALL {self.run_id} {codeword}"
        self.tmux.send_pi_prompt(
            new_pane,
            (
                "Earlier in this same session I asked you to memorize a codeword. "
                "Do not use any tools. "
                f"Reply with exactly: RECALL {self.run_id} <the codeword you memorized>"
            ),
        )
        self.wait_for_pane_text(name, recall, self.args.command_timeout, f"archive-resume-recall-{name}")
        self.writer.write_json(
            "archive-resume-proof.json",
            {"peer_id": peer.peer_id, "codeword": codeword, "recall_marker": recall, "resumed_pane": new_pane.__dict__},
        )

    def rediscover_resumed_pane(self, name: str, peer_id: str, timeout: int) -> AgentPane:
        # The original pane was force-killed and is now dead, but its scrollback
        # still contains the (now durable) host_session_id — so we must NOT match
        # on hsid alone. The faithful resume spawns a fresh AoE session in the
        # daemon's profile (title like '<rand>-<name>'), distinct from the
        # harness's original 'aoe_<name>_<hash>'. Exclude the original session and
        # pick the LIVE pane for this agent.
        original = self.agent_panes.get(name)
        original_session = original.tmux_session if original else None

        # Wait until the peer has resurrected (left the archived set) and exposes
        # a current host_session_id binding.
        deadline = time.time() + timeout
        current_hsid = ""
        while time.time() < deadline:
            archived_ids = {str(s.get("peer_id")) for s in self.rest.list_archived().get("sessions", [])}
            bindings = self.rest.agent_sessions_for_peer(peer_id).get("bindings", [])
            hsids = [str(b.get("host_session_id")) for b in bindings if b.get("host_session_id")]
            if peer_id not in archived_ids and hsids:
                current_hsid = hsids[-1]
                break
            time.sleep(2)
        if not current_hsid:
            raise HarnessError(f"resumed peer {peer_id} did not re-register within {timeout}s")
        self.writer.write_text("archive-resume-current-hsid.txt", current_hsid)

        # Find the LIVE resumed pane: belongs to this agent, is NOT the original
        # (dead) session, and is not a dead pane.
        deadline = time.time() + timeout
        while time.time() < deadline:
            for entry in self.tmux.list_panes():
                session = str(entry["session"])
                if session == original_session:
                    continue
                if name not in session:
                    continue
                output = self.tmux.capture_pane(str(entry["pane"]), lines=700)
                if "Pane is dead" in output:
                    continue
                return AgentPane(
                    name=name,
                    pane_id=str(entry["pane"]),
                    tmux_session=session,
                    tmux_window=str(entry["window"]),
                )
            time.sleep(2)
        raise HarnessError(f"could not locate live resumed tmux pane for {name} (host_session_id={current_hsid})")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the real Pi AoE/tmux archive→resume codeword-recall smoke.")
    parser.add_argument("--profile", help="AoE profile to create/use. Defaults to sync-pi-archive-resume-itest-<worktree>-<timestamp>.")
    parser.add_argument("--run-id", help="Stable run id for reproducible names/logs.")
    parser.add_argument("--state-dir", help="Worktree-local state root. Defaults to .synchronize-itest.")
    parser.add_argument("--run-dir", help="Exact run directory. Defaults under --state-dir/runs/<run-id>.")
    parser.add_argument("--agents", type=int, default=DEFAULT_ARCHIVE_RESUME_AGENTS, help="Number of real Pi sessions to launch.")
    # Short prefix: the agent name becomes SYNCHRONIZE_SESSION_NAME, and the
    # daemon's resume reuses it as the launch name — capped at 11 chars
    # (LAUNCH_ALIAS_MAX). "arpi-1" stays well under. Daemon-launched agents are
    # always short ("alpha"); only the harness picked long descriptive names.
    parser.add_argument("--agent-prefix", default="arpi", help="Prefix for Pi session titles (keep short; becomes the session name).")
    parser.add_argument("--provider", default=DEFAULT_PROVIDER, help="Pi provider to use for the smoke.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Pi model to use for the smoke.")
    parser.add_argument("--thinking", default=DEFAULT_THINKING, help="Pi thinking level to use for the smoke.")
    parser.add_argument("--auth-source", help="Path to auth.json to copy into the isolated Pi home. Defaults to ~/.pi/agent/auth.json.")
    parser.add_argument("--keep", action="store_true", help="Preserve AoE sessions/profile and all run state for debugging.")
    parser.add_argument("--start-timeout", type=int, default=90, help="Seconds to wait for AoE sessions to appear.")
    parser.add_argument("--registration-timeout", type=int, default=90, help="Seconds to wait for Pi extension auto-registration.")
    parser.add_argument("--warmup-timeout", type=int, default=120, help="Seconds to wait for each Pi pane to answer the liveness warmup prompt.")
    parser.add_argument("--command-timeout", type=int, default=240, help="Seconds to wait for real Pi MCP behavior.")
    parser.add_argument("--pre-archive-wait", type=int, default=30, help="Seconds to let the agent idle/persist after storing the codeword, before archiving.")
    parser.add_argument("--post-archive-wait", type=int, default=10, help="Seconds to wait after archiving before resuming.")
    args = parser.parse_args(argv)
    if args.agents < 1:
        parser.error("--agents must be at least 1 for the archive→resume smoke")
    return args


def main(argv: list[str], repo: Path) -> int:
    try:
        PiMcpArchiveResumeScenario(parse_args(argv), repo).run()
        return 0
    except HarnessError as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1
