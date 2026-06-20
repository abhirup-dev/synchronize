# Architecture

System design for the synchronize Android app. Read this before the per-phase docs.

---

## The pivot: reuse, don't rewrite

Three facts about the existing system collapse most of the work:

1. **The daemon already serves the SPA.** `WEB_DIST` is served at `/web/*` from `web/dist` ([src/daemon/server.ts:1192](../../../src/daemon/server.ts), [src/daemon/routes/web.ts:120](../../../src/daemon/routes/web.ts)). In v0 it's unauthenticated under `/web/*`.
2. **The web client is origin-agnostic.** `DaemonDataSource` defaults its base URL to `window.location.origin` but accepts an explicit one ([web/src/data/daemon.ts:338](../../../web/src/data/daemon.ts)). Real-time is **SSE** at `/web/events` with a 2s polling fallback; attachments stage via `/web/attachments` ([web/src/data/daemon.ts:556](../../../web/src/data/daemon.ts)).
3. **Auth is a Bearer token** enforced only for non-localhost binds ([src/daemon/auth.ts:30](../../../src/daemon/auth.ts) localhost bypass, `:39` Bearer check).

**Therefore:** the Android app is a **Capacitor** shell bundling `web/dist`, rendering a **new mobile-first UI layer** (`web/src/mobile/`) on top of the **unchanged** `DaemonDataSource`/hooks/types. The daemon gets only *additive* changes (CORS, optional push endpoint). A full native rewrite would re-do weeks of shipped UI for no real gain given the brief is "mostly just a web client."

---

## Runtime topology

```
   ┌─────────────────────────── Android phone ───────────────────────────┐
   │  Capacitor APK (native shell)                                        │
   │   ├─ Native: connection screen, secure token store, mic recorder,    │
   │   │          share-intent receiver, push, keyboard/safe-area         │
   │   └─ WebView (https://localhost)                                     │
   │        └─ React SPA  →  web/src/mobile/  →  DaemonDataSource ────────┐│
   └──────────────────────────────────────────────────────────────────┐ ││
                                                                        │ ││
                       Tailscale tailnet (private mesh VPN)             │ ││
                       phone ⇄ daemon host · stable name · any network  │ ││
                       `tailscale serve` ⇒ https://<host>.<ts-net>      │ ││
                                                                        ▼ ▼▼
   ┌──────────────────────── Daemon host machine ───────────────────────────┐
   │  synchronize daemon (Bun)                                               │
   │   ├─ REST  /web/state · /web/attachments · /dm · /groups/* · /activity  │
   │   ├─ SSE   /web/events  (live state_changed)                            │
   │   ├─ Static /web/*  (serves the SPA — used by the browser path)         │
   │   ├─ NEW  CORS (preflight + headers) for the capacitor origin           │
   │   └─ NEW (Phase 10) /devices register + push sender on inbox events     │
   │  SQLite (WAL) durable state · filesystem MediaStore (incl. voice notes) │
   └─────────────────────────────────────────────────────────────────────────┘
```

Plain-English networking (the bridge): the daemon lives on one machine; the phone is elsewhere, maybe on mobile data. **Tailscale** is a private VPN mesh — install it on both, sign into the same account, and each device gets a stable private address that works on any network. `tailscale serve` then publishes the daemon as `https://<host>.<tailnet>.ts.net`, giving the app a real HTTPS endpoint (no cleartext-HTTP headaches on Android, and SSE/secure-context just work).

---

## Repo layout

```
synchronize/
├─ src/                          # daemon — additive changes only
│   └─ daemon/
│       ├─ auth.ts               # (touch) CORS preflight + headers
│       ├─ routes/web.ts         # (touch) CORS on /web/* incl. SSE
│       ├─ routes/devices.ts     # (NEW, Phase 10) push registration
│       └─ push/                 # (NEW, Phase 10) push sender (transport TBD)
├─ web/                          # existing SPA — shared data layer + new mobile UI
│   └─ src/
│       ├─ data/daemon.ts        # (touch) injected {baseUrl, token}; token on SSE
│       ├─ utils/attachments.ts  # (touch) add "audio" kind
│       ├─ bootstrap.ts          # (NEW) Capacitor detect → read config → mount
│       └─ mobile/               # (NEW) mobile-first UI (lazy-loaded chunk)
│           ├─ MobileApp.tsx
│           ├─ nav/              # bottom tabs + stack router
│           ├─ ChatsList.tsx · Conversation.tsx · ThreadScreen.tsx
│           ├─ Composer.tsx · VoiceRecorder.tsx · AudioBubble.tsx
│           ├─ ForwardSheet.tsx · ShareTarget.tsx
│           ├─ SpawnAgent.tsx · ArchiveResume.tsx · Roster.tsx · Activity.tsx
│           └─ ConnectScreen.tsx · Settings.tsx
└─ mobile/                       # (NEW) Capacitor project
    ├─ capacitor.config.ts       # appId, webDir → ../web/dist, androidScheme https
    ├─ package.json              # @capacitor/core + cli + plugins
    └─ android/                  # generated Gradle project (committed)
        └─ app/src/main/
            ├─ AndroidManifest.xml      # share intent filters, permissions
            ├─ res/xml/network_security_config.xml  # cleartext fallback
            └─ (google-services.json)   # only if FCM chosen in O1
```

**Mobile UI strategy (D3):** one SPA, runtime-branched. `bootstrap.ts` checks `Capacitor.isNativePlatform()` (or `?mobile` / narrow viewport for browser testing) and lazy-loads `web/src/mobile/MobileApp.tsx`; otherwise the existing desktop app renders. Shared `DaemonDataSource`, `context.tsx` hooks, `types.ts`. Desktop UI is untouched; the mobile chunk is code-split so neither audience pays for the other.

---

## Key decisions (detail)

- **D1 Capacitor over native / React Native.** Maximum reuse of the React data layer and most UI logic; one language; cheap iOS path later. WebView perf is the main bet (see Risks).
- **D2 Bundle assets, don't point at remote.** `server.url`-to-remote would make the app a glorified bookmark with no offline shell and slow cold starts. Bundling `web/dist` keeps the UI local; only data crosses the network.
- **D3 New mobile layer, shared data.** Desktop is a dense multi-pane layout (sidebar + chat + thread + timeline rail) — wrong for a phone. We build mobile-first screens but reuse every hook and the entire `DaemonDataSource`.
- **D4 Native-injected config.** In the APK `window.location.origin === https://localhost`, not the daemon, so the default base-URL path can't work. The native connection screen stores `{baseUrl, token}`; `bootstrap.ts` injects them. This is also where "switch daemon" / sign-out live.
- **D5 Tailscale + HTTPS.** Works on any network; HTTPS satisfies Android's cleartext policy and the browser secure-context rules (relevant for the browser-test path and any service-worker use).
- **D6 CORS.** The APK origin (`https://localhost`) is cross-origin to the daemon, so REST **and** SSE need `Access-Control-Allow-Origin`, `Allow-Headers: Authorization, Content-Type`, `Allow-Methods`, and a real `OPTIONS` preflight responder. Reflect the single known app origin rather than `*` when credentials/token are involved.
- **D7 Voice notes as attachments.** MediaStore already stores arbitrary mime types; `attachmentKindFor` only special-cases `image/*` today ([web/src/utils/attachments.ts:4](../../../web/src/utils/attachments.ts)). We add an `audio` kind + a player bubble; storage/transport is unchanged.
- **D8 Forwarding.** No forward concept exists yet (the data model has a "forward-compatible kind" seam at [web/src/data/types.ts:198](../../../web/src/data/types.ts) but nothing for forwarding). Implemented client-side as "send a copy to target chat(s)" with optional `forwarded_from` attribution.

---

## End-to-end wiring (the critical flows)

### Flow A — First connect
1. Native **ConnectScreen** → user types or **scans a QR** of `{baseUrl, token}`.
2. Stored via `@capacitor/preferences` (token in secure storage).
3. `bootstrap.ts` reads it → `new DaemonDataSource({ baseUrl, token })`.
4. SSE opens against `<baseUrl>/web/events` with `Authorization: Bearer <token>`.
5. Mobile SPA mounts; unreachable/invalid-token states show retry.

### Flow B — Send / receive a message
1. Composer → existing `DaemonDataSource` send method → daemon persists.
2. Optimistic local echo via existing `rememberLocalMessage` ([web/src/data/daemon.ts:521](../../../web/src/data/daemon.ts)).
3. Daemon emits SSE `state_changed`; `scheduleInvalidation` (50ms coalesce) refreshes all clients — phone **and** desktop.

### Flow C — Voice note
1. Hold mic → `VoiceRecorder` captures compressed audio (aac/opus).
2. `stageAttachment` → `POST /web/attachments` (existing path).
3. Send message with the attachment (kind `audio`).
4. `AudioBubble` renders a play/scrub/duration/waveform UI on every client.

### Flow D — Share-into-app
1. Another app fires `ACTION_SEND` → AndroidManifest intent filter routes it to the activity.
2. `send-intent` plugin hands the payload to the web layer (cold-start safe).
3. `ShareTarget` screen → pick chat → text goes to the composer, files/images go through `stageAttachment` → send.

### Flow E — Background push (Phase 10, transport TBD)
1. Daemon inbox/mention event → look up the peer's device tokens.
2. Send push (FCM **or** UnifiedPush — O1) → app shows a local notification.
3. Tap → deep-link to the chat → SSE + durable inbox catch up on resume (the project's existing fallback design).

---

## Cross-cutting concerns

- **Auth/CORS.** Non-localhost bind requires `SYNCHRONIZE_TOKEN`. Daemon must answer preflight `OPTIONS` and echo CORS headers (incl. `Authorization`) on `/web/*`, REST, and SSE. Decide whether `/web/*` static stays unauthenticated (browser path) while data routes require the token — recommend token on all non-localhost data routes.
- **TLS / cleartext.** Prefer `tailscale serve` HTTPS. Fallback: `network_security_config.xml` allowing cleartext to the tailnet host only (never global).
- **SSE on mobile.** Stays open while foregrounded; Android suspends it in the background → rely on push + durable-inbox catch-up on resume. Reconnect with backoff on network changes.
- **Theming.** Reuse the existing `data-theme` palettes (light · dark · rose-pine-dawn · kanagawa-wave · catppuccin-mocha). Follow OS dark mode by default; tint Android status/nav bars to match. Per the standing UI directive, verify every visual change in both light and dark.
- **Performance.** Reuse `@tanstack/react-virtual` for message lists; tune keyboard-resize + momentum/overscroll to avoid WebView jank (primary "seamless" risk).
- **Offline.** Bundled shell loads offline; data shows a clear "disconnected, retrying" state. No local message queue in v1 (sends require the daemon).
- **Security.** Token in secure storage, never logged, redacted in any diagnostics. QR pairing payload is versioned. Release APK signed with a managed keystore.

---

## Tech stack reference (Capacitor plugins)

| Capability | Plugin (candidate) | Phase |
|---|---|---|
| Config storage | `@capacitor/preferences` (+ secure storage for token) | 4 |
| QR pairing | `@capacitor-mlkit/barcode-scanning` (or camera + zxing) | 4 |
| Keyboard / safe-area | `@capacitor/keyboard`, `@capacitor/status-bar` | 5–6 |
| Haptics | `@capacitor/haptics` | 6 |
| Voice recording | `@capacitor-community/voice-recorder` (or WebView `MediaRecorder`) | 7 |
| Share target | `send-intent` (capacitor-plugin) | 8 |
| File picker | `@capacitor/filesystem` / `@capawesome/capacitor-file-picker` | 6–8 |
| Push | `@capacitor/push-notifications` (FCM) **or** UnifiedPush lib | 10 (O1) |
| App links / deep links | `@capacitor/app` | 8, 10 |

(Plugin choices are candidates; lock exact versions at scaffold time in Phase 3.)

---

## Risks register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | WebView chat feels janky (scroll/keyboard) — fails "seamless" | Med | Virtualization, keyboard-resize handling, momentum/overscroll CSS; re-evaluate after Phase 6; selective native only if needed |
| R2 | CORS misconfig on SSE breaks live updates | Med | Nail preflight + `text/event-stream` headers in Phase 2; test from phone browser before any native code |
| R3 | Push couples to Google / breaks local-first | Med | O1 deferred; UnifiedPush/ntfy kept as local-first alternative |
| R4 | Android cleartext / secure-context blocks HTTP | Low | Tailscale HTTPS (D5); network-security-config fallback |
| R5 | Token leakage on device | Low | Secure storage, redaction, signed release |
| R6 | Cold-start share intent races the WebView | Low | Queue intent payload natively; replay once web layer signals ready |
| R7 | Voice-note codec mismatch web↔desktop `<audio>` | Low | Pick a widely-supported container (aac/m4a); verify desktop playback in Phase 7 |
