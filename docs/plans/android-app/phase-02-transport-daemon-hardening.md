# Phase 2 — Remote transport & daemon hardening (Tailscale + CORS)

## Objective
Make the daemon reachable from the phone over the network, authenticated, **and prove it from the phone's mobile browser before writing any native code**. This isolates all transport/CORS/auth/TLS bugs to a phase where the only variable is the network — not Capacitor.

## Depends on
Phase 1 (so we can later install; not strictly required for the browser test).

## Background (measured)
- Daemon binds `127.0.0.1` by default; non-localhost binds require `SYNCHRONIZE_TOKEN`. Auth bypasses localhost, else checks `Authorization: Bearer <token>` ([src/daemon/auth.ts:30,39](../../../src/daemon/auth.ts)).
- `/web/*` is served **unauthenticated** in v0 ([src/daemon/server.ts:1188](../../../src/daemon/server.ts)).
- No CORS handling exists today (same-origin only so far).

## Steps
1. **Start Tailscale on the host** and join the phone:
   ```bash
   sudo tailscale up            # host (Mac); was stopped
   tailscale status             # note the host's tailnet name/IP
   ```
   Install the **Tailscale app** on the phone, sign into the **same** account.
2. **Expose the daemon over HTTPS** with Tailscale Serve (clean cert, no cleartext):
   ```bash
   # daemon bound locally as usual; serve proxies TLS → local port
   tailscale serve --bg <daemon-port>
   tailscale serve status       # shows https://<host>.<tailnet>.ts.net
   ```
   (Alternative, no Serve: bind `SYNCHRONIZE_BIND=0.0.0.0` + `SYNCHRONIZE_TOKEN`, reach `http://<tailscale-ip>:<port>` — but then handle Android cleartext later.)
3. **Add CORS to the daemon** (additive). In [src/daemon/auth.ts](../../../src/daemon/auth.ts) / [src/daemon/routes/web.ts](../../../src/daemon/routes/web.ts):
   - Respond to `OPTIONS` preflight with `204` + CORS headers.
   - On all responses (REST, `/web/*`, and the SSE `/web/events`): `Access-Control-Allow-Origin: <app-origin>` (reflect the single capacitor origin `https://localhost`, not `*`, since a token is involved), `Access-Control-Allow-Headers: Authorization, Content-Type`, `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`, `Access-Control-Expose-Headers` as needed.
   - Allow the origin to be configured via env (e.g. `SYNCHRONIZE_WEB_ORIGINS`) so the browser-test origin and the capacitor origin can both be whitelisted.
4. **Decide the token posture for `/web/*`** (currently unauthenticated): recommend keeping static asset serving open but requiring the Bearer token on data routes (`/web/state`, `/web/events`, `/web/attachments`, `/dm`, `/groups/*`, `/activity/*`) for non-localhost binds. Document the choice.
5. **Browser-test from the phone:** open `https://<host>.<tailnet>.ts.net/web/`, provide the token (the web client reads `SYNCHRONIZE_TOKEN` from local/sessionStorage), confirm the SPA loads, sends a message, and receives a **live SSE** update.

## Files created/touched
- `src/daemon/auth.ts` (touch) — CORS preflight + header helper, origin allow-list.
- `src/daemon/routes/web.ts` (touch) — CORS headers on `/web/*` + SSE.
- `src/daemon/server.ts` (touch) — wire `SYNCHRONIZE_WEB_ORIGINS`; document `/web/*` token posture.
- Tests under `tests/` — CORS preflight + Bearer enforcement for non-localhost.
- `docs/configuration/` — remote-access + Tailscale Serve notes.

## Wiring
This is the transport substrate for every later phase: the APK (Phase 3+) hits the same `https://<host>.<tailnet>.ts.net` endpoint with the same token and relies on the same CORS headers.

## Acceptance criteria
- [ ] Phone (mobile browser, over tailnet) loads `/web/`, sends, and receives a live SSE update — with a token, over HTTPS.
- [ ] `OPTIONS` preflight returns CORS headers; cross-origin `EventSource`/fetch to `/web/events` is not blocked.
- [ ] Bearer token enforced on data routes for non-localhost; localhost still bypasses.
- [ ] New daemon tests pass; `bun run typecheck` clean.

## Risks & mitigations
- **SSE + CORS** is the classic trap — preflight + correct headers on the streaming response; test with a real cross-origin `EventSource`.
- Tailnet ACLs blocking the port → check `tailscale status` / admin ACLs.
- Leaving `/web/*` fully open on a public-ish bind → token posture decided in step 4.

## Suggested `bd` units
- `Daemon: CORS preflight + headers for app origins (REST + SSE)` (feature)
- `Daemon: token posture for /web/* on non-localhost binds` (task)
- `Tailscale Serve HTTPS exposure + docs` (task)
- `Tests: CORS + Bearer enforcement` (task)
