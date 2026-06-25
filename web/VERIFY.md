# Web UI verification

Regression gate for the shared React UI (served by the daemon at `/web/` and
bundled into the Android app via Capacitor). See `sync-imeu.1.23`.

## Automated (run before every push)

```bash
make verify-web        # typecheck (web+root) + both asset-base builds + Storybook tests
# one-time browser install:
cd web && bunx playwright install chromium
```

`make verify-web` is cheap-to-expensive and fails the build on any error:

1. `tsc --noEmit` for `web/` and the root package
2. daemon bundle build (`/web/` asset base → `dist/`)
3. mobile bundle build (`/` asset base → `dist-mobile/`)
4. Storybook story + `play` tests (`bun run test:storybook`, headless Playwright
   Chromium via Vitest). Every component story renders, interaction `play` tests
   run, and **`Layouts/App Shell`** mounts the full shell at compact / medium /
   desktop, asserting the right `data-shell-mode` and that the chat surface
   renders. Uses deterministic **MockDataSource** (no daemon/DB).

To watch/debug stories: `cd web && bun run storybook` (dev server + MCP on :6006).
To run the tests headed: `cd web && bun run test:storybook:headed`.

## Manual matrix (run for UI-affecting changes)

The story tests cover component states + shell render. Manually confirm the rest across
**compact (<780) / medium (780–1180) / desktop (≥1180)** and **light + dark/Kanagawa**,
in both **brutal + glass** skins:

- [ ] **Activity**: grouped ↔ timeline toggle, live-only filter, room filter, jump-to-room
- [ ] **Chat**: send, mention `@` popup, skill `/` picker, attachments, reactions
- [ ] **Thread**: open via badge; desktop = resizable split + header banner; medium/compact = pushed full panel with header; close/back
- [ ] **Roster**: desktop = persistent right column; medium = AGENTS header button → 320px side panel; compact = bottom-nav Agents → full sheet
- [ ] **Overlays (compact)**: Chats + Agents close via X / Escape / Android Back; display sheet dismisses via backdrop-tap / Escape; bottom nav stays live under Chats/Agents
- [ ] **Breakpoint transitions**: resize across 780/1180 — open overlays close, no stuck state
- [ ] **Themes/skins**: cycle theme, toggle light/dark, toggle brutal/glass — no FOUC, glass blur only on fixed chrome
- [ ] **Android (device/APK only)**: hardware Back closes top overlay → thread → exits; soft-keyboard doesn't clip composer/popovers (`sync-imeu.1.2`)

> The Android rows can't be exercised by the web smoke — verify on a device build
> (`cd mobile && bun run dev`).
