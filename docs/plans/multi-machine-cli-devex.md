# Multi-machine CLI DevEx: profiles, provisioning, parity, ops

> Status: **Planning — design agreed.** Tracked under epic `sync-kp1`.
>
> Companion to [`multi-machine-push-v0.md`](./multi-machine-push-v0.md) (delivery
> transport) and [`multi-machine-support.md`](./multi-machine-support.md)
> (connectivity feasibility). This document covers the **operator/developer and
> customer experience** of running synchronize across machines — the CLI surface,
> not the wire protocol.

## Problem

The multi-machine operator story is three tangled concerns, and the CLI today
only addresses fragments of each:

| Concern | Today | Pain |
|---|---|---|
| **Connection config** (client → daemon) | raw env vars: `SYNCHRONIZE_REMOTE_URL` / `_TOKEN` / `_HEALTH_TIMEOUT_MS` | re-typed everywhere, token leaks, no named targets |
| **Machine provisioning** (ready a remote) | ad-hoc SSH: install bun/aoe/pi/claude, rsync, `bun install` | manual, fragile (was `sync-nxyp`) |
| **Dev-env parity** (skills + MCP + versions match) | *nothing* | a VPS agent ≠ a Mac agent → divergent behavior |

There is **no client profile/config concept** — only a daemon-side `.env` loader.
Everything client-side is env-var soup.

## Decisions (locked)

1. **Config lives in a new TOML profile file** (`~/.synchronize/config.toml`) with
   named `[remote.*]` profiles. Env vars still override it (tests/one-offs
   unaffected).
2. **Skills/MCP sync is bidirectional**, bounded by a 3-way reconcile + manifest
   (no silent clobber). See D4 — this is the only piece carrying real complexity,
   and it is designed so a downgrade to one-way is clean, not a rewrite.
3. **Build profiles first** — it is the substrate everything else resolves
   against.

## The model

```
      ┌──────────────────────── tailnet (Tailscale) ─────────────────────────┐
      │                                                                       │
 ┌────┴────┐   ~/.synchronize/config.toml                ┌────────┐ ┌────────┐│
 │  Mac    │   [remote.hub] url, token, ssh_host          │  VPS   │ │ Laptop ││
 │ (HUB)   │◄────────── outbound clients only ────────────│ client │ │ client ││
 │ daemon  │   poll GET /events · POST /dm · SSE /web      │ agents │ │ agents ││
 │ +SQLite │                                              └────────┘ └────────┘│
 └─────────┘   ONE durable owner. Clients hold a profile, never state.         │
      └────────────────────────────────────────────────────────────────────-──┘
```

## config.toml schema (sketch)

```toml
active = "hub"                       # default profile for this machine

[remote.hub]
url        = "http://100.126.163.80:58412"
token_env  = "SYNCHRONIZE_TOKEN"     # or token_cmd = "op read op://…" for a secret manager
health_timeout_ms = 5000

[remote.hub.sync]                    # used by `remote provision` / `remote sync`
ssh_host = "vpsme"
paths    = [".claude/skills", ".mcp.json"]
```

The profile only *feeds* the values `ensureDaemon()` already reads
(`SYNCHRONIZE_REMOTE_URL`, `SYNCHRONIZE_TOKEN`, `SYNCHRONIZE_HEALTH_TIMEOUT_MS`).
Resolution precedence: **explicit env var > active profile > local auto-discovery.**

## Revised CLI surface

```
synchronize
├── serve [--remote]              run daemon (--remote: bind tailnet + token from profile)
├── remote                        ← NEW: the multi-machine control plane
│   ├── add <name> --url --token  define a profile in config.toml
│   ├── use <name> / ls / show    select / list / inspect profiles  (kills env-var soup)
│   ├── provision <ssh-host>      install bun/aoe/pi/claude on a remote
│   ├── sync <ssh-host>           rsync runtime + reconcile skills/MCP (bidirectional)
│   ├── upgrade [--all]           match synchronize version across machines
│   └── status                    health + agent roster across ALL machines
├── doctor                        ← NEW: local + remote readiness checklist
├── status / top                  existing observability, now profile-aware
└── launch / spawn / dm / …       existing agent cmds, now resolve via active profile
```

## DevEx use cases

**D1 — Stand up the hub** (Mac)
```
$ synchronize serve --remote
   config.toml [hub] → bind 100.126.163.80:58412, token required
   daemon.json written → local clients still auto-discover, no profile needed
```

**D2 — Onboard a remote machine** (today: a page of ad-hoc SSH → two commands)
```
Mac $ synchronize remote provision vpsme      ssh → PATH fix; install/verify bun,aoe,pi,claude,uv
Mac $ synchronize remote sync vpsme           rsync repo→/opt/synchronize; bun install
                                              write remote config.toml [hub] → points back at Mac
                                              verify /health 200, /status authed
                                              ✓ "vpsme ready · profile hub · claude 2.1.158"
```

**D3 — Point a session at the hub** (the env-soup killer)
```
BEFORE  SYNCHRONIZE_REMOTE_URL=http://100.x:58412 SYNCHRONIZE_TOKEN=… \
        SYNCHRONIZE_HEALTH_TIMEOUT_MS=5000 synchronize launch claude --as worker

AFTER   synchronize remote use hub            ← once per machine
        synchronize launch claude --as worker ← profile resolves url+token+timeout
```

**D4 — Bidirectional skills/MCP sync** (the one piece with real complexity, kept bounded)
```
 Mac .claude/skills/ ◄──────── reconcile ────────► VPS .claude/skills/  (+ .mcp.json)
                          │
        ┌─────────────────┴──────────────────┐   base = last-synced manifest
        │ 3-way compare per file:             │   ~/.synchronize/sync-manifest.json
        │   changed on A only   → push        │   (content-hash + mtime)
        │   changed on B only   → pull        │
        │   changed on BOTH     → CONFLICT ▌   │ → HALT, show diff,
        └─────────────────────────────────────┘   resolve with --prefer mac|remote
   Never clobbers a divergent edit silently. "Bidirectional" without a merge-hell.
   DOWNGRADE PATH: dropping to one-way = skip the B-side branch + conflict halt;
   the manifest and compare stay. Not a rewrite.
```

**D5 — Upgrade across machines**
```
$ synchronize remote upgrade --all
   each host: rsync/git to pinned rev → bun install → (hub) restart daemon
   verify /status api_version matches; REFUSE if any host would drift incompatible
```

**D6 — Observability across machines**
```
$ synchronize remote status
   HOST    ROLE    DAEMON     AGENTS  VERSION    SKILLS   MCP
   mac     hub     ✓ :58412      3    2.1.158    ✓ synced ✓ synced
   vpsme   client  → uses mac    2    2.1.158    ✓ synced ⚠ drift
   laptop  client  → uses mac    0    2.1.140 ⚠  ⚠ ahead  –
```

**D7 — Troubleshoot**
```
$ synchronize doctor
   ✓ tailnet reachable (100.x, 128ms)   ✓ token valid    ⚠ laptop API_VERSION mismatch
   ✓ daemon healthy                     ✓ skills manifest fresh   → suggests `remote upgrade laptop`
```

## Customer use cases (the payoff this unlocks)

**C1 — Agent on one machine talks to an agent on another, live**
```
laptop claude ──bridge_dm──► Mac hub ──INSERT events/inbox──► VPS claude
                                 │                              └─poll 0.5–2s→ notifications/claude/channel
                                 └─ web UI roster shows BOTH agents live, tagged by machine
```
(Delivery transport per `multi-machine-push-v0.md`: local callback, remote poll.)

**C2 — Operator opens the bus from any device**
```
phone browser → https://100.x:58412/?token=…   token captured to storage (no localStorage hand-edit)
              → SSE /web/events                 unified roster: mac + vps + laptop in one view
```

## Build order (profiles first)

```
1. profiles      config.toml + loader feeding ensureDaemon + `remote add/use/ls/show`   ← foundation
2. provision     `remote provision` + `remote sync` (rsync runtime)  (absorbs old sync-nxyp)
3. parity        bidirectional skills/MCP reconcile + manifest        ← the D4 complexity
4. ops           `remote status`, `remote upgrade`, `doctor`          ← observability/maint
```

Dependencies: provision and ops both build on profiles; parity builds on
provision (it rides the same SSH/rsync transport).

## What is intentionally NOT in scope

- Always-on VPS daemon mode / daemon failover (single hub for v0).
- Per-machine credentials (one shared token; Tailscale is the boundary).
- A federation/multi-daemon protocol.
- Web UI machine-grouping beyond a subtle indicator (`sync-xl3`).

## Invariants preserved

- The Mac hub remains the single durable state owner; clients are stateless and
  hold only a profile.
- Env vars always override profile values (tests and one-off runs unaffected).
- The existing `.env` daemon loader is untouched; profiles are a *client*-side
  concern layered above it.
