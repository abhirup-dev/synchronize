# Handoff: Multi-machine AOE/VPS/Claude Support

## Session Metadata

- Created: 2026-06-06 12:34:13
- Project: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/multi-machine-support`
- Branch: `codex/multi-machine-support`
- Session duration: multi-turn implementation and verification session

### Recent Commits

- `47c7a05` Record Claude event-stream push plan
- `920fdc1` Document cross-machine harness pain points
- `f56d30d` Make AOE harness cross-machine compliant
- `330c893` Add Mac-hosted remote daemon setup
- `45a1fdf` Record multi-machine v0 decisions
- `c40edce` Add remote daemon client override

## Handoff Chain

- Continues from: `2026-05-31-104015-claude-launch-lifecycle-stress-test.md`
- Supersedes: none

## Current State Summary

The `codex/multi-machine-support` worktree now has a working v0 for Mac-hosted
daemon plus VPS-launched AOE harness sessions. CLI and Pi AOE integration suites
can run on the VPS against a Mac daemon over Tailscale. Claude AOE spawn on the
VPS works, Claude MCP can send DMs through the Mac daemon, and Claude can read
the durable inbox, but cross-machine Claude live push is not implemented yet.
The next design step is tracked and documented: extend the existing
`GET /events/:peer_id` route with `Accept: text/event-stream` and have Claude
MCP use that outbound stream for local and remote live delivery.

## Codebase Understanding

## Architecture Overview

- One Bun daemon owns SQLite state and MediaStore under `SYNCHRONIZE_HOME`.
- CLI and MCP clients use `src/client.ts` to discover/connect to the daemon.
- `SYNCHRONIZE_REMOTE_URL` now makes clients use an existing remote daemon and
  fail loudly instead of silently starting a local daemon.
- Remote daemon auth uses `SYNCHRONIZE_TOKEN` HTTP auth.
- AOE harnesses run real tmux-backed agent sessions and assert through REST.
- Pi remote delivery now works via client-side polling.
- Claude local push currently uses daemon-to-client callback URLs. That breaks
  across machines because the callback server is bound to the VPS loopback
  address, which the Mac daemon cannot reach.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `docs/plans/multi-machine-support.md` | Main plan, current state, pain points, SSE architecture diagrams | Read first when resuming |
| `src/client.ts` | Daemon discovery and remote URL override | Core local vs remote client behavior |
| `src/constants.ts` | Env var names including health timeout | Remote env contract |
| `src/mcp/claude-subscription.ts` | Current Claude callback subscription | Explains live push failure across machines |
| `src/mcp/tools/register.ts` | MCP peer registration and subscription activation | Where future stream subscription should plug in |
| `src/mcp/tools/messaging.ts` | `bridge_dm` and `bridge_inbox` | DM send and durable fallback |
| `extensions/pi-synchronize/src/client.ts` | Pi remote daemon discovery | Pi remote behavior |
| `extensions/pi-synchronize/src/subscription.ts` | Pi remote event polling | Existing remote-delivery model |
| `scripts/integration-aoe/sync_itest_aoe/runtime.py` | Harness remote daemon config/env | Shared remote harness plumbing |
| `scripts/integration-aoe/sync_itest_aoe/sync_rest.py` | Harness REST client | Remote base URL and token auth |
| `scripts/integration-aoe/sync_itest_aoe/pi_env.py` | Isolated Pi MCP/session env | Remote env propagation for Pi |
| `scripts/integration-aoe/sync_itest_aoe/scenarios/*.py` | AOE integration scenarios | CLI and Pi cross-machine harnesses |

### Key Patterns Discovered

- Remote mode must never fall back to starting a local daemon.
- Remote harness env must clear inherited stale remote vars in local mode.
- The inbox table is the source of truth; live delivery is only transport.
- `event_id` is the right cursor for replay and reconnect.
- AOE/tmux cleanup must be explicit; failed runs can leave orphan sessions.
- Pi binding selection must filter by repo, host tool, registration timestamp,
  and nested peer session name to avoid stale session reuse.

## Work Completed

### Tasks Finished

- Found and used the existing multi-machine plan worktree.
- Implemented `SYNCHRONIZE_REMOTE_URL` client override and token support.
- Added remote health timeout through `SYNCHRONIZE_HEALTH_TIMEOUT_MS`.
- Made AOE CLI harnesses remote-daemon aware.
- Made AOE Pi harnesses remote-daemon aware.
- Added Pi remote daemon discovery and event polling.
- Fixed Pi binding mapping to avoid stale cross-run bindings.
- Added unit tests for remote env, REST auth, Pi env redaction, Pi mapping,
  Pi remote discovery/polling, and remote health timeout.
- Ran local tests: `bun test`, `bun run typecheck`, Pi extension tests, and AOE
  Python unit tests.
- Installed/verified remote VPS prerequisites for the run: `aoe`, `pi`, `uv`,
  `claude`, `bun`, and `tmux`.
- Synced the worktree to `/tmp/synchronize-mm-client` on the VPS.
- Ran full remote AOE suites on the VPS against a Mac-hosted daemon:
  CLI DM, CLI group policy, Pi MCP DM, Pi group policy, Pi thread baton, and Pi
  peer revival.
- Manually verified Claude AOE spawn on the VPS.
- Manually verified Claude AOE DM send and durable inbox read against the Mac
  daemon.
- Documented current manual setup, pain points, and future CLI/Makefile surface.
- Documented unified SSE stream plan with ASCII diagrams.
- Created follow-up Beads issues:
  - `sync-nxyp`: remote sync command for VPS client runtime.
  - `sync-ba7h`: Claude cross-machine push via unified event stream.

## Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `docs/plans/multi-machine-support.md` | Current state, pain points, CLI surface notes, SSE diagrams | Durable design record |
| `scripts/README.md` | Remote harness invocation docs | Operator guidance |
| `src/client.ts` | Remote daemon health/discovery behavior | Cross-machine clients |
| `src/constants.ts` | Health timeout env var | Tailnet health checks |
| `tests/health.test.ts` | Remote health timeout coverage | Regression protection |
| `extensions/pi-synchronize/src/client.ts` | Remote daemon discovery | Pi remote support |
| `extensions/pi-synchronize/src/subscription.ts` | Remote event polling | Pi cross-machine delivery |
| `extensions/pi-synchronize/tests/*.test.ts` | Pi remote tests | Regression protection |
| `scripts/integration-aoe/sync_itest_aoe/*.py` | Remote daemon harness support | VPS AOE tests |
| `scripts/integration-aoe/tests/*.py` | Harness unit tests | Regression protection |
| `.claude/handoffs/2026-06-06-123413-multi-machine-support-aoe-vps-claude.md` | This handoff | Resume context |

## Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Mac hosts daemon for v0 | Mac vs VPS daemon | User wants active workstation stability; no always-on requirement yet |
| Shared token for v0 | Per-machine credentials vs one token | Simpler v0 on trusted Tailscale network |
| Remote sessions share Mac runtime state | Machine grouping vs same daemon state | UI should mostly be indistinguishable for v0 |
| Pi remote delivery uses polling | Callback vs polling | Outbound client calls work cross-machine now |
| Claude push should use unified SSE on `/events/:peer_id` | New endpoint vs existing route; tailnet callback vs SSE | Existing route preserves domain model; outbound stream avoids daemon-to-client reachability |
| Keep Claude callback during rollout | Immediate replacement vs staged migration | Reduces risk to stable local behavior |

## Pending Work

## Immediate Next Steps

1. Implement `sync-ba7h`: add `Accept: text/event-stream` mode to
   `GET /events/:peer_id`, then add Claude MCP `EventStreamSubscription`.
2. Implement `sync-nxyp`: one Mac-triggered command to install/update remote
   tools, sync runtime, write env/MCP config, verify the VPS, and print harness
   commands.
3. Add a first-class Claude AOE harness scenario once stream push exists, with
   sender and recipient Claude sessions proving live DM notification without
   `bridge_inbox` polling.

### Blockers/Open Questions

- Exact stream subscriber data structure in the daemon needs design:
  callback subscribers can remain legacy while stream subscribers become the
  long-term path.
- `delivered_at` semantics for SSE should be defined carefully: write accepted
  by stream is delivery, explicit inbox read remains `read_at`.
- Backpressure and slow-client behavior need bounded handling.
- Decide the env flag name for forcing Claude stream mode during rollout.

### Deferred Items

- Web UI token-entry UX for remote browsers.
- Machine icon/identifier in UI for remote vs local agents.
- Removing the old Claude callback path after stream burn-in.
- Always-on VPS daemon mode.

## Context for Resuming Agent

## Important Context

The latest architecture decision is that cross-machine Claude live push should
not use daemon-to-client tailnet callbacks. Use client-initiated SSE on the
existing `GET /events/:peer_id` route via `Accept: text/event-stream`. Local and
remote Claude should converge on the same transport; the only local/remote
difference should be daemon discovery (`daemon.json` vs `SYNCHRONIZE_REMOTE_URL`).

The manual Claude demo proved:

- AOE can spawn Claude on the VPS.
- Claude MCP can register sender and recipient peers into the Mac daemon.
- Sender Claude can call `bridge_dm`.
- Recipient Claude can read the durable inbox through `bridge_inbox`.
- Current Claude live push fails across machines because the VPS callback URL is
  `127.0.0.1:<port>` and the Mac daemon cannot reach that loopback address.

Do not treat inbox success as push parity. The missing feature is live channel
notification delivered to remote Claude without polling or manual inbox reads.

## Assumptions Made

- Tailscale remains the v0 network boundary.
- One shared `SYNCHRONIZE_TOKEN` value is acceptable for v0.
- The Mac daemon remains the central runtime owner for v0.
- Remote machines are thin executor/client machines, not federated daemons.

## Potential Gotchas

- Non-interactive SSH on the VPS does not include `~/.local/bin` by default.
- AOE can leave orphan tmux sessions if a run is interrupted.
- AOE refuses to delete the last/default profile.
- Remote mode must not set `SYNCHRONIZE_PORT=0`; that would imply local daemon
  ownership.
- Do not log or commit real throwaway tokens.
- `claude -p` can prove MCP tool paths, but it exits after the turn; live push
  needs an interactive or long-lived Claude session.
- Current callback registration accepts only localhost URLs by design.

## Environment State

### Tools/Services Used

- Local Mac worktree: `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/multi-machine-support`
- VPS SSH host: `vpsme`
- VPS repo copy during tests: `/tmp/synchronize-mm-client`
- Mac tailnet IP used in tests: `100.126.163.80`
- VPS tailnet IP observed: `100.96.245.110`
- VPS tools verified: `aoe 1.10.1`, `claude 2.1.158`, `tmux 3.4`, `pi 0.75.3`, `uv`, `bun`

### Active Processes

- No test daemon should be running.
- No `sync-claude-dm`, `sync-pi`, or AOE test tmux sessions should remain.
- VPS had unrelated `lettabot` and `litellm` tmux sessions; do not kill them.

### Environment Variables

Relevant names only:

- `SYNCHRONIZE_HOME`
- `SYNCHRONIZE_BIND`
- `SYNCHRONIZE_PORT`
- `SYNCHRONIZE_TOKEN`
- `SYNCHRONIZE_REMOTE_URL`
- `SYNCHRONIZE_HEALTH_TIMEOUT_MS`
- `SYNCHRONIZE_MCP_MODE`
- `SYNCHRONIZE_PEER_ID`
- `SYNCHRONIZE_LAUNCH_ID`
- `PI_CODING_AGENT_DIR`
- `PI_CODING_AGENT_SESSION_DIR`

## Related Resources

- `docs/plans/multi-machine-support.md`
- `scripts/README.md`
- `docs/agents/issue-tracker.md`
- Beads issue `sync-ba7h`
- Beads issue `sync-nxyp`
- Prior handoff: `.claude/handoffs/2026-05-31-104015-claude-launch-lifecycle-stress-test.md`

## Verification Already Completed

Local:

- `bun test`
- `bun run typecheck`
- `bun test extensions/pi-synchronize/tests`
- `PYTHONPATH=scripts/integration-aoe python3 -m unittest discover scripts/integration-aoe/tests`

VPS against Mac daemon:

- CLI DM harness passed.
- CLI group policy harness passed.
- Pi MCP DM harness passed.
- Pi group policy harness passed.
- Pi thread baton harness passed.
- Pi peer revival harness passed.
- Claude AOE spawn succeeded.
- Claude AOE DM send succeeded.
- Claude durable inbox read succeeded.

## Cleanup Notes

- Mac throwaway daemon homes used during tests were removed after runs.
- VPS temporary runner files for Claude DM were removed.
- VPS test tmux state was checked after cleanup; only unrelated sessions should
  remain.
- One empty/default AOE profile may remain because AOE requires at least one
  profile.
