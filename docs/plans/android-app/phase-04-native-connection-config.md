# Phase 4 — Native connection/config + token injection

## Objective
A clean first-run flow to connect the app to a remote daemon (manual URL+token **or** QR scan), persisted across restarts, with reachable/unreachable/invalid-token states. This replaces the Phase 3 temporary config and is the seam that makes `DaemonDataSource` work inside the APK.

## Depends on
Phase 3 (APK runs the SPA).

## Background (measured)
In the APK, `window.location.origin === https://localhost`, so the `DaemonDataSource` default base URL ([web/src/data/daemon.ts:338](../../../web/src/data/daemon.ts)) can't reach the daemon. The client already supports a token via storage; we formalize injected `{baseUrl, token}`.

## Steps
1. **ConnectScreen** (`web/src/mobile/ConnectScreen.tsx`): inputs for daemon URL + token, plus a **Scan QR** button. QR encodes a versioned pairing payload `{v, baseUrl, token}` (a `synchronize status`-style command on the host can print/serve it).
2. **Persist config** via `@capacitor/preferences`; store the token in secure storage. Keys: `daemon.baseUrl`, `daemon.token`, plus a saved-daemons list for future multi-daemon (v1 keeps one active).
3. **Bootstrap** (`web/src/bootstrap.ts`): on launch, if `Capacitor.isNativePlatform()` → read stored config. If present → `new DaemonDataSource({ baseUrl, token })` and mount `MobileApp`. If absent → mount `ConnectScreen`.
4. **`DaemonDataSource` injection** (`web/src/data/daemon.ts`, touch): ensure constructor cleanly accepts `{baseUrl, token}`; attach `Authorization: Bearer <token>` to **all** requests **and** the SSE connection (`requestRaw`/`readSse` path ~`:1196–1246`). Add a connection-state callback (connecting / live / unreachable / unauthorized).
5. **Connection UX:** spinner + retry on unreachable; explicit "invalid token" message on 401; a Settings affordance to **switch daemon** / sign out (clears stored config).
6. **Reconnect/backoff:** on network change or SSE drop, reconnect with capped backoff; fall back to polling (existing 2s path) meanwhile.

## Files created/touched
- `web/src/bootstrap.ts` (NEW) — platform detect, config read, mount decision.
- `web/src/mobile/ConnectScreen.tsx` (NEW), `web/src/mobile/Settings.tsx` (NEW, sign-out/switch).
- `web/src/data/daemon.ts` (touch) — injected config + token on SSE + connection-state callback.
- `mobile/package.json` — `@capacitor/preferences`, barcode-scanning plugin.
- `mobile/android/app/src/main/AndroidManifest.xml` — camera permission (QR).

## Wiring
Implements **Flow A** in [`architecture.md`](architecture.md): ConnectScreen → Preferences → bootstrap → `DaemonDataSource({baseUrl, token})` → authenticated SSE → mount. Every later screen consumes this already-connected data source.

## Acceptance criteria
- [ ] Fresh install → ConnectScreen → enter or **scan** daemon + token → connected.
- [ ] Kill + relaunch → still connected (no re-entry).
- [ ] Wrong token → clear "unauthorized" message, not a blank screen.
- [ ] Daemon down → "disconnected, retrying" state; auto-recovers when back.
- [ ] "Switch daemon" / sign-out clears config and returns to ConnectScreen.

## Risks & mitigations
- Token in storage → secure storage, never logged, redacted in diagnostics.
- QR payload drift → version field + validation.
- SSE auth header omitted → explicit test that `/web/events` carries the Bearer token.

## Suggested `bd` units
- `bootstrap.ts: platform detect + config-gated mount` (feature)
- `ConnectScreen + QR pairing + Preferences/secure storage` (feature)
- `DaemonDataSource: injected {baseUrl,token} + token on SSE + conn-state` (feature)
- `Reconnect/backoff + unreachable/unauthorized UX` (task)
