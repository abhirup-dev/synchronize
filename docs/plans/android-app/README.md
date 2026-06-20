# Synchronize Android App — Plan

> **Status:** approved-for-build draft (2026-06-13). Lives on branch `feat-android-app`.
> **What this is:** a full-feature, **UI-only** Android client for the synchronize daemon running on a *different* machine. No agents run on the phone; it drives a remote daemon over the network and reaches parity with the existing web UI, plus a native-grade mobile chat experience.

This directory is the authoritative plan. Read [`architecture.md`](architecture.md) for the system design, then the per-phase docs for build detail.

---

## Goal

Reach **feature parity with the web UI** (spawn agents, archive/resume, groups, DMs, activity, threads, media, polls, reactions, themes) **plus** a WhatsApp/Telegram/Slack-grade mobile chat experience with **voice notes**, **message forwarding**, and **OS share-sheet** integration.

**Stated priority:** the *seamless chat experience* comes first (phases 5–6 before agent-control in phase 9).

**Non-goals (v1):** iOS, running agents on-device, end-to-end encryption, multi-daemon switching beyond a saved list.

---

## The one fact that shapes everything

The daemon **already serves the React SPA** at `/web/*` and the web client talks to whatever origin served it, over **REST + SSE**, with **Bearer-token** auth for non-localhost binds. So we **do not rewrite natively** — we reuse the existing React data layer and add a mobile-first UI layer inside a thin **Capacitor** shell. See [`architecture.md`](architecture.md) §"The pivot".

---

## Confirmed decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Capacitor** native shell (not a native rewrite) | ✅ confirmed |
| D2 | **Bundle `web/dist`** into the APK; only API/SSE hit the daemon | ✅ confirmed |
| D3 | **Mobile UI = new layer** in `web/src/mobile/`, runtime-branched in the *same* SPA, shared data layer; desktop untouched | ✅ confirmed |
| D4 | **Config injected from native** (daemon URL + token) → `DaemonDataSource({baseUrl, token})` | ✅ confirmed |
| D5 | **Tailscale** transport, **HTTPS via `tailscale serve`** | ✅ confirmed |
| D6 | **Daemon CORS** for the capacitor origin (REST + SSE) | ✅ confirmed |
| D7 | **Voice notes = audio attachment** over existing `/web/attachments` | ✅ confirmed |
| D8 | **"Passing messages" = message forwarding** (copy into another chat) | ✅ confirmed |
| D9 | **Capacitor project at `mobile/`**; chat-first phase ordering | ✅ confirmed |
| D10 | **iOS** out of scope v1 (Capacitor keeps it cheap to add later) | ✅ confirmed |

## Open decisions

| # | Decision | Notes |
|---|---|---|
| **O1** | **Push transport (Phase 10): FCM vs UnifiedPush/ntfy** | **LEFT OPEN by user.** FCM = reliable but routes via Google + a Firebase service account on the daemon host. UnifiedPush/ntfy = local-first, self-hosted. Phase 10 is written to defer this; both options are documented in [`phase-10-notifications-polish-deploy.md`](phase-10-notifications-polish-deploy.md). Decide before starting Phase 10. |

---

## Phase index

Each phase is independently testable and leaves the app working. Chat-first ordering.

| # | Phase | Doc | Outcome |
|---|---|---|---|
| 1 | Toolchain & device bring-up | [`phase-01-toolchain.md`](phase-01-toolchain.md) | Android build env + authorized phone |
| 2 | Remote transport & daemon hardening | [`phase-02-transport-daemon-hardening.md`](phase-02-transport-daemon-hardening.md) | Phone browser reaches daemon over Tailscale w/ token + CORS |
| 3 | Capacitor scaffold & first install | [`phase-03-capacitor-scaffold.md`](phase-03-capacitor-scaffold.md) | Existing UI running inside an installed APK |
| 4 | Native connection/config | [`phase-04-native-connection-config.md`](phase-04-native-connection-config.md) | First-run connect (URL+token/QR), persists |
| 5 | Mobile-first UI shell & navigation | [`phase-05-mobile-shell-navigation.md`](phase-05-mobile-shell-navigation.md) | Bottom-tab nav, chats list, push/pop |
| 6 | Seamless conversation experience | [`phase-06-conversation-experience.md`](phase-06-conversation-experience.md) | Native-grade chat parity |
| 7 | Voice notes | [`phase-07-voice-notes.md`](phase-07-voice-notes.md) | Record → send → play (everywhere) |
| 8 | Forwarding & share-into-app | [`phase-08-forwarding-share.md`](phase-08-forwarding-share.md) | Forward messages + OS share target |
| 9 | Agent control surfaces | [`phase-09-agent-control.md`](phase-09-agent-control.md) | Spawn / archive-resume / roster / activity |
| 10 | Notifications, polish, packaging & deploy | [`phase-10-notifications-polish-deploy.md`](phase-10-notifications-polish-deploy.md) | Push (transport TBD), signed APK, deploy |

**Dependency spine:** 1 → 2 → 3 → 4 → 5 → 6 → {7, 8, 9 in parallel} → 10.

---

## Top risks (full register in [`architecture.md`](architecture.md) §Risks)

1. **WebView chat feel** — the seamless requirement; mitigated by virtualization + keyboard/scroll tuning; re-evaluate after Phase 6.
2. **CORS on SSE** (`text/event-stream`) — get preflight right in Phase 2.
3. **Push ⇄ local-first tension** — O1; deferred.
4. **Cleartext/secure-context** — resolved by Tailscale HTTPS.
5. **Token security on device** — secure storage, never logged.

---

## Process / next steps

Per repo convention (`CLAUDE.md` — Plan → bd → skill index), the strict order is:
1. ✅ Write the plan docs (this directory).
2. ⏭ Create `bd` issues for the phases/units (each phase doc ends with a suggested `bd` unit breakdown).
3. ⏭ Add this plan to `.claude/skills/synchronize-debugging/reference-v0-plans.md`.

Work proceeds on `feat-android-app`, squash-merged to `master`.
