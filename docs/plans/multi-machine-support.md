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
over the tailnet. The natural host for the central daemon is the **always-on
VPS** (`vps`, tailnet `100.96.245.110`), because the Mac (`mtpl-7638`) sleeps,
roams between networks, and changes IPs. Clients open *outbound* connections to
the daemon — which is what makes the design NAT/sleep-friendly.

We are **not** federating multiple daemons in v0 (no gossip/replication between
daemons). Single durable owner, many thin clients — the existing model, stretched
across the tailnet.

## Feasibility verdict

**Feasible now for the core goal.** The LAN-bind plumbing already exists and the
data model already records which machine each peer is on. Split into two tiers:

- **MVP-now** — bind the daemon to its tailnet IP + token, add a remote-URL
  override for clients, surface `machine_id` in the UI. Remote **codex** sessions
  work fully (their notifier already polls outbound). Remote **claude** sessions
  *degrade gracefully*: live push fails, but polled delivery + the durable inbox
  fallback (already the documented contract in CLAUDE.md) keep them functional.
- **Push parity (follow-up)** — restore live push notifications for remote
  claude-mode sessions. This is an enhancement, **not** a blocker for "render
  sessions from both machines."

## Empirical evidence (gathered this session)

Groundwork completed:

- SSH to the VPS works (`ssh vpsme`, user `abhirup`, Ubuntu 24.04, x86_64).
- Claude Code installed/updated on the VPS → **2.1.158** at `~/.local/bin/claude`,
  added to PATH in `~/.zshrc`/`~/.bashrc`/`~/.profile`.
- VPS and Mac are on the **same tailnet** (`sunnydas.das460@`): `vps` =
  `100.96.245.110`, `mtpl-7638` = `100.126.163.80`.
- `synchronize` rsynced to `vps:~/synchronize`, `bun install` clean (bun 1.3.10).
- **Daemon bound to the tailnet IP works:** started with
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
daemon on another and is distinguishable by machine — exactly what the UI grouping
needs. The throwaway VPS test daemon and `/tmp/sync-test` home were torn down after.

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
   The web UI does **not** yet group by it.
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
2. **Central daemon deployment on the VPS.** Run the daemon as a service bound to
   the tailnet IP with a token (`SYNCHRONIZE_BIND`, `SYNCHRONIZE_PORT` stable,
   `SYNCHRONIZE_TOKEN`). Document the env contract for clients.
3. **Web UI: group sessions/peers by machine.** Use `machine_id` (prefer the
   Tailscale device name as the stable key — `os.hostname()` is not guaranteed
   stable/unique) to render "this machine" vs other machines.
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

## Open questions / decisions for the user

> These are the calls I'd like your input on. Annotate inline with answers.

1. **Which machine hosts the one daemon?** Everything else connects to it.
   - *Recommendation:* the **VPS** — it's always on, so sessions can join any
     time; the Mac sleeps and changes networks, which would knock everyone off.
   - Trade-off: if the VPS is down, *nobody* can chat (even two local sessions).
     Acceptable?
2. **One shared password, or one per machine?** The daemon needs the bearer token
   (the shared secret) to let clients in.
   - *Recommendation:* one shared token for v0 — simple, and Tailscale already
     ensures only your devices can even reach the daemon. Per-machine tokens are
     more work for little gain on a personal tailnet. OK to start shared?
3. **How do remote claude sessions get live updates (Phase 2)?** Two ways to fix
   the push problem (finding 4):
   - **(A) Quick patch:** let the daemon call the client on its Tailscale address.
     Less code, but breaks whenever the client's address changes (laptop sleeps /
     switches wifi).
   - **(B) Client-opens-the-pipe (SSE), recommended:** the client holds open a
     connection *to* the daemon and receives events down it. More work now, but
     it just keeps working as machines sleep/roam — same approach the web UI
     already uses.
   - Or **defer Phase 2** entirely and rely on polling/inbox for remote claude
     sessions for now. Which do you want?
4. **What name do we group sessions by in the UI?** I'd use the **Tailscale device
   name** (`vps`, `mtpl-7638`) because it's stable and unique. The current default
   (`os.hostname()`) can change or collide. Agree?

## Groundwork artifacts

- VPS test daemon: `SYNCHRONIZE_HOME=/tmp/sync-test` on `vps`, port `58410`,
  token `lan-test-token` (throwaway — tear down after the cross-machine curl).
- Repo synced at `vps:~/synchronize`.
