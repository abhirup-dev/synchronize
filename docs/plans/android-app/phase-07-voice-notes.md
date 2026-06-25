# Phase 7 — Voice notes

## Objective
Record, send, and play voice notes. Renders on the phone **and** the desktop web UI (so it's a real feature, not a mobile-only hack).

## Depends on
Phase 6 (composer + conversation).

## Background (measured)
The daemon MediaStore stores arbitrary mime types; staging exists at `/web/attachments` ([web/src/data/daemon.ts:556](../../../web/src/data/daemon.ts)). `attachmentKindFor` only special-cases `image/*` today ([web/src/utils/attachments.ts:4](../../../web/src/utils/attachments.ts)) — everything else falls through to a generic file. So storage/transport need **no** backend change; the new work is the recorder + an audio bubble + an `audio` attachment kind.

## Steps
1. **Add `audio` kind** in `web/src/utils/attachments.ts`: `mimeType.startsWith('audio/') → 'audio'` (and surface duration if available).
2. **Recorder** (`web/src/mobile/VoiceRecorder.tsx`): hold-to-record mic button with a running timer, live amplitude/waveform, and **slide-to-cancel**. Use `@capacitor-community/voice-recorder` (native mic, consistent encoding) or WebView `MediaRecorder`; request `RECORD_AUDIO` permission. Produce a compact, widely-supported container (aac/m4a).
3. **Upload + send:** on release, `stageAttachment` the audio blob → send a message with the attachment (kind `audio`). Show upload progress + cancel.
4. **AudioBubble** (`web/src/mobile/AudioBubble.tsx`, also used by desktop attachment rendering): play/pause, scrubber, elapsed/total duration, static waveform; single-player policy (pause others on play).
5. **Desktop parity:** desktop attachment rendering (`AttachmentPreview.tsx` path) renders the same `AudioBubble`/`<audio>` so voice notes recorded on the phone play on the web.

## Files created/touched
- `web/src/utils/attachments.ts` (touch) — `audio` kind + duration.
- `web/src/mobile/VoiceRecorder.tsx`, `AudioBubble.tsx` (NEW).
- desktop attachment rendering (touch) — reuse `AudioBubble` for `audio` kind.
- `mobile/package.json` — voice-recorder plugin; `AndroidManifest.xml` — `RECORD_AUDIO`.

## Wiring
Implements **Flow C** in [`architecture.md`](architecture.md): record → `stageAttachment` (`/web/attachments`) → send with `audio` attachment → SSE → `AudioBubble` on all clients.

## Acceptance criteria
- [ ] Hold-to-record with timer + slide-to-cancel; permission prompt handled.
- [ ] Sent voice note appears as an audio bubble and **plays on the phone**.
- [ ] The same voice note **plays in the desktop web UI**.
- [ ] Upload progress + cancel; failure shows a retry.

## Risks & mitigations
- **R7:** codec/container mismatch web↔desktop → standardize on aac/m4a; verify desktop `<audio>` playback explicitly.
- Permission denial UX → graceful fallback + settings deep-link.
- Background/interrupted recording → cancel + cleanup on app pause.

## Suggested `bd` units
- `attachments: add audio kind (+duration)` (task)
- `VoiceRecorder (hold-to-record, waveform, slide-to-cancel, RECORD_AUDIO)` (feature)
- `AudioBubble player (mobile + desktop parity)` (feature)
- `Upload progress/cancel + failure retry` (task)
