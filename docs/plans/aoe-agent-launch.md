# AOE-backed Agent Launch (daemon-managed, group-aware)

Status: v0 plan, branch `feat/aoe-agent-launch`. Authored 2026-05-29 after a
`grill-me` design session. UI wiring is explicitly **out of scope** for v0.

## Goal

Make the synchronize daemon able to **launch persistent Claude/Pi agent
sessions on demand**, organized through Agent of Empires (AOE) as the tmux
backend. A launch can target a synchronize **group** (the agent auto-joins on
boot) or be **standalone**. Surfaces for v0: REST endpoint + CLI adapter + MCP
tool. No web UI this round.

This generalizes the existing throwaway AOE *integration-test* harness
(`scripts/integration-aoe/`) into a first-class, daemon-driven launch path. The
harness is a test *driver* (it puppets panes); the launch path needs none of
that pane-mapping/keystroke machinery — only "create + start a session."

## Key architecture decisions (from the grill)

The design tree was resolved one branch at a time. Decision record:

1. **Server-side group join at register time.** When a launched agent's
   SessionStart hook calls `POST /agent-sessions/register` with its
   `launch_id`, the daemon performs the synchronize-group join itself
   (`reconcileLaunch`). The agent is "dumb" — it wakes up already a member.
   Chosen over env-carried group binding because it also generalizes to
   re-grouping a *live* agent later (env binding is write-once).

2. **Group provenance recorded server-side; memberships mutable.** A launched
   agent can later be joined to other groups. "Launch origin" is provenance,
   not a hard primary.

3. **`whoami` stays identity-only.** Group membership is *not* added to
   `bridge_whoami`. Instead, extend `bridge_list_groups` with `mine: true`,
   returning `{ name, alias, joined_at, is_launch_group }` — a gap that exists
   regardless of this feature (no "what groups am I in" query exists today;
   `/groups` is unscoped). The `synchronize-{claude,pi}` skill instructs a
   launched agent to call it on startup to orient. `is_launch_group` carries
   the "primarily a member of" intent, demoted from identity to a queryable
   fact.

4. **Alias = launch `name`; active-name collision rejected.** Reuses the
   existing per-group alias uniqueness rule (`src/daemon.ts` join handler). On
   active collision the agent still boots and registers (it exists as a peer),
   but the auto-join records `join_failed` — session alive, unjoined. Inactive
   alias reclaim still works via the existing path. UI will pre-validate name
   uniqueness later; the backend stays authoritative.

5. **No `pending_launches` table — in-memory only.** Launch intent
   (`launch_id`/`peer_id` → `{ group, alias }`) lives in a plain in-memory map,
   dropped once the agent registers+joins. No durable state machine, no TTL
   reaper, no reconcile-across-restart. On each new launch the daemon emits a
   warning counting still-unregistered launches and points the operator at the
   AOE HUD to inspect/clear. **Conscious trade:** a daemon restart in the boot
   window (after spawn, before register) leaves that agent alive-but-unjoined;
   recovery is manual. Everything durable (peer_id, session_name, group
   membership) is persisted via the *existing* register/join paths the moment
   register completes, so post-register restarts lose nothing. `launch_id`
   stays transient per `constants.ts` ("not a durable identity").

6. **Rely on global install** (`make install-claude` / `install-pi`). The
   daemon's command-builder = `launch.ts`'s `buildCommand` + an `env` wrapper
   injecting `SYNCHRONIZE_HOME` (so the agent registers to *this* daemon),
   `SYNCHRONIZE_HOOK_ENABLE`, `SYNCHRONIZE_LAUNCH_ID`, `SYNCHRONIZE_SESSION_NAME`,
   `SYNCHRONIZE_PEER_ID`. No per-launch config synthesis (no mcp.json/auth/skill
   handling). If global install is missing, the agent never registers → the
   pending-launch warning surfaces it.

7. **Pin `peer_id` at launch; AOE title = `session_name-peerid8`.** The daemon
   mints `peer_id` up front and passes `SYNCHRONIZE_PEER_ID`. This requires a
   **backward-safe hook change**: `src/cli/commands/hook.ts` (Claude + Pi
   paths) must forward `peerId` to `registerAgentSession` when `ENV_PEER_ID` is
   set (no-op otherwise; the register endpoint already accepts `peer_id`). The
   AOE title is then derivable from the durable peer row, so `stop` needs no
   stored mapping: `aoe -p <profile> remove --force <session_name>-<peerid8>`.
   `stop` kills only the AOE/tmux session — no synchronize-side teardown (peer
   goes offline via lease expiry, like any disconnect).

8. **Launch request contract** (minimal, no field proliferation):
   ```
   POST /agent-sessions/launch
   { tool: "claude" | "pi",   // required
     name: string,            // required → session_name + AOE title stem + group alias
     repo: string,            // required → working dir (no magic default)
     group?: string,          // omit = standalone; present = auto-join target
     args?: string[] }        // tool knobs (--model / --provider / --thinking) → buildCommand `rest`
   ```
   All tool-specific knobs ride in `args[]` (reuses `launch.ts`'s `--`
   passthrough). No typed `model`/`provider` fields.

9. **Backend behind a seam.** `SessionBackend` interface; `AoeBackend` only for
   v0; vanilla-`tmux` backend is a future drop-in (`tmux -S $SYNCHRONIZE_HOME/…`).
   The daemon route must never name an `aoe` command (leak test). Backend
   selection will be config/default later — **not** a new env var.

10. **Zero new env vars; no DB migration.** Reuses the five existing
    `SYNCHRONIZE_*` vars. Durable identity/membership flow through existing
    tables. The only code touchpoints are: new REST endpoint, `AoeBackend`,
    `reconcileLaunch`, the hook `peer_id` forward, and the CLI/MCP adapters.

## AOE mechanics (empirically verified, `aoe 1.7.1`)

- Session **survives its spawner**: `aoe add ... ; aoe session start <title>`
  hands the session to AOE's daemon/tmux; the tmux server reparents to PID 1.
  A short-lived `Bun.spawn("aoe", …)` from the daemon exits immediately and the
  agent keeps running independent of the daemon (satisfies decision-7 lifecycle).
- **Use `add` then `session start`, never `--launch`.** `add --launch` tries to
  *attach* and fails headless (`open terminal failed: not a terminal`, non-zero
  exit) even though the session launched. `session start` is clean headless
  (exit 0).
- `--cmd <tool>` sets the agent type; `--cmd-override "env K=V … <tool> <args>"`
  supplies the real command + env (how the harness injects vars).
- Groups: `aoe group create <g>` (make idempotent, ignore-error) + `aoe add -g <g>`
  organizes panes in the AOE HUD. This AOE group is **cosmetic**, kept in sync
  with the functional synchronize group by name.
- Profile: one dedicated profile owned by synchronize. AOE exposes **no
  data-dir env override** (only `AGENT_OF_EMPIRES_PROFILE`), so the profile
  lives in AOE's default data dir, *not* literally inside `SYNCHRONIZE_HOME`.
  The operator's real intent ("wipe runtime → sessions gone") is delivered by
  wiring `aoe profile delete <ours>` into the runtime-wipe path
  (`make daemon-relaunch`). Re-check `aoe init` config.toml for a data-dir key
  during build; relocate literally if one exists.

## Two parallel "groups"

```
 synchronize group "alpha"  (FUNCTIONAL: group_members, alias, mine-query)
        ▲ name-matched ▼
 AOE group "alpha"          (COSMETIC: aoe group create + add -g, HUD only)
```

## Slices (spine-first; v0 = REST + CLI + MCP, no UI)

- **S-hook** — `hook.ts` forwards `ENV_PEER_ID` (Claude + Pi). Backward-safe enabler.
- **S1** — `SessionBackend` interface + `AoeBackend` (ensureProfile/ensureGroup
  idempotent; spawn = add + session start; stop = remove; list = list --json).
  Injectable spawn fn → unit-testable without `aoe`.
- **S2** — Extract shared command/env builder from `launch.ts` → `src/launch/build.ts`;
  refactor `launch.ts` to use it.
- **S3** — Launch orchestration: mint launch_id + peer_id, resolveLaunchSpec
  (ad-hoc now; config-ready seam), profile/group naming, in-memory launch map,
  pending-count warning.
- **S4** — `POST /agent-sessions/launch` + `client.launchAgent`. **Tracer:** one
  Claude into a group, end to end.
- **S5** — `reconcileLaunch` at register: server-side auto-join (`fresh=true`),
  `join_failed` handling, drop map entry.
- **S6** — `bridge_list_groups(mine: true)` + `is_launch_group` provenance.
- **S7** — Standalone launch path (no group) + Pi parity.
- **S8** — `stop` endpoint + `client.stopAgent` + wire `aoe profile delete` into
  `make daemon-relaunch`.
- **S9a** — CLI `synchronize spawn` (thin adapter over client).
- **S9b** — MCP `bridge_launch` (spawn teammate into current group; thin adapter).
- **S10** — Docs + README/AGENTS updates + skill-index entry (this file).

## Deferred to v1

Web UI button/dialog; config-driven launch profiles; vanilla-tmux backend;
durable launch reconciliation; install verification at launch time.
</content>
</invoke>
