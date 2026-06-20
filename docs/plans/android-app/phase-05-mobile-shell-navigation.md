# Phase 5 — Mobile-first UI shell & navigation

## Objective
A native-feeling navigation skeleton over the shared data layer: bottom-tab navigation, a chats list, and push/pop into conversations and threads. This is where the mobile UI layer (`web/src/mobile/`) takes shape; the desktop UI stays untouched.

## Depends on
Phase 4 (connected `DaemonDataSource`).

## Steps
1. **MobileApp shell** (`web/src/mobile/MobileApp.tsx`): top-level layout with safe-area insets, status-bar tint, and a **bottom tab bar**: **Chats · Activity · Agents · Settings** (Slack/Telegram idiom).
2. **Stack router** (`web/src/mobile/nav/`): lightweight push/pop with native-style transitions and Android back-button handling (`@capacitor/app` backButton). Routes: ChatsList → Conversation → Thread; Agents → SpawnAgent / ArchiveResume; Settings.
3. **ChatsList** (`web/src/mobile/ChatsList.tsx`): groups + DMs from `useRooms`; last-message preview, timestamp, unread + awaiting badges; search/filter; theme switcher (reuse `data-theme` palettes). Mirror the information in `Sidebar.tsx` but as a mobile list.
4. **Theming + chrome:** follow OS dark mode by default; tint status/nav bars per active palette; verify in both light and dark (standing UI directive).
5. **Empty/loading/disconnected** states for the list.

## Files created/touched
- `web/src/mobile/MobileApp.tsx`, `nav/` (router + tab bar), `ChatsList.tsx` (NEW).
- `web/src/bootstrap.ts` (touch) — mount `MobileApp` once connected.
- `mobile/package.json` — `@capacitor/status-bar`, `@capacitor/app`.

## Wiring
Consumes existing hooks from `context.tsx` (`useRooms`, activity counts, `useAgents`) unchanged. Navigation state is mobile-local; data state stays in the shared store. Desktop entry path is not modified (code-split chunk).

## Acceptance criteria
- [ ] App opens to a bottom-tab shell; tabs switch instantly.
- [ ] ChatsList shows groups + DMs with correct unread/awaiting badges (live via SSE).
- [ ] Tapping a chat pushes a Conversation screen; Android back pops correctly.
- [ ] Light and dark both verified; status bar matches.
- [ ] Desktop web build unchanged (no regressions).

## Risks & mitigations
- Transition jank → keep transitions CSS-driven and cheap; avoid layout thrash.
- Sharing hooks across desktop/mobile causing regressions → mobile imports hooks read-only; no changes to `context.tsx` semantics.

## Suggested `bd` units
- `Mobile shell + bottom-tab nav + safe-area/status-bar` (feature)
- `Stack router + Android back-button handling` (feature)
- `ChatsList (rooms, badges, search, theme switch)` (feature)
