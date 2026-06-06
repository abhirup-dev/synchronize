# Multi-machine support: sessions over LAN/Tailscale join one daemon

> Status: **Planning / feasibility — CONFIRMED.** Cross-machine reachability and
> remote peer registration proven end-to-end over Tailscale. Tracked by `sync-kp1`.

## Goal

Let Claude/Codex sessions running on **other machines** join the *same*
`synchronize` daemon, so the web UI renders sessions running on this machine and
on remote machines together. Remote machines are reachable over **Tailscale**
(a flat, authenticated overlay network — every device gets a stable `100.x` IP
and a device name like `vps` / `mtpl-7638`).

## Networking primer (plain English)

A short glossary so the rest of the plan reads clearly:

- **localhost / `127.0.0.1`** — the "only this computer" address. A daemon bound
  to localhost can *only* be reached by programs on the same machine. This is the
  current default, and it's why remote sessions can't see it today.
- **LAN bind / a "real" IP** — binding the daemon to an address other than
  localhost (e.g. its Tailscale IP) makes it reachable by *other* machines.
- **Tailscale** — a tool that builds a small private network ("**tailnet**") across
  all your devices, wherever they physically are. Each device gets a stable
  address in the `100.x.x.x` range and a friendly name (`vps`, `mtpl-7638`). To
  software it looks like all your devices are on one safe LAN, even across the
  internet. Traffic is encrypted and only your devices can join — so the network
  itself is the first layer of access control. *(It needs to be running on each
  machine: `sudo tailscale up`.)*
- **Port** — a numbered "door" on a machine (we use `58410` here). An address +
  port (`100.96.245.110:58410`) is the full coordinate a client connects to.
- **Bearer token** — a shared secret string sent on every request
  (`Authorization: Bearer …`). We require it whenever the daemon isn't on
  localhost, as a second lock on top of Tailscale. Wrong/missing token → `401`.
- **Push vs. poll** — two ways a session learns about a new message:
  - *Push*: the daemon actively sends the event to the client. Fast, but the
    daemon has to be able to *reach* the client — which breaks across machines
    today (see finding 4).
  - *Poll*: the client periodically asks the daemon "anything new?". Slightly
    less instant, but the client only makes *outbound* calls, which always work
    across a tailnet. This is why codex-mode already works remotely.
- **SSE (Server-Sent Events)** — a long-lived connection the *client* opens to the
  daemon, which the daemon keeps feeding events down. It's "push-like speed" but
  with "poll-like direction" (outbound from the client), so it's the
  network-friendly way to get live updates across machines. This is what Phase 2
  recommends and what the web UI already uses.

## Topology decision (drives everything else)

One daemon is **central**; all other machines are **clients** that point at it
over the tailnet.

**v0 decision: the Mac hosts the daemon.** The Mac is the active workstation and
the current goal is cross-machine support while the operator is actively using
it, not an always-on deployment. The Mac daemon's `SYNCHRONIZE_HOME` remains the
single runtime state owner; remote sessions register into that state over the
tailnet. The VPS is a remote client/executor target for v0, not the central
daemon host.

Clients open *outbound* connections to the daemon — which is what makes the
design NAT/sleep-friendly. A future always-on mode can move the same daemon
contract to the VPS, but that is not required for the first cross-machine cut.

We are **not** federating multiple daemons in v0 (no gossip/replication between
daemons). Single durable owner, many thin clients — the existing model, stretched
across the tailnet.

## Feasibility verdict

**Feasible now for the core goal.** The LAN-bind plumbing already exists and the
data model already records which machine each peer is on. Split into two tiers:

- **MVP-now** — bind the Mac daemon to its tailnet IP + shared token, use
  `SYNCHRONIZE_REMOTE_URL` on remote clients, and verify remote peer/session
  registration into the Mac-owned runtime state. Remote **codex** sessions work
  fully (their notifier already polls outbound). Remote **claude** sessions
  *degrade gracefully* until Phase 2: durable inbox fallback remains available.
- **Push parity (follow-up, chosen design)** — restore live push notifications
  for remote claude-mode sessions by using a client-initiated SSE/long-poll pipe
  to the daemon. This is more work than daemon-to-client callbacks, but it
  unlocks the cleaner remote/session model.

## Empirical evidence (gathered this session)

Groundwork completed:

- SSH to the VPS works (`ssh vpsme`, user `abhirup`, Ubuntu 24.04, x86_64).
- Claude Code installed/updated on the VPS → **2.1.158** at `~/.local/bin/claude`,
  added to PATH in `~/.zshrc`/`~/.bashrc`/`~/.profile`.
- VPS and Mac are on the **same tailnet** (`sunnydas.das460@`): `vps` =
  `100.96.245.110`, `mtpl-7638` = `100.126.163.80`.
- `synchronize` rsynced to `vps:~/synchronize`, `bun install` clean (bun 1.3.10).
- **Daemon bound to a tailnet IP works:** prior proof used the VPS as the host,
  started with
  `SYNCHRONIZE_BIND=100.96.245.110 SYNCHRONIZE_PORT=58410 SYNCHRONIZE_TOKEN=…`
  - `GET /health` → 200 (reachable on the tailnet IP, not just localhost)
  - `GET /status` → `host: 100.96.245.110`, `machine: "vps"`, `token_required: true`
  - `GET /status` **without** token → **401** (auth enforced on LAN bind)

**Cross-machine gate — PASSED (from the Mac, over the tailnet):**

- `GET http://100.96.245.110:58410/health` → **200 in ~128ms**
- `GET /status` without token → **401** (auth enforced across the network)
- `POST /peers/register` with `machine_id: "mtpl-7638"` → **201**; the peer then
  appears in the VPS daemon's `/peers` list tagged `machine_id: mtpl-7638`.

That last step is the core goal in miniature: a session on one machine joined the
daemon on another and is distinguishable by machine. The throwaway VPS test
daemon and `/tmp/sync-test` home were torn down after. For v0, repeat the same
gate in the opposite direction: Mac hosts the daemon, VPS registers as the remote
client/session.

## Current architecture — the constraints that matter

1. **Discovery is local-only.** `ensureDaemon()` (`src/client.ts:41`) reads
   `~/.synchronize/daemon.json` and auto-starts a *local* daemon if none is
   healthy. There is **no** way to point a client at a remote daemon URL. A
   remote client today silently spins up its own isolated daemon.
2. **LAN bind already supported.** `assertLanModeIsProtected` (`daemon.ts:217`)
   permits non-localhost binds when `SYNCHRONIZE_TOKEN` is set; `requireAuth`
   (`daemon.ts:224`) enforces the bearer token. ✅ proven above.
3. **`machine_id` is already in the data model.** `peers.machine_id` is
   `NOT NULL` (`db.ts:41`), set on every registration, defaulting to
   `os.hostname()` (`daemon.ts:439,570`). It flows into peer rows and `/web/state`.
   The web UI does **not** need to group by it for v0; a small machine indicator
   can come later.
4. **Claude push notifications are localhost-bound.** `EventSubscription`
   (`mcp/claude-subscription.ts`) starts a callback server on `127.0.0.1` on the
   *client*, and the daemon POSTs events to it. `requireLocalCallbackUrl`
   (`daemon.ts:1370`) rejects any non-localhost callback. Across machines this is
   unreachable — the source of the "push parity" follow-up.
5. **Codex notifier already polls outbound** (`mcp/codex-notifier.ts`) — works
   across the tailnet unchanged.
6. **Web UI auth works over the network.** `DaemonDataSource` sends the bearer
   token on every request, **including the SSE** (it uses streaming `fetch`, not
   `EventSource`, so header auth is fine — `web/src/data/daemon.ts:551`). The
   token is read from `localStorage`/`sessionStorage` `SYNCHRONIZE_TOKEN`
   (`App.tsx:45`). Gap: no UX to *enter* the token; today it must be set manually.
7. **Media is REST-served** — remote clients fetch/share over HTTP, no change.

## Required changes

### Phase 1 — MVP (sessions from both machines render in one UI)

1. **Remote-URL override for clients.** Add `SYNCHRONIZE_REMOTE_URL` (or
   `SYNCHRONIZE_BASE_URL`). When set, `ensureDaemon()` uses it directly and
   **skips local auto-start and `daemon.json` entirely**.
   - **Hard requirement:** if the remote is unreachable, **error loudly** — never
     fall back to spawning a local daemon. Silent local spawn = two isolated
     daemons that each look healthy but never see each other (failure that
     masquerades as success).
2. **Mac-hosted central daemon.** Run the daemon on the Mac bound to the Mac
   tailnet IP with a stable port and a simple shared `SYNCHRONIZE_TOKEN`.
   Document the client env contract:
   `SYNCHRONIZE_REMOTE_URL=http://<mac-tailnet-ip>:<port>` plus the shared token.
3. **Remote session registration/lifecycle.** Verify a remote VPS session
   registers into the Mac daemon and shows up as a normal peer/session in the
   existing UI. Do not make machine grouping a v0 requirement.
4. **Web UI: token entry.** Capture a `?token=` query param into storage (or a
   small prompt) so a remote browser can authenticate without hand-editing
   localStorage.
5. **Remote claude sessions:** document that they run via codex-mode polling or
   rely on inbox fallback until Phase 2; verify the inbox/poll path end-to-end
   across machines.

### Phase 2 — Push parity for remote claude sessions

Restore live push to remote claude-mode sessions. Two options:

- **(A) Small / fragile to roaming.** Bind the client callback server to the
  client's tailnet IP and relax `requireLocalCallbackUrl` to also allow tailnet
  (`100.64.0.0/10`) addresses. Less code, but breaks when the client's IP changes
  (sleep/roam) and re-opens a daemon→client connection direction.
- **(B) Larger / clean.** Invert the flow: the client opens a long-lived
  SSE/long-poll *to* the daemon (outbound, like `/web/events` and the codex
  notifier already do) and the daemon streams events down it. NAT/sleep-friendly,
  unifies the notification model. **Recommended.**

## Decisions

1. **Daemon host for v0:** Mac hosts the daemon. The goal is active
   cross-machine work while the Mac is in use, not an always-on server.
2. **Auth for v0:** one simple shared bearer token. Tailscale is the network
   boundary; per-machine credentials are deferred.
3. **Remote Claude push:** use option B, client-initiated SSE/long-poll from the
   remote session to the daemon. Do not relax daemon-to-client callback rules as
   the long-term answer.
4. **UI machine treatment:** no v0 machine grouping requirement. Remote sessions
   should mostly be indistinguishable once registered into the Mac daemon's
   runtime state. Later UI polish can add a small icon or identifier for VPS vs
   Mac agents.

## Groundwork artifacts

- VPS test daemon: `SYNCHRONIZE_HOME=/tmp/sync-test` on `vps`, port `58410`,
  token `lan-test-token` (throwaway — tear down after the cross-machine curl).
- Repo synced at `vps:~/synchronize`.

## Follow-up notes: seamless VPS install and sync

Live cross-machine harness work exposed a separate product gap: the Mac can host
the daemon, but the remote session machine still needs the right client/runtime
bits installed and refreshed.

Observations from the VPS setup:

- Non-interactive SSH did not include `~/.local/bin` in `PATH`; the harness must
  either inject a deterministic PATH or install wrappers into a known location.
- `uv` and `claude` already existed under `~/.local/bin`, while `aoe` and `pi`
  were absent.
- `aoe` was installed from the upstream Linux release tarball into
  `~/.local/bin/aoe`.
- `pi` was installed from npm with `npm config set prefix ~/.local` and
  `npm install -g @earendil-works/pi-coding-agent@0.75.3`.
- The repo copy for the run used `rsync` into `/tmp/synchronize-mm-client`,
  followed by `bun install`.
- The remote harness needs the same environment contract as normal remote
  clients: `SYNCHRONIZE_REMOTE_URL`, `SYNCHRONIZE_TOKEN`, and a larger
  `SYNCHRONIZE_HEALTH_TIMEOUT_MS` for tailnet health checks.

### Current manual harness setup

This is the current state to simplify later. It is intentionally procedural:
today the operator still has to assemble a remote runtime by hand before the
cross-machine harnesses are easy to run.

Mac side:

- start a throwaway or chosen daemon with a tailnet bind, fixed port, and token,
  for example:

  ```bash
  SYNCHRONIZE_HOME=/tmp/sync-mm-mac-itest \
  SYNCHRONIZE_BIND=100.126.163.80 \
  SYNCHRONIZE_PORT=58412 \
  SYNCHRONIZE_TOKEN=... \
  bun run src/daemon.ts
  ```

- keep that daemon alive while the remote harness runs;
- verify from the VPS with `/health` and authenticated `/status`;
- stop the daemon and delete its temporary `SYNCHRONIZE_HOME` after the run.

VPS side:

- ensure `~/.local/bin` is on `PATH` for non-interactive SSH commands;
- ensure `aoe`, `tmux`, `uv`, `bun`, and the target agent CLI are installed;
- rsync the Mac worktree into a remote path such as
  `/tmp/synchronize-mm-client`;
- run `bun install` in the remote copy;
- invoke harness commands from the remote copy with:

  ```bash
  PATH="$HOME/.local/bin:$PATH" \
  SYNCHRONIZE_REMOTE_URL=http://100.126.163.80:<port> \
  SYNCHRONIZE_TOKEN=... \
  SYNCHRONIZE_HEALTH_TIMEOUT_MS=5000 \
  uv run scripts/<harness>.py --remote-url ... --remote-token ...
  ```

### Harness status today

CLI harnesses:

- work cross-machine when launched on the VPS against the Mac daemon;
- use the remote REST client for assertions;
- do not own or stop the daemon in remote mode.

Pi agent harnesses:

- work cross-machine after remote env is threaded into the temporary Pi
  `mcp.json` and session command;
- use client-side polling for remote event delivery instead of relying on a
  daemon-to-client callback;
- require careful session binding selection by repo, host tool, registration
  timestamp, and session name to avoid stale Pi bindings from prior runs;
- currently need the remote Pi runtime and `pi-mcp-adapter` installed or
  provisioned before the test is reliable.

Claude AOE sessions:

- can be spawned by AOE on the VPS with `--cmd claude` or `--cmd-override`;
- can run synchronize MCP when given a remote-aware MCP config with
  `SYNCHRONIZE_REMOTE_URL`, `SYNCHRONIZE_TOKEN`, and
  `SYNCHRONIZE_HEALTH_TIMEOUT_MS`;
- can send a DM through `bridge_dm` to a peer registered in the Mac daemon;
- can read the recipient durable inbox through `bridge_inbox`;
- do **not** yet have cross-machine live push parity in claude-mode. The
  current Claude subscription registers a `127.0.0.1:<port>` callback on the
  VPS, which the Mac daemon cannot reach. Durable inbox works; Phase 2 still
  needs client-initiated SSE/long-poll.

### Pain points to remove

- Remote setup is too manual: install/check `aoe`, `pi`, `claude`, `uv`, `bun`,
  PATH, repo sync, and dependency install all happen through ad-hoc SSH.
- The daemon lifecycle is manual: choose a tailnet IP, port, token, temp home,
  keep the process alive, verify health, and tear it down.
- The harness invocation has duplicated remote flags and env variables.
- The remote MCP configuration for Claude is not first-class; for manual tests
  we had to generate a temporary `--mcp-config` with remote daemon env.
- Pi has a harness-owned isolated environment, but the equivalent Claude test
  environment is still improvised.
- Cleanup requires knowing both AOE and tmux state. Failed or interrupted runs
  can leave profiles, tmux sessions, or agent processes behind.
- AOE profile deletion can leave one default profile because AOE refuses to
  delete the last profile.
- Diagnostics are spread across daemon logs, AOE JSON, tmux panes, REST queries,
  and remote transcript files.
- There is no single command that answers: "is this VPS ready to run all remote
  synchronize harnesses against this Mac daemon?"
- There is no single command that syncs the current worktree and prints the
  exact remote command/env the harness will use.

Candidate command shape for later discussion:

```bash
synchronize remote sync vpsme \
  --path /opt/synchronize \
  --install-tools aoe,pi,uv \
  --daemon-url http://<mac-tailnet-ip>:58412 \
  --token-env SYNCHRONIZE_TOKEN
```

Expected behavior:

- run from the Mac, over SSH, with no interactive prompts;
- install or update remote prerequisites into a user-owned prefix;
- rsync the current worktree or a built release bundle to the remote path;
- run `bun install` or copy prebuilt dependencies as appropriate;
- write a small remote env/profile file that points CLI/MCP/Pi at the Mac daemon;
- verify `synchronize status`, `synchronize-mcp`, and optional `pi --version`;
- print the exact remote command/env used by AoE/Pi harnesses.
