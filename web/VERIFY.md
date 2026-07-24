# Web UI verification

Regression gate for the React UI served by the daemon at `/web/`.
See `sync-imeu.1.23`.

## Automated (run before every push)

```bash
make verify-web        # typecheck (web+root) + both asset-base builds + Storybook tests
# one-time browser install:
cd web && bunx playwright install chromium
```

`make verify-web` is cheap-to-expensive and fails the build on any error:

1. `tsc --noEmit` for `web/` and the root package
2. bundle build (`/web/` asset base → `dist/`)
3. Storybook story + `play` tests (`bun run test:storybook`, headless Playwright
   Chromium via Vitest). Every component story renders, interaction `play` tests
   run, and **`Layouts/App Shell`** mounts the full shell at compact / medium /
   desktop, asserting the right `data-shell-mode` and that the chat surface
   renders. Uses deterministic **MockDataSource** (no daemon/DB).

To watch/debug stories: `cd web && bun run storybook` (dev server + MCP on :6006).
To run the tests headed: `cd web && bun run test:storybook:headed`.

## Dev-server routing (run for changes to the dev config or the address module)

```bash
make web-dev                                                   # one shell
bun run scripts/verify-web-dev.ts <the printed Portless URL>    # another
```

Asserts that client routes serve the dev bundle rather than the daemon's SPA
fallback, that daemon routes forward without being named in the dev config, that
request bodies cross the proxy, and that `/web/events` streams on an open
connection instead of buffering to close. It needs a live Vite server, so it is a
script rather than part of `bun test`.

## Manual matrix (run for UI-affecting changes)

The story tests cover component states + shell render. Manually confirm the rest across
**compact (<780) / medium (780–1180) / desktop (≥1180)** and **light + dark/Kanagawa**,
in both **brutal + glass** skins:

- [ ] **Activity**: grouped ↔ timeline toggle, live-only filter, room filter, jump-to-room
- [ ] **Chat**: send, mention `@` popup, skill `/` picker, attachments, reactions
- [ ] **Thread**: open via badge; desktop = resizable split + header banner; medium/compact = pushed full panel with header; close/back
- [ ] **Roster**: desktop = persistent right column; medium = AGENTS header button → 320px side panel; compact = bottom-nav Agents → full sheet
- [ ] **Overlays (compact)**: Chats + Agents close via X / Escape; display sheet dismisses via backdrop-tap / Escape; bottom nav stays live under Chats/Agents
- [ ] **Breakpoint transitions**: resize across 780/1180 — open overlays close, no stuck state
- [ ] **Themes/skins**: cycle theme, toggle light/dark, toggle brutal/glass — no FOUC, glass blur only on fixed chrome
