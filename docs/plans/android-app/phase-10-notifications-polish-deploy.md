# Phase 10 — Notifications, polish, packaging & deployment

## Objective
Background delivery so messages arrive when the app is closed, final polish, and a shippable, signed APK with a documented deploy workflow.

## Depends on
Phases 6 + 9 (the app is feature-complete). **Push transport decision (O1) must be made before starting the push sub-phase.**

---

## ⚠️ OPEN DECISION — push transport (O1)

The user **left this open**. Choose before building the push sub-phase. The rest of Phase 10 (polish, packaging, deploy) does not depend on it.

### Option A — FCM (Firebase Cloud Messaging)
- **Pros:** the reliable, turnkey Android path; survives Doze; well-supported by `@capacitor/push-notifications`.
- **Cons:** routes message *signals* through Google; requires a **Firebase project** + `google-services.json` in the app and a **service account** on the daemon host to call FCM HTTP v1. Cuts against this project's local-first ethos.
- **Shape:** app registers an FCM token → `POST /devices` → daemon stores per-peer device tokens → on inbox/mention events, daemon sends an FCM data message → app shows a local notification → tap deep-links to the chat.

### Option B — UnifiedPush / ntfy (local-first)
- **Pros:** self-hosted, no Google dependency; aligns with local-first; ntfy is simple to run.
- **Cons:** the user installs/relies on a distributor app (e.g. ntfy) or self-hosted server; slightly less turnkey; background reliability depends on the distributor.
- **Shape:** app registers a UnifiedPush endpoint → `POST /devices` → daemon POSTs to that endpoint on events → distributor wakes the app → local notification → deep link.

> Both options share the **same daemon seam**: a `POST /devices` registration endpoint + a push-sender hook fired on inbox/mention events. Build that seam transport-agnostic so the chosen transport is a thin adapter. Until O1 is decided, **in-app foreground notifications** (SSE-driven, while open) ship without any transport.

---

## Steps

### 10a — Push (after O1)
1. Daemon: `src/daemon/routes/devices.ts` (NEW) — register/unregister device endpoints per peer; `src/daemon/push/` (NEW) — transport-agnostic sender fired on inbox/mention events; reuse the durable inbox as the source of truth (catch-up on resume).
2. App: register endpoint/token, send to `/devices`; handle incoming → local notification; **deep link** (`@capacitor/app`) → open the right chat; foreground notifications via SSE.
3. Respect mute/Do-Not-Disturb and per-chat notification settings (Settings screen).

### 10b — Polish
- Theme ↔ OS dark mode; status/nav bar tint per palette; verify **all** visual states in light **and** dark (standing UI directive).
- Real app icon + splash; haptics pass; empty/error/offline states; performance pass (cold start, scroll, memory).
- Accessibility basics (touch targets, contrast, labels).

### 10c — Packaging & deployment
1. **Signing:** generate/manage a release keystore (kept out of git); configure Gradle release signing.
2. **Release build:** `make android-release` → web build → `cap sync` → `assembleRelease` → signed APK.
3. **Deploy (personal):** sideload via `adb install -r app-release.apk`. Document the steps in `mobile/README.md`.
4. **Optional:** Play **internal testing** track for OTA updates / sharing (note store requirements: AAB, privacy policy, etc.) — out of scope unless wanted.
5. **Versioning:** version name/code bump in the release script.

## Files created/touched
- `src/daemon/routes/devices.ts`, `src/daemon/push/` (NEW, after O1).
- `web/src/mobile/Settings.tsx` (touch) — notification prefs.
- `mobile/android/app` — signing config, release manifest, icons/splash; `google-services.json` **only if FCM**.
- `Makefile` — `android-release`; `mobile/README.md` — signing + deploy docs.

## Wiring
Implements **Flow E** in [`architecture.md`](architecture.md): daemon event → device lookup → push (FCM or UnifiedPush) → local notification → deep link → SSE/inbox catch-up. Release signing wires the deploy loop.

## Acceptance criteria
- [ ] (Post-O1) A **closed** app receives a push for a new message; tapping opens the correct chat.
- [ ] Foreground in-app notifications work regardless of transport.
- [ ] Theme follows OS dark mode; all states verified light + dark; real icon/splash.
- [ ] Signed release APK installs cleanly via `adb`; build/deploy steps documented.
- [ ] Notification prefs (mute/per-chat) respected.

## Risks & mitigations
- **R3:** FCM ⇄ local-first tension → O1; transport-agnostic seam keeps the choice cheap to swap.
- Battery/Doze suppressing delivery → rely on durable-inbox catch-up on resume; document expectations.
- Keystore loss → documented, backed-up keystore management.

## Suggested `bd` units
- `Daemon: /devices registration + transport-agnostic push sender seam` (feature) — blocked by O1
- `Push adapter: FCM OR UnifiedPush` (feature) — blocked by O1
- `Foreground in-app notifications (SSE)` (feature) — not blocked
- `Polish: theming/icons/splash/a11y/perf (light+dark)` (task)
- `Release signing + make android-release + deploy docs` (task)
