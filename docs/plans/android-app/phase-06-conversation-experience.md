# Phase 6 — The seamless conversation experience

## Objective
The headline phase: WhatsApp/Telegram/Slack-grade chat in a mobile idiom, at parity with the desktop conversation. This is the user's stated top priority.

## Depends on
Phase 5 (shell + navigation).

## Steps
1. **Conversation screen** (`web/src/mobile/Conversation.tsx`):
   - Message **bubbles** with sender identity/colors, timestamps, date dividers, unread divider.
   - **Markdown** via the existing `Markdown.tsx` (GFM + code highlight); attachment rendering (images inline, files as cards); **polls** via `PollWidget`; **reactions** row.
   - **Virtualized** list (`@tanstack/react-virtual`, already a dep) with scroll-to-bottom FAB and "new messages" pill.
2. **Composer** (`web/src/mobile/Composer.tsx`):
   - Text input that grows; **attach** (image/file via file picker); **send**.
   - **Keyboard handling** (`@capacitor/keyboard`, resize mode) so the input sits above the keyboard with no layout jump; safe-area aware.
   - Mic button placeholder (wired in Phase 7).
3. **Gestures & actions:**
   - **Long-press** context menu (mirror `ContextMenu.tsx`): react, reply, copy, delete (Forward added in Phase 8).
   - **Swipe-to-reply** with reply-quote preview in the composer.
   - **Tap-to-react** quick emoji.
4. **Threads:** open a thread as a pushed screen (`ThreadScreen.tsx`) mirroring `ThreadPane.tsx`, with summary + participants.
5. **Optimistic send** via existing `rememberLocalMessage`; live updates via SSE; haptics on send/long-press (`@capacitor/haptics`).
6. **DMs + groups** both use this screen (the data layer abstracts the difference).

## Files created/touched
- `web/src/mobile/Conversation.tsx`, `Composer.tsx`, `ThreadScreen.tsx`, `MessageBubble.tsx`, `MessageActions.tsx` (NEW).
- `mobile/package.json` — `@capacitor/keyboard`, `@capacitor/haptics`, file-picker plugin.
- Possibly small shared helpers extracted from desktop components (no behavior change).

## Wiring
Implements **Flow B** in [`architecture.md`](architecture.md). All sends/edits/reactions/replies go through the existing `DaemonDataSource`; live refresh via SSE `state_changed`. Reuses `Markdown.tsx`, `PollWidget.tsx`, attachment utils verbatim.

## Acceptance criteria
- [ ] Full parity: send/receive, react, reply, thread, render markdown/images/polls — in both DMs and groups.
- [ ] Keyboard open/close is smooth; input stays above keyboard; no scroll jump.
- [ ] Long-press menu + swipe-to-reply work; haptics fire.
- [ ] Live updates arrive via SSE; optimistic echo then reconciles.
- [ ] Subjective "seamless" check on-device (scroll/keyboard/gesture feel) — sign-off gate.

## Risks & mitigations
- **R1 (primary):** WebView scroll/keyboard jank → virtualization, momentum/overscroll CSS, careful resize handling; **re-evaluate the WebView bet here** — if feel is unacceptable, scope a selective native chat surface before proceeding.
- Reaction/reply parity gaps → diff against desktop `ChatView`/`ContextMenu` behavior.

## Suggested `bd` units
- `Conversation: virtualized bubble list + dividers + reactions` (feature)
- `Composer: text + attach + keyboard/safe-area handling` (feature)
- `Long-press menu + swipe-to-reply + haptics` (feature)
- `ThreadScreen (summary + participants)` (feature)
- `On-device seamless sign-off + jank mitigations` (task)
