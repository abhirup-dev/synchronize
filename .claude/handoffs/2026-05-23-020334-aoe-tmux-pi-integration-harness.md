# Handoff: AoE/tmux and Real Pi Integration Harness

## Session Metadata
- Created: 2026-05-23 02:03:34
- Project: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feature-aoe-tmux-integration-harness`
- Branch: `feature/aoe-tmux-integration-harness`
- Session duration: Multi-turn implementation and validation session across the fake-shell harness, real Pi harness, manual inspection, cleanup, and refactor planning.

### Recent Commits
- `7a45a33 test: add real Pi AoE integration harness`
- `c24eb57 test: add AoE tmux integration harness`
- `813b5e3 feat(hooks): auto-register Claude and Pi agent sessions with daemon`

## Handoff Chain

- **Continues from**: None. This is a standalone handoff for the AoE/tmux + Pi integration harness exercise.
- **Supersedes**: None.

## Current State Summary

The AoE/tmux integration harness work is implemented and pushed on `feature/aoe-tmux-integration-harness`. The branch contains the deterministic shell/CLI smoke and the real interactive Pi MCP smoke. The real Pi smoke provisions an isolated per-worktree Pi environment, launches Pi through AoE/tmux, validates extension auto-registration, prompts Pi to discover peers through MCP tools, sends a DM, and verifies REST plus transcript evidence. All live AoE/tmux sessions and `.synchronize-itest/` runtime state were cleaned after manual inspection. The only uncommitted file at handoff creation is this handoff document.

## Codebase Understanding

## Architecture Overview

`synchronize` is a local-first coordination bus for coding agents. It has a REST daemon, CLI, MCP adapter, durable SQLite state, peer identity, agent-session bindings, groups, inboxes, media, and notification paths.

The integration harness direction established in this session:

- `tmux` is the substrate where agent sessions live.
- AoE is the cockpit for navigating and inspecting those tmux-backed sessions.
- Raw tmux/libtmux is the automation layer for tests.
- `synchronize` is the identity, messaging, and workflow control plane.
- `peer_id` is canonical identity. Native host session ids and AoE/tmux ids are runtime bindings/metadata, not stable identity keys.

The branch now has two manual integration paths:

- `scripts/integration_tmux.py`: deterministic AoE shell-session smoke that drives the `synchronize` CLI through tmux panes.
- `scripts/integration_pi.py`: real interactive Pi agent smoke that drives Pi through AoE/tmux and requires MCP tool usage.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `scripts/integration_tmux.py` | AoE/tmux shell harness | Launches shell panes, registers CLI peers, sends DM, checks REST state. Good deterministic baseline. |
| `scripts/integration_pi.py` | Real Pi AoE/tmux harness | Provisions isolated Pi config, launches real Pi sessions, verifies MCP DM flow. |
| `scripts/README.md` | Future-agent integration notes | Documents how to build future complex workflows and the Pi prompt discipline. |
| `docs/integration-tmux.md` | User-facing harness docs | Describes shell and real Pi harness usage, flags, diagnostics, and isolation. |
| `.gitignore` | Ignore runtime state | Adds `.synchronize-itest/` so per-worktree harness state stays untracked. |
| `extensions/pi-synchronize/src/index.ts` | Pi session lifecycle extension | Auto-registers Pi peers, registers native host session binding, subscribes for inbound events, exports `SYNCHRONIZE_PEER_ID`. |
| `skills/synchronize-pi/SKILL.md` | Pi behavior instructions | Teaches Pi how to use MCP tools, handle injected events, and avoid CLI fallback. |
| `bin/synchronize-mcp` | MCP stdio server entrypoint | Used by isolated Pi MCP config in `integration_pi.py`. |

### Key Patterns Discovered

- Pi can run from a temporary `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`.
- Copying only `~/.pi/agent/auth.json` into the temp Pi home is enough for the local `openai-codex` OAuth subscription. Token refreshes write to the copied temp file, not the real one.
- Real Pi sessions must be treated as nondeterministic/manual-local integration tests. They should not be part of `bun test` or CI.
- Pi interactive TUI under tmux does not reliably submit prompts with `C-m`; use named `Enter`:

  ```bash
  tmux send-keys -t "$PANE" Enter
  ```

- For real-agent scenarios, prompts should not spoon-feed peer ids unless explicitly testing low-level identity. The successful DM smoke asks Pi to call `bridge_whoami`, then `bridge_list_peers`, then send `bridge_dm` to the other live Pi peer.
- Harness REST assertions may use peer ids, but agent prompts should remain high-level and tool-driven.
- AoE/tmux pane mapping should prefer current AoE session id prefixes, not just titles, because kept sessions from older runs can share titles.

## Work Completed

### Tasks Finished

- Created and closed Beads epic `sync-dfm` for the fake-shell AoE/tmux integration harness.
- Created and closed Beads epic `sync-an6` with children:
  - `sync-an6.1`: isolated per-worktree Pi test environment
  - `sync-an6.2`: AoE/tmux launch and mapping for real Pi sessions
  - `sync-an6.3`: Pi auto-registration and MCP DM smoke
  - `sync-an6.4`: documentation
- Created open Beads task `sync-yzv` for future modularization of integration harness support code.
- Installed AoE locally via Homebrew during the earlier harness work. Current AoE version observed: `1.7.1`.
- Implemented `scripts/integration_tmux.py`.
- Implemented `scripts/integration_pi.py`.
- Added `scripts/README.md`.
- Updated `docs/integration-tmux.md`.
- Added `.synchronize-itest/` to `.gitignore`.
- Verified and pushed the branch to GitHub.

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `.gitignore` | Added `.synchronize-itest/` | Keep per-worktree harness runtime state untracked. |
| `docs/integration-tmux.md` | Added real Pi smoke documentation | Explain requirements, isolation, flags, and manual-local caveats. |
| `scripts/README.md` | New integration workflow guide | Guide future agents adding complex workflows. |
| `scripts/integration_pi.py` | New real Pi harness | Launch and validate real Pi MCP DM through AoE/tmux. |
| `scripts/integration_tmux.py` | Existing fake-shell harness from earlier commit | Deterministic CLI smoke baseline. |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Use AoE interactive Pi, not `pi -p`, for real harness | Interactive, print mode, hybrid | The target architecture is live inspectable agents in tmux/AoE. |
| Keep real Pi harness manual/local | Manual, env-gated test, CI candidate | It uses real model/OAuth behavior and is nondeterministic. |
| Use temp Pi config with copied auth | Real config, temp config copied auth, env keys only | Avoids production config mutation while reusing working OAuth. |
| Load MCP/skill/extension from current worktree | Global Pi config, copied config, explicit worktree paths | Enables independent parallel worktrees with different code. |
| Use high-level prompts for Pi | Give peer ids directly, make Pi discover via tools | The auto-register flow expects Pi to be self-aware via MCP/hooks. |
| Encode named `Enter` for Pi submission | `C-m`, named `Enter` | Manual smoke proved `C-m` does not submit reliably in Pi TUI under tmux. |
| Defer harness modularization | Refactor immediately, issue first | User asked to document refactor pass only and stop. |

## Pending Work

## Immediate Next Steps

1. If continuing implementation, pick up open Beads issue `sync-yzv` and modularize the integration harness into reusable Python modules.
2. Before adding group/media/inbound workflows, refactor shared AoE/tmux/runtime/Pi environment code out of the monolithic scripts.
3. After any API/CLI/MCP refactor branch merges, rerun both integration harnesses because they depend on `bin/synchronize-mcp`, `bun run src/cli.ts status`, and REST endpoint shapes.

### Blockers/Open Questions

- `bd dolt push` hung during this session inside the underlying Git push. Code was pushed to GitHub, but Beads remote sync may still need attention.
- There are other active worktrees with potential merge conflicts, especially `.gitignore` and large API/CLI/MCP refactor branches.
- `sync-yzv` is open and intentionally not implemented.

### Deferred Items

- Modularize integration harness support code (`sync-yzv`).
- Add real Pi group workflow scenarios.
- Add inbound Pi push workflow validation.
- Add media share workflow validation.
- Add blocked-agent or needs-input workflow scenarios.
- Add stronger cleanup/diagnostics around Beads Dolt remote sync.

## Context for Resuming Agent

## Important Context

The branch is already pushed and clean except for this handoff file. Do not restart from scratch. The current good commit is:

```bash
7a45a33 test: add real Pi AoE integration harness
```

The main worktree path is:

```bash
/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feature-aoe-tmux-integration-harness
```

The real Pi harness has been tested with:

```bash
uv run scripts/integration_pi.py --command-timeout 240 --registration-timeout 120 --mcp-timeout 120 --start-timeout 120
uv run scripts/integration_pi.py --keep --command-timeout 240 --registration-timeout 120 --mcp-timeout 120 --start-timeout 120
```

The final kept run was inspected by the user and then cleaned. No AoE/tmux harness sessions should be running now.

The final prompt shape in `integration_pi.py` intentionally does not pass a recipient peer id to Pi. It asks Pi to use MCP tools to inspect itself and discover the other peer. Do not regress this into direct peer-id prompting.

## Assumptions Made

- User’s machine has working `pi`, `aoe`, `tmux`, `bun`, and `uv`.
- User’s real Pi OAuth credentials live in `~/.pi/agent/auth.json`.
- Copying `auth.json` into temp Pi home is acceptable and safe.
- Real Pi harness remains manual/local and outside normal `bun test`.
- AoE profile/session naming can be run-id based.
- `peer_id` remains canonical identity; session titles are display/runtime hints.

## Potential Gotchas

- `C-m` does not submit Pi prompts under tmux; named `Enter` is required.
- Pi extension may display native names like `pi-<session-id>` despite `SYNCHRONIZE_SESSION_NAME`; harness must map panes to agent-session bindings by host session id in pane output and REST, not rely only on names.
- Kept AoE sessions from older runs can confuse title-based pane discovery. Prefer AoE session id prefix matching.
- The real Pi harness installs `pi-mcp-adapter` into the temporary Pi home on first run and may take extra time.
- `MCP: 0/1` can appear briefly; harness waits for at least one pane to become MCP-ready before prompting.
- `bd dolt push` has previously hung or failed due remote auth/transport issues. Do not assume Beads remote sync succeeded unless verified.
- Other worktrees may touch `.gitignore`; merge conflict is possible but small.

## Environment State

### Tools/Services Used

- `bd` for Beads issue tracking.
- `git worktree` for isolated branch work.
- `aoe` 1.7.1 for session cockpit.
- `tmux` and `libtmux` for automation/capture.
- `uv` for Python script dependencies.
- `bun` for TypeScript tests, daemon, CLI, and MCP entrypoints.
- `pi` 0.75.3 for real Pi agent harness.

### Active Processes

- No known active AoE/tmux harness sessions remain after cleanup.
- No long-running integration daemon is expected; `.synchronize-itest/` was removed after final inspection.

### Environment Variables

Relevant names only:

- `SYNCHRONIZE_HOME`
- `SYNCHRONIZE_PORT`
- `SYNCHRONIZE_MCP_MODE`
- `SYNCHRONIZE_SESSION_NAME`
- `SYNCHRONIZE_PEER_ID`
- `SYNCHRONIZE_PI_DEBUG`
- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`
- `PATH`

## Related Resources

- `scripts/integration_tmux.py`
- `scripts/integration_pi.py`
- `scripts/README.md`
- `docs/integration-tmux.md`
- `extensions/pi-synchronize/README.md`
- `skills/synchronize-pi/SKILL.md`
- Beads issue `sync-an6`
- Beads issue `sync-yzv`

---

**Security Reminder**: This handoff intentionally mentions `auth.json` path and environment variable names only. It does not contain token values or credential contents.
