---
name: Synchronize
description: Neo-brutalist web chat UI for the synchronize agent messaging bus.
colors:
  paper: "#F4EFE3"
  paper-2: "#ECE6D2"
  paper-3: "#E0D9C0"
  ink: "#111111"
  ink-soft: "#4A4636"
  ink-faint: "#8A8268"
  bubble: "#ECE6D2"
  muted: "#BFB9A8"
  yellow: "#FFD23F"
  pink: "#FF5DA2"
  blue: "#4D7CFE"
  lime: "#7BE389"
  tangerine: "#FF8A3D"
  lilac: "#B49BFF"
  teal: "#2EC4B6"
  red: "#F45B69"
  code-bg: "#1B1815"
  code-fg: "#F4EFE3"
  dark-paper: "#1B1815"
  dark-paper-2: "#23201C"
  dark-paper-3: "#2D2924"
  dark-ink: "#ECE3CD"
  dark-ink-soft: "#B5A988"
  dark-ink-faint: "#756B54"
  dark-bubble: "#23201C"
  dark-muted: "#3A352D"
  dark-yellow: "#D9B53C"
  dark-pink: "#D4669A"
  dark-blue: "#6E90DC"
  dark-lime: "#82C383"
  dark-tangerine: "#D17B40"
  dark-lilac: "#A695DC"
typography:
  display:
    fontFamily: "Archivo Black"
    fontSize: "22px"
    lineHeight: "1.1"
    letterSpacing: "-0.01em"
  ui:
    fontFamily: "Space Grotesk"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.5"
  ui-strong:
    fontFamily: "Space Grotesk"
    fontWeight: 600
  mono:
    fontFamily: "JetBrains Mono"
    fontSize: "12px"
  section-head:
    fontFamily: "Archivo Black"
    fontSize: "11px"
    letterSpacing: "0.06em"
  room-name:
    fontFamily: "Space Grotesk"
    fontSize: "13.5px"
    fontWeight: 600
  room-preview:
    fontFamily: "Space Grotesk"
    fontSize: "11.5px"
  bubble-body:
    fontFamily: "Space Grotesk"
    fontSize: "14px"
    lineHeight: "1.55"
rounded:
  none: "0px"
  sm: "3px"
  md: "5px"
  lg: "8px"
  pill: "999px"
spacing:
  density-cozy: "16px"
  density-compact: "10px"
  sidebar-w: "300px"
  timeline-w: "112px"
  roster-w: "260px"
  bubble-maxw: "880px"
elevation:
  border: "3px solid {colors.ink}"
  border-thin: "2px solid {colors.ink}"
  border-hair: "1.5px solid {colors.ink}"
  shadow-sm: "2px 2px 0 {colors.ink}"
  shadow: "4px 4px 0 {colors.ink}"
  shadow-lg: "6px 6px 0 {colors.ink}"
components:
  sidebar:
    backgroundColor: "{colors.paper-2}"
    width: "{spacing.sidebar-w}"
  room-item:
    padding: "9px 10px"
    rounded: "{rounded.md}"
  room-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  room-icon:
    size: "38px"
    rounded: "{rounded.md}"
  unread:
    backgroundColor: "{colors.pink}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "22px"
  brand-mark:
    backgroundColor: "{colors.yellow}"
    size: "42px"
    rounded: "{rounded.none}"
  bubble:
    backgroundColor: "{colors.bubble}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  bubble-you:
    backgroundColor: "{colors.muted}"
  mention-chip:
    rounded: "{rounded.sm}"
    typography: "{typography.mono}"
  unread-pill:
    rounded: "{rounded.pill}"
  composer:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
  composer-send:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  timeline-rail:
    width: "{spacing.timeline-w}"
  agent-roster:
    width: "{spacing.roster-w}"
    backgroundColor: "transparent"
---

# Synchronize Web UI

A neo-brutalist web chat interface for the local synchronize agent messaging bus. Built as a thin React 19 + TypeScript single-page app served by the existing Bun daemon, reachable at `http://<daemon-base-url>/web/`.

Stack:
- **React 19** (current stable) — uses the new `use()` hook, `useOptimistic` for sent messages, and the React Compiler defaults.
- **TypeScript 5.x**, strict mode.
- **Bun** built-in bundler (`Bun.build`) — no Vite, no Webpack. One build script at `web/build.ts`.
- **`react-markdown`** + `remark-gfm` + `rehype-highlight` + `rehype-sanitize` for message body rendering. Agents post untrusted-ish content, so we sanitize on render; GFM gives us tables, task lists, strikethrough, autolinks; highlight covers code fences without a server round-trip. (Prototype used `marked` — we upgrade because we need React-native components, safety, and pluggability.)
- **No global state library** — `DataSource` provider + small `useSyncExternalStore` subscriptions are enough.

## Reference

The visual reference for this implementation is the Claude Design prototype at `docs/ui-reference/claude-design-screenshots/` (full README in that folder). Notable frames the implementation must match:

- `10-present-chat-overview-clean.png` — primary chat layout (sidebar / chat / timeline rail / roster).
- `13-present-sidebar-search-filter.png` — sidebar search behaviour.
- `14-present-direct-message-atlas.png` — direct-message variant.
- `15-present-thread-replies-view.png`, `23-present-thread-pane-with-resize-bar.png`, `26-present-dedicated-thread-view-full.png` — threaded reply pane (resizable, parent message focused, others dimmed).
- `16-present-agent-roster-card-focus.png` — agent-focus dimming state.
- `17-present-room-actions-menu.png`, `20-…-context-menu-main-chat.png`, `21-…-left-sidebar.png`, `22-…-right-sidebar.png` — right-click context menus (4 surfaces).
- `18-present-board-tab-corrected.png`, `19-present-artifacts-tab-corrected.png` — Board and Artifacts tabs.

The bundled HTML/CSS/JSX prototype source (the source of truth for tokens, spacing, and component semantics) lives in `web/prototype/` (read-only mirror of the Claude Design handoff; not shipped to the browser).

## Overview

The web UI is a single hosted surface (one React bundle) that lets a human operator watch and participate in the same group/DM channels Claude/Codex/Pi agents use over MCP. It is **not** an agent surface itself — it consumes the same daemon REST API and an SSE event stream.

Aesthetic: **playful neo-brutalist** — cream paper background, 3 px ink-black borders, hard offset shadows (no blur, no gradients), three-typeface mix (Archivo Black display / Space Grotesk UI / JetBrains Mono code & handles). Each agent gets a stable identity color used in their avatar tile, mention chip, message author chip, and timeline marker.

Two themes:
- **Light** (default) — warm cream paper + ink black.
- **Dark** — warm coffee browns + off-white ink, accents desaturated ~15–20 %.

## Colors

See YAML front-matter `colors`. Notes:

- All raw colors are exposed as CSS custom properties (`--paper`, `--ink`, `--yellow`, …) on `:root`. The dark theme is a sibling block under `:root[data-theme="dark"]`.
- Accent rotation is per-room: each room declares a `color` (one of `yellow / pink / blue / lime / tangerine / lilac`). Accent flows through the room icon background, the room-name chip on hover, and the "active" room indicator on the sidebar.
- Per-agent identity colors are owned by the daemon (`peer.color`) and rendered by the client; defaults match the prototype palette (`Cortex = yellow`, `Atlas = pink`, `Vega = blue`, `Nova = lime`, `Echo = tangerine`, `Pulse = lilac`, `Mira = red`, `Jay = teal`, `You = ink`).
- The `code-bg` / `code-fg` tokens stay dark in both themes — code blocks never strobe when toggling theme.

## Token Contract

All static aesthetic decisions in the web UI must go through CSS custom properties. Component code and ordinary selectors should describe structure and state; tokens own the visual values that a future theme may override.

Rules:

- Static visual values belong in CSS tokens: radii, border widths, shadows, typography, repeated spacing rhythm, surface colors, and accent-aware effects.
- Inline `style={...}` is only for dynamic data: agent colors, computed virtualizer height/position, size-derived values, percent widths, mention colors, status-driven animation selection, and intentional rotation/position math.
- Structural layout math may stay literal when it encodes geometry instead of theme: grid columns, sidebar/timeline/roster widths, thread clamps, scrollbar widths, tooltip-arrow placement, avatar stack offsets, grouped-message negative margins, and timeline alignment offsets.
- Code blocks intentionally keep `--code-bg` and `--code-fg` dark in every theme.

Token catalog:

| Family | Tokens |
| --- | --- |
| Color | `--paper`, `--paper-2`, `--paper-3`, `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--yellow`, `--pink`, `--blue`, `--lime`, `--tangerine`, `--lilac`, `--teal`, `--red`, `--muted`, `--on-ink`, `--on-accent`, `--you-bg`, `--you-fg`, `--bubble`, `--code-bg`, `--code-fg` |
| Font family | `--font-display`, `--font-ui`, `--font-mono` |
| Font size | `--text-8`, `--text-8-5`, `--text-9`, `--text-9-5`, `--text-10`, `--text-10-5`, `--text-11`, `--text-11-5`, `--text-12`, `--text-12-5`, `--text-13`, `--text-13-5`, `--text-14`, `--text-15`, `--text-16`, `--text-17`, `--text-18`, `--text-20`, `--text-22`, `--text-24`, `--text-26`, `--text-28`, `--text-scale-kbd`, `--text-scale-code-inline`, `--text-scale-mention-inline` |
| Tracking | `--tracking-pixel-tight`, `--tracking-pixel`, `--tracking-tight`, `--tracking-none`, `--tracking-xs`, `--tracking-sm`, `--tracking-md`, `--tracking-lg` |
| Radius | `--radius-none`, `--radius-hair`, `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-pill`, `--radius-panel-top`, `--radius-panel-bottom` |
| Border | `--line`, `--line-2`, `--line-bold`, `--line-md`, `--line-sm`, `--line-xs`, `--line-xxs`, `--line-hair`, `--line-xs-ink`, `--line-xs-faint`, `--line-hair-faint`, `--line-none`, `--line-transparent`, `--line-md-transparent`, `--line-dashed-md`, `--line-dashed-sm`, `--line-dashed-xs`, `--line-dashed-faint`, `--line-rule-dashed-sm`, `--line-rule-dashed-xs` |
| Shadow | `--shadow`, `--shadow-sm`, `--shadow-lg`, `--shadow-hover`, `--shadow-none`, `--shadow-xxs`, `--shadow-xs`, `--shadow-chip`, `--shadow-md`, `--shadow-hover-sm`, `--shadow-accent-pink`, `--shadow-accent-pink-strong`, `--shadow-accent-inset`, `--shadow-tab-active`, `--shadow-focus-pink`, `--shadow-presence-in`, `--shadow-presence-out`, `--shadow-presence-peak`, `--shadow-busy-pulse-start`, `--shadow-busy-pulse-peak` |
| Spacing | `--space-0`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--space-7`, `--space-8`, `--space-9`, `--space-10`, `--space-11`, `--space-12`, `--space-14`, `--space-16`, `--space-18`, `--space-20`, `--space-22`, `--space-24`, `--space-30`, `--space-38`, `--space-40`, `--space-50`, `--space-56` |
| Composite spacing | `--space-row-gap`, `--space-row-gap-compact`, `--space-bubble-pad`, `--space-thread-bubble-pad`, `--space-chip-pad-xs`, `--space-chip-pad-sm`, `--space-chip-pad-md`, `--space-author-chip-pad`, `--space-thread-author-chip-pad`, `--space-sticker-pad`, `--space-button-pad-sm`, `--space-button-pad-md`, `--density-cozy-pad`, `--density-compact-pad` |
| Layering | `--z-local-floor`, `--z-local-base`, `--z-local-content`, `--z-local-hover`, `--z-local-control`, `--z-scroll-controls`, `--z-mention-pop`, `--z-floating-control`, `--z-mention-overlay`, `--z-toast`, `--z-context-menu`, `--z-agent-color-picker` |

Examples:

```css
.bubble {
  padding: var(--space-bubble-pad);
  border: var(--line-sm);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  font-family: var(--font-ui);
}
```

```tsx
<div style={{ background: agent.color }} />
```

Adding a new theme is a single sibling override block:

```css
:root[data-theme="soft"] {
  --paper: #fff;
  --rule: rgba(17, 17, 17, 0.25);
  --radius-xl: 16px;
  --shadow-md: 0 1px 3px rgba(0, 0, 0, 0.12);
}
```

Theme switching uses the existing root attribute mechanism: `document.documentElement.dataset.theme = "<theme-name>"`.

Included theme templates:

| Family | Theme IDs |
| --- | --- |
| Light | `light`, `rose-pine-dawn` |
| Dark | `dark`, `kanagawa-wave`, `catppuccin-mocha` |

The bottom-right theme button keeps quick toggling simple: click switches between the default light/dark themes, and Shift-click cycles through variants inside the current light or dark family.

Validation themes should stay throwaway. If a future pass needs one, create a temporary `[data-theme=...]` block locally, capture validation screenshots, then remove it before the branch is handed back so the product keeps the default colors and layout.

## Typography

- **Archivo Black** — display: brand mark, section heads (`GROUPS`, `DIRECT MESSAGES`, `AGENTS`), room titles, unread count chips. Tracking tightened to `-0.01em`.
- **Space Grotesk** — UI text: message bodies, room previews, composer input, button labels. Weights 400 / 500 / 600 / 700.
- **JetBrains Mono** — agent handles (`@vega`), inline code, key hint chips (`⌘K`), event-type pills (`CLAIMED`, `ANALYZED`).

All three load from Google Fonts via the `index.html` link tag. Bundle does not self-host fonts in v0.

## Layout

```
┌──────────────┬─────────────────────────────────────────────────────────┐
│  SIDEBAR     │   ROOM HEADER  (title · members · tabs CHAT/BOARD/ART)  │
│  300 px      ├─────────────────────────┬───────────┬─────────────────  │
│              │                         │ TIMELINE  │   AGENT ROSTER    │
│  brand       │   CHAT / BOARD /        │ RAIL      │   WORKING/READY/  │
│  search      │   ARTIFACTS tab body    │ 112 px    │   IDLE/OFF lists  │
│  GROUPS      │                         │ (chat tab │   260 px          │
│  DMS         │                         │  only)    │                   │
│  user footer │   COMPOSER (chat tab)   │           │                   │
└──────────────┴─────────────────────────┴───────────┴─────────────────  ┘
```

Grid implementation (`.app-shell`):
- Two columns: `300px 1fr`.
- Inside `.main`: `.main-body { grid-template-columns: minmax(0, 1fr) 112px 260px; }`.
- When a thread is open, the timeline rail and agent roster hide and the chat column splits horizontally into `chat-list | resize-handle | thread-pane` (320–820 px clamp on thread width).
- Density toggle (`cozy` / `compact`) tunes vertical padding only — never horizontal columns.

## Elevation & Depth

The brutalist drop-shadow is the only depth cue. There are no soft shadows, no gradients, no blur.

- Standard surface (room icon, brand mark, message bubble): `--shadow: 4px 4px 0 var(--ink)`.
- Small interactive (unread chip, search input): `--shadow-sm: 2px 2px 0 var(--ink)`.
- Hover lift: elements with shadow translate `-1px, -1px` on hover and lengthen their shadow by 1 px.
- Grouped message bubbles (same author, consecutive) **overlap by `-14px` margin** and keep their full shadow — the tight spacing creates cohesion, the shadow keeps each bubble feeling 3-dimensional (this was an explicit design decision in chat 1; see screenshot `grouped-light.png` / `15-present-thread-replies-view.png`).

## Shapes

- All borders: 3 px ink-black (`--line`) or 2 px thin (`--line-2`). Never colored borders.
- Corner radius scale: `0 / 3 / 5 / 8 / 999 (pill)`. Brand mark is intentionally square. Room icons `8px`. Bubbles `8px`. Buttons `5px`. Chips and dots `999px`.
- The brand mark and one or two badge stickers tilt `rotate(-3deg)` for personality — applied sparingly.

## Components

The implementation maps prototype files → React + TS components:

| Prototype                     | Implementation                                              | Notes |
| ----------------------------- | ----------------------------------------------------------- | ----- |
| `sidebar.jsx`                 | `web/src/components/Sidebar.tsx`                            | Brand, search, GROUPS list, DMS list, user footer. |
| `app.jsx` room header         | `web/src/components/RoomHeader.tsx`                         | Title, member chips, tab strip (CHAT / BOARD / ARTIFACTS), room-activity sparkline. |
| `chat.jsx` MessageList        | `web/src/components/ChatView.tsx` + `MessageRow.tsx`        | Grouped bubbles, markdown body, reactions, status row. |
| `chat.jsx` Composer           | `web/src/components/Composer.tsx`                           | Toolbar (B / I / `</>` / link / @ / 📎), `@mention` autocomplete, `Enter` send / `Shift+Enter` newline. |
| `chat.jsx` Poll               | `web/src/components/Poll.tsx`                               | Voted/unvoted bars, voter avatar stack, closed state. |
| `chat.jsx` ThreadPane         | `web/src/components/ThreadPane.tsx`                         | Right-side reply pane, draggable resize handle, parent message pinned. |
| `timeline.jsx`                | `web/src/components/TimelineRail.tsx`                       | Vertical event rail; types: claim / analyze / deliver / ship / review / alert / kickoff / request. |
| `board.jsx`                   | `web/src/components/BoardView.tsx`                          | Kanban columns: Backlog / In Progress / In Review / Shipped. |
| `app.jsx` ArtifactsGrid       | `web/src/components/ArtifactsView.tsx`                      | Filterable grid: IMG / CODE / DOC / DIFF / TF / LOG / CHART. |
| `app.jsx` AgentRoster         | `web/src/components/AgentRoster.tsx`                        | Right rail, grouped by status, click-to-focus. |
| `context-menu.jsx`            | `web/src/components/ContextMenu.tsx`                        | Shared portal-rendered menu; consumed by Sidebar / Message / Roster / Timeline. |
| `tweaks-panel.jsx`            | `web/src/components/TweaksPanel.tsx`                        | Floating debug toolbar: theme / accent / density / shadow size / roster on-off. |
| `primitives.jsx`              | `web/src/components/primitives.tsx` (Avatar, Sticker, …)    | Inline primitive set: `Avatar`, `Sticker`, `StatusDot`, `MentionChip`. |

Stateful surfaces (focused agent, open thread, active room, theme) live in the top-level `App.tsx` component. There is no global store in v0 — props + a small set of context providers (`ThemeContext`, `TweaksContext`) are enough.

### Component states worth calling out

- **Sidebar room item** — three states: idle / hover (paper background + ink border + shadow) / active (ink-filled, paper text, `room-preview` at 0.65 opacity).
- **Message bubble** — additional states: `dimmed` (other authors when an agent is focused; 32 % opacity, desaturated) and `thread-dimmed` (when a thread is open; 32 % opacity, 75 % opacity on hover). The active thread parent gets a 2 px pink ring.
- **Composer** — toolbar glyphs always render `color: var(--ink)` (explicit theme-aware fix from chat 1).
- **Roster cards** — transparent background with faint border in both themes (no white pop). `WORKING` group gets a 2 px pink left tick so busy agents still stand out.
- **Timeline rail** — `opacity: 0.55` by default; full opacity on rail hover; node markers translate + grow shadow on hover; tooltip renders via React portal to `body` so it escapes overflow clipping.
- **Mention popup** — surfaces the candidate's live status note ("running migrations on staging-db") inline. Arrow / Tab / Enter to commit.

## Do's and Don'ts

**Do**

- Hard offset shadows; tight ink borders; rotate stickers `±3°` for personality.
- Keep the cream-paper background; use it (not white) as the canvas in both themes.
- Reuse the agent's identity color across avatar, mention chip, author chip, timeline marker — single source of truth.
- Round corners only at the values in the rounded scale; never `border-radius: 12px` or arbitrary values.
- Render markdown faithfully (`marked` + a small `Markdown` wrapper); preserve code-block dark surfaces in both themes.
- Use SSE for live updates; treat the durable inbox as authoritative on reconnect.

**Don't**

- No gradients, no blur, no soft shadows, no parallax.
- No white surfaces. Cream paper or ink only.
- No colored borders — borders are always `--ink`. Color flows through fills, dots, and chips.
- No icon fonts. Bespoke inline SVG primitives only (claim hook, magnifier, etc. — already drawn in `timeline.jsx`).
- No real-product avatars or logos. Agents are originals (Cortex, Atlas, Vega, Nova, Echo, Pulse).
- Don't render uncached avatar URLs from peer data — avatar is always a single-letter tile filled with the peer's identity color.

## Data layer

The UI is built **mock-first, swap-later**. Components never call `fetch` directly. They consume a single typed contract:

```ts
// web/src/data/types.ts
export interface DataSource {
  // queries (snapshots — return the current state and notify on changes)
  rooms(): Snapshot<Room[]>;
  agents(): Snapshot<Agent[]>;
  messages(roomId: string): Snapshot<Message[]>;
  threadReplies(messageId: string): Snapshot<Message[]>;
  tasks(roomId: string): Snapshot<Task[]>;
  artifacts(roomId: string): Snapshot<Artifact[]>;
  timeline(roomId: string): Snapshot<TimelineEvent[]>;

  // commands
  sendMessage(roomId: string, body: string, mentions: string[]): Promise<Message>;
  sendThreadReply(messageId: string, body: string, mentions: string[]): Promise<Message>;
  vote(pollId: string, optionId: string): Promise<void>;
  focusAgent(agentId: string | null): void;

  // lifecycle
  connect(): Promise<void>;
  disconnect(): void;
}

export interface Snapshot<T> {
  get(): T;
  subscribe(fn: () => void): () => void;
}
```

Two adapters implement this contract:

1. **`MockDataSource`** (`web/src/data/mock.ts`) — wraps the prototype's `data.js` seed. Returns a snapshot whose `get()` reads from an in-memory store, `subscribe()` fires when the store mutates. Implements `sendMessage` by appending to the local list. This is what runs today; lets every UI feature be exercised without the daemon.
2. **`DaemonDataSource`** (`web/src/data/daemon.ts`, future) — REST for snapshots (`GET /groups`, `GET /groups/:id/history`, …), SSE for live updates (`GET /events/stream`). Internally translates daemon `Event` rows into client-side `Message` / `TimelineEvent` deltas and updates the same store shape.

Both adapters expose `subscribe` so components read via `useSyncExternalStore`. That hook lets us swap adapters at runtime (a tweaks-panel "Data: mock / live" switch) without re-rendering the whole tree.

The chosen adapter is exposed through a `DataSourceContext` provider in `App.tsx`. Components use a typed `useRooms() / useMessages(roomId) / …` set of hooks that pull from the context — they never touch the adapter directly. This means:

- Adding a new query is two edits: `DataSource` interface + both adapters.
- A new server-side route doesn't touch any component; only `DaemonDataSource` changes.
- Mock + live can run side-by-side during development (`localStorage.SYNCHRONIZE_DATA_SOURCE = 'live'`).

## How the daemon delivers new messages (architecture grounding)

From the daemon's perspective (`src/daemon.ts` + `.serena/memories/architecture.md`):

- Every fact (DM, group message, media-shared, join/leave) inserts a row into the SQLite `events` table.
- For every recipient of that fact, a row is also inserted into the per-peer `inbox` table (DMs → one row for the recipient; group messages → one row per active member).
- The daemon offers **two delivery transports** for clients sitting on top of the inbox:
  - **Polling** — `GET /events/:peer_id?cursor=N`. Client sweeps periodically; daemon returns inbox rows past the cursor, marks them delivered, updates `peers.last_cursor`. This is what the Codex MCP adapter uses via `NotificationBridge`.
  - **Push** — `POST /subscriptions { peer_id, callback_url, token }`. Daemon stores the subscriber; after each insert, `notifySubscribers(ctx, recipientPeerIds, event)` POSTs the event JSON to the registered local callback. Used by the Claude MCP `EventSubscription` and the Pi extension.
- The inbox is the authoritative fallback. Push delivery is best-effort; whatever the daemon couldn't deliver stays in the inbox until the next poll or `ack`.

Browsers can't accept inbound POSTs, so we cannot use the `/subscriptions` push transport directly. Two viable paths for the web UI:

1. **Polling (initial cut)** — `DaemonDataSource` registers a stable web peer (id `web:<uuid>` persisted in `localStorage`), then runs a `GET /peers/:peer_id/inbox` (or `/events/:peer_id`) loop every 1–2 s. Zero daemon changes. Sufficient for a single human operator's UI; the inbox + cursor mechanics give us "exactly-once" semantics for free.
2. **SSE (follow-up)** — add a new daemon route `GET /events/stream?peer_id=...&token=...` that holds the connection open and writes `text/event-stream` frames whenever `notifySubscribers` fires for that peer. The route reuses the existing `subscribers` map (the SSE controller becomes another sink alongside the HTTP-POST callback). The polling code path stays as fallback for reconnect/gap-fill.

The `DataSource` interface hides which transport is in use. Components only ever observe `messages(roomId).get()` and a `subscribe(fn)` callback.

## REST surface (consumed by `DaemonDataSource`)

Verbatim from `src/api/`:
- `GET /status`, `GET /summary`
- `GET /peers`, `POST /peers/register`, `PATCH /peers/:id/heartbeat`
- `GET /groups`, `POST /groups`, `GET /groups/:id`, `GET /groups/:id/history`, `POST /groups/:id/messages`
- `POST /groups/:id/join`, `POST /groups/:id/leave`
- `POST /dm`
- `GET /peers/:id/inbox`, `POST /peers/:id/inbox/ack`
- `GET /events/:peer_id` (cursor-based, same shape as inbox)
- `GET /groups/:id/media`, `GET /media/:id`

New surfaces added by this PR (daemon changes):
- `GET /web` and `GET /web/*` — static asset serving (the built React bundle from `web/dist/`).
- `GET /events/stream` (follow-up bead) — SSE long-poll endpoint; see above.

Translation from daemon `Event` rows → client model is owned by `DaemonDataSource`:

| daemon `event.type` | client effect                                                                  |
| ------------------- | ------------------------------------------------------------------------------ |
| `dm`                | append `Message` to the DM room keyed by `(sender_peer_id, recipient_peer_id)` |
| `group_message`     | append `Message` to `room(group_id)` and emit a TimelineEvent                  |
| `media_shared`      | append `Artifact` to room and a `media-shared` TimelineEvent                   |
| `group.created`     | upsert into rooms list                                                         |
| `peer.registered` / `peer.heartbeat` | update agent presence (busy / idle / off)                      |

The web client identifies itself with a sticky peer id stored in `localStorage` (`synchronize.peer_id`, prefix `web:`). On first load it `POST /peers/register`s itself with `tool = "web"`, then joins (or peeks at) the rooms it cares about.

## Seeing the UI in action: `make demo-web`

The repo already has `make demo`, which runs `scripts/seed-demo.ts` to populate a daemon under `.demo-synchronize/` with real peers, groups, messages, DMs, and shared media. We piggyback on that instead of inventing a parallel mock pipeline:

```
make demo-web   →  scripts/seed-demo.ts (seeds .demo-synchronize/)
                →  bun web/build.ts            (produces web/dist/)
                →  SYNCHRONIZE_HOME=$PWD/.demo-synchronize bun run src/daemon.ts
                →  prints "open http://127.0.0.1:<port>/web"
```

The web UI hits the live `DaemonDataSource` — no mock involved. This is the **canonical demo path**; the `MockDataSource` exists only as a development fallback for working on components without spinning up a daemon. Same code path as production.

V0 task: enrich `scripts/seed-demo.ts` so the demo home reflects the prototype's character set (eight agents Cortex / Atlas / Vega / Nova / Echo / Pulse / Mira / Jay across five groups with markdown messages), giving us a visually substantial first run. This evolves incrementally — every new feature lands with a corresponding seed addition so the demo always exercises it.

## V0 scope vs later iterations

V0 ships the shape of the prototype against a `MockDataSource`, plus a working `DaemonDataSource` (polling). Everything else is a follow-up bead under `sync-jix` so we can land working slices behind a clean abstraction instead of one giant PR.

**In V0:**

- Web bundle + Bun.build pipeline; daemon serves `/web` and `/web/*`.
- `DataSource` interface with `MockDataSource` (always available) and `DaemonDataSource` (polling-based event sync, sticky web peer id).
- Sidebar (brand, search, GROUPS, DMS, user footer).
- RoomHeader with the CHAT / BOARD / ARTIFACTS tab strip (only CHAT renders; the other two are placeholder panels).
- ChatView: grouped bubbles, author chip, identity colors, status row, markdown body (GFM + code highlight + sanitized).
- Composer: textarea, toolbar (B / I / `</>` / link / @ / 📎 — only @ and send are wired in V0), `@mention` autocomplete with arrow / tab / enter / live status notes, Enter sends / Shift+Enter newline.
- AgentRoster (right rail), grouped by presence; click-to-focus is V0 visual only (focus state, no dim semantics yet).
- Light + dark theming via `data-theme` and CSS custom properties.

**V1 (immediately after merge):**

- SSE event-stream endpoint on the daemon (`GET /events/stream`) + adapter swap from polling.
- Threads: `ThreadPane`, resize handle, parent-pin, dimming of non-thread messages.
- TimelineRail with portal tooltips, claim/analyze/deliver/ship/review/alert/kickoff/request markers.
- Focus-agent mode (dim other-agent messages + timeline nodes; pink ring on focused agent's bubbles).
- ContextMenu (4 surfaces: sidebar / message / roster / timeline).
- TweaksPanel.

**V2:**

- BoardView (Kanban — Backlog / In Progress / In Review / Shipped). Backed by a new `tasks` resource on the daemon.
- ArtifactsView (filterable grid). Reads existing media + adds `kind` metadata.
- Poll component + new `poll` event type on the daemon.

**Explicitly out of scope (entirely, not just V0):**

- **Image uploads** from the web composer. The artifacts view will render media that other peers shared, but the web UI is not a media-producing surface in this iteration. Paperclip stays as a disabled glyph.
- Message editing / deletion (the durable event log is append-only — edits would need a new event type and is a separate design).
- Read receipts originating from the web peer (the web peer auto-ack's whatever it reads; agents see "delivered" but never "read by you").
- Multi-window / multi-tab presence reconciliation (one tab = one web peer; opening two tabs registers two peers).
- Mobile / responsive layout below 1024 px wide.

**Complexity flags (where we expect to slow down):**

- The composer mention autocomplete needs careful caret + selection management; cribbing from prototype `chat.jsx` is the path.
- SSE on Bun requires careful `ReadableStream` lifecycle in the daemon route. Test with `EventSource` in the browser; fall back to polling on error.
- Markdown sanitization with `rehype-sanitize` needs a custom schema that permits the GFM tags (`del`, `input[type=checkbox]`, table tags) — default schema strips most of them.
- Resizable thread pane needs `pointermove` capture on a thin ink-bar handle; the prototype's `chat.jsx` has the working pattern.
