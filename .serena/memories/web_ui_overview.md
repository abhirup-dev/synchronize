# Web UI Overview (`web/`)

Neo-brutalist React 19 + TypeScript SPA served by the Bun daemon at `/web` and `/web/*`. It is a **human operator surface** — same agent messaging bus as the MCP adapters but with eyes. Not an agent surface itself.

## Stack & build

- **React 19**, strict TS, no Vite/Webpack. Bundled by `web/build.ts` via `Bun.build` → `web/dist/`.
- `bun run web/build.ts [--watch]`. Hashed entry + CSS, `index.html` rewritten with absolute `/web/` paths.
- Markdown: `react-markdown` + `remark-gfm` + `rehype-highlight` + `rehype-sanitize` (custom schema for GFM tags). Untrusted agent content is sanitized on render.
- **No global state lib.** Custom `Snapshot<T> { get(); subscribe(fn) }` contract + `useSyncExternalStore`.

## Entry points

- `web/index.html` — single shell with `__JS_BUNDLE__` / `__CSS_BUNDLE__` placeholders.
- `web/src/main.tsx` — mounts `<App/>`.
- `web/src/App.tsx` — picks DataSource, owns top-level state (`activeId`, `tab`, `focusedAgent`, `threadParentId`, `threadWidth`, `theme`), drives Vim keymap, sets `data-theme` and `data-vim-mode` on root.

## DataSource pattern (this is the core abstraction)

`web/src/data/types.ts` defines `DataSource`. Two adapters:

1. **`MockDataSource`** (`web/src/data/mock.ts`) — seeded from `seed.ts`. **The only working adapter today.** Persists agent color overrides in `localStorage.synchronize.agentColors`.
2. **`DaemonDataSource`** (`web/src/data/daemon.ts`) — **stub that throws.** Real impl tracked under `sync-jix` follow-up beads. Will register a sticky `web:<uuid>` peer in `localStorage`, then poll `GET /peers/:id/inbox` (V0 transport). SSE upgrade is a follow-up.

Components never call adapters directly — they go through hooks in `web/src/data/context.tsx` (`useRooms`, `useMessages`, `useAgents`, `useThreadReplies`, `useTimeline`, `useTasks`, `useArtifacts`, `useMe`). Adding a query = edit `DataSource` interface + both adapters; components untouched.

`web/src/data/store.ts` exports `createSnapshot<T>()` returning `MutableSnapshot<T>` with `get/set/update/subscribe`.

## Component map (`web/src/components/`)

| Component | Responsibility |
|-----------|---------------|
| `Sidebar.tsx` | Brand mark, search, GROUPS list, DMS list, user footer. Vim panel `sidebar`. |
| `RoomHeader.tsx` | Title, members, CHAT/BOARD/ARTIFACTS tab strip. BOARD/ARTIFACTS are placeholders (V2). |
| `ChatView.tsx` + `MessageRow.tsx` | Grouped bubbles, markdown body, reactions, status row. Vim panel `chat`. |
| `Composer.tsx` (210 LOC) | Textarea, toolbar, `@mention` autocomplete, Enter sends / Shift+Enter newline. |
| `ThreadPane.tsx` + `ResizeHandle.tsx` | Right-side thread pane, draggable 6 px ink-bar handle, width clamped 320–820, persisted in `localStorage.synchronize.threadWidth`. |
| `TimelineRail.tsx` | Vertical event rail (claim/analyze/deliver/ship/review/alert/kickoff/request). Hidden when thread open. |
| `AgentRoster.tsx` | Right rail grouped by status, click-to-focus, double-click jumps to that agent's last message. Hidden when thread open. |
| `PollWidget.tsx` | Poll bubbles. |
| `ContextMenu.tsx` | Portal-rendered shared menu (4 surfaces: sidebar / message / roster / timeline). |
| `Markdown.tsx` | Sanitized GFM markdown renderer wrapper. |
| `AgentColorPicker.tsx` | Per-agent identity color override → `ds.setAgentColor`. |
| `ScrollControls.tsx`, `Toast.tsx`, `primitives.tsx` | Helpers (Avatar, Sticker, StatusDot, MentionChip live in primitives). |

## Hooks (`web/src/hooks/`)

- `useVimNav.ts` (275 LOC) — modal nav: `navigate` / `typing` modes; panel cycle `H/L/Tab`, item nav `J/K/gg/G`, activate `Enter`, insert `i`, `Escape` to navigate, `c` closes thread. `App.tsx` wires focus-in/focus-out to auto-switch mode for any `<input>`/`<textarea>`/contentEditable.
- `useAutoScrollbar.ts` — show scrollbar only while scrolling.

## Styling

- `web/src/styles.css` (~59 KB) + `web/src/extra.css` (~34 KB). All design tokens are CSS custom props on `:root`; dark theme is a sibling block under `:root[data-theme="dark"]`.
- Tokens, palette, typography, shadows: see `web/DESIGN.md` front-matter (canonical).
- Bubble grouping uses **`-14px` negative margin** for consecutive same-author messages — intentional, do not "fix".

## Layout shell

`.app-shell` is `300px 1fr` (sidebar + main).
`.main-body` is `minmax(0,1fr) 112px 260px` (chat + timeline rail + roster).
Thread open: timeline+roster hide, body becomes `minmax(0,1fr) 6px ${threadWidth}px` (chat + handle + thread pane).

## V0 status (per DESIGN.md, as of 2026-05-22)

**Shipped V0:** Sidebar, RoomHeader (CHAT only), ChatView w/ grouped bubbles + sanitized markdown, Composer w/ @mention autocomplete, AgentRoster, ThreadPane + resize, TimelineRail, ContextMenu, Toast, AgentColorPicker, Vim nav, light/dark theme toggle, MockDataSource.

**V1 (next):** SSE endpoint + `DaemonDataSource` swap, focus-agent dimming semantics, TweaksPanel.

**V2:** BoardView (Kanban), ArtifactsView, Poll event type.

**Out of scope entirely:** image uploads from web composer (paperclip stays disabled), message edit/delete (event log is append-only), read receipts originating from web peer, multi-tab presence reconciliation, mobile/responsive <1024 px.

## Key conventions when editing

- Never call `fetch` from a component. Add a method to `DataSource` and both adapters.
- Avatar = single-letter tile filled with peer identity color. Never render uncached avatar URLs.
- Border is always `--ink`. Color flows through fills/dots/chips, never borders.
- Rounded scale is `0 / 3 / 5 / 8 / 999`. No arbitrary radii.
- No gradients, no blur, no soft shadows. Hard offset `Npx Npx 0 var(--ink)` only.
- No white surfaces. Cream paper or ink only.
- Bespoke inline SVGs only — no icon fonts.

## How to run

```
bun run web/build.ts --watch                                  # rebuild on change
bun run src/daemon.ts                                         # daemon serves /web/*
# Demo path (when implemented as `make demo-web`):
make demo                                                     # seed .demo-synchronize
SYNCHRONIZE_HOME=$PWD/.demo-synchronize bun run src/daemon.ts # open http://127.0.0.1:<port>/web
```

The `DaemonDataSource` is not wired yet — today the page runs against `MockDataSource` regardless of `localStorage.SYNCHRONIZE_DATA_SOURCE`. See `App.tsx::pickDataSource`.

## Worktree

A separate worktree exists at `/Users/abhirupdas/Codes/Personal/synchronize-worktrees/feat-web-chat-ui` for in-flight web work. Last master commits show recent web feature work: vim nav, agent color overrides, toasts, UX polish (`3513714`); web chat UI handoff doc (`166f841`).

## Canonical reference

`web/DESIGN.md` is the source of truth for tokens, layout, component states, data flow, and V0/V1/V2 scope. Read it before any structural change.
