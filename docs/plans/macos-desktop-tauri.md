# Plan: Native macOS Desktop App (Tauri) reusing the synchronize Web UI

> Status: **DRAFT / for review** · Author: planning session 2026-05-30
> Decision owner: Abhirup · Implementation: not started
>
> This plan describes wrapping the **existing** synchronize web UI in a thin,
> native-feeling macOS desktop shell using **Tauri v2**, with an explicit eye
> on a **future native mobile app**. It is intentionally diagram-heavy so it is
> easy to parse and annotate. Sections marked `« DIAGRAM »` are placeholders
> where additional ASCII diagrams can be filled in during review.

---

## 1. Goal & constraints

**Goal.** Ship a macOS desktop app for synchronize that:

1. Reuses the **exact existing web codebase** (`web/`) — no second UI.
2. Feels **native** (real window chrome, menus, traffic lights, keyboard).
3. Is **efficient** (small binary, low RAM) — not a bundled Chromium.
4. Supports **tabs**, so different threads/rooms open in different tabs.

**Hard constraints**

| # | Constraint | Source |
|---|---|---|
| C1 | Reuse `web/` as-is; do not fork the UI | user |
| C2 | Native feel | user |
| C3 | Efficient (footprint/RAM) | user |
| C4 | Tabs — a thread per tab (**vision; deferred to last, NOT v0** — see §6) | user |
| C5 | Must not paint us into a corner for a **future native mobile app** | user |

**Non-goals (v1)**

- Cross-platform desktop (Windows/Linux). Mac-first. (See §10 risk R3.)
- Offline mode. The daemon is the source of truth and runs locally.
- Re-architecting the daemon or the web UI's internals.

---

## 2. Guiding principle (the lesson from T3 Code)

We studied `pingdotgg/t3code` (Theo's open-source agent GUI), which the user
regards highly and which ships as **both** a web app and a native desktop app,
with a mobile app too. The durable lesson is **not** their shell technology
(they chose Electron) — it is their **layering**:

```
                 ┌──────────────────────────────────────────┐
                 │   ONE shared, UI-agnostic CORE             │
                 │   (API client + types/contracts)           │
                 └───────────────┬────────────────────────────┘
                                 │ consumed by
        ┌────────────────┬───────┴────────┬──────────────────┐
        ▼                ▼                ▼                  ▼
   ┌─────────┐     ┌───────────┐    ┌───────────┐     ┌────────────┐
   │  Web    │     │  Desktop  │    │  Mobile   │     │  CLI / MCP │
   │ (React) │     │  (shell + │    │ (native;  │     │ (existing) │
   │         │     │  web UI)  │    │  new UI)  │     │            │
   └─────────┘     └───────────┘    └───────────┘     └────────────┘
```

T3 Code's mobile app (Expo / React Native) reuses **only** the shared core
(`client-runtime` + `contracts`) and writes a **fully native UI** — it does
*not* wrap the web UI on the phone. That is the single most important input to
our mobile-seam decisions below.

**Why Tauri over Electron/Swift for *our* case** (recorded so the choice is auditable):

| Option | Native feel | Footprint | Web reuse | Mobile reach | Verdict |
|---|---|---|---|---|---|
| **Tauri v2** | High (WKWebView) | ~10 MB, low RAM | 100% | Tauri-mobile *possible* | **chosen** |
| Electron | Medium (Chromium chrome) | ~150 MB, high RAM | 100% | none (desktop-only) | rejected (C3) |
| Swift/WKWebView | Highest | tiny | web reusable, shell rewritten | SwiftUI spans iOS | rejected (most shell code; diverges from reuse goal) |

The one argument that justified Electron for T3 Code — **Chromium streams text
more consistently across OSes** — does **not** bind synchronize: we render
discrete messages (poll/SSE → append rows), not token-by-token streaming, and
on macOS WKWebView *is* Safari's engine. So Tauri's efficiency win is free here.

---

## 3. Target architecture

The desktop app is **a thin native window pointed at the daemon's `/web`**,
plus a **supervision layer** that guarantees the daemon is up and discoverable.

```
            macOS Desktop App ("Synchronize.app")
 ┌───────────────────────────────────────────────────────────────┐
 │  Tauri Shell (Rust)                                             │
 │                                                                 │
 │   ┌─────────────────────────┐    ┌──────────────────────────┐  │
 │   │  Native chrome           │    │  Daemon Supervisor        │  │
 │   │  • NSWindow / titlebar    │   │  • read daemon.json       │  │
 │   │  • menu bar / shortcuts   │   │  • health check           │  │
 │   │  • tabs (see §6)          │   │  • auto-start if down     │  │
 │   └───────────┬─────────────┘    └────────────┬─────────────┘  │
 │               │ hosts                          │ resolves       │
 │               ▼                                ▼                │
 │   ┌──────────────────────────────────────────────────────────┐ │
 │   │  WKWebView  ──loadURL──►  http://127.0.0.1:<port>/web      │ │
 │   │  (the EXISTING React SPA, served by the daemon, unchanged) │ │
 │   └──────────────────────────────────────────────────────────┘ │
 └───────────────────────────────┬─────────────────────────────────┘
                                  │ REST + SSE over loopback
                                  ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  synchronize daemon  (src/daemon.ts — UNCHANGED)               │
 │  • serves /web/*  (web/dist)                                    │
 │  • REST: /web/state, /web/events, /web/session, /api/*          │
 │  • SQLite (WAL) durable state · MediaStore                      │
 │  • writes ~/.synchronize/daemon.json {baseUrl, pid}             │
 └───────────────────────────────────────────────────────────────┘
```

**Key insight:** synchronize is already ~70% of the way here. The daemon
*already* serves the SPA at `/web` and *already* publishes discovery via
`daemon.json`. The desktop app is "a window + supervision," not a new frontend.

> **One daemon, many front doors.** There is exactly **one** daemon process per
> machine. The browser tab at `http://127.0.0.1:<port>/web` and the desktop app
> talk to the **same daemon, same SQLite, same state**. Open the web UI in
> Safari and the desktop app side-by-side and they show the identical rooms and
> messages in real time — the desktop app is just a second, native-feeling
> window onto that one daemon. (Agents' CLI/MCP sessions also talk to that same
> daemon — see §5 — but they run in their own terminals and are unrelated to the
> desktop app.)

---

## 4. The load-model fork (DECIDE EXPLICITLY)

Unlike Electron (which loads remote URLs first-class), Tauri's **default** is to
bundle the frontend and serve it from `tauri://localhost`. We have two genuinely
different paths and must pick one in writing.

```
   (A) POINT AT DAEMON  ── recommended v1 ──────────────────────────
   ┌────────────┐  loadURL(http://127.0.0.1:port/web)  ┌──────────┐
   │ WKWebView  │ ───────────────────────────────────► │  daemon  │
   └────────────┘   window.location.origin == daemon    └──────────┘
     • SPA live-mode detection works UNCHANGED:
         pathname.startsWith("/web")  → true
         baseUrl = window.location.origin → the daemon
     • Zero SPA changes.
     • Tradeoff: blank webview if daemon down (supervisor covers this);
       no offline shell; not using Tauri asset pipeline / IPC on that page.

   (B) BUNDLE web/dist  ── later option ────────────────────────────
   ┌────────────┐  loadURL(tauri://localhost)           ┌──────────┐
   │ WKWebView  │ ──fetch()──────────────────────────►  │  daemon  │
   └────────────┘   origin == tauri://, NOT the daemon   └──────────┘
     • BREAKS live-mode detection: origin is no longer the daemon and the
       path isn't /web. Must inject baseUrl via a Tauri command that reads
       daemon.json, and set the DaemonDataSource baseUrl explicitly.
     • CSP must allow the daemon origin AND the Google Fonts CDN
       (index.html pulls fonts.googleapis.com / fonts.gstatic.com).
     • Gains: offline shell, native asset pipeline.
```

**Decision: (A) — CONFIRMED by Abhirup ("definitely point it at the external
daemon").** (B) recorded only as a far-future option.
**Validation step (must do before building):** confirm the SPA's live-mode
branch (`web/src/App.tsx:49`, `web/src/data/daemon.ts:146`) fires when Tauri
loads an *external* `http://127.0.0.1` URL. Logically it should — the webview's
real location *is* the daemon — but verify before drawing the rest on top of it.

---

## 5. What code we share, and how it helps the future mobile app

The whole point of this section: **share as much UI-agnostic logic as possible
so the future mobile app can reuse it.** To do that cleanly we just have to know
*which* code is reusable on a phone and which isn't. There are only two
categories that matter, plus one piece of "launch plumbing" that is NOT a phone
concern at all. Concrete examples make this obvious.

### The two layers we WANT to share everywhere

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ (i)  TYPES         today in web/src/data/types.ts                      │
 │      What a Message / Room / Peer / Group / Event actually looks like. │
 │      e.g.  type Message = { id, roomId, authorPeerId, body, ts, … }    │
 │      Pure data shapes. No network, no DOM, no Node. Safe ANYWHERE.     │
 ├──────────────────────────────────────────────────────────────────────┤
 │ (ii) FETCH CLIENT  today in web/src/data/daemon.ts (DaemonDataSource)  │
 │      The functions that TALK to the daemon over HTTP:                  │
 │        • sendMessage(roomId, body)  → POST /web/...                    │
 │        • loadState(roomId)          → GET  /web/state                  │
 │        • subscribe to /web/events   (SSE stream of new messages)       │
 │      Built on the browser's plain `fetch()` — which React Native ALSO  │
 │      has. So this exact file runs unchanged on web, in the desktop     │
 │      webview, AND in a future Expo/React-Native app.                   │
 └──────────────────────────────────────────────────────────────────────┘
```

**Why this is the mobile win:** when you build the mobile app you write *new*
native screens (native message bubbles, native swipe gestures), but the code
that says "here's what a message is" (i) and "here's how to send/receive one
from the daemon" (ii) is **literally the same TypeScript**. You re-skin the UI,
you don't re-implement the protocol. That's exactly what T3 Code did — their RN
app imports `client-runtime` + `contracts` and only the views are new.

### The one piece that is NOT shareable (and not a mobile concern)

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ "make sure a daemon is actually running" — today in src/client.ts     │
 │  ensureDaemon(): read ~/.synchronize/daemon.json, and if the daemon    │
 │  isn't alive, START it (spawn the Bun process) and wait until healthy. │
 │  Uses node:child_process → can only run on a real computer, never on   │
 │  a phone (a phone can't spawn a daemon).                               │
 └──────────────────────────────────────────────────────────────────────┘
```

> **Mobile vision (per Abhirup).** The mobile app is purely a **frontend for
> agents**. The agents run on *other devices*, and **the daemon also lives on one
> of those other devices** — never on the phone. So the phone never spawns or
> supervises anything; it just points its fetch client (ii) at a **remote
> daemon's URL** over the network. That is *why* layer (iii) is irrelevant to
> mobile, and *why* the real mobile prerequisite is remote access + auth
> (Tailscale/LAN bind + token), not anything in this desktop plan. Captured in
> §9 Phase "FUTURE — mobile seam" and §10.

This is **not application logic** — it's launch plumbing. It answers "is the
server up, and what port is it on?" Three independent things need that answer,
and they all reuse this one tiny helper, but they do **not** know about or drive
each other:

```
   ensureDaemon()  ◄── reused by ──┬── the CLI        (an agent typed `synchronize …`)
                                   ├── the MCP adapter (an agent's MCP session)
                                   └── the DESKTOP shell (Tauri, at app launch)
```

> **Re: your annotations (#3, #4) —** correct: the **CLI and MCP are used by
> agents, in their own terminals, completely separate from the desktop app.**
> The desktop app does **not** drive, launch, or care about the CLI or MCP. The
> *only* relationship is that all three happen to call the same "is the daemon
> up?" function — like three unrelated apps all calling `connect_to_db()`. The
> desktop app needs it for exactly one reason: so it doesn't open to a blank
> window when no daemon is running yet (see §7). That is the entire overlap, and
> it has nothing to do with mobile.

### Who reuses what (the table that matters for mobile)

```
                       (i) types   (ii) fetch client   needs ensureDaemon?   UI
  Web      (today)         ✔             ✔                   no              React
  Desktop  (this plan)     ✔             ✔                   yes, via shell  React (web)
  Mobile   (FUTURE)        ✔             ✔                   NO (phone)      NATIVE (new)
  CLI/MCP  (agents)        ✔             —                   yes             terminal
```

**Action for this plan (cheap, protects the future):** keep (i) types and (ii)
the fetch client free of any `node:*` imports so the mobile app can import them
as-is. Good news: today they already live in `web/src/data/` and are already
Node-free. So the work now is simply **don't regress that**; later, when mobile
starts, promote those two files into a shared `packages/core-*` workspace. This
is a **seam to protect, not a refactor to do now.**

---

## 6. Tabs — DEFERRED past v0 (model decided: in-app)

> **Scope note (per Abhirup).** Tabs are the *vision*, but **v0 ships without
> tab support** to keep things simple while we flesh out the core app. Tabs —
> and their deep-linking prerequisite — become the **last work in the epic** (a
> final bd child issue / final phase), picked up only once the rest of the
> desktop app works. v0 behaves like the web UI does today: one window, sidebar
> room switching, no tabs. This section records the *chosen design* so it's
> ready when we pull it forward; it is **not** v0 scope.

When we do build tabs, the model is already decided (in-app). The two options
are kept below for the record. The deep-link change is **shared** prerequisite
work, done as part of the deferred tabs phase.

```
 (A) IN-APP TABS (React-rendered)            (B) NATIVE macOS WINDOW TABS
 ┌───────────────────────────────┐          ┌───────────────────────────────┐
 │ [ #ops ][ thread-42 ][ #qa ]+ │ ← React  │ ⌘  [ #ops │ thread-42 │ #qa ]  │ ← AppKit
 ├───────────────────────────────┤          ├───────────────────────────────┤
 │  one WKWebView                 │          │  N webviews (one per tab)      │
 │  one daemon connection         │          │  N daemon connections/pollers  │
 │  shared SSE/poll, shared cache │          │  independent SSE/poll each     │
 └───────────────────────────────┘          └───────────────────────────────┘
   • identical in browser & desktop            • desktop-only (no browser equiv)
   • full styling control (neo-brutalist)      • real OS tabs: ⌘T, drag, merge
   • single process, cheap                      • Tauri: tabbing_identifier set,
   • the route T3 Code took                       but newWindowForTab: wiring is
                                                    DIY (NOT free AppKit behavior)
                                                  • N tabs = N connections = more RAM
```

| Dimension | (A) In-app | (B) Native window tabs |
|---|---|---|
| Native feel | good | best |
| Works in browser too | ✔ | ✗ |
| Resource cost | 1 connection | N connections/pollers |
| Styling control | full | OS-controlled |
| Implementation cost | React only | Rust window mgmt + menu wiring |
| Matches reference (T3 Code) | ✔ | ✗ |

**Decision: (A) In-app tabs — CONFIRMED by Abhirup** ("RAM is a concern… let us
have in-app tabs if that will take less RAM"). It does: one webview, one daemon
connection, one shared SSE/poll, regardless of tab count — versus N independent
connections for native window tabs. (B) is not pursued. Revisit only if native
OS tabs ever become a felt need.

### Shared prerequisite for BOTH models: deep-linking

Today room/thread selection is in-memory React state (`activeId`,
`threadParentId` in `web/src/App.tsx`) with **no URL deep-linking**. Both tab
models need "open this thread directly," so add it once:

```
   URL                              initial SPA state
   /web?room=ops&thread=evt_42  ─►  activeId="ops", threadParentId="evt_42"
   /web?room=qa                 ─►  activeId="qa",  thread closed
   /web                         ─►  default (first room)
```

~20-line change in `App.tsx`: read `URLSearchParams` on mount → seed
`useState` initializers; optionally reflect changes back via `history.replaceState`
(so a tab can be reopened/restored). Shared work, not contingent on A/B.

---

## 7. Daemon supervision (reuse, don't reinvent)

The shell must guarantee the daemon is running and know its `baseUrl` before
loading the webview. We already have the logic — `ensureDaemon()` in
`src/client.ts` reads `daemon.json`, spawns the daemon if unhealthy, waits for
health. The Rust shell should **not** reimplement this in Rust; it should
delegate to the existing Bun code.

```
   App launch
       │
       ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Tauri (Rust) spawns a tiny Bun helper:                    │
   │   `synchronize ensure-daemon --print-url`                 │
   │   (new thin CLI subcommand wrapping ensureDaemon())       │
   └───────────────┬───────────────────────────────────────────┘
                   │ stdout: http://127.0.0.1:<port>
                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │ daemon healthy?                                            │
   │   yes → return baseUrl                                     │
   │   no  → spawn `bun run src/daemon.ts`, poll health, return │
   └───────────────┬───────────────────────────────────────────┘
                   ▼
   Tauri window.loadURL(`${baseUrl}/web`)
                   │
                   ▼
   On webview load failure (daemon died mid-session):
        show native "reconnecting…" overlay, re-run ensure-daemon, reload.
```

**Packaging — DECIDED: bundle a Bun sidecar** (confirmed by Abhirup, "Sidecar
makes the most sense"). The shipped `.app` carries the Bun runtime + daemon
bundle inside `.app/Contents/Resources`, and the Tauri shell spawns *that* as
the daemon if one isn't already running. This makes the app **self-contained**:
it works on a clean machine with no repo checkout and no global `bun`, and it
fits the "the app owns its daemon" mental model from the other decisions. (A
system-`bun` dev build can still be used during local development, but the
shipped artifact is sidecar.) (see §10 R2).

« DIAGRAM » — sidecar packaging layout (Bun binary + daemon bundle inside .app/Contents/Resources)

---

## 8. Repository layout

v1 keeps the footprint minimal: add one `desktop/` (or `apps/desktop/`) dir; do
**not** prematurely extract `packages/core`. Protect the seam, defer the refactor.

```
 synchronize/
 ├─ src/                      # daemon, cli, mcp, client (UNCHANGED)
 │  └─ cli/commands/ensure-daemon.ts   # NEW thin subcommand (§7)
 ├─ web/                      # existing React SPA (small deep-link change §6)
 │  └─ dist/                  # served by daemon at /web
 ├─ desktop/                  # NEW — Tauri shell
 │  ├─ src-tauri/
 │  │  ├─ tauri.conf.json     # window: hiddenInset titlebar, sizes, tabs
 │  │  ├─ Cargo.toml
 │  │  └─ src/main.rs         # supervise daemon → loadURL(baseUrl/web)
 │  ├─ icons/                 # .icns etc.
 │  └─ package.json           # tauri-cli scripts
 └─ docs/plans/macos-desktop-tauri.md   # this file
```

**Future (mobile milestone), NOT v1:**

```
 synchronize/
 ├─ packages/
 │  ├─ core-types/            # promoted from web/src/data/types.ts   (layer i)
 │  └─ core-client/           # promoted from web/src/data/daemon.ts  (layer ii)
 ├─ web/        → depends on packages/core-*
 ├─ desktop/    → loads web (unchanged)
 └─ mobile/     → Expo/RN, depends on packages/core-* , native UI      (NEW)
```

---

## 9. Phased implementation plan

```
 Phase 0  Validate assumptions ........................ [S]
   0.1  Confirm SPA live-mode fires under Tauri external-URL load (§4)
   0.2  Confirm daemon /web works when reached from a WKWebView origin
   0.3  Spike: bare Tauri window loadURL(http://127.0.0.1:PORT/web)

 Phase 1  Thin shell (point-at-daemon, model A) ....... [M]
   1.1  Scaffold desktop/ Tauri project (Mac target)
   1.2  hiddenInset titlebar + traffic-light position + app icon
   1.3  Native menu bar + core shortcuts (⌘W, ⌘R, ⌘,, copy/paste)
   1.4  `synchronize ensure-daemon --print-url` subcommand
   1.5  Rust supervisor: resolve baseUrl → loadURL → reconnect overlay

 Phase 2  Native polish ............................... [M]
   2.1  Dock badge / unread count, notifications (native)
   2.2  Window state persistence (size/pos) across launches
   2.3  Deep-link from notification → focus the right room

 Phase 3  Distribution ................................ [M/L]
   3.1  Bun sidecar packaging (§7) + bundle
   3.2  Code signing + notarization (Developer ID)
   3.3  Auto-update channel (tauri-updater) — optional v1

   ─────── v0 COMPLETE here: single-window native app, NO tabs ───────

 Phase 4  (DEFERRED — last in epic) Tabs .............. [M]
   4.1  Deep-linking: App.tsx reads URLSearchParams → initial room/thread
        state; history.replaceState reflection (restore/reopen)
   4.2  In-app tab strip component + per-tab state mgmt (model A, §6)
   Pulled forward ONLY once Phases 1–3 work and tabs are actually wanted.

 Phase 5  (FUTURE) Mobile seam ........................ [L]
   5.1  Promote core-types + core-client to packages/
   5.2  Harden daemon REMOTE access (Tailscale/LAN bind + token) — phone
        points its fetch client at a daemon running on ANOTHER device
   5.3  Expo/RN app consuming the shared core, native UI
```

Legend: [S]=small, [M]=medium, [L]=large.

« DIAGRAM » — milestone dependency graph
   (Phase 0 → 1 → 2 → 3 = v0 ship; then 4 tabs deferred; 5 mobile far-future)

---

## 10. Risks & open decisions

| ID | Risk / decision | Mitigation / note |
|---|---|---|
| R1 | SPA live-mode doesn't fire under Tauri external load | Phase 0.1 validates *before* anything is built on it |
| R2 | Distributable app needs daemon present | Bun **sidecar** packaging (§7); system-bun OK for personal build |
| R3 | Future Windows/Linux desktop hits WebKitGTK quirks | Out of scope v1; documented; revisit per-OS if needed |
| R4 | Native-tab (model B) cost: N connections/pollers | Prefer model A; if B, add shared-connection broker later |
| R5 | Google Fonts CDN dependency in index.html | Fine in model A (real http origin); needs CSP work in model B |
| R6 | Notarization / signing friction | Allocate time in Phase 5; not on critical path for dev build |

**Decisions (resolved during Plannotator review 2026-05-30):**

- [x] **Load model — (A) point at external daemon.** Confirmed.
- [x] **D1 — Tab model: (A) in-app tabs.** Confirmed (RAM: one shared connection).
- [x] **D2 — Packaging: bundle a Bun sidecar** (system-bun for dev only). Confirmed.

**Still open (lower-stakes, can be settled at issue-creation time):**

- [ ] D3 — Repo location: `desktop/` (flat) vs `apps/desktop/` (monorepo-ish). *Recommend `desktop/` now, monorepo later with mobile.*
- [ ] D4 — Auto-update in v1 scope? *Recommend defer.*

---

## 11. What is genuinely new vs reused

```
 REUSED AS-IS  ████████████████████████████  daemon, /web serving, REST/SSE,
                                              daemon.json discovery, the entire
                                              React SPA, bind/token model
 SMALL CHANGE  ████                           App.tsx deep-linking (§6),
                                              ensure-daemon subcommand (§7)
 NEW           ████████                        Tauri shell (Rust), native chrome,
                                              tabs UI, packaging/signing
 FUTURE        ████████                        packages/core-*, mobile app,
                                              remote-access hardening
```

The desktop app is overwhelmingly **reuse + a thin shell**, which directly
satisfies C1 (reuse) and C3 (efficiency).

---

## 12. References

- `pingdotgg/t3code` — inspiration. Desktop = Electron loading
  `loadURL(backendConfig.httpBaseUrl)`; mobile = Expo/RN reusing
  `client-runtime` + `contracts`; backend supervised by `DesktopBackendManager`,
  exposure via `DesktopServerExposure` (loopback/Tailscale). The *layering* is
  the lesson; the Electron choice is not.
- Current code anchors: `src/daemon.ts` (`/web` serving ~line 2304+),
  `web/build.ts` (bundle), `web/src/App.tsx:49` + `web/src/data/daemon.ts:146`
  (live-mode detection), `src/client.ts` (`ensureDaemon`).
```
