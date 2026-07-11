# Letta ↔ synchronize native integration — decision log

Status: native channel **proven end-to-end**; productionization + full-peer agency tracked under epic `sync-fi9l`.
Branch: `codex/letta-harness`. Code: `extensions/letta-synchronize/`.

This is the *why* record (decisions, PoCs, problems, tradeoffs, assumptions). Usage
lives in `extensions/letta-synchronize/README.md`; forward work in `sync-fi9l` children.

---

## Goal

Make a real remote Letta agent ("Rocky", `agent-814dab68-...` on the VPS Letta
server) a first-class synchronize peer — reachable from the bus (CLI, MCP, web UI)
with its real host tools (Bash/Read/Write over its Obsidian vault), reliably, and
**not Rocky-specific** (onboard more Letta agents by config).

## Topology (decided)

Mac runs the synchronize daemon (tailnet-bound + token). The Letta side runs on the
**VPS** (where the vault and the Letta server live) and **dials in** to the Mac
daemon over Tailscale via `SYNCHRONIZE_DAEMON_URL`.

- Why dial-in: the agent's tools must execute where the files are (VPS). The daemon
  is the durable owner and lives on the always-on Mac.
- Assumption: both machines are on the tailnet; VPS→Mac reachability over Tailscale
  (intermittent drops recover on backoff — observed, non-fatal).

## Tool-access model (the core constraint)

Server-side Rocky (Letta server) has **only built-ins** (fetch_webpage,
tavily_search, memory_apply_patch) — **no host shell/filesystem**. Host
shell/filesystem/Obsidian comes **only from Letta Code client-side tools**
(Bash/Read/Write/Edit/Glob/Grep) executing where the SDK/CLI runs. So any path that
uses the pure HTTP SDK (`letta-client`) is **memory-only** — that was the old
unreliable `rocky-agent` ceiling.

## PoCs tried (in order)

1. **`remote` backend** (`src/remote-session.ts`, `letta-client`) — memory-only.
   Proved the bus loop but **no tools**. Kept as a fallback backend; not the product.
2. **`agent` backend** (`src/index.ts`, `letta-code-sdk` `resumeSession`) — remote
   Rocky brain + **client-side tools** in `cwd`. PROVEN: DM → Rocky ran Bash+Write →
   created a file in the vault → replied on the bus. This is a real poll-and-turn
   harness. Works, but it is a bespoke loop, not how Letta Code natively integrates
   external chat surfaces.
3. **Native channel plugin** (`channel/plugin.mjs`) — a Letta Code *dynamic channel*.
   **Chosen path.** Inbound: plugin polls the bus, calls `adapter.onMessage`. Outbound:
   agent's `MessageChannel` tool → `handleAction` → `POST /reply`. A channel-delivered
   turn runs the **full** Letta Code harness with client-side tools. Multi-agent via
   `routing.yaml` (chatId→agentId); onboarding another agent is config, not code.
   PROVEN end-to-end incl. cross-machine and a real vault write from the web UI.

Decision: the channel **supersedes** backends 1–2 as the integration path. Backends
stay as harness/fallback; the channel is the product.

## Problems solved

- **Heartbeat 404** — plugin used `POST`; daemon route is `PATCH /peers/:id/heartbeat`. Fixed.
- **node-pty no linux prebuild** in copied node_modules — `bun pm trust @letta-ai/letta-code` builds it.
- **letta CLI requires `LETTA_API_KEY`** even self-hosted — dummy value works with `SECURE=false`.
- **VPS global letta-code 0.18.3 too old** for channels (need ≥0.25.x) — use the
  `node_modules` 0.27.9 via the launch dir, not the global binary.
- **Web UI send silently did nothing over HTTP** (`crypto.randomUUID is not a function`).
  Root cause: `randomUUID` only exists in a *secure context* (HTTPS/localhost); the UI
  is reached over plain HTTP on a tailnet IP, so `addOptimisticMessage()` threw before
  the POST fired. Fix: `randomId()` fallback to `crypto.getRandomValues()`
  (`web/src/data/daemon.ts`, commit `070fdfb`). General bug — affected every non-HTTPS
  UI send (incl. the Android app), independent of Letta.
- **Channel turn-stuck** (this session): channel *read* an inbox item but never fired a
  turn or acked it; restart cleared it. Tracked as bug `sync-4k6p` (D6).

## Tradeoffs / open decisions

- **Polling vs push.** The channel polls `/peers/:id/inbox` every 1500ms — a stopgap
  that betrays the native-channel premise. The daemon's two push paths don't fit a
  remote peer consumer: (a) per-peer callback (`POST /subscribe`) is **localhost-only**
  (`requireLocalCallbackUrl`, daemon.ts), so the VPS channel is locked out; (b) the
  `/web/events` SSE stream is a **web-state broadcast**, not peer-scoped delivery.
  Decided fix: add peer-scoped `GET /peers/:id/events` SSE the channel dials out and
  holds open; durable inbox + ack stays as the fallback. Tracked `sync-ibe1` (D7, P1).
- **MCP for full agency.** The channel only gives reply-via-MessageChannel. For
  react/join-group/group-send/DM-third-party, wire the **existing, stable** synchronize
  MCP via `.mcp.json` — installation, *not* an MCP rewrite. Constraint: MCP must be
  outbound-only so its own notification path doesn't create a 2nd identity / double
  inbound. Tracked `sync-c69f` (A1).
- **Deployment is hand-run.** Daemon + channel were started manually and the channel
  needed a manual restart this session. Tracked `sync-w23c` (C4, supervised services).

## Assumptions

- `SECURE=false` on the self-hosted Letta server (dummy API key OK).
- Headless letta server runs unrestricted permission mode, so `MessageChannel`
  auto-fires without an approval prompt.
- `cwd` of the launched channel server = where tools run; use absolute vault paths or
  launch in the vault. `dmPolicy: open`. `routing.yaml` is JSON despite the extension.

## Pointers

- bd epic: `sync-fi9l` (children A1 `sync-c69f`, A2 `sync-fkil`, B3 `sync-e3zp`,
  C4 `sync-w23c`, C5 `sync-16g3`, D6 `sync-4k6p`, D7 `sync-ibe1`, E8 `sync-0ic5`).
- Memories: `letta-synchronize-native-channel-plugin`, `letta-synchronize-agent-backend-proven`,
  `letta-vps-server-and-tool-architecture`.
- VPS server facts (ports, rollback, Rocky id): memory `letta-vps-server-and-tool-architecture`.
