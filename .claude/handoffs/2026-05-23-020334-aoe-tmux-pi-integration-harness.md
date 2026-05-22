# Handoff: AoE/tmux and Real Pi Integration Harness

## Session Metadata
- Created: 2026-05-23 02:03:34
- Project: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feature-aoe-tmux-integration-harness`
- Branch: `feature/aoe-tmux-integration-harness`
- Session duration: Multi-turn implementation and validation session across the fake-shell harness, real Pi harness, manual inspection, cleanup, and refactor planning.

### Recent Commits
- `8602b15 fix: tolerate bridge dm peer id alias`
- `393220c refactor: modularize AoE integration harness`
- `8ef35b4 docs(handoff): AoE tmux Pi integration harness`
- `7a45a33 test: add real Pi AoE integration harness`
- `c24eb57 test: add AoE tmux integration harness`

## Handoff Chain

- **Continues from**: None. This is a standalone handoff for the AoE/tmux + Pi integration harness exercise.
- **Supersedes**: None.

## Current State Summary

The AoE/tmux integration harness work is implemented, modularized, verified, committed, and pushed on `feature/aoe-tmux-integration-harness`. The branch contains stable wrapper commands for the deterministic shell/CLI smoke and the real interactive Pi MCP smoke. Shared AoE/tmux/runtime/REST/Pi provisioning support now lives under `scripts/integration-aoe/sync_itest_aoe`, with workflow-specific scenarios under `scripts/integration-aoe/sync_itest_aoe/scenarios`.

The real Pi smoke provisions an isolated per-worktree Pi environment, launches Pi through AoE/tmux, validates extension auto-registration, prompts Pi to discover peers through MCP tools, sends a DM, and verifies REST plus transcript evidence. The latest kept runs were used for manual inspection and debugging. Their AoE profiles were removed on 2026-05-23, but `.synchronize-itest/runs/20260522T205206Z` and `.synchronize-itest/runs/20260522T205537Z` still exist locally and should be removed before merging if no longer needed.

The branch also includes a small MCP compatibility fix: `bridge_dm` now accepts `peer_id` as an alias for `recipient_peer_id`. This addresses a repeated real Pi behavior where the agent naturally used `peer_id` on the first DM attempt and hit an MCP validation error before retrying with the canonical field.

## Codebase Understanding

## Architecture Overview

`synchronize` is a local-first coordination bus for coding agents. It has a REST daemon, CLI, MCP adapter, durable SQLite state, peer identity, agent-session bindings, groups, inboxes, media, and notification paths.

The integration harness direction established in this session:

- `tmux` is the substrate where agent sessions live.
- AoE is the cockpit for navigating and inspecting those tmux-backed sessions.
- Raw tmux/libtmux is the automation layer for tests.
- `synchronize` is the identity, messaging, and workflow control plane.
- `peer_id` is canonical identity. Native host session ids and AoE/tmux ids are runtime bindings/metadata, not stable identity keys.

The branch now has two public integration entrypoints:

- `scripts/integration_tmux.py`: stable wrapper for the deterministic AoE shell-session smoke that drives the `synchronize` CLI through tmux panes.
- `scripts/integration_pi.py`: stable wrapper for the real interactive Pi agent smoke that drives Pi through AoE/tmux and requires MCP tool usage.

The reusable integration package is:

- `scripts/integration-aoe/sync_itest_aoe/runtime.py`: run ids, command execution, artifact writing, env setup, JSON parsing, daemon cleanup.
- `scripts/integration-aoe/sync_itest_aoe/aoe.py`: AoE profile/session lifecycle and diagnostics.
- `scripts/integration-aoe/sync_itest_aoe/tmux.py`: libtmux checks, pane discovery/mapping/capture, shell command submission, Pi prompt submission with named `Enter`.
- `scripts/integration-aoe/sync_itest_aoe/sync_rest.py`: REST discovery and helpers for status, peers, events, inbox, and agent sessions.
- `scripts/integration-aoe/sync_itest_aoe/pi_env.py`: isolated Pi home/session provisioning, copied auth, MCP config, Pi command building, transcript reads.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/cli_dm.py`: fake shell CLI DM smoke workflow.
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py`: real Pi MCP DM workflow.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `scripts/integration_tmux.py` | Thin CLI smoke wrapper | Preserves `uv run scripts/integration_tmux.py` while delegating to `scripts/integration-aoe/sync_itest_aoe/scenarios/cli_dm.py`. |
| `scripts/integration_pi.py` | Thin real Pi smoke wrapper | Preserves `uv run scripts/integration_pi.py` while delegating to `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py`. |
| `scripts/integration-aoe/sync_itest_aoe/` | Reusable integration package | Shared AoE, tmux, runtime, REST, Pi environment, and scenario modules for future workflow tests. |
| `scripts/README.md` | Future-agent integration notes | Documents how to build future complex workflows and the Pi prompt discipline. |
| `docs/integration-tmux.md` | User-facing harness docs | Describes shell and real Pi harness usage, flags, diagnostics, and isolation. |
| `.gitignore` | Ignore runtime state | Adds `.synchronize-itest/` so per-worktree harness state stays untracked. |
| `extensions/pi-synchronize/src/index.ts` | Pi session lifecycle extension | Auto-registers Pi peers, registers native host session binding, subscribes for inbound events, exports `SYNCHRONIZE_PEER_ID`. |
| `skills/synchronize-pi/SKILL.md` | Pi behavior instructions | Teaches Pi how to use MCP tools, handle injected events, and avoid CLI fallback. |
| `bin/synchronize-mcp` | MCP stdio server entrypoint | Used by isolated Pi MCP config in `integration_pi.py`. |
| `src/mcp/tools/messaging.ts` | MCP DM tool schema | `bridge_dm` accepts canonical `recipient_peer_id` and compatibility alias `peer_id`. |
| `tests/mcp-e2e.test.ts` | MCP e2e coverage | Verifies both canonical and alias DM argument shapes. |

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
- `bridge_dm` canonical argument is `recipient_peer_id`, but real Pi repeatedly tried `peer_id` first. The MCP tool now accepts `peer_id` as a compatibility alias while the prompt and skill continue teaching `recipient_peer_id`.
- Future workflow scenarios should stay thin and compose primitives from `scripts/integration-aoe/sync_itest_aoe`; do not copy lifecycle plumbing into each workflow.

## Work Completed

### Tasks Finished

- Created and closed Beads epic `sync-dfm` for the fake-shell AoE/tmux integration harness.
- Created and closed Beads epic `sync-an6` with children:
  - `sync-an6.1`: isolated per-worktree Pi test environment
  - `sync-an6.2`: AoE/tmux launch and mapping for real Pi sessions
  - `sync-an6.3`: Pi auto-registration and MCP DM smoke
  - `sync-an6.4`: documentation
- Created and closed Beads task `sync-yzv` for modularization of integration harness support code.
- Created and closed Beads bug `sync-3kg` for accepting `peer_id` as a `bridge_dm` compatibility alias.
- Installed AoE locally via Homebrew during the earlier harness work. Current AoE version observed: `1.7.1`.
- Implemented `scripts/integration_tmux.py` and later reduced it to a thin wrapper.
- Implemented `scripts/integration_pi.py` and later reduced it to a thin wrapper.
- Added reusable AoE integration support modules under `scripts/integration-aoe/sync_itest_aoe`.
- Added scenario modules `scripts/integration-aoe/sync_itest_aoe/scenarios/cli_dm.py` and `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py`.
- Updated `bridge_dm` to accept `peer_id` as an alias for `recipient_peer_id`.
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
| `scripts/integration_pi.py` | Thin wrapper | Keeps public real Pi command stable while importing the scenario module. |
| `scripts/integration_tmux.py` | Thin wrapper | Keeps public fake-shell command stable while importing the scenario module. |
| `scripts/integration-aoe/sync_itest_aoe/` | New reusable package | Prevent future workflow tests from duplicating AoE/tmux/Pi/REST setup and diagnostics. |
| `src/mcp/tools/messaging.ts` | `bridge_dm` schema alias | Accepts `peer_id` alias to prevent repeated real-agent validation failures. |
| `tests/mcp-e2e.test.ts` | Alias coverage | Proves canonical and alias DM argument forms work through MCP stdio. |
| `skills/synchronize-pi/SKILL.md` | Wording tightened | Explicitly tells Pi to pass `recipient_peer_id` and `message` to `bridge_dm`. |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Use AoE interactive Pi, not `pi -p`, for real harness | Interactive, print mode, hybrid | The target architecture is live inspectable agents in tmux/AoE. |
| Keep real Pi harness manual/local | Manual, env-gated test, CI candidate | It uses real model/OAuth behavior and is nondeterministic. |
| Use temp Pi config with copied auth | Real config, temp config copied auth, env keys only | Avoids production config mutation while reusing working OAuth. |
| Load MCP/skill/extension from current worktree | Global Pi config, copied config, explicit worktree paths | Enables independent parallel worktrees with different code. |
| Use high-level prompts for Pi | Give peer ids directly, make Pi discover via tools | The auto-register flow expects Pi to be self-aware via MCP/hooks. |
| Encode named `Enter` for Pi submission | `C-m`, named `Enter` | Manual smoke proved `C-m` does not submit reliably in Pi TUI under tmux. |
| Modularize under `scripts/integration-aoe` | `scripts/integration`, `scripts/integration_harness`, `scripts/integration-aoe` | User preferred `integration-aoe` because the suite is deliberately AoE-backed. A hyphenated directory is fine because wrappers add it to `sys.path`; the importable package inside is `sync_itest_aoe`. |
| Keep wrappers stable | Rename commands, preserve wrappers | Existing commands must continue to work, so wrappers preserve `uv run scripts/integration_tmux.py` and `uv run scripts/integration_pi.py`. |
| Accept `peer_id` alias in `bridge_dm` | Prompt-only fix, schema alias, rename canonical field | Real agents naturally use `peer_id`; accepting it at the MCP boundary is a pragmatic compatibility layer while `recipient_peer_id` remains canonical. |

## Pending Work

## Immediate Next Steps

1. Remove remaining local `.synchronize-itest/` runtime directories if the user no longer needs the run artifacts.
2. Confirm no AoE/tmux harness sessions remain after cleanup.
3. Commit this updated handoff and push the branch if not already done.
4. Squash-merge `feature/aoe-tmux-integration-harness` into `master` from the main worktree, per repo policy.
5. After any API/CLI/MCP refactor branch merges, rerun both integration harnesses because they depend on `bin/synchronize-mcp`, `bun run src/cli.ts status`, and REST endpoint shapes.

### Blockers/Open Questions

- `bd dolt push` hung during this session inside the underlying Git push. Code was pushed to GitHub, but Beads remote sync may still need attention.
- There are other active worktrees with potential merge conflicts, especially `.gitignore`, `src/mcp/tools/messaging.ts`, `tests/mcp-e2e.test.ts`, and large API/CLI/MCP refactor branches.
- `bd dolt push` has repeatedly hung. Git pushes succeeded, but Beads remote sync may still need manual attention.

### Deferred Items

- Add real Pi group workflow scenarios.
- Add inbound Pi push workflow validation.
- Add media share workflow validation.
- Add blocked-agent or needs-input workflow scenarios.
- Add stronger cleanup/diagnostics around Beads Dolt remote sync.

## Context for Resuming Agent

## Important Context

The branch is already pushed. Do not restart from scratch. The current good commit before this handoff update is:

```bash
8602b15 fix: tolerate bridge dm peer id alias
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

The refactor and alias fix were verified with:

```bash
python3 -m py_compile scripts/integration_tmux.py scripts/integration_pi.py scripts/integration-aoe/sync_itest_aoe/*.py scripts/integration-aoe/sync_itest_aoe/scenarios/*.py
uv run scripts/integration_tmux.py --help
uv run scripts/integration_pi.py --help
uv run scripts/integration_tmux.py
uv run scripts/integration_pi.py --command-timeout 240 --registration-timeout 120 --mcp-timeout 120 --start-timeout 120
uv run scripts/integration_pi.py --keep --command-timeout 240 --registration-timeout 120 --mcp-timeout 120 --start-timeout 120
bun run typecheck
bun test
bun test tests/mcp-e2e.test.ts
```

The latest `--keep` run (`20260522T205537Z`) confirmed no `bridge_dm` input validation error. The first DM tool call used `recipient_peer_id` and succeeded. The prior run (`20260522T205206Z`) demonstrated the original issue: Pi first sent `{ "peer_id": "...", "message": "..." }`, which failed against the old schema, then retried with `recipient_peer_id`.

The AoE profiles for both kept runs were removed:

- `sync-pi-itest-feature-aoe-tmux-integration-harness-20260522t205206z`
- `sync-pi-itest-feature-aoe-tmux-integration-harness-20260522t205537z`

The `.synchronize-itest/` directories for those runs still exist locally until cleanup is completed.

The final prompt shape in `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py` intentionally does not pass a recipient peer id to Pi. It asks Pi to use MCP tools to inspect itself and discover the other peer. It does explicitly name the `recipient_peer_id` argument so Pi does not confuse the MCP field name with the domain concept `peer_id`.

## Assumptions Made

- User’s machine has working `pi`, `aoe`, `tmux`, `bun`, and `uv`.
- User’s real Pi OAuth credentials live in `~/.pi/agent/auth.json`.
- Copying `auth.json` into temp Pi home is acceptable and safe.
- Real Pi harness remains manual/local and outside normal `bun test`.
- AoE profile/session naming can be run-id based.
- `peer_id` remains canonical identity; session titles are display/runtime hints.
- `bridge_dm` may accept both `recipient_peer_id` and `peer_id`, but docs and prompts should keep teaching `recipient_peer_id`.

## Potential Gotchas

- `C-m` does not submit Pi prompts under tmux; named `Enter` is required.
- Pi extension may display native names like `pi-<session-id>` despite `SYNCHRONIZE_SESSION_NAME`; harness must map panes to agent-session bindings by host session id in pane output and REST, not rely only on names.
- Kept AoE sessions from older runs can confuse title-based pane discovery. Prefer AoE session id prefix matching.
- The real Pi harness installs `pi-mcp-adapter` into the temporary Pi home on first run and may take extra time.
- `MCP: 0/1` can appear briefly; harness waits for at least one pane to become MCP-ready before prompting.
- `bd dolt push` has previously hung or failed due remote auth/transport issues. Do not assume Beads remote sync succeeded unless verified.
- Other worktrees may touch `.gitignore`; merge conflict is possible but small.
- Other worktrees may also touch MCP schemas or tests. The `bridge_dm` alias is intentionally backward-compatible, but merge carefully around `src/mcp/tools/messaging.ts` and `tests/mcp-e2e.test.ts`.
- Running `python3 -m py_compile` creates `__pycache__` directories under `scripts/`; remove them before committing.

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

- AoE profiles for the kept Pi runs were deleted before this handoff update.
- `.synchronize-itest/runs/20260522T205206Z` and `.synchronize-itest/runs/20260522T205537Z` remain locally and can be deleted with `rm -rf .synchronize-itest`.
- No long-running integration daemon is expected after AoE cleanup, but check tmux/AoE once more before merge.

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
- `scripts/integration-aoe/sync_itest_aoe/runtime.py`
- `scripts/integration-aoe/sync_itest_aoe/aoe.py`
- `scripts/integration-aoe/sync_itest_aoe/tmux.py`
- `scripts/integration-aoe/sync_itest_aoe/sync_rest.py`
- `scripts/integration-aoe/sync_itest_aoe/pi_env.py`
- `scripts/integration-aoe/sync_itest_aoe/scenarios/cli_dm.py`
- `scripts/integration-aoe/sync_itest_aoe/scenarios/pi_mcp_dm.py`
- `scripts/README.md`
- `docs/integration-tmux.md`
- `extensions/pi-synchronize/README.md`
- `skills/synchronize-pi/SKILL.md`
- Beads issue `sync-an6`
- Beads issue `sync-yzv`
- Beads issue `sync-3kg`

---

**Security Reminder**: This handoff intentionally mentions `auth.json` path and environment variable names only. It does not contain token values or credential contents.
