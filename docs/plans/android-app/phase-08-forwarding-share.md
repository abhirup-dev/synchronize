# Phase 8 — Forwarding & share-into-app

## Objective
Two related features: **forwarding** ("passing messages" — copy a message into another chat) and **share-into-app** (receive content shared from any other Android app via the OS share sheet).

## Depends on
Phase 6 (conversation + context menu). Can run in parallel with 7 and 9.

## Background (measured)
No forwarding concept exists; the data model has a generic "forward-compatible kind" seam ([web/src/data/types.ts:198](../../../web/src/data/types.ts)) but nothing for message forwarding. Forwarding is implemented client-side as "send a copy"; the daemon optionally records attribution.

## Part A — Forwarding
1. **Forward action** added to the long-press menu (`MessageActions`): opens a **ForwardSheet** (`web/src/mobile/ForwardSheet.tsx`) — a searchable multi-select of target chats (groups + DMs).
2. **Send copies:** for each selected target, send the message body + re-stage/reference attachments, with an optional **`forwarded_from`** attribution (original sender/room) rendered as a small header on the forwarded bubble.
3. **Backend (optional, minimal):** if attribution should survive on the server, add a `forwarded_from` field to the send payload + message record; otherwise keep it client-only. Decide during scoping; default to including lightweight attribution.

## Part B — Share-into-app
1. **Manifest intent filters** (`AndroidManifest.xml`): `ACTION_SEND` for `text/plain`, `image/*`, `*/*`, and `ACTION_SEND_MULTIPLE`, so the app appears in the OS share sheet.
2. **Receive payload** via the `send-intent` plugin; **queue natively** if the WebView isn't ready (cold start) and replay once the web layer signals ready (avoids R6 race).
3. **ShareTarget screen** (`web/src/mobile/ShareTarget.tsx`): show the shared content, pick a target chat → text goes to the composer (editable), files/images go through `stageAttachment` → send.
4. **Deep link** into the chosen conversation after sending.

## Files created/touched
- `web/src/mobile/ForwardSheet.tsx`, `ShareTarget.tsx` (NEW); `MessageActions` (touch) — Forward.
- `web/src/data/daemon.ts` (touch, optional) — `forwarded_from` on send.
- daemon send route + message record (touch, optional) — attribution field.
- `mobile/AndroidManifest.xml` — share intent filters; `mobile/package.json` — `send-intent`, `@capacitor/app`.

## Wiring
Forwarding reuses the existing send path (Flow B). Share implements **Flow D** in [`architecture.md`](architecture.md): OS intent → native queue → ShareTarget → `stageAttachment`/composer → send.

## Acceptance criteria
- [ ] Long-press → Forward → pick one or more chats → message arrives there (with attribution if enabled).
- [ ] App appears in the Android share sheet for text and images.
- [ ] Sharing a photo from Gallery into the app (cold start **and** warm) lands in ShareTarget → sends as an attachment.
- [ ] Sharing text lands in the composer, editable before send.

## Risks & mitigations
- **R6:** cold-start intent races the WebView → native queue + replay on ready.
- Large file shares → size guard + progress.
- Attribution scope creep → default to lightweight client+payload attribution; defer richer provenance.

## Suggested `bd` units
- `ForwardSheet + Forward action (+ optional forwarded_from attribution)` (feature)
- `Share intent filters + send-intent plugin + cold-start queue` (feature)
- `ShareTarget screen (text → composer, media → stageAttachment)` (feature)
